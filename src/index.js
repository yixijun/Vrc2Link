import { timingSafeEqual } from 'node:crypto';

import { AppError } from './errors.js';
import { homePage } from './home.js';
import { resolveMedia, selectPlayableStream } from './resolver.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function handleRequest(request, dependencies = {}) {
  const env = dependencies.env || process.env;
  const resolve = dependencies.resolve || resolveMedia;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return withCommonHeaders(new Response(null, { status: 204 }));
  }
  if (request.method !== 'GET') {
    return errorResponse(new AppError(405, 'method_not_allowed', 'Only GET is supported'), {
      Allow: 'GET, OPTIONS',
    });
  }

  try {
    if (url.pathname === '/') return withCommonHeaders(homePage());
    if (url.pathname !== '/api' && url.pathname !== '/play') {
      throw new AppError(404, 'not_found', 'Endpoint not found');
    }

    const authenticated = authenticate(url.searchParams.get('key'), env.API_KEY);
    const cookies = authenticated
      ? {
          bilibili: env.BILIBILI_COOKIE || '',
          netease: env.NETEASE_COOKIE || '',
        }
      : {};
    const quality = url.pathname === '/play' ? url.searchParams.get('quality') || undefined : undefined;
    const result = await resolve(url.searchParams.get('url'), {
      authenticated,
      cookies,
      quality,
    });

    if (url.pathname === '/api') return jsonResponse(result);

    const stream = selectPlayableStream(result, quality);
    return withCommonHeaders(new Response(null, {
      status: 302,
      headers: {
        Location: stream.url,
        'X-Stream-Quality': stream.quality,
        'X-Stream-Format': stream.format,
        'Cache-Control': 'no-store',
      },
    }));
  } catch (error) {
    if (error instanceof AppError) return errorResponse(error);
    console.error(`[server] ${error.message}`);
    return errorResponse(new AppError(500, 'internal_error', 'Internal server error'));
  }
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
