/**
 * HTTP fetch wrapper with retry and platform-specific headers.
 */

const TIMEOUT = 10000;
const RETRIES = 2;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const PLATFORM = {
  bilibili: { referer: 'https://www.bilibili.com/', origin: 'https://www.bilibili.com' },
  netease:  { referer: 'https://music.163.com/',     origin: 'https://music.163.com' },
  douyin:   { referer: 'https://www.douyin.com/',    origin: 'https://www.douyin.com' },
  kuaishou: { referer: 'https://www.kuaishou.com/',  origin: 'https://www.kuaishou.com' },
};

/**
 * Fetch with retry on network errors and 5xx.
 * @param {string} url
 * @param {{ platform?: string, cookie?: string, userAgent?: string }} [options]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}) {
  const { platform, cookie, userAgent = UA } = options;
  const cfg = PLATFORM[platform];

  const headers = new Headers();
  headers.set('User-Agent', userAgent);
  headers.set('Accept', 'application/json, text/plain, */*');
  headers.set('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8');

  if (cfg) {
    headers.set('Referer', cfg.referer);
    headers.set('Origin', cfg.origin);
  }

  if (cookie) {
    headers.set('Cookie', cookie);
  }

  let lastError;
  for (let i = 0; i <= RETRIES; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const resp = await fetch(url, { headers, signal: ctrl.signal, redirect: 'follow' });
      if (resp.status >= 500 && i < RETRIES) { lastError = new Error(`HTTP ${resp.status}`); continue; }
      return resp;
    } catch (err) {
      lastError = err;
      if (i < RETRIES && err.name !== 'AbortError') continue;
      if (err.name === 'AbortError') break;
    } finally {
      clearTimeout(t);
    }
  }
  throw lastError || new Error('Request failed');
}
