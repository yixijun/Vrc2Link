/**
 * HTTP fetch wrapper with retry, timeout, and platform-specific headers.
 *
 * Two modes:
 *   - "page"  → mimics a browser navigating to a web page (no Referer, Accept: text/html)
 *   - "api"   → mimics an XHR/fetch call from the platform's own page (Referer + Origin set)
 */

const REQUEST_TIMEOUT = 10000;
const MAX_RETRIES = 2;

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

const PLATFORM_CONFIG = {
  bilibili: { referer: 'https://www.bilibili.com/', origin: 'https://www.bilibili.com' },
  netease:  { referer: 'https://music.163.com/',     origin: 'https://music.163.com' },
};

/**
 * Generate a random buvid3-like cookie value.
 * buvid3 format: "XX-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
 */
function generateBuvid3() {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const seg = (n) => Array.from({ length: n }, hex).join('');
  return `${seg(2)}-${seg(8)}-${seg(4)}-${seg(4)}-${seg(4)}-${seg(12)}`.toUpperCase();
}

/**
 * Get a basic browser cookie string for the platform.
 * Includes a generated buvid3 so B站 doesn't reject us as a bot.
 */
function baseCookie(platform, existingCookie) {
  if (existingCookie) return existingCookie;
  if (platform === 'bilibili') {
    return `buvid3=${generateBuvid3()}; b_lsid=${generateBuvid3().replace(/-/g, '').substring(0, 13).toLowerCase()}`;
  }
  return '';
}

/**
 * Set page-mode headers (simulating a direct browser navigation).
 */
function setPageHeaders(headers, platform, existingCookie) {
  headers.set('User-Agent', DEFAULT_UA);
  headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8');
  headers.set('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8');
  headers.set('Upgrade-Insecure-Requests', '1');
  headers.set('Sec-Fetch-Site', 'none');
  headers.set('Sec-Fetch-Mode', 'navigate');
  headers.set('Sec-Fetch-User', '?1');
  headers.set('Sec-Fetch-Dest', 'document');
  // No Referer or Origin — mimics typing URL in address bar

  const cookie = baseCookie(platform, existingCookie);
  if (cookie && !headers.has('Cookie')) {
    headers.set('Cookie', cookie);
  }
}

/**
 * Set API-mode headers (simulating an XHR from the platform's page).
 */
function setApiHeaders(headers, platform, existingCookie) {
  const cfg = PLATFORM_CONFIG[platform];

  headers.set('User-Agent', DEFAULT_UA);
  headers.set('Accept', 'application/json, text/plain, */*');
  headers.set('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8');
  headers.set('Sec-Fetch-Site', 'same-site');
  headers.set('Sec-Fetch-Mode', 'cors');
  headers.set('Sec-Fetch-Dest', 'empty');

  if (cfg) {
    headers.set('Referer', cfg.referer);
    headers.set('Origin', cfg.origin);
  }

  const cookie = baseCookie(platform, existingCookie);
  if (cookie && !headers.has('Cookie')) {
    headers.set('Cookie', cookie);
  }
}

/**
 * Fetch with retry. Supports optional proxy for blocked platforms.
 * @param {string} url
 * @param {RequestInit & { platform?: string, mode?: 'page'|'api', forwardIp?: string, proxy?: string }} options
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}) {
  const { platform, mode = 'api', forwardIp, proxy, ...fetchOptions } = options;
  const maxRetries = MAX_RETRIES;

  const headers = new Headers(fetchOptions.headers || {});

  // Extract cookie from passed headers before we overwrite it
  const existingCookie = headers.get('Cookie') || '';

  if (mode === 'page') {
    setPageHeaders(headers, platform, existingCookie);
  } else {
    setApiHeaders(headers, platform, existingCookie);
  }

  // Route through proxy if configured (for IP-blocked platforms like B站)
  const targetUrl = proxy ? `${proxy}${encodeURIComponent(url)}` : url;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const resp = await fetch(targetUrl, {
        ...fetchOptions,
        headers: proxy ? new Headers() : headers, // use clean headers when proxying
        signal: controller.signal,
        redirect: 'follow',
      });

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
      if (err.name === 'AbortError') break;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error('Request failed after retries');
}
