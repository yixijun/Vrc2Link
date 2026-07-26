/**
 * Cookie parsing and masking utilities.
 */

const SENSITIVE_KEYS = ['SESSDATA', 'bili_jct', 'DedeUserID', 'buvid3',
  'MUSIC_U', '__csrf', 'os', 'appver'];

/**
 * Parse a cookie string into a key-value object.
 * @param {string} cookieStr - "key1=value1; key2=value2"
 * @returns {Record<string, string>}
 */
export function parseCookie(cookieStr) {
  if (!cookieStr) return {};
  const result = {};
  for (const pair of cookieStr.split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      result[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  }
  return result;
}

/**
 * Combine a cookie object back into a string.
 * @param {Record<string, string>} cookieObj
 * @returns {string}
 */
export function stringifyCookie(cookieObj) {
  return Object.entries(cookieObj)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/**
 * Mask sensitive values in a cookie string for safe logging.
 * @param {string} cookieStr
 * @returns {string}
 */
export function maskCookie(cookieStr) {
  if (!cookieStr) return '(none)';
  const parsed = parseCookie(cookieStr);
  const masked = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (SENSITIVE_KEYS.includes(key)) {
      masked[key] = value.length > 6
        ? value.substring(0, 3) + '***' + value.substring(value.length - 3)
        : '***';
    } else {
      masked[key] = value;
    }
  }
  return stringifyCookie(masked);
}

/**
 * Extract cookie value(s) from request — checks both Cookie header and ?cookie= query param.
 * @param {Request} request
 * @returns {string}
 */
export function extractCookie(request) {
  const url = new URL(request.url);
  const queryCookie = url.searchParams.get('cookie');
  if (queryCookie) return queryCookie;
  const headerCookie = request.headers.get('Cookie');
  return headerCookie || '';
}
