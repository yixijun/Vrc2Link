/**
 * Douyin and Kuaishou page parser.
 * Both platforms expose playable URLs in the server-rendered share page.
 */

import { fetchWithRetry } from '../utils/http.js';

const URL_PATTERN = /https?:\\?\/\\?\/[^"'\s<>]+/gu;
const VIDEO_KEYS = [
  'download_addr', 'downloadUrl', 'download_url',
  'play_addr', 'playAddr', 'playUrl', 'play_url', 'videoUrl', 'video_url',
  'srcNoWaterMark', 'src_no_watermark',
];
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36';
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 256;
const publicShortVideoCache = new Map();

export async function parseShortVideo(platform, sourceUrl, options = {}) {
  const { cookie = '' } = options;
  if (cookie) {
    return fetchShortVideo(platform, sourceUrl, options);
  }

  const cacheKey = `${platform}:${options.id || sourceUrl}`;
  const cached = publicShortVideoCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  if (cached) publicShortVideoCache.delete(cacheKey);

  if (publicShortVideoCache.size >= MAX_CACHE_ENTRIES) {
    publicShortVideoCache.delete(publicShortVideoCache.keys().next().value);
  }
  const result = fetchShortVideo(platform, sourceUrl, options);
  publicShortVideoCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, result });
  try {
    return await result;
  } catch (error) {
    publicShortVideoCache.delete(cacheKey);
    throw error;
  }
}

async function fetchShortVideo(platform, sourceUrl, options) {
  const { cookie = '' } = options;
  // Desktop Douyin pages return an anti-bot shell; the official mobile share page embeds video data.
  const pageUrl = platform === 'douyin' && options.id
    ? `https://www.iesdouyin.com/share/video/${encodeURIComponent(options.id)}/`
    : sourceUrl;
  const response = await fetchWithRetry(pageUrl, {
    platform,
    cookie,
    userAgent: platform === 'douyin' || platform === 'kuaishou'
      ? MOBILE_USER_AGENT
      : undefined,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${pageUrl}`);

  const html = await response.text();
  const streamUrl = findVideoUrl(html);
  if (!streamUrl) {
    throw new Error(`No playable ${platform} video URL found`);
  }

  const title = findField(html, ['desc', 'caption', 'photoCaption', 'title']) || `${platform} video ${options.id || ''}`.trim();
  const author = findField(html, ['nickname', 'authorName', 'userName', 'author']) || '';
  const cover = findImageUrl(html);
  const durationValue = Number(findField(html, ['duration']) || 0);
  const duration = Number.isFinite(durationValue) ? Math.round(durationValue / (durationValue > 1000 ? 1000 : 1)) : 0;

  return {
    platform,
    type: 'video',
    meta: { id: options.id || '', title, author, cover, duration },
    streams: [{
      quality: 'original',
      format: streamUrl.includes('.m3u8') ? 'm3u8' : 'mp4',
      codec: 'unknown',
      url: streamUrl,
      duration,
    }],
  };
}

function findVideoUrl(html) {
  const searchable = html.replace(/\\u002F/giu, '/').replace(/\\u0026/giu, '&');
  for (const key of VIDEO_KEYS) {
    const keyIndex = searchable.search(new RegExp(`(?:["']?${key}["']?)\\s*:`, 'iu'));
    if (keyIndex === -1) continue;
    const urls = searchable.slice(keyIndex, keyIndex + 1800).match(URL_PATTERN) || [];
    const candidate = urls.map(decodeUrl).find(isVideoUrl);
    if (candidate) return candidate;
  }

  const fallback = searchable.match(URL_PATTERN) || [];
  return fallback.map(decodeUrl).find(isVideoUrl) || '';
}

function findImageUrl(html) {
  const urls = html.match(URL_PATTERN) || [];
  return urls.map(decodeUrl).find((url) => /\.(?:jpg|jpeg|png|webp)(?:[?#]|$)/iu.test(url)) || '';
}

function findField(html, keys) {
  for (const key of keys) {
    const match = html.match(new RegExp(`(?:["']?${key}["']?)\\s*:\\s*(?:["']([^"']+)["']|(\\d+(?:\\.\\d+)?))`, 'iu'));
    if (match) return decodeUrl(match[1] || match[2]);
  }
  return '';
}

function isVideoUrl(value) {
  try {
    const url = new URL(value);
    const pathname = url.pathname.toLowerCase();
    const mimeType = url.searchParams.get('mime_type') || '';
    return /\.(?:mp4|m3u8|flv)$/u.test(pathname) ||
      /\/aweme\/v\d+\/play(?:wm)?\//u.test(pathname) ||
      mimeType.startsWith('video_') ||
      /(?:ksurl|txvideo)/iu.test(url.hostname);
  } catch {
    return false;
  }
}

function decodeUrl(value) {
  return String(value || '')
    .replace(/\\u002F/giu, '/')
    .replace(/\\u0026/giu, '&')
    .replace(/\\\//gu, '/')
    .replace(/&amp;/giu, '&')
    .replace(/[),;\]}]+$/u, '');
}
