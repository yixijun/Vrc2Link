/**
 * Cloudflare Cache API wrapper for short-lived caching.
 */

const DEFAULT_TTL = 300; // 5 minutes

/**
 * Try to get a cached response for this request.
 * @param {Request} request
 * @returns {Promise<Response|undefined>}
 */
export async function getCached(request) {
  const cache = caches.default;
  const cached = await cache.match(request);
  return cached;
}

/**
 * Cache a response for future requests.
 * @param {Request} request
 * @param {Response} response
 * @param {number} [ttl] - seconds
 */
export async function putCache(request, response, ttl = DEFAULT_TTL) {
  const cache = caches.default;

  // Only cache successful responses
  if (!response.ok && response.status < 400) return;

  const cacheable = new Response(response.body, response);

  // Set cache-control on the stored response
  cacheable.headers.set('Cache-Control', `public, max-age=${ttl}`);
  cacheable.headers.set('X-Cache-TTL', String(ttl));

  // Use waitUntil so cache write doesn't block the response
  // In Workers, the execution context persists after response is sent
  await cache.put(request, cacheable);
}

/**
 * Generate a stable cache key from URL and cookie presence.
 * This avoids caching issues when cookies change.
 * @param {string} urlStr - the full request URL
 * @param {boolean} hasCookie - whether a cookie was provided
 * @returns {string}
 */
export function cacheKey(urlStr, hasCookie) {
  const url = new URL(urlStr);
  // Remove timestamp params that would bust cache
  url.searchParams.delete('_t');
  url.searchParams.delete('_');
  // Add cookie flag so we don't mix cached results
  return `${url.pathname}${url.search}::cookie=${hasCookie ? '1' : '0'}`;
}
