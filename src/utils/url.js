/**
 * URL normalization, short-link expansion, and platform identification.
 */

const PLATFORM_RULES = [
  {
    name: 'bilibili',
    domains: ['bilibili.com', 'www.bilibili.com', 'b23.tv', 'live.bilibili.com', 't.bilibili.com'],
    shortDomains: ['b23.tv'],
  },
  {
    name: 'netease',
    domains: ['music.163.com', '163cn.tv', 'y.music.163.com'],
    shortDomains: ['163cn.tv', 'y.music.163.com'],
  },
  {
    name: 'douyin',
    domains: ['douyin.com', 'iesdouyin.com', 'v.douyin.com'],
    shortDomains: ['v.douyin.com'],
  },
  {
    name: 'kuaishou',
    domains: ['kuaishou.com', 'kwai.com', 'v.kuaishou.com'],
    shortDomains: ['v.kuaishou.com'],
  },
  {
    name: 'youtube',
    domains: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
    shortDomains: [],
  },
];
const SHORT_LINK_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SHORT_LINK_CACHE_ENTRIES = 512;
const shortLinkCache = new Map();

/**
 * Extract the first supported media URL from a raw URL or copied share text.
 * @param {string} input
 * @returns {string}
 */
export function normalizeSourceUrl(input) {
  const text = String(input || '').trim();
  if (!text) return text;

  const candidates = text.match(/https?:\/\/[^\s<>"'，。；！？、）】,;\])]+/giu) || [];
  for (const rawCandidate of candidates) {
    const candidate = rawCandidate.replace(/[.!]+$/u, '');
    if (identifyPlatform(candidate)) return candidate;
  }
  return text;
}

/**
 * Identify the platform from a URL string.
 * @param {string} urlStr
 * @returns {string|null} platform name or null
 */
export function identifyPlatform(urlStr) {
  let hostname;
  try {
    hostname = new URL(urlStr).hostname;
  } catch {
    return null;
  }
  for (const rule of PLATFORM_RULES) {
    if (rule.domains.some((d) => hostname === d || hostname.endsWith('.' + d))) {
      return rule.name;
    }
  }
  return null;
}

/**
 * Check if a URL is a known short-link that needs expansion.
 * @param {string} urlStr
 * @returns {boolean}
 */
export function isShortLink(urlStr) {
  let hostname;
  try {
    hostname = new URL(urlStr).hostname;
  } catch {
    return false;
  }
  return PLATFORM_RULES.some((rule) =>
    rule.shortDomains.some((d) => hostname === d || hostname.endsWith('.' + d))
  );
}

/**
 * Follow short-link redirects to get the real URL.
 * @param {string} urlStr
 * @param {string} [userAgent]
 * @returns {Promise<string>} expanded URL (or original if not a short link)
 */
export async function expandShortLink(urlStr, userAgent) {
  if (!isShortLink(urlStr)) return urlStr;

  const cached = shortLinkCache.get(urlStr);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  if (cached) shortLinkCache.delete(urlStr);

  if (shortLinkCache.size >= MAX_SHORT_LINK_CACHE_ENTRIES) {
    shortLinkCache.delete(shortLinkCache.keys().next().value);
  }
  const result = requestShortLink(urlStr, userAgent);
  shortLinkCache.set(urlStr, { expiresAt: Date.now() + SHORT_LINK_CACHE_TTL_MS, result });
  try {
    const expanded = await result;
    if (expanded === urlStr) shortLinkCache.delete(urlStr);
    return expanded;
  } catch (error) {
    shortLinkCache.delete(urlStr);
    throw error;
  }
}

async function requestShortLink(urlStr, userAgent) {
  const resp = await fetch(urlStr, {
    method: 'HEAD',
    redirect: 'manual',
    headers: userAgent ? { 'User-Agent': userAgent } : undefined,
  });

  if (resp.status >= 300 && resp.status < 400 && resp.headers.has('location')) {
    const location = resp.headers.get('location');
    return new URL(location, urlStr).href;
  }

  return urlStr;
}

/**
 * Extract video/room/song ID from a URL based on platform.
 * @param {string} urlStr
 * @param {string} platform
 * @returns {{ type: string, id: string } | null}
 */
export function extractId(urlStr, platform) {
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    return null;
  }
  const pathname = url.pathname;
  const searchParams = url.searchParams;

  if (platform === 'bilibili') {
    // Live room: live.bilibili.com/12345 or live.bilibili.com/12345?broadcast_type=0
    if (url.hostname === 'live.bilibili.com' || url.hostname.startsWith('live.')) {
      const match = pathname.match(/^\/(\d+)/);
      if (match) return { type: 'live', id: match[1] };
    }
    // Video: bilibili.com/video/BVxxx or b23.tv/BVxxx
    const bvMatch = pathname.match(/\/(BV[a-zA-Z0-9]+)/);
    if (bvMatch) return { type: 'video', id: bvMatch[1] };
    // Alternate: ?bvid=BVxxx
    const bvid = searchParams.get('bvid');
    if (bvid) return { type: 'video', id: bvid };
    // Short link that already resolved to video
    const avMatch = pathname.match(/\/(av\d+)/i);
    if (avMatch) return { type: 'video', id: avMatch[1] };
    return null;
  }

  if (platform === 'netease') {
    // MV: music.163.com/mv?id=xxx or music.163.com/#/mv?id=xxx
    if (pathname.includes('/mv') || url.hash.includes('/mv')) {
      // Hash-based routing: #/mv?id=xxx
      const hash = url.hash;
      const mvHashMatch = hash.match(/\/mv\?id=(\d+)/);
      if (mvHashMatch) return { type: 'mv', id: mvHashMatch[1] };
      // Direct query: /mv?id=xxx
      const mvId = searchParams.get('id');
      if (mvId) return { type: 'mv', id: mvId };
    }
    // Song: music.163.com/song?id=xxx or music.163.com/#/song?id=xxx
    if (pathname.includes('/song') || url.hash.includes('/song')) {
      const hash = url.hash;
      const songHashMatch = hash.match(/\/song\?id=(\d+)/);
      if (songHashMatch) return { type: 'song', id: songHashMatch[1] };
      const songId = searchParams.get('id');
      if (songId) return { type: 'song', id: songId };
    }
    // Short link resolved to song
    const id = searchParams.get('id');
    if (id && /^\d+$/.test(id)) {
      if (pathname.includes('/song') || url.hash.includes('/song')) {
        return { type: 'song', id };
      }
      // Generic — try song first
      return { type: 'song', id };
    }
    return null;
  }

  if (platform === 'douyin') {
    const match = pathname.match(/\/video\/(\d+)/i) || pathname.match(/\/share\/video\/(\d+)/i);
    const modalId = searchParams.get('modal_id') || searchParams.get('mid');
    if (match) return { type: 'video', id: match[1] };
    if (modalId && /^\d+$/.test(modalId)) return { type: 'video', id: modalId };
    if (url.hostname === 'v.douyin.com') {
      const shortId = pathname.match(/^\/([^/]+)/)?.[1];
      if (shortId) return { type: 'video', id: shortId };
    }
    return null;
  }

  if (platform === 'kuaishou') {
    const match = pathname.match(/\/(?:short-video|video|f)\/([A-Za-z0-9_-]+)/i);
    const photoId = searchParams.get('photoId') || searchParams.get('photo_id');
    if (match) return { type: 'video', id: match[1] };
    if (photoId) return { type: 'video', id: photoId };
    if (url.hostname === 'v.kuaishou.com') {
      const shortId = pathname.match(/^\/([^/]+)/)?.[1];
      if (shortId) return { type: 'video', id: shortId };
    }
    return null;
  }

  return null;
}
