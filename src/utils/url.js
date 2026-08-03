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
const SHORT_LINK_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const shortLinkCache = new Map();

/**
 * Extract the first supported media URL from a raw URL or copied share text.
 * @param {string} input
 * @param {{ allowGeneric?: boolean }} [options]
 * @returns {string}
 */
export function normalizeSourceUrl(input, options = {}) {
  const text = String(input || '').trim();
  if (!text) return text;

  const bareBilibiliAv = text.match(/^av(\d+)$/iu);
  if (bareBilibiliAv) {
    return `https://www.bilibili.com/video/av${bareBilibiliAv[1]}`;
  }

  const candidates = text.match(/https?:\/\/[^\s<>"'，。；！？、）】,;\])]+/giu) || [];
  let genericCandidate = '';
  for (const rawCandidate of candidates) {
    const candidate = rawCandidate.replace(/[.!]+$/u, '');
    if (identifyPlatform(candidate)) return candidate;
    if (!genericCandidate && options.allowGeneric && isHttpUrl(candidate)) {
      genericCandidate = candidate;
    }
  }
  if (genericCandidate) return genericCandidate;

  const copiedBilibiliAv = text.match(/(?:^|[^a-zA-Z0-9])av(\d+)(?![a-zA-Z0-9])/iu);
  if (copiedBilibiliAv) {
    return `https://www.bilibili.com/video/av${copiedBilibiliAv[1]}`;
  }
  return text;
}

/**
 * Identify the platform from a URL string.
 * @param {string} urlStr
 * @param {{ allowGeneric?: boolean }} [options]
 * @returns {string|null} platform name or null
 */
export function identifyPlatform(urlStr, options = {}) {
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
  if (options.allowGeneric && isHttpUrl(urlStr)) return 'generic';
  return null;
}

function videoResult(id, pageValue) {
  const page = positivePage(pageValue);
  return page > 1 ? { type: 'video', id, page } : { type: 'video', id };
}

function positivePage(value) {
  const page = Number.parseInt(value, 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function isHttpUrl(urlStr) {
  try {
    return ['http:', 'https:'].includes(new URL(urlStr).protocol);
  } catch {
    return false;
  }
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
  const headers = {
    'User-Agent': userAgent || SHORT_LINK_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  };
  let resp = await fetch(urlStr, {
    method: 'HEAD',
    redirect: 'manual',
    headers,
  });

  let expanded = redirectLocation(resp, urlStr);
  if (expanded) return expanded;

  // Some short-link gateways reject HEAD even though GET redirects normally.
  if (!resp.ok) {
    resp = await fetch(urlStr, {
      method: 'GET',
      redirect: 'manual',
      headers,
    });
    expanded = redirectLocation(resp, urlStr);
    if (expanded) return expanded;
  }

  return urlStr;
}

function redirectLocation(response, baseUrl) {
  if (response.status < 300 || response.status >= 400 || !response.headers.has('location')) {
    return null;
  }
  return new URL(response.headers.get('location'), baseUrl).href;
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
    const collectionId = searchParams.get('sid') || searchParams.get('season_id') || searchParams.get('series_id');
    if (collectionId && /collectiondetail|seriesdetail/iu.test(pathname)) {
      return {
        type: 'playlist',
        id: collectionId,
        kind: /seriesdetail/iu.test(pathname) || searchParams.has('series_id') ? 'series' : 'season',
        mid: url.hostname === 'space.bilibili.com' ? pathname.match(/^\/(\d+)/u)?.[1] || '' : '',
        bvid: searchParams.get('bvid') || '',
      };
    }
    const listMatch = pathname.match(/\/list\/(ml)?(\d+)/iu);
    if (listMatch) {
      return {
        type: 'playlist', id: listMatch[2], kind: listMatch[1] ? 'favorite' : 'collection',
        mid: searchParams.get('mid') || '', bvid: searchParams.get('bvid') || '',
      };
    }
    const mediaListMatch = pathname.match(/\/medialist\/detail\/ml(\d+)/iu);
    if (mediaListMatch) return { type: 'playlist', id: mediaListMatch[1], kind: 'favorite', mid: '', bvid: searchParams.get('bvid') || '' };
    // Video: bilibili.com/video/BVxxx or b23.tv/BVxxx
    const bvMatch = pathname.match(/\/(BV[a-zA-Z0-9]+)/);
    if (bvMatch) return videoResult(bvMatch[1], searchParams.get('p'));
    // Alternate: ?bvid=BVxxx
    const bvid = searchParams.get('bvid');
    if (bvid) return videoResult(bvid, searchParams.get('p'));
    // Short link that already resolved to video
    const avMatch = pathname.match(/\/(av\d+)/i);
    if (avMatch) return videoResult(avMatch[1], searchParams.get('p'));
    return null;
  }

  if (platform === 'netease') {
    if (pathname.includes('/playlist') || url.hash.includes('/playlist')) {
      const hashPlaylistId = url.hash.match(/\/playlist\?id=(\d+)/iu)?.[1];
      const playlistId = searchParams.get('id') || hashPlaylistId;
      if (playlistId) return { type: 'playlist', id: playlistId };
    }
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
