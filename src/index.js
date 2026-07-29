import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

import { AppError } from './errors.js';
import { fetchCurrentDanmaku } from './danmaku.js';
import { homePage } from './home.js';
import { enforceDanmakuRateLimit, enforceRateLimits, hashIdentity } from './rate-limit.js';
import { resolveMedia, selectPlayableStream } from './resolver.js';
import { fetchCurrentSubtitle } from './subtitle.js';
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

  if (request.method === 'OPTIONS') {
    return withCommonHeaders(new Response(null, { status: 204 }));
  }
  if (request.method !== 'GET') {
    return errorResponse(new AppError(405, 'method_not_allowed', 'Only GET is supported'), {
      Allow: 'GET, OPTIONS',
    });
  }

  let rateLimitHeaders = {};
  try {
    if (url.pathname === '/') return withCommonHeaders(homePage());
    if (url.pathname === '/danmaku/current' || isCurrentDanmakuApi(url)) {
      return await handleDanmakuRequest(url, dependencies);
    }
    if (url.pathname === '/subtitle/current' || isCurrentSubtitleApi(url)) {
      return await handleSubtitleRequest(url, dependencies);
    }
    if (url.pathname !== '/api' && url.pathname !== '/play') {
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
    const quality = url.pathname === '/play' ? url.searchParams.get('quality') || undefined : undefined;
    const rawUrl = url.searchParams.get('url');
    context.platform = identifyPlatform(normalizeSourceUrl(rawUrl || '')) || null;
    const cacheKey = !authenticated && state ? mediaCacheKey(rawUrl, quality) : undefined;
    let result = cacheKey ? state.getJson(cacheKey) : undefined;
    const cacheHit = result !== undefined;
    context.cacheHit = cacheKey ? cacheHit : null;
    if (!cacheHit) {
      result = await resolve(rawUrl, { authenticated, cookies, quality });
      if (cacheKey) state.setJson(cacheKey, result, positiveInteger(env.CACHE_TTL_SECONDS, 300));
    }
    context.platform = result.platform || null;

    if (url.pathname === '/api') {
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

    const stream = selectPlayableStream(result, quality);
    bindDanmakuSession({
      state,
      env,
      clientIp: dependencies.clientIp || 'unknown',
      rawUrl,
      result,
    });
    return withCommonHeaders(new Response(null, {
      status: 302,
      headers: {
        Location: stream.url,
        'X-Stream-Quality': stream.quality,
        'X-Stream-Format': stream.format,
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
        ...rateLimitHeaders,
        ...(cacheKey ? { 'X-Cache': cacheHit ? 'HIT' : 'MISS' } : {}),
      },
    }));
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error, { ...rateLimitHeaders, ...error.headers });
    }
    return errorResponse(new AppError(500, 'internal_error', 'Internal server error'));
  }
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

async function handleSubtitleRequest(url, dependencies) {
  const env = dependencies.env || process.env;
  const state = dependencies.state;
  if (!state) throw new AppError(503, 'state_unavailable', 'Subtitle state is unavailable');

  const clientIp = dependencies.clientIp || 'unknown';
  const rateLimitHeaders = enforceDanmakuRateLimit({ state, env, clientIp });
  const session = state.getJson(`danmaku:session:${hashIdentity(clientIp)}`);
  if (!session) {
    throw new AppError(
      409,
      'no_subtitle_session',
      'Play a supported URL through /play before requesting subtitles',
    );
  }

  const loadSubtitle = dependencies.fetchSubtitle || fetchCurrentSubtitle;
  const rawTrack = url.searchParams.get('track') || '0';
  const track = Number.parseInt(rawTrack, 10);
  if (!Number.isInteger(track) || track < 0 || track > 16) {
    throw new AppError(400, 'invalid_subtitle_track', 'track must be an integer from 0 to 16');
  }
  const result = await loadSubtitle(session, { track }, { env, state });
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
  const result = await loadDanmaku(session, { segment, live }, {
    env,
    state,
    clientIdentity: identity,
  });
  return url.searchParams.get('compact') === '1' && !live
    ? compactVideoDanmaku(result)
    : result;
}

function compactVideoDanmaku(result) {
  const messages = Array.isArray(result.messages) ? result.messages : [];
  const limit = 120;
  const selected = messages.length <= limit
    ? messages
    : Array.from({ length: limit }, (_, index) => (
      messages[Math.round(index * (messages.length - 1) / (limit - 1))]
    ));
  return {
    platform: result.platform,
    mode: result.mode,
    segment: result.segment,
    segmentSeconds: result.segmentSeconds,
    compact: true,
    messages: selected.map((message) => [
      Number(message.time) || 0,
      String(message.text || ''),
      Number.isFinite(Number(message.color)) ? Number(message.color) : 0xffffff,
    ]),
  };
}

function isCurrentDanmakuApi(url) {
  return url.pathname === '/api' &&
    url.searchParams.get('danmaku') === '1' &&
    !url.searchParams.has('url');
}

function isCurrentSubtitleApi(url) {
  return url.pathname === '/api' &&
    url.searchParams.get('subtitle') === '1' &&
    !url.searchParams.has('url');
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

function mediaCacheKey(rawUrl, quality) {
  const normalized = normalizeSourceUrl(rawUrl || '');
  const digest = createHash('sha256')
    .update(`${normalized}\n${quality || ''}`)
    .digest('hex');
  return `media:${digest}`;
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
