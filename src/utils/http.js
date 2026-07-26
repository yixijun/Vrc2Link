/**
 * HTTP fetch wrapper with retry, timeout, and platform-specific headers.
 */

const REQUEST_TIMEOUT = 10000;
const MAX_RETRIES = 2;

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const PLATFORM_CONFIG = {
  bilibili: {
    referer: 'https://www.bilibili.com/',
    origin: 'https://www.bilibili.com',
  },
  netease: {
    referer: 'https://music.163.com/',
    origin: 'https://music.163.com',
  },
};

/**
 * Fetch with retry on network/timeout errors and 5xx responses.
 * @param {string} url
 * @param {RequestInit & { platform?: string, forwardIp?: string }} options
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}) {
  const { platform, forwardIp, ...fetchOptions } = options;
  const maxRetries = MAX_RETRIES;

  const headers = new Headers(fetchOptions.headers || {});
  const cfg = platform && PLATFORM_CONFIG[platform];

  // Set default UA if not provided
  if (!headers.has('User-Agent')) {
    headers.set('User-Agent', DEFAULT_UA);
  }

  // Set platform-specific browser headers
  if (cfg) {
    if (!headers.has('Referer')) {
      headers.set('Referer', cfg.referer);
    }
    if (!headers.has('Origin')) {
      headers.set('Origin', cfg.origin);
    }
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json, text/plain, */*');
    }
    if (!headers.has('Accept-Language')) {
      headers.set('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8');
    }
  }

  // Forward user's real IP for CDN geo-selection (only for CDN requests, not API)
  // The 'forwardIp' flag is passed but we only attach XFF to CDN hosts, not API calls
  if (forwardIp && url.includes('upos-') && !headers.has('X-Forwarded-For')) {
    headers.set('X-Forwarded-For', forwardIp);
  }

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const resp = await fetch(url, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
        redirect: 'follow',
      });

      // Retry on server errors
      if (resp.status >= 500 && attempt < maxRetries) {
        lastError = new Error(`Upstream ${resp.status}`);
        continue;
      }

      return resp;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && err.name !== 'AbortError') {
        continue;
      }
      // On abort timeout, don't retry
      if (err.name === 'AbortError') break;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error('Request failed after retries');
}

/**
 * Simple JSON GET helper.
 * @param {string} url
 * @param {{ platform?: string, forwardIp?: string, cookie?: string }} options
 * @returns {Promise<any>}
 */
export async function fetchJson(url, options = {}) {
  const headers = {};
  if (options.cookie) {
    headers.Cookie = options.cookie;
  }

  const resp = await fetchWithRetry(url, {
    headers,
    platform: options.platform,
    forwardIp: options.forwardIp,
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} from ${url}`);
  }

  return resp.json();
}
