import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Expose-Headers': [
    'X-Request-Id', 'X-Cache', 'X-RateLimit-Limit', 'X-RateLimit-Remaining',
    'X-RateLimit-Reset', 'Retry-After', 'X-Stream-Quality', 'X-Stream-Format',
  ].join(', '),
};

const dashRefreshLocks = new Map();

export async function handleRequest(request, dependencies = {}) {
  const startedAt = performance.now();
  const requestId = dependencies.requestId || randomUUID();
  const context = { platform: null, cacheHit: null };
  let response;

  try {
    response = await dispatchRequest(request, dependencies, context);
  } catch {
    response = errorResponse(new AppError(500, 'internal_error', 'Internal server error'));
  }

  response.headers.set('X-Request-Id', requestId);
  writeRequestLog(dependencies.logger, {
    event: 'http_request',
    requestId,
    method: request.method,
    path: new URL(request.url).pathname,
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
  const url = new URL(request.url);
  const dashAsset = parseDashAsset(url.pathname);

  if (request.method === 'OPTIONS') {
    return withCommonHeaders(new Response(null, { status: 204 }));
  }
  if (request.method !== 'GET' && !(request.method === 'HEAD' && dashAsset)) {
    return errorResponse(new AppError(405, 'method_not_allowed', 'Only GET is supported'), {
      Allow: 'GET, OPTIONS',
    });
  }

  let rateLimitHeaders = {};
  try {
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

    const authenticated = authenticate(url.searchParams.get('key'), env.API_KEY);
    rateLimitHeaders = state
      ? enforceRateLimits({
          state,
          env,
          authenticated,
          suppliedKey: url.searchParams.get('key'),
          clientIp: dependencies.clientIp || 'unknown',
        })
      : {};
    const cookies = authenticated
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
          state, env, clientIp: dependencies.clientIp || 'unknown', rawUrl, authenticated,
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
        resolverPrefix: env.PLAYLIST_RESOLVER_PREFIX || 'https://vrc2link.luonako.cn/play?mode=auto&url=',
      });
      if (cacheKey) state.setJson(cacheKey, result, positiveInteger(env.CACHE_TTL_SECONDS, 300));
    }
    context.platform = result.platform || null;

    let playbackSourceUrl = rawUrl;
    let playlistSessionResult;
    if (url.pathname === '/play' && result.playlist) {
      playlistSessionResult = result;
      bindPlaylistSession({
        state, env, clientIp: dependencies.clientIp || 'unknown', rawUrl, authenticated,
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
        resolverPrefix: env.PLAYLIST_RESOLVER_PREFIX || 'https://vrc2link.luonako.cn/play?mode=auto&url=',
      });
      context.platform = result.platform || context.platform;
    }

    const dashMode = usesDashForResult(requestedMode, result, playbackSourceUrl);
    const playbackQuality = requestedMode === 'auto' &&
      !(result.platform === 'bilibili' && result.type === 'video')
      ? undefined
      : quality;
    if (dashMode) {
      const session = createDashSession({
        request, env, state, rawUrl: playbackSourceUrl, authenticated, quality: playbackQuality, result,
      });
      if (url.pathname === '/play') {
        bindPlaylistSession({
          state,
          env,
          clientIp: dependencies.clientIp || 'unknown',
          rawUrl,
          authenticated,
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
        state, env, clientIp: dependencies.clientIp || 'unknown', rawUrl, authenticated,
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
  return platform === 'bilibili' ? 'dash' : 'single';
}

function usesDashForResult(requestedMode, result, sourceUrl) {
  if (requestedMode === 'dash') return true;
  if (requestedMode !== 'auto') return false;
  const platform = result?.platform || identifyPlatform(normalizeSourceUrl(sourceUrl || ''));
  return platform === 'bilibili' && result?.type === 'video';
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

function createDashSession({ request, env, state, rawUrl, authenticated, quality, result }) {
  const sourceUrl = normalizeSourceUrl(rawUrl || '');
  const tracks = selectDashTracks(result, quality);
  const record = makeDashRecord({
    sourceUrl,
    authenticated,
    quality,
    result,
    tracks,
  });
  const ttlSeconds = dashTicketTtl(env);
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
    cookies: cookiesForAuthentication(latest.authenticated === true, env),
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
      cookies: cookiesForAuthentication(session.authenticated === true, env),
      generic: genericOptions(env),
      playlistMode: true,
      resolverPrefix: env.PLAYLIST_RESOLVER_PREFIX || 'https://vrc2link.luonako.cn/play?mode=auto&url=',
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
    cookies: cookiesForAuthentication(dependencies.authenticated === true, env),
    generic,
    quality,
    mode: resolveMode,
    playlistMode: false,
    resolverPrefix: env.PLAYLIST_RESOLVER_PREFIX || 'https://vrc2link.luonako.cn/play?mode=auto&url=',
  });
  context.platform = result.platform || playlistResult.platform || null;
  bindDanmakuSession({
    state: dependencies.state,
    env,
    clientIp: dependencies.clientIp || 'unknown',
    rawUrl: sourceUrl,
    result,
  });
  if (usesDashForResult(requestedMode, result, sourceUrl)) {
    const session = createDashSession({
      request: dependencies.request,
      env,
      state: dependencies.state,
      rawUrl: sourceUrl,
      authenticated: dependencies.authenticated === true,
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

function beginPlaylistSession({ state, env, clientIp, rawUrl, authenticated, mode, quality }) {
  if (!state) return;
  const sourceUrl = normalizeSourceUrl(rawUrl || '');
  if (!sourceUrl) return;
  const sessionId = randomUUID();
  state.setJson(playlistSessionKey(clientIp), {
    sourceUrl,
    authenticated: authenticated === true,
    mode: mode || 'single',
    quality,
    autoPlay: false,
    pending: true,
    sessionId,
  }, playlistSessionTtl(env));
  return sessionId;
}

function bindPlaylistSession({ state, env, clientIp, rawUrl, authenticated, result, sessionId, mode, quality }) {
  if (!state) return;
  const sourceUrl = normalizeSourceUrl(rawUrl || '');
  if (!sourceUrl) return;
  const sessionKey = playlistSessionKey(clientIp);
  const current = state.getJson(sessionKey);
  if (sessionId && current?.sessionId !== sessionId) return;
  state.setJson(sessionKey, {
    sourceUrl,
    authenticated: authenticated === true,
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

function cookiesForAuthentication(authenticated, env) {
  if (!authenticated) return {};
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

function dashTicketTtl(env) {
  return positiveInteger(env.DASH_TICKET_TTL_SECONDS, 3600);
}

function bindDanmakuSession({ state, env, clientIp, rawUrl, result }) {
  if (!state) return;
  const sourceUrl = normalizeSourceUrl(rawUrl || '');
  state.setJson(`danmaku:session:${hashIdentity(clientIp)}`, {
    platform: result.platform,
    type: result.type,
    id: result.id,
    webRid: result.webRid || '',
    sourceUrl,
    authenticated: result.authenticated === true,
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
