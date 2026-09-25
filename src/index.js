import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AppError } from './errors.js';
import { fetchCurrentDanmaku } from './danmaku.js';
import { homePage } from './home.js';
import { enforceDanmakuRateLimit, enforceRateLimits, hashIdentity } from './rate-limit.js';
import { resolveMedia, selectPlayableStream } from './resolver.js';
import {
  buildDashMpd,
  buildDashUrls,
  createDashTicket,
  dashTicketNeedsRefresh,
  getDashTicket,
  makeDashRecord,
  selectDashTracks,
  updateDashTicket,
} from './dash.js';
import { identifyPlatform, normalizeSourceUrl } from './utils/url.js';
import {
  authenticateCredential,
  createCredential,
  createPlaybackTicket,
  deleteCredential,
  getCredentialCookie,
  getPlaybackTicket,
  rotateCredential,
} from './credentials.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Expose-Headers': [
    'API-Version', 'X-Request-Id', 'X-Cache', 'X-RateLimit-Limit', 'X-RateLimit-Remaining',
    'X-RateLimit-Reset', 'Retry-After', 'X-Stream-Quality', 'X-Stream-Format',
  ].join(', '),
};

const dashRefreshLocks = new Map();

export async function handleRequest(request, dependencies = {}) {
  const startedAt = performance.now();
  const requestId = dependencies.requestId || randomUUID();
  const context = {
    platform: null,
    cacheHit: null,
    apiVersioned: isApiV1Path(new URL(request.url).pathname),
  };
  let response;

  try {
    response = await dispatchRequest(request, dependencies, context);
  } catch {
    response = errorResponse(new AppError(500, 'internal_error', 'Internal server error'));
  }

  if (context.apiVersioned) {
    response = await normalizeApiV1Response(response, requestId);
    response.headers.set('API-Version', '1');
  }
  response.headers.set('X-Request-Id', requestId);
  writeRequestLog(dependencies.logger, {
    event: 'http_request',
    requestId,
    method: request.method,
    path: safeLogPath(new URL(request.url).pathname),
    status: response.status,
    platform: context.platform,
    cacheHit: context.cacheHit,
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
    clientIpHash: hashIdentity(dependencies.clientIp || 'unknown'),
  });
  return response;
}

async function dispatchRequest(request, dependencies, context) {
  const env = dependencies.env || process.env;
  const resolve = dependencies.resolve || resolveMedia;
  const state = dependencies.state;
  const incomingUrl = new URL(request.url);
  context.apiVersioned = isApiV1Path(incomingUrl.pathname);

  if (request.method === 'OPTIONS') {
    return withCommonHeaders(new Response(null, { status: 204 }));
  }
  const requestPath = incomingUrl.pathname;
  const credentialPostPath = request.method === 'POST' && [
    '/api/v1/credentials',
    '/api/v1/credentials/current/rotate',
    '/api/v1/playback-tickets',
  ].includes(requestPath);
  const credentialDeletePath = request.method === 'DELETE' && requestPath === '/api/v1/credentials/current';
  const ticketPlayPath = request.method === 'GET' && isPlaybackTicketPath(requestPath);
  if (request.method !== 'GET' && !(request.method === 'HEAD' && isDashAssetPath(requestPath)) &&
      !credentialPostPath && !credentialDeletePath && !ticketPlayPath) {
    return errorResponse(new AppError(405, 'method_not_allowed', 'Method is not supported for this endpoint'), {
      Allow: isDashAssetPath(requestPath) ? 'GET, HEAD, OPTIONS' : 'GET, HEAD, POST, DELETE, OPTIONS',
    });
  }

  if (incomingUrl.pathname === '/api/v1' || incomingUrl.pathname === '/api/v1/') {
    return jsonResponse({
      service: 'Vrc2Link',
      apiVersion: '1',
      links: {
        openapi: '/api/v1/openapi.yaml',
        mediaResolve: '/api/v1/media/resolve',
        play: '/api/v1/play',
        credentials: '/api/v1/credentials',
        playbackTickets: '/api/v1/playback-tickets',
        currentPlaylist: '/api/v1/playlists/current',
      },
    });
  }
  if (incomingUrl.pathname === '/api/v1/openapi.yaml') {
    const document = await readFile(new URL('../docs/openapi-v1.yaml', import.meta.url), 'utf8');
    return withCommonHeaders(new Response(document, {
      headers: { 'Content-Type': 'application/yaml; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
    }));
  }

  const url = normalizeApiV1Url(incomingUrl);
  const dashAsset = parseDashAsset(url.pathname);

  let rateLimitHeaders = {};
  try {
    if (requestPath === '/api/v1/credentials' && request.method === 'POST') {
      return await handleCreateCredential(request, dependencies);
    }
    if (requestPath === '/api/v1/credentials/current/rotate' && request.method === 'POST') {
      return handleRotateCredential(request, dependencies);
    }
    if (requestPath === '/api/v1/credentials/current' && request.method === 'DELETE') {
      return handleDeleteCredential(request, dependencies);
    }
    if (requestPath === '/api/v1/playback-tickets' && request.method === 'POST') {
      return await handleCreatePlaybackTicket(request, dependencies);
    }
    if (ticketPlayPath) {
      return await handlePlaybackTicketRequest(request, dependencies, context);
    }
    if (dashAsset) return await handleDashAssetRequest(dashAsset, request, dependencies, context);
    if (url.pathname === '/') return withCommonHeaders(homePage());
    if (url.pathname === '/danmaku/current' || isCurrentDanmakuApi(url)) {
      return await handleDanmakuRequest(url, dependencies);
    }
    if (isCurrentPlaylistApi(url)) {
      return await handleCurrentPlaylistRequest(dependencies, context);
    }
    if (isPlaylistItemRequest(url)) {
      return await handlePlaylistItemRequest(url, request, dependencies, context);
    }
    if (isLegacyPlaylistApi(url)) {
      const replacement = url.searchParams.has('playlistItem')
        ? `/playlist/current/item/${encodeURIComponent(url.searchParams.get('playlistItem') || '')}`
        : '/playlist/current';
      throw new AppError(410, 'playlist_endpoint_moved', `Playlist endpoint moved to ${replacement}`);
    }
    if (url.pathname !== '/api' && url.pathname !== '/play' && url.pathname !== '/playlist') {
      throw new AppError(404, 'not_found', 'Endpoint not found');
    }

    const suppliedKey = requestApiKey(request, url);
    const credentialProfile = dependencies.credentialProfile || null;
    const profileId = credentialProfile?.profileId || '';
    const authenticated = credentialProfile != null || authenticate(suppliedKey, env.API_KEY);
    rateLimitHeaders = state
      ? enforceRateLimits({
          state,
          env,
          authenticated,
          suppliedKey: profileId || suppliedKey,
          clientIp: dependencies.clientIp || 'unknown',
        })
      : {};
    const cookies = credentialProfile
      ? { bilibili: credentialProfile.cookie }
      : authenticated
      ? Object.fromEntries([
          ['bilibili', env.BILIBILI_COOKIE],
          ['netease', env.NETEASE_COOKIE],
          ['douyin', env.DOUYIN_COOKIE],
          ['kuaishou', env.KUAISHOU_COOKIE],
        ].filter(([, value]) => value))
      : {};
    const requestedMode = url.searchParams.get('mode') || 'single';
    if (!['single', 'dash', 'auto'].includes(requestedMode)) {
      throw new AppError(400, 'invalid_play_mode', 'mode must be single, dash, or auto');
    }
    if (requestedMode !== 'single' && url.pathname !== '/api' && url.pathname !== '/play') {
      throw new AppError(400, 'invalid_play_mode', 'DASH modes are only available through /api or /play');
    }
    const playlistMode = url.pathname === '/playlist';
    const rawUrl = url.searchParams.get('url');
    const generic = genericOptions(env);
    context.platform = identifyPlatform(
      normalizeSourceUrl(rawUrl || '', { allowGeneric: generic.enabled }),
      { allowGeneric: generic.enabled },
    ) || null;
    const sourceMode = playbackModeForSource(requestedMode, rawUrl, context.platform);
    const quality = requestedMode === 'auto' && sourceMode === 'single'
      ? undefined
      : (url.pathname === '/play' || requestedMode === 'dash' || requestedMode === 'auto')
        ? url.searchParams.get('quality') || undefined
        : undefined;
    const playlistSessionId = url.pathname === '/play'
      ? beginPlaylistSession({
          state, env, clientIp: dependencies.clientIp || 'unknown', rawUrl, authenticated, profileId,
          mode: requestedMode, quality,
        })
      : undefined;
    const cacheKey = !authenticated && state
      ? mediaCacheKey(rawUrl, quality, generic.enabled, playlistMode, requestedMode)
      : undefined;
    let result = cacheKey ? state.getJson(cacheKey) : undefined;
    const cacheHit = result !== undefined;
    context.cacheHit = cacheKey ? cacheHit : null;
    if (!cacheHit) {
      result = await resolve(rawUrl, {
        authenticated, cookies, quality, generic, playlistMode,
        mode: sourceMode,
        resolverPrefix: env.PLAYLIST_RESOLVER_PREFIX || 'https://vrc2link.luonako.cn/api/v1/play?mode=auto&url=',
      });
      if (cacheKey) state.setJson(cacheKey, result, positiveInteger(env.CACHE_TTL_SECONDS, 300));
    }
    context.platform = result.platform || null;

    let playbackSourceUrl = rawUrl;
    let playlistSessionResult;
    if (url.pathname === '/play' && result.playlist) {
      playlistSessionResult = result;
      bindPlaylistSession({
        state, env, clientIp: dependencies.clientIp || 'unknown', rawUrl, authenticated, profileId,
        result: playlistSessionResult, sessionId: playlistSessionId,
        mode: requestedMode, quality,
      });
      const index = normalizePlaylistIndex(result.currentIndex, result.playlist.length);
      playbackSourceUrl = playlistEntrySource(result.playlist[index]);
      if (!playbackSourceUrl) {
        throw new AppError(422, 'invalid_playlist_item', 'The current playlist item has no playable source URL');
      }
      const itemMode = playbackModeForSource(requestedMode, playbackSourceUrl);
      const itemQuality = requestedMode === 'auto' && itemMode === 'single' ? undefined : quality;
      result = await resolve(playbackSourceUrl, {
        authenticated,
        cookies,
        quality: itemQuality,
        generic,
        playlistMode: false,
        mode: itemMode,
        resolverPrefix: env.PLAYLIST_RESOLVER_PREFIX || 'https://vrc2link.luonako.cn/api/v1/play?mode=auto&url=',
      });
      context.platform = result.platform || context.platform;
    }

    const playbackQuality = requestedMode === 'auto' &&
      !(result.platform === 'bilibili' && result.type === 'video')
      ? undefined
      : quality;
    const dashMode = usesDashForResult(requestedMode, result, playbackSourceUrl, playbackQuality);
    if (dashMode) {
      const session = createDashSession({
        request, env, state, rawUrl: playbackSourceUrl, authenticated, profileId, quality: playbackQuality, result,
      });
      if (url.pathname === '/play') {
        bindPlaylistSession({
          state,
          env,
          clientIp: dependencies.clientIp || 'unknown',
          rawUrl,
          authenticated,
          profileId,
          result: playlistSessionResult || result,
          sessionId: playlistSessionId,
          mode: requestedMode,
          quality,
        });
      }
      bindDanmakuSession({
        state,
        env,
        clientIp: dependencies.clientIp || 'unknown',
        rawUrl: playbackSourceUrl,
        result,
        profileId,
      });
      const headers = {
        'X-Stream-Quality': session.record.video.quality,
        'X-Stream-Format': 'mpd',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
        ...rateLimitHeaders,
        ...(cacheKey ? { 'X-Cache': cacheHit ? 'HIT' : 'MISS' } : {}),
      };
      if (url.pathname === '/play') {
        return withCommonHeaders(new Response(null, {
          status: 302,
          headers: { Location: session.urls.manifestUrl, ...headers },
        }));
      }
      return jsonResponse({
        ...result,
        dash: dashDescriptor(session),
      }, { headers });
    }

    if (url.pathname === '/api' || url.pathname === '/playlist') {
      if (url.pathname === '/playlist' && !result.playlist) {
        throw new AppError(422, 'not_a_playlist', 'The URL did not resolve to a playlist');
      }
      if (url.searchParams.get('danmaku') === '1') {
        bindDanmakuSession({
          state,
          env,
          clientIp: dependencies.clientIp || 'unknown',
          rawUrl,
          result,
          profileId,
        });
        const danmaku = await loadDanmakuForSession(url, result, dependencies);
        return jsonResponse({ ...result, danmaku }, {
          headers: {
            ...rateLimitHeaders,
            ...(cacheKey ? { 'X-Cache': cacheHit ? 'HIT' : 'MISS' } : {}),
          },
        });
      }
      return jsonResponse(result, {
        headers: {
          ...rateLimitHeaders,
          ...(cacheKey ? { 'X-Cache': cacheHit ? 'HIT' : 'MISS' } : {}),
        },
      });
    }

    const stream = selectPlayableStream(result, playbackQuality);
    if (url.pathname === '/play') {
      bindPlaylistSession({
        state, env, clientIp: dependencies.clientIp || 'unknown', rawUrl, authenticated, profileId,
        result: playlistSessionResult || result,
        sessionId: playlistSessionId,
        mode: requestedMode,
        quality,
      });
    }
    bindDanmakuSession({
      state,
      env,
      clientIp: dependencies.clientIp || 'unknown',
      rawUrl: playbackSourceUrl,
      result,
      profileId,
    });
    const streamHeaders = {
      'X-Stream-Quality': stream.quality,
      'X-Stream-Format': stream.format,
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      ...rateLimitHeaders,
      ...(cacheKey ? { 'X-Cache': cacheHit ? 'HIT' : 'MISS' } : {}),
    };
    if (shouldProxyStream(request, result, env)) {
      return await proxyStreamResponse(stream, request, streamHeaders, result.platform);
    }
    return withCommonHeaders(new Response(null, {
      status: 302,
      headers: { Location: stream.url, ...streamHeaders },
    }));
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error, { ...rateLimitHeaders, ...error.headers });
    }
    return errorResponse(new AppError(500, 'internal_error', 'Internal server error'));
  }
}

async function handleCreateCredential(request, dependencies) {
  const env = dependencies.env || process.env;
  const state = dependencies.state;
  if (!state) throw new AppError(503, 'state_unavailable', 'Credential storage is unavailable');
  const clientIp = dependencies.clientIp || 'unknown';
  const rateLimitHeaders = enforceRateLimits({
    state, env, authenticated: false, suppliedKey: '', clientIp,
  });
  const body = await readJsonBody(request);
  const credential = createCredential({
    state,
    env,
    cookie: body.cookie,
    retentionDays: body.retentionDays,
  });
  return jsonResponse({
    key: credential.key,
    expiresAt: credential.expiresAt,
    retentionDays: body.retentionDays,
    revealOnce: true,
  }, { status: 201, headers: rateLimitHeaders });
}

function handleRotateCredential(request, dependencies) {
  const credential = rotateCredential({
    state: dependencies.state,
    key: requiredBearerKey(request),
  });
  return jsonResponse({
    key: credential.key,
    expiresAt: credential.expiresAt,
    revealOnce: true,
  });
}

function handleDeleteCredential(request, dependencies) {
  deleteCredential({
    state: dependencies.state,
    key: requiredBearerKey(request),
  });
  return jsonResponse({ deleted: true });
}

async function handleCreatePlaybackTicket(request, dependencies) {
  const env = dependencies.env || process.env;
  const state = dependencies.state;
  if (!state) throw new AppError(503, 'state_unavailable', 'Playback ticket storage is unavailable');
  const key = requiredBearerKey(request);
  const credential = authenticateCredential({ state, env, key });
  const rateLimitHeaders = enforceRateLimits({
    state, env, authenticated: true, suppliedKey: key, clientIp: dependencies.clientIp || 'unknown',
  });
  const body = await readJsonBody(request);
  const rawUrl = String(body.url || '').trim();
  const sourceUrl = normalizeSourceUrl(rawUrl);
  if (!sourceUrl || identifyPlatform(sourceUrl) !== 'bilibili') {
    throw new AppError(400, 'invalid_bilibili_url', 'Playback tickets require a supported Bilibili video, live, or collection URL');
  }
  const mode = body.mode == null || body.mode === '' ? 'auto' : String(body.mode);
  if (!['auto', 'dash', 'single'].includes(mode)) {
    throw new AppError(400, 'invalid_play_mode', 'mode must be auto, dash, or single');
  }
  const quality = String(body.quality || '').trim();
  if (quality.length > 32 || /[^\w.-]/u.test(quality)) {
    throw new AppError(400, 'invalid_quality', 'quality contains unsupported characters');
  }
  const ticket = createPlaybackTicket({
    state,
    env,
    profileId: credential.profileId,
    sourceUrl,
    mode,
    quality,
  });
  const configuredBase = String(env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/u, '');
  const publicBase = configuredBase || new URL(request.url).origin;
  return jsonResponse({
    playUrl: `${publicBase}/api/v1/playback-tickets/${ticket.token}/play`,
    expiresAt: ticket.expiresAt,
    expiresInSeconds: ticket.ttlSeconds,
    mode,
    quality: quality || 'auto',
  }, { headers: rateLimitHeaders });
}

async function handlePlaybackTicketRequest(request, dependencies, context) {
  const pathname = new URL(request.url).pathname;
  const match = pathname.match(/^\/api\/v1\/playback-tickets\/([A-Za-z0-9_-]{43})\/play$/u);
  const ticket = getPlaybackTicket({ state: dependencies.state, token: match?.[1] });
  if (!ticket) throw new AppError(404, 'playback_ticket_not_found', 'Playback ticket is missing or expired');
  const env = dependencies.env || process.env;
  const cookie = getCredentialCookie({ state: dependencies.state, env, profileId: ticket.profileId });
  const replayUrl = new URL(request.url);
  replayUrl.pathname = '/api/v1/play';
  replayUrl.search = '';
  replayUrl.searchParams.set('url', ticket.sourceUrl);
  replayUrl.searchParams.set('mode', ticket.mode || 'auto');
  if (ticket.quality) replayUrl.searchParams.set('quality', ticket.quality);
  const headers = new Headers(request.headers);
  headers.delete('authorization');
  headers.delete('cookie');
  const replayRequest = new Request(replayUrl, { method: 'GET', headers });
  return dispatchRequest(replayRequest, {
    ...dependencies,
    credentialProfile: { profileId: ticket.profileId, cookie },
  }, context);
}

function isPlaybackTicketPath(pathname) {
  return /^\/api\/v1\/playback-tickets\/[A-Za-z0-9_-]{43}\/play$/u.test(String(pathname || ''));
}

function safeLogPath(pathname) {
  return String(pathname || '')
    .replace(/(\/api\/v1\/playback-tickets\/)[A-Za-z0-9_-]{43}(\/play)/u, '$1:ticket$2')
    .replace(/(\/(?:api\/v1\/)?dash\/)[A-Za-z0-9_-]{32}(\/)/u, '$1:ticket$2');
}

function requiredBearerKey(request) {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+([^\s]+)$/iu);
  if (!match) throw new AppError(401, 'invalid_authorization', 'Authorization must use the Bearer scheme');
  return match[1];
}

async function readJsonBody(request) {
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get('content-type') || '')) {
    throw new AppError(415, 'unsupported_media_type', 'Content-Type must be application/json');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, 'invalid_json', 'Request body must contain a JSON object');
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32 * 1024) {
      await reader.cancel();
      throw new AppError(413, 'request_body_too_large', 'JSON request body must be 32 KB or smaller');
    }
    chunks.push(Buffer.from(value));
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError(400, 'invalid_json', 'Request body must contain valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'invalid_json', 'Request body must contain a JSON object');
  }
  return value;
}

function isApiV1Path(pathname) {
  return pathname === '/api/v1' || pathname.startsWith('/api/v1/');
}

function isDashAssetPath(pathname) {
  return /^\/(?:api\/v1\/)?dash\/[A-Za-z0-9_-]{32}\/(?:manifest\.mpd|video|audio)$/u.test(pathname);
}

function normalizeApiV1Url(url) {
  if (!isApiV1Path(url.pathname)) return url;
  const path = url.pathname;
  const fixedRoutes = new Map([
    ['/api/v1/media/resolve', '/api'],
    ['/api/v1/play', '/play'],
    ['/api/v1/playlists/resolve', '/playlist'],
    ['/api/v1/playlists/current', '/playlist/current'],
  ]);
  if (fixedRoutes.has(path)) {
    url.pathname = fixedRoutes.get(path);
    return url;
  }

  const itemMatch = path.match(/^\/api\/v1\/playlists\/current\/items\/([^/]+)$/u);
  if (itemMatch) {
    url.pathname = `/playlist/current/item/${itemMatch[1]}`;
    return url;
  }

  const segmentMatch = path.match(/^\/api\/v1\/danmaku\/current\/video\/segments\/(\d+)$/u);
  if (segmentMatch) {
    url.pathname = '/danmaku/current';
    url.searchParams.set('segment', segmentMatch[1]);
    url.searchParams.set('live', '0');
    return url;
  }
  if (path === '/api/v1/danmaku/current/live') {
    url.pathname = '/danmaku/current';
    url.searchParams.set('live', '1');
    return url;
  }

  if (path.startsWith('/api/v1/dash/')) {
    url.pathname = path.slice('/api/v1'.length);
  }
  return url;
}

function requestApiKey(request, url) {
  const authorization = request.headers.get('authorization');
  if (!authorization) return url.searchParams.get('key');
  const match = authorization.match(/^Bearer\s+([^\s]+)$/iu);
  if (!match) {
    throw new AppError(401, 'invalid_authorization', 'Authorization must use the Bearer scheme');
  }
  return match[1];
}

async function normalizeApiV1Response(response, requestId) {
  if (!response.headers.get('content-type')?.includes('application/json')) return response;

  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const meta = { apiVersion: '1', requestId };
  const normalized = response.ok
    ? { data: body, meta }
    : {
        error: body?.error || { code: 'http_error', message: response.statusText || 'Request failed' },
        meta,
      };
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return withCommonHeaders(new Response(JSON.stringify(normalized, null, 2), {
    status: response.status,
    statusText: response.statusText,
    headers,
  }));
}

function shouldProxyStream(request, result, env) {
  if (String(env.QUEST_STREAM_PROXY).toLowerCase() !== 'true') return false;
  const userAgent = request.headers.get('user-agent') || '';
  if (!/android|quest|oculus/i.test(userAgent)) return false;
  return result?.platform === 'bilibili' || result?.platform === 'netease';
}

function playbackModeForSource(requestedMode, sourceUrl, knownPlatform) {
  if (requestedMode === 'dash') return 'dash';
  if (requestedMode !== 'auto') return 'single';
  const platform = knownPlatform || identifyPlatform(normalizeSourceUrl(sourceUrl || ''));
  return platform === 'bilibili' ? 'auto' : 'single';
}

function usesDashForResult(requestedMode, result, sourceUrl, quality) {
  if (requestedMode === 'dash') return true;
  if (requestedMode !== 'auto') return false;
  const platform = result?.platform || identifyPlatform(normalizeSourceUrl(sourceUrl || ''));
  if (platform !== 'bilibili' || result?.type !== 'video') return false;

  try {
    selectDashTracks(result, quality);
    return true;
  } catch {
    return !hasPlayableSingleStream(result, quality);
  }
}

function hasPlayableSingleStream(result, quality) {
  return (result?.streams || []).some((stream) =>
    stream.url && stream.type !== 'video-only' && stream.type !== 'audio-only' &&
    (!quality || stream.quality === quality),
  );
}

function parseDashAsset(pathname) {
  const match = String(pathname || '').match(/^\/dash\/([A-Za-z0-9_-]{32})\/(manifest\.mpd|video|audio)$/u);
  if (!match) return null;
  return { ticket: match[1], kind: match[2] };
}

async function handleDashAssetRequest(asset, request, dependencies, context) {
  const env = dependencies.env || process.env;
  const state = dependencies.state;
  if (!state) throw new AppError(503, 'state_unavailable', 'DASH ticket state is unavailable');

  const record = await loadFreshDashTicket(asset.ticket, dependencies);
  context.platform = record.platform || null;
  const urls = buildDashUrls(request, env, asset.ticket);
  if (asset.kind === 'manifest.mpd') {
    const headers = {
      'Content-Type': 'application/dash+xml; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    };
    return withCommonHeaders(new Response(request.method === 'HEAD' ? null : buildDashMpd(record, urls), {
      status: 200,
      headers,
    }));
  }

  const track = asset.kind === 'video' ? record.video : record.audio;
  const location = track?.url || track?.backupUrls?.[0];
  if (!location) throw new AppError(502, 'dash_track_unavailable', `DASH ${asset.kind} track is unavailable`);
  return withCommonHeaders(new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Stream-Quality': track.quality || 'unknown',
      'X-Stream-Format': track.format || 'mp4',
    },
  }));
}

function createDashSession({ request, env, state, rawUrl, authenticated, profileId, quality, result }) {
  const sourceUrl = normalizeSourceUrl(rawUrl || '');
  const tracks = selectDashTracks(result, quality);
  const record = makeDashRecord({
    sourceUrl,
    authenticated,
    profileId,
    quality,
    result,
    tracks,
  });
  const ttlSeconds = dashTicketTtl(env, result);
  record.ticketExpiresAt = Date.now() + ttlSeconds * 1000;
  const ticketSession = createDashTicket(state, record, ttlSeconds);
  return {
    ticket: ticketSession.ticket,
    record: ticketSession.record,
    urls: buildDashUrls(request, env, ticketSession.ticket),
  };
}

function dashDescriptor(session) {
  const { record, urls } = session;
  return {
    mode: 'dash',
    ticket: session.ticket,
    ticketExpiresAt: record.ticketExpiresAt || null,
    manifestUrl: urls.manifestUrl,
    videoUrl: urls.videoUrl,
    audioUrl: urls.audioUrl,
    video: dashTrackDescriptor(record.video),
    audio: dashTrackDescriptor(record.audio),
  };
}

function dashTrackDescriptor(track) {
  return {
    quality: track.quality,
    codec: track.codec,
    bandwidth: track.bandwidth,
    trackId: track.trackId,
    ...(track.width ? { width: track.width } : {}),
    ...(track.height ? { height: track.height } : {}),
    ...(track.sampleRate ? { sampleRate: track.sampleRate } : {}),
  };
}

async function loadFreshDashTicket(ticket, dependencies) {
  const state = dependencies.state;
  const env = dependencies.env || process.env;
  const initial = getDashTicket(state, ticket);
  if (!initial) throw new AppError(404, 'dash_ticket_not_found', 'DASH ticket is missing or expired');
  if (initial.profileId) getCredentialCookie({ state, env, profileId: initial.profileId });
  if (!dashTicketNeedsRefresh(initial)) return initial;

  const existing = dashRefreshLocks.get(ticket);
  if (existing) return existing;
  const refresh = refreshDashTicket(ticket, dependencies, env)
    .finally(() => dashRefreshLocks.delete(ticket));
  dashRefreshLocks.set(ticket, refresh);
  return refresh;
}

async function refreshDashTicket(ticket, dependencies, env) {
  const latest = getDashTicket(dependencies.state, ticket);
  if (!latest) throw new AppError(404, 'dash_ticket_not_found', 'DASH ticket is missing or expired');
  if (!dashTicketNeedsRefresh(latest)) return latest;

  const resolve = dependencies.resolve || resolveMedia;
  const result = await resolve(latest.sourceUrl, {
    authenticated: latest.authenticated === true,
    cookies: cookiesForAuthentication(latest.authenticated === true, env, latest.profileId, dependencies.state),
    quality: latest.quality,
    generic: genericOptions(env),
    mode: 'dash',
  });
  if ((latest.id && String(result.id || '') !== String(latest.id)) ||
      (latest.cid && String(result.cid || '') !== String(latest.cid))) {
    throw new AppError(409, 'dash_source_changed', 'DASH refresh resolved a different media item');
  }
  const tracks = selectDashTracks(result, latest.quality);
  const next = makeDashRecord({
    sourceUrl: latest.sourceUrl,
    authenticated: latest.authenticated === true,
    profileId: latest.profileId,
    quality: latest.quality,
    result,
    tracks,
  });
  next.ticketExpiresAt = latest.ticketExpiresAt;
  const updated = updateDashTicket(
    dependencies.state,
    ticket,
    latest,
    next,
    dashTicketTtl(env),
  );
  if (updated) return updated;
  const concurrent = getDashTicket(dependencies.state, ticket);
  if (concurrent) return concurrent;
  throw new AppError(404, 'dash_ticket_not_found', 'DASH ticket expired during refresh');
}

async function proxyStreamResponse(stream, request, headers, platform) {
  const upstreamHeaders = new Headers();
  for (const name of ['range', 'if-range', 'accept', 'user-agent']) {
    const value = request.headers.get(name);
    if (value) upstreamHeaders.set(name, value);
  }
  if (platform === 'bilibili') {
    upstreamHeaders.set('Referer', 'https://www.bilibili.com/');
    upstreamHeaders.set('Origin', 'https://www.bilibili.com');
  } else if (platform === 'netease') {
    upstreamHeaders.set('Referer', 'https://music.163.com/');
    upstreamHeaders.set('Origin', 'https://music.163.com');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let upstream;
  try {
    upstream = await fetch(stream.url, {
      method: 'GET',
      headers: upstreamHeaders,
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (error) {
    throw new AppError(502, 'upstream_stream_error', error?.name === 'AbortError'
      ? 'Upstream stream timed out'
      : 'Unable to open upstream stream');
  } finally {
    clearTimeout(timeout);
  }

  const responseHeaders = new Headers(headers);
  for (const name of [
    'content-type', 'content-length', 'content-range', 'accept-ranges',
    'etag', 'last-modified', 'expires',
  ]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  const upstreamContentType = responseHeaders.get('content-type') || '';
  if (!upstreamContentType || upstreamContentType === 'application/octet-stream') {
    const mediaTypes = {
      mp4: platform === 'netease' && stream.codec === 'aac' ? 'audio/mp4' : 'video/mp4',
      mp3: 'audio/mpeg',
      flac: 'audio/flac',
      m3u8: 'application/vnd.apple.mpegurl',
      flv: 'video/x-flv',
    };
    const mediaType = mediaTypes[String(stream.format || '').toLowerCase()];
    if (mediaType) responseHeaders.set('Content-Type', mediaType);
  }
  responseHeaders.set('Cache-Control', 'no-store');
  return withCommonHeaders(new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  }));
}

async function handleDanmakuRequest(url, dependencies) {
  const env = dependencies.env || process.env;
  const state = dependencies.state;
  if (!state) throw new AppError(503, 'state_unavailable', 'Danmaku state is unavailable');

  const clientIp = dependencies.clientIp || 'unknown';
  const rateLimitHeaders = enforceDanmakuRateLimit({ state, env, clientIp });
  const identity = hashIdentity(clientIp);
  const session = state.getJson(`danmaku:session:${identity}`);
  if (!session) {
    throw new AppError(
      409,
      'no_danmaku_session',
      'Play a supported URL through /play before requesting danmaku',
    );
  }

  const result = await loadDanmakuForSession(url, session, dependencies, identity);
  return jsonResponse(result, { headers: rateLimitHeaders });
}

async function loadDanmakuForSession(url, session, dependencies, identityOverride) {
  const env = dependencies.env || process.env;
  const state = dependencies.state;
  const clientIp = dependencies.clientIp || 'unknown';
  const identity = identityOverride || hashIdentity(clientIp);
  const live = url.searchParams.get('live') === '1';
  const rawSegment = url.searchParams.get('segment') || '1';
  const segment = Number.parseInt(rawSegment, 10);
  if (!live && (!Number.isInteger(segment) || segment < 1 || segment > 240)) {
    throw new AppError(400, 'invalid_segment', 'segment must be an integer from 1 to 240');
  }
  const loadDanmaku = dependencies.fetchDanmaku || fetchCurrentDanmaku;
  return loadDanmaku(session, { segment, live }, {
    env,
    state,
    clientIdentity: identity,
  });
}

function isCurrentDanmakuApi(url) {
  return url.pathname === '/api' &&
    url.searchParams.get('danmaku') === '1' &&
    !url.searchParams.has('url');
}

function isCurrentPlaylistApi(url) {
  return url.pathname === '/playlist/current';
}

function isPlaylistItemRequest(url) {
  return /^\/playlist\/current\/item\/[^/]+$/u.test(url.pathname);
}

function isLegacyPlaylistApi(url) {
  return url.pathname === '/api' && !url.searchParams.has('url') &&
    (url.searchParams.get('playlist') === '1' || url.searchParams.has('playlistItem'));
}

async function handleCurrentPlaylistRequest(dependencies, context) {
  const env = dependencies.env || process.env;
  const state = dependencies.state;
  if (!state) throw new AppError(503, 'state_unavailable', 'Playlist state is unavailable');

  const clientIp = dependencies.clientIp || 'unknown';
  const rateLimitHeaders = enforceDanmakuRateLimit({ state, env, clientIp });
  const sessionKey = playlistSessionKey(clientIp);
  const session = state.getJson(sessionKey);
  if (!session || !session.sourceUrl) {
    throw new AppError(409, 'no_playlist_session', 'Play a playlist-capable URL through /play first');
  }
  if (session.pending) {
    throw new AppError(409, 'playlist_session_pending', 'The current media is still being resolved');
  }

  let result = session.result;
  if (!result?.playlist) {
    const resolve = dependencies.resolve || resolveMedia;
    result = await resolve(session.sourceUrl, {
      authenticated: session.authenticated === true,
      cookies: cookiesForAuthentication(session.authenticated === true, env, session.profileId, state),
      generic: genericOptions(env),
      playlistMode: true,
      resolverPrefix: env.PLAYLIST_RESOLVER_PREFIX || 'https://vrc2link.luonako.cn/api/v1/play?mode=auto&url=',
    });
    const currentSession = state.getJson(sessionKey);
    if (currentSession?.sessionId !== session.sessionId) {
      throw new AppError(409, 'playlist_session_changed', 'The current media changed while its playlist was loading');
    }
    if (!result?.playlist) {
      throw new AppError(422, 'not_a_playlist', 'The current media does not expose a playlist');
    }
    session.result = result;
    state.setJson(sessionKey, session, playlistSessionTtl(env));
  }
  context.platform = result.platform || null;
  return jsonResponse(playlistManifest(result, session), { headers: rateLimitHeaders });
}

async function handlePlaylistItemRequest(url, request, dependencies, context) {
  const env = dependencies.env || process.env;
  const state = dependencies.state;
  if (!state) throw new AppError(503, 'state_unavailable', 'Playlist state is unavailable');

  const clientIp = dependencies.clientIp || 'unknown';
  const session = state.getJson(playlistSessionKey(clientIp));
  if (!session?.result?.playlist) {
    throw new AppError(409, 'no_playlist_session', 'Load the current playlist manifest before selecting an item');
  }
  const itemMatch = url.pathname.match(/^\/playlist\/current\/item\/([^/]+)$/u);
  const rawIndex = itemMatch?.[1] || '';
  const index = Number.parseInt(rawIndex, 10);
  if (!/^\d+$/u.test(rawIndex) || !Number.isInteger(index) || index < 0 || index >= session.result.playlist.length) {
    throw new AppError(400, 'invalid_playlist_item', 'playlistItem is outside the current playlist');
  }
  session.result.currentIndex = index;
  session.autoPlay = false;
  state.setJson(playlistSessionKey(clientIp), session, playlistSessionTtl(env));
  const rateLimitHeaders = enforceDanmakuRateLimit({ state, env, clientIp });
  return resolvePlaylistItemResponse(
    session.result,
    index,
    {
      ...dependencies,
      env,
      resolve: dependencies.resolve || resolveMedia,
      authenticated: session.authenticated === true,
      profileId: session.profileId || '',
      mode: session.mode || 'single',
      quality: session.quality,
      request,
    },
    context,
    rateLimitHeaders,
  );
}

async function resolvePlaylistItemResponse(playlistResult, index, dependencies, context, headers = {}) {
  const entry = playlistResult.playlist[index];
  const sourceUrl = playlistEntrySource(entry);
  if (!sourceUrl) throw new AppError(422, 'invalid_playlist_item', 'Playlist item has no playable source URL');
  const env = dependencies.env || process.env;
  const generic = genericOptions(env);
  const requestedMode = dependencies.mode || 'single';
  const sourcePlatform = identifyPlatform(
    normalizeSourceUrl(sourceUrl, { allowGeneric: generic.enabled }),
    { allowGeneric: generic.enabled },
  );
  const resolveMode = playbackModeForSource(requestedMode, sourceUrl, sourcePlatform);
  const quality = requestedMode === 'auto' && resolveMode === 'single'
    ? undefined
    : dependencies.quality;
  const result = await dependencies.resolve(sourceUrl, {
    authenticated: dependencies.authenticated === true,
    cookies: cookiesForAuthentication(dependencies.authenticated === true, env, dependencies.profileId, dependencies.state),
    generic,
    quality,
    mode: resolveMode,
    playlistMode: false,
    resolverPrefix: env.PLAYLIST_RESOLVER_PREFIX || 'https://vrc2link.luonako.cn/api/v1/play?mode=auto&url=',
  });
  context.platform = result.platform || playlistResult.platform || null;
  bindDanmakuSession({
    state: dependencies.state,
    env,
    clientIp: dependencies.clientIp || 'unknown',
    rawUrl: sourceUrl,
    result,
    profileId: dependencies.profileId,
  });
  if (usesDashForResult(requestedMode, result, sourceUrl, quality)) {
    const session = createDashSession({
      request: dependencies.request,
      env,
      state: dependencies.state,
      rawUrl: sourceUrl,
      authenticated: dependencies.authenticated === true,
      profileId: dependencies.profileId,
      quality,
      result,
    });
    return withCommonHeaders(new Response(null, {
      status: 302,
      headers: {
        Location: session.urls.manifestUrl,
        'X-Stream-Quality': session.record.video.quality,
        'X-Stream-Format': 'mpd',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
        ...headers,
      },
    }));
  }
  const stream = selectPlayableStream(result, quality);
  return withCommonHeaders(new Response(null, {
    status: 302,
    headers: {
      Location: stream.url,
      'X-Stream-Quality': stream.quality,
      'X-Stream-Format': stream.format,
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      ...headers,
    },
  }));
}

function beginPlaylistSession({ state, env, clientIp, rawUrl, authenticated, profileId, mode, quality }) {
  if (!state) return;
  const sourceUrl = normalizeSourceUrl(rawUrl || '');
  if (!sourceUrl) return;
  const sessionId = randomUUID();
  state.setJson(playlistSessionKey(clientIp), {
    sourceUrl,
    authenticated: authenticated === true,
    profileId: profileId || '',
    mode: mode || 'single',
    quality,
    autoPlay: false,
    pending: true,
    sessionId,
  }, playlistSessionTtl(env));
  return sessionId;
}

function bindPlaylistSession({ state, env, clientIp, rawUrl, authenticated, profileId, result, sessionId, mode, quality }) {
  if (!state) return;
  const sourceUrl = normalizeSourceUrl(rawUrl || '');
  if (!sourceUrl) return;
  const sessionKey = playlistSessionKey(clientIp);
  const current = state.getJson(sessionKey);
  if (sessionId && current?.sessionId !== sessionId) return;
  state.setJson(sessionKey, {
    sourceUrl,
    authenticated: authenticated === true,
    profileId: profileId || current?.profileId || '',
    mode: mode || current?.mode || 'single',
    quality: quality ?? current?.quality,
    autoPlay: Boolean(result?.playlist),
    pending: false,
    ...(sessionId ? { sessionId } : {}),
    ...(result?.playlist ? { result } : {}),
  }, playlistSessionTtl(env));
}

function playlistManifest(result, session) {
  const playlist = result.playlist || [];
  return {
    type: 'playlist',
    title: result.meta?.title || result.title || 'Playlist',
    count: playlist.length,
    currentIndex: normalizePlaylistIndex(result.currentIndex, playlist.length),
    autoPlay: session?.autoPlay === true,
    entries: playlist.map((entry, index) => ({ title: entry.title || `Item ${index + 1}` })),
  };
}

function playlistEntrySource(entry) {
  if (entry?.sourceUrl) return entry.sourceUrl;
  if (!entry?.url) return '';
  try {
    return new URL(entry.url).searchParams.get('url') || entry.url;
  } catch {
    return entry.url;
  }
}

function normalizePlaylistIndex(value, length) {
  if (length <= 0) return 0;
  const index = Number.parseInt(value, 10);
  return Number.isInteger(index) && index >= 0 && index < length ? index : 0;
}

function cookiesForAuthentication(authenticated, env, profileId = '', state) {
  if (!authenticated) return {};
  if (profileId) return { bilibili: getCredentialCookie({ state, env, profileId }) };
  return Object.fromEntries([
    ['bilibili', env.BILIBILI_COOKIE],
    ['netease', env.NETEASE_COOKIE],
    ['douyin', env.DOUYIN_COOKIE],
    ['kuaishou', env.KUAISHOU_COOKIE],
  ].filter(([, value]) => value));
}

function playlistSessionKey(clientIp) {
  return `playlist:session:${hashIdentity(clientIp)}`;
}

function playlistSessionTtl(env) {
  return positiveInteger(env.PLAYLIST_SESSION_TTL_SECONDS, 21600);
}

function dashTicketTtl(env, result) {
  const configured = positiveInteger(env.DASH_TICKET_TTL_SECONDS, 3600);
  const duration = Number(result?.duration);
  const mediaWindow = Number.isFinite(duration) && duration > 0
    ? Math.min(86400, Math.ceil(duration) + 300)
    : 0;
  return Math.max(configured, mediaWindow);
}

function bindDanmakuSession({ state, env, clientIp, rawUrl, result, profileId = '' }) {
  if (!state) return;
  const sourceUrl = normalizeSourceUrl(rawUrl || '');
  state.setJson(`danmaku:session:${hashIdentity(clientIp)}`, {
    platform: result.platform,
    type: result.type,
    id: result.id,
    webRid: result.webRid || '',
    sourceUrl,
    authenticated: result.authenticated === true,
    profileId,
  }, positiveInteger(env.DANMAKU_SESSION_TTL_SECONDS, 21600));
}

function writeRequestLog(logger, entry) {
  if (typeof logger !== 'function') return;
  try {
    logger(entry);
  } catch {
    // Logging failures must not break media requests.
  }
}

function mediaCacheKey(rawUrl, quality, allowGeneric = false, playlistMode = false, mode = 'single') {
  const normalized = normalizeSourceUrl(rawUrl || '', { allowGeneric });
  const digest = createHash('sha256')
    .update(`${normalized}\n${quality || ''}\n${playlistMode ? 'playlist' : 'media'}\n${mode}`)
    .digest('hex');
  return `media:${digest}`;
}

function genericOptions(env) {
  return {
    enabled: booleanValue(env.GENERIC_RESOLVER_ENABLED, false),
    requireKey: booleanValue(env.GENERIC_RESOLVER_REQUIRE_KEY, true),
    ytDlpPath: env.YT_DLP_PATH || 'yt-dlp',
    timeoutMs: positiveInteger(env.GENERIC_RESOLVER_TIMEOUT_MS, 20000),
    maxConcurrent: positiveInteger(env.GENERIC_RESOLVER_MAX_CONCURRENT, 2),
  };
}

function booleanValue(value, fallback) {
  if (value == null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function authenticate(suppliedKey, expectedKey) {
  if (!suppliedKey) return false;
  if (!expectedKey || !secureEqual(suppliedKey, expectedKey)) {
    throw new AppError(401, 'invalid_key', 'Invalid API key');
  }
  return true;
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function jsonResponse(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return withCommonHeaders(new Response(JSON.stringify(body, null, 2), { ...init, headers }));
}

function errorResponse(error, extraHeaders = {}) {
  return jsonResponse({
    error: {
      code: error.code,
      message: error.message,
    },
  }, {
    status: error.status,
    headers: extraHeaders,
  });
}

function withCommonHeaders(response) {
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}
