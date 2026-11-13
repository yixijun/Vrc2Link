import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AppError } from './errors.js';
import { createRuntimeConfig, playlistResolverPrefix as configuredPlaylistResolverPrefix, publicBaseUrl as configuredPublicBaseUrl } from './runtime-config.js';
import {
  errorResponse,
  jsonResponse,
  normalizeApiV1Response,
  withCommonHeaders,
} from './http-response.js';
import {
  playbackModeForSource as playbackModeForSourcePolicy,
  usesDashForResult as usesDashForResultPolicy,
} from './playback-policy.js';
import {
  beginPlaylistSession as beginPlaylistSessionModule,
  bindPlaylistSession as bindPlaylistSessionModule,
  normalizePlaylistIndex as normalizePlaylistIndexModule,
  playlistEntrySource as playlistEntrySourceModule,
  playlistManifest as playlistManifestModule,
  playlistSessionKey as playlistSessionKeyModule,
} from './playlist-session.js';
import { fetchCurrentDanmaku } from './danmaku.js';
import { homePage } from './home.js';
import { enforceDanmakuRateLimit, enforceRateLimits, hashIdentity } from './rate-limit.js';
import { resolveMedia, selectPlayableStream } from './resolver.js';
import { choosePlayableCdn } from './cdn-selection.js';
import {
  createDashPlaybackResponse,
  handleDashAssetRequest,
} from './dash-playback.js';
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
import { parseCdnPreference } from './utils/cdn.js';
import {
  extractTrailingQueryValue,
  isApiV1Path,
  isDashAssetPath,
  isPlaybackTicketPath,
  normalizeApiV1Url,
  parseDashAsset,
  requestApiKey,
  requiredBearerKey,
  safeLogPath,
} from './http-routing.js';

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
  const env = createRuntimeConfig(dependencies.env || process.env);
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
        playbackTicketResolve: '/api/v1/playback-tickets/resolve',
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
    if (requestPath === '/api/v1/playback-tickets/resolve' && request.method === 'GET') {
      return await handleCreatePlaybackTicketFromQuery(request, dependencies);
    }
    if (ticketPlayPath) {
      return await handlePlaybackTicketRequest(request, dependencies, context);
    }
    if (dashAsset) {
      return await handleDashAssetRequest(dashAsset, request, { ...dependencies, env }, context, {
        genericOptions,
        getBilibiliCdnPreference,
      });
    }
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
      if (String(env.LEGACY_PLAYLIST_ENDPOINTS).toLowerCase() !== 'false') {
        if (url.searchParams.has('playlistItem')) {
          const legacyItemUrl = new URL(url);
          legacyItemUrl.pathname = `/playlist/current/item/${encodeURIComponent(url.searchParams.get('playlistItem') || '')}`;
          return await handlePlaylistItemRequest(legacyItemUrl, request, dependencies, context);
        }
        return await handleCurrentPlaylistRequest(dependencies, context);
      }
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
    const bilibiliCdnPreference = getBilibiliCdnPreference(env);
    context.platform = identifyPlatform(
      normalizeSourceUrl(rawUrl || '', { allowGeneric: generic.enabled }),
      { allowGeneric: generic.enabled },
    ) || null;
    const sourceMode = playbackModeForSourcePolicy(requestedMode, rawUrl, context.platform);
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
      ? mediaCacheKey(rawUrl, quality, generic.enabled, playlistMode, requestedMode, bilibiliCdnPreference)
      : undefined;
    let result = cacheKey ? state.getJson(cacheKey) : undefined;
    const cacheHit = result !== undefined;
    context.cacheHit = cacheKey ? cacheHit : null;
    if (!cacheHit) {
      result = await resolve(rawUrl, {
        authenticated, cookies, quality, generic, playlistMode,
        bilibiliCdnPreference,
        mode: sourceMode,
        resolverPrefix: configuredPlaylistResolverPrefix(env),
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
      const index = normalizePlaylistIndexModule(result.currentIndex, result.playlist.length);
      playbackSourceUrl = playlistEntrySourceModule(result.playlist[index]);
      if (!playbackSourceUrl) {
        throw new AppError(422, 'invalid_playlist_item', 'The current playlist item has no playable source URL');
      }
      const itemMode = playbackModeForSourcePolicy(requestedMode, playbackSourceUrl);
      const itemQuality = requestedMode === 'auto' && itemMode === 'single' ? undefined : quality;
      result = await resolve(playbackSourceUrl, {
        authenticated,
        cookies,
        quality: itemQuality,
        generic,
        bilibiliCdnPreference,
        playlistMode: false,
        mode: itemMode,
        resolverPrefix: configuredPlaylistResolverPrefix(env),
      });
      context.platform = result.platform || context.platform;
    }

    const playbackQuality = requestedMode === 'auto' &&
      !(result.platform === 'bilibili' && result.type === 'video')
      ? undefined
      : quality;
    const dashMode = usesDashForResultPolicy(requestedMode, result, playbackSourceUrl, playbackQuality);
    if (dashMode) {
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
      return createDashPlaybackResponse({
        request,
        env,
        state,
        rawUrl: playbackSourceUrl,
        authenticated,
        profileId,
        quality: playbackQuality,
        result,
        pathname: url.pathname,
        responseMode: url.searchParams.get('response'),
        rateLimitHeaders,
        cacheKey,
        cacheHit,
      });
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

    const streamQuality = requestedMode === 'auto' && result.platform === 'bilibili' && result.type === 'video'
      ? undefined
      : playbackQuality;
    let stream = selectPlayableStream(result, streamQuality, muxedMp4Selection(result));
    stream = await choosePlayableCdn(stream, result);
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
  const publicBase = configuredPublicBaseUrl(env);
  return jsonResponse({
    // Keep the public URL looking like a DASH manifest. VRChat's URL resolver
    // otherwise asks yt-dlp for one best format and receives only the video
    // adaptation, dropping the separate audio track before AVPro sees it.
    playUrl: `${publicBase}/api/v1/playback-tickets/${ticket.token}/manifest.mpd`,
    expiresAt: ticket.expiresAt,
    expiresInSeconds: ticket.ttlSeconds,
    mode,
    quality: quality || 'auto',
  }, { headers: rateLimitHeaders });
}

// VRChat's Udon runtime cannot attach an Authorization header to
// VRCStringDownloader requests. This narrow GET entry point is intended for
// the local VizVid settings panel: it exchanges a user-entered credential for
// a short-lived media ticket and returns only the ticket URL. The credential
// never appears in the URL that VizVid synchronizes to other players.
async function handleCreatePlaybackTicketFromQuery(request, dependencies) {
  const env = dependencies.env || process.env;
  const state = dependencies.state;
  if (!state) throw new AppError(503, 'state_unavailable', 'Playback ticket storage is unavailable');
  const requestUrl = new URL(request.url);
  const key = String(requestUrl.searchParams.get('key') || '').trim();
  const credential = authenticateCredential({ state, env, key });
  const rateLimitHeaders = enforceRateLimits({
    state, env, authenticated: true, suppliedKey: key, clientIp: dependencies.clientIp || 'unknown',
  });
  const rawUrl = extractTrailingQueryValue(request.url, 'url');
  const sourceUrl = normalizeSourceUrl(rawUrl);
  if (!sourceUrl || identifyPlatform(sourceUrl) !== 'bilibili') {
    throw new AppError(400, 'invalid_bilibili_url', 'Playback tickets require a supported Bilibili video, live, or collection URL');
  }
  const mode = String(requestUrl.searchParams.get('mode') || 'auto');
  if (!['auto', 'dash', 'single'].includes(mode)) {
    throw new AppError(400, 'invalid_play_mode', 'mode must be auto, dash, or single');
  }
  const quality = String(requestUrl.searchParams.get('quality') || '').trim();
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
  const publicBase = configuredPublicBaseUrl(env);
  const response = new Response(
    `${publicBase}/api/v1/playback-tickets/${ticket.token}/manifest.mpd`,
    {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        ...rateLimitHeaders,
      },
    },
  );
  return withCommonHeaders(response);
}

async function handlePlaybackTicketRequest(request, dependencies, context) {
  const pathname = new URL(request.url).pathname;
  const match = pathname.match(/^\/api\/v1\/playback-tickets\/([A-Za-z0-9_-]{43})\/(?:play|manifest\.mpd)$/u);
  const servesManifest = pathname.endsWith('/manifest.mpd');
  const ticket = getPlaybackTicket({ state: dependencies.state, token: match?.[1] });
  if (!ticket) throw new AppError(404, 'playback_ticket_not_found', 'Playback ticket is missing or expired');
  // VRChat invokes yt-dlp with browser-like headers before handing a URL to
  // AVPro. If yt-dlp parses this MPD it chooses only the video adaptation.
  // Returning a probe failure makes the resolver keep the original .mpd URL;
  // AVPro then requests the same URL and receives the complete manifest.
  if (servesManifest && isDashResolverProbe(request)) {
    return withCommonHeaders(new Response(null, {
      status: 403,
      headers: { 'Cache-Control': 'no-store', 'X-Vrc2Link-Mpd-Probe': 'direct' },
    }));
  }
  const env = dependencies.env || process.env;
  const cookie = getCredentialCookie({ state: dependencies.state, env, profileId: ticket.profileId });
  const replayUrl = new URL(request.url);
  replayUrl.pathname = '/api/v1/play';
  replayUrl.search = '';
  replayUrl.searchParams.set('url', ticket.sourceUrl);
  replayUrl.searchParams.set('mode', ticket.mode || 'auto');
  if (ticket.quality) replayUrl.searchParams.set('quality', ticket.quality);
  if (servesManifest) replayUrl.searchParams.set('response', 'manifest');
  const headers = new Headers(request.headers);
  headers.delete('authorization');
  headers.delete('cookie');
  const replayRequest = new Request(replayUrl, { method: 'GET', headers });
  return dispatchRequest(replayRequest, {
    ...dependencies,
    credentialProfile: { profileId: ticket.profileId, cookie },
  }, context);
}

function isDashResolverProbe(request) {
  const userAgent = request.headers.get('user-agent') || '';
  const accept = request.headers.get('accept') || '';
  return /Chrome\/\d[\s\S]*Safari\//u.test(userAgent) && /text\/html/u.test(accept);
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

function shouldProxyStream(request, result, env) {
  if (String(env.QUEST_STREAM_PROXY).toLowerCase() !== 'true') return false;
  const userAgent = request.headers.get('user-agent') || '';
  if (!/android|quest|oculus/i.test(userAgent)) return false;
  return result?.platform === 'bilibili' || result?.platform === 'netease';
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
  const sessionKey = playlistSessionKeyModule(clientIp);
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
      bilibiliCdnPreference: getBilibiliCdnPreference(env),
      playlistMode: true,
      resolverPrefix: configuredPlaylistResolverPrefix(env),
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
  return jsonResponse(playlistManifestModule(result, session), { headers: rateLimitHeaders });
}

async function handlePlaylistItemRequest(url, request, dependencies, context) {
  const env = dependencies.env || process.env;
  const state = dependencies.state;
  if (!state) throw new AppError(503, 'state_unavailable', 'Playlist state is unavailable');

  const clientIp = dependencies.clientIp || 'unknown';
  const session = state.getJson(playlistSessionKeyModule(clientIp));
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
  state.setJson(playlistSessionKeyModule(clientIp), session, playlistSessionTtl(env));
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
  const sourceUrl = playlistEntrySourceModule(entry);
  if (!sourceUrl) throw new AppError(422, 'invalid_playlist_item', 'Playlist item has no playable source URL');
  const env = dependencies.env || process.env;
  const generic = genericOptions(env);
  const bilibiliCdnPreference = getBilibiliCdnPreference(env);
  const requestedMode = dependencies.mode || 'single';
  const sourcePlatform = identifyPlatform(
    normalizeSourceUrl(sourceUrl, { allowGeneric: generic.enabled }),
    { allowGeneric: generic.enabled },
  );
  const resolveMode = playbackModeForSourcePolicy(requestedMode, sourceUrl, sourcePlatform);
  const quality = requestedMode === 'auto' && resolveMode === 'single'
    ? undefined
    : dependencies.quality;
  const result = await dependencies.resolve(sourceUrl, {
    authenticated: dependencies.authenticated === true,
    cookies: cookiesForAuthentication(dependencies.authenticated === true, env, dependencies.profileId, dependencies.state),
    generic,
    bilibiliCdnPreference,
    quality,
    mode: resolveMode,
    playlistMode: false,
    resolverPrefix: configuredPlaylistResolverPrefix(env),
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
  if (usesDashForResultPolicy(requestedMode, result, sourceUrl, quality)) {
    return createDashPlaybackResponse({
      request: dependencies.request,
      env,
      state: dependencies.state,
      rawUrl: sourceUrl,
      authenticated: dependencies.authenticated === true,
      profileId: dependencies.profileId,
      quality,
      result,
      pathname: '/play',
      responseMode: null,
      rateLimitHeaders: headers,
    });
  }
  const stream = selectPlayableStream(result, quality, muxedMp4Selection(result));
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
  return beginPlaylistSessionModule({
    state,
    ttlSeconds: playlistSessionTtl(env),
    clientIp,
    rawUrl,
    authenticated,
    profileId,
    mode,
    quality,
  });
}

function bindPlaylistSession({ state, env, clientIp, rawUrl, authenticated, profileId, result, sessionId, mode, quality }) {
  return bindPlaylistSessionModule({
    state,
    ttlSeconds: playlistSessionTtl(env),
    clientIp,
    rawUrl,
    authenticated,
    profileId,
    result,
    sessionId,
    mode,
    quality,
  });
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

function playlistSessionTtl(env) {
  return positiveInteger(env.PLAYLIST_SESSION_TTL_SECONDS, 21600);
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

function mediaCacheKey(
  rawUrl,
  quality,
  allowGeneric = false,
  playlistMode = false,
  mode = 'single',
  bilibiliCdnPreference = [],
) {
  const normalized = normalizeSourceUrl(rawUrl || '', { allowGeneric });
  const digest = createHash('sha256')
    .update(`${normalized}\n${quality || ''}\n${playlistMode ? 'playlist' : 'media'}\n${mode}\n${bilibiliCdnPreference.join(',')}`)
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

function getBilibiliCdnPreference(env) {
  return parseCdnPreference(env.BILIBILI_CDN_PREFERENCE || env.BILIBILI_CDN_ALLOWLIST);
}

function booleanValue(value, fallback) {
  if (value == null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function muxedMp4Selection(result) {
  if (result?.platform === 'bilibili' && result?.type === 'video') {
    return { requireMp4: true, allowQualityFallback: true };
  }
  return {};
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
