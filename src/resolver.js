import { AppError } from './errors.js';
import { parseLive, parseVideo } from './platforms/bilibili.js';
import { parseMv, parseSong } from './platforms/netease.js';
import { parseShortVideo } from './platforms/short-video.js';
import { qualityRank } from './utils/quality.js';
import { expandShortLink, extractId, identifyPlatform, normalizeSourceUrl } from './utils/url.js';

export async function resolveMedia(rawUrl, options = {}) {
  const { authenticated = false, cookies = {}, quality } = options;
  if (!rawUrl?.trim()) {
    throw new AppError(400, 'missing_url', 'Missing required parameter: url');
  }

  let target = normalizeSourceUrl(rawUrl);
  try {
    target = await expandShortLink(target);
  } catch (error) {
    throw new AppError(400, 'short_link_failed', `Failed to resolve short link: ${error.message}`);
  }

  const platform = identifyPlatform(target);
  if (!platform) {
    throw new AppError(400, 'unsupported_url', 'Only Bilibili, Netease, Douyin, Kuaishou, and YouTube URLs are supported');
  }

  if (platform === 'youtube') {
    return normalizeResult({
      platform: 'youtube',
      type: 'video',
      meta: { id: youtubeVideoId(target), title: 'YouTube' },
      streams: [{ quality: 'original', format: 'url', codec: 'passthrough', url: target }],
    }, authenticated);
  }

  const extracted = extractId(target, platform);
  if (!extracted) {
    throw new AppError(400, 'invalid_url', `Could not extract a media ID from the ${platform} URL`);
  }

  const cookie = cookies[platform] || '';
  try {
    const result = await parsePlatform(platform, extracted, { cookie, quality, sourceUrl: target });
    if (!result.streams?.some((stream) => stream.url)) {
      throw new Error('No playable streams found');
    }
    return normalizeResult(result, authenticated);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, 'upstream_error', error.message);
  }
}

function youtubeVideoId(target) {
  const url = new URL(target);
  if (url.hostname === 'youtu.be' || url.hostname.endsWith('.youtu.be')) {
    return url.pathname.split('/').filter(Boolean)[0] || '';
  }
  return url.searchParams.get('v') ||
    url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/i)?.[1] || '';
}

export function selectPlayableStream(result, targetQuality) {
  let candidates = result.streams.filter((stream) =>
    stream.url && stream.type !== 'video-only' && stream.type !== 'audio-only'
  );

  if (targetQuality) {
    candidates = candidates.filter((stream) => stream.quality === targetQuality);
    if (candidates.length === 0) {
      throw new AppError(
        422,
        'quality_unavailable',
        `Requested quality is unavailable: ${targetQuality}`,
      );
    }
  }

  if (candidates.length === 0) {
    throw new AppError(422, 'no_direct_stream', 'No directly playable combined stream is available');
  }

  candidates.sort((a, b) => {
    if (result.type === 'live') {
      const formatDifference = Number(b.format === 'm3u8') - Number(a.format === 'm3u8');
      if (formatDifference !== 0) return formatDifference;
    }
    return qualityRank(b.quality) - qualityRank(a.quality);
  });
  return candidates[0];
}

async function parsePlatform(platform, extracted, options) {
  if (platform === 'bilibili') {
    return extracted.type === 'live'
      ? parseLive(extracted.id, options)
      : parseVideo(extracted.id, options);
  }
  if (platform === 'douyin' || platform === 'kuaishou') {
    return parseShortVideo(platform, options.sourceUrl, { ...options, id: extracted.id });
  }
  return extracted.type === 'mv'
    ? parseMv(extracted.id, options)
    : parseSong(extracted.id, options);
}

function normalizeResult(result, authenticated) {
  const meta = result.meta || {};
  const streams = result.streams
    .filter((stream) => stream.url)
    .map(normalizeStream);
  const qualities = [];

  for (const option of meta.qualityOptions || []) {
    const label = typeof option === 'string' ? option : option.label;
    if (label && !qualities.includes(label)) qualities.push(label);
  }
  for (const stream of streams) {
    if (stream.quality && !qualities.includes(stream.quality)) qualities.push(stream.quality);
  }

  const normalized = {
    platform: result.platform,
    type: result.type,
    id: String(meta.id || ''),
    title: meta.title || '',
    author: meta.author || '',
    cover: meta.cover || '',
    duration: meta.duration || 0,
    authenticated,
    qualities,
    streams,
  };

  if (meta.album) normalized.album = meta.album;
  if (meta.liveStatus != null) normalized.liveStatus = meta.liveStatus;
  if (meta.shortId) normalized.shortId = String(meta.shortId);
  if (meta.pages?.length) {
    normalized.parts = meta.pages.map((part) => ({
      id: String(part.cid),
      title: part.title || '',
      duration: part.duration || 0,
    }));
  }

  return normalized;
}

function normalizeStream(stream) {
  const normalized = {
    quality: stream.quality || 'unknown',
    format: stream.format || 'unknown',
    codec: stream.codec || 'unknown',
    url: stream.url,
  };
  const optionalFields = [
    'type', 'duration', 'size', 'bandwidth', 'bitrate', 'expiresAt', 'protocol',
  ];
  for (const field of optionalFields) {
    if (stream[field] != null) normalized[field] = stream[field];
  }
  return normalized;
}
