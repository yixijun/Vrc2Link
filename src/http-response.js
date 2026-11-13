export const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Expose-Headers': [
    'API-Version', 'X-Request-Id', 'X-Cache', 'X-RateLimit-Limit', 'X-RateLimit-Remaining',
    'X-RateLimit-Reset', 'Retry-After', 'X-Stream-Quality', 'X-Stream-Format',
  ].join(', '),
});

export function jsonResponse(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return withCommonHeaders(new Response(JSON.stringify(body, null, 2), { ...init, headers }));
}

export function errorResponse(error, extraHeaders = {}) {
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

export function withCommonHeaders(response) {
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export async function normalizeApiV1Response(response, requestId) {
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
