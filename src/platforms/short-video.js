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

export async function parseShortVideo(platform, sourceUrl, options = {}) {
  const { cookie = '' } = options;
  // Desktop Douyin pages return an anti-bot shell; the official mobile share page embeds video data.
  const pageUrl = platform === 'douyin' && options.id
    ? `https://www.iesdouyin.com/share/video/${encodeURIComponent(options.id)}/`
    : sourceUrl;
  const response = await fetchWithRetry(pageUrl, {
    platform,
    cookie,
    userAgent: platform === 'douyin' ? MOBILE_USER_AGENT : undefined,
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

function isVideoUrl(url) {
  return /\.(?:mp4|m3u8|flv)(?:[?#]|$)/iu.test(url) ||
    /(?:play|download|video|aweme|ksurl|txvideo)/iu.test(url);
}

function decodeUrl(value) {
  return String(value || '')
    .replace(/\\u002F/giu, '/')
    .replace(/\\u0026/giu, '&')
    .replace(/\\\//gu, '/')
    .replace(/&amp;/giu, '&')
    .replace(/[),;\]}]+$/u, '');
}
