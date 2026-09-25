import { createHash, randomBytes } from 'node:crypto';

import { DEFAULT_PUBLIC_BASE_URL } from './config.js';
import { AppError } from './errors.js';
import { qualityRank } from './utils/quality.js';

const TICKET_BYTES = 24;
const REFRESH_MARGIN_MS = 30_000;

export function selectDashTracks(result, targetQuality) {
  if (result?.platform !== 'bilibili' || result?.type !== 'video') {
    throw new AppError(422, 'dash_platform_unavailable', 'DASH mode currently supports Bilibili videos only');
  }

  const videos = (result.streams || []).filter((stream) =>
    stream.type === 'video-only' && stream.url,
  );
  const audios = (result.streams || []).filter((stream) =>
    stream.type === 'audio-only' && stream.url,
  );

  const requestedVideos = targetQuality
    ? videos.filter((stream) => stream.quality === targetQuality)
    : videos;
  if (!requestedVideos.length) {
    if (targetQuality) {
      throw new AppError(422, 'quality_unavailable', `Requested DASH quality is unavailable: ${targetQuality}`);
    }
    throw new AppError(422, 'dash_video_unavailable', 'No DASH video track is available');
  }

  const h264Videos = requestedVideos.filter((stream) => isH264(stream.codec));
  if (!h264Videos.length) {
    throw new AppError(422, 'dash_codec_unavailable', 'No SDR H.264 DASH video track is available');
  }
  h264Videos.sort(compareVideoTracks);

  const aacAudios = audios.filter((stream) => isAac(stream.codec));
  if (!aacAudios.length) {
    throw new AppError(422, 'dash_audio_unavailable', 'No AAC DASH audio track is available');
  }
  aacAudios.sort((left, right) => Number(right.bandwidth || 0) - Number(left.bandwidth || 0));

  return { video: h264Videos[0], audio: aacAudios[0] };
}

export function createDashTicket(state, record, ttlSeconds) {
  if (!state) throw new AppError(503, 'state_unavailable', 'DASH ticket state is unavailable');
  const ticket = randomBytes(TICKET_BYTES).toString('base64url');
  const generation = 1;
  const stored = {
    ...record,
    generation,
    createdAt: Date.now(),
    refreshedAt: Date.now(),
  };
  state.setJson(dashTicketKey(ticket), stored, ttlSeconds);
  return { ticket, record: stored };
}

export function getDashTicket(state, ticket) {
  if (!state || !isValidTicket(ticket)) return undefined;
  const record = state.getJson(dashTicketKey(ticket));
  if (!record || isTicketExpired(record)) return undefined;
  return record;
}

export function updateDashTicket(state, ticket, current, next, ttlSeconds) {
  if (!state || !isValidTicket(ticket)) return undefined;
  const latest = state.getJson(dashTicketKey(ticket));
  if (!latest || isTicketExpired(latest)) return undefined;
  if (latest.generation !== current.generation) return latest;
  const remainingSeconds = ticketRemainingSeconds(latest);
  if (remainingSeconds <= 0) return undefined;
  const updated = {
    ...next,
    generation: current.generation + 1,
    createdAt: current.createdAt,
    refreshedAt: Date.now(),
  };
  state.setJson(
    dashTicketKey(ticket),
    updated,
    Math.max(1, Math.min(Number(ttlSeconds) || remainingSeconds, remainingSeconds)),
  );
  return updated;
}

export function buildDashUrls(request, env, ticket) {
  const configuredBase = String(env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/u, '');
  const requestUrl = new URL(request.url);
  const base = configuredBase || DEFAULT_PUBLIC_BASE_URL;
  const prefix = requestUrl.pathname.startsWith('/api/v1/') ? '/api/v1/dash' : '/dash';
  const path = `${prefix}/${encodeURIComponent(ticket)}`;
  return {
    manifestUrl: `${base}${path}/manifest.mpd`,
    videoUrl: `${base}${path}/video`,
    audioUrl: `${base}${path}/audio`,
  };
}

export function buildDashMpd(record, urls) {
  const duration = Number(record.duration);
  const durationAttribute = Number.isFinite(duration) && duration > 0
    ? ` mediaPresentationDuration="${formatDuration(duration)}"`
    : '';
  const video = record.video;
  const audio = record.audio;
  const periodDuration = Number.isFinite(duration) && duration > 0
    ? ` duration="${formatDuration(duration)}"`
    : '';

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" minBufferTime="PT1.5S"' + durationAttribute + '>',
    `  <Period id="vrc2link-0" start="PT0S"${periodDuration}>`,
    renderVideoAdaptation(video, urls.videoUrl),
    renderAudioAdaptation(audio, urls.audioUrl),
    '  </Period>',
    '</MPD>',
    '',
  ].join('\n');
}

export function dashTrackNeedsRefresh(track, now = Date.now()) {
  const expiresAt = Number(track?.expiresAt || 0);
  return expiresAt > 0 && expiresAt <= now + REFRESH_MARGIN_MS;
}

export function dashTicketNeedsRefresh(record, now = Date.now()) {
  return dashTrackNeedsRefresh(record?.video, now) || dashTrackNeedsRefresh(record?.audio, now);
}

export function trackExpiresAt(url) {
  const match = String(url || '').match(/[?&]deadline=(\d+)/u);
  if (!match) return 0;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

export function makeDashRecord({ sourceUrl, authenticated, profileId, quality, result, tracks }) {
  return {
    platform: 'bilibili',
    type: 'video',
    sourceUrl,
    authenticated: authenticated === true,
    profileId: profileId || '',
    quality: quality || tracks.video.quality,
    id: String(result.id || ''),
    cid: String(result.cid || ''),
    title: result.title || '',
    duration: Number(result.duration) || 0,
    video: sanitizeTrack(tracks.video),
    audio: sanitizeTrack(tracks.audio),
  };
}

function sanitizeTrack(track) {
  return {
    quality: track.quality || 'unknown',
    format: track.format || 'mp4',
    codec: track.codec || 'unknown',
    url: track.url,
    backupUrls: Array.isArray(track.backupUrls) ? track.backupUrls.filter(Boolean).slice(0, 3) : [],
    bandwidth: Number(track.bandwidth) || 0,
    trackId: Number(track.trackId) || 0,
    width: Number(track.width) || 0,
    height: Number(track.height) || 0,
    frameRate: track.frameRate || '',
    mimeType: track.mimeType || (track.type === 'audio-only' ? 'audio/mp4' : 'video/mp4'),
    initialization: track.initialization || '',
    indexRange: track.indexRange || '',
    startWithSap: Number(track.startWithSap) || 1,
    sampleRate: Number(track.sampleRate) || 0,
    channels: Number(track.channels) || 0,
    expiresAt: track.expiresAt || trackExpiresAt(track.url),
  };
}

function renderVideoAdaptation(track, baseUrl) {
  const attributes = [
    'contentType="video"',
    `mimeType="${escapeXml(track.mimeType || 'video/mp4')}"`,
    `codecs="${escapeXml(track.codec || 'avc1')}"`,
  ];
  if (track.width > 0) attributes.push(`maxWidth="${track.width}"`);
  if (track.height > 0) attributes.push(`maxHeight="${track.height}"`);
  if (track.frameRate) attributes.push(`maxFrameRate="${escapeXml(track.frameRate)}"`);
  return renderAdaptationSet(attributes.join(' '), renderRepresentation(track, baseUrl, 'video'));
}

function renderAudioAdaptation(track, baseUrl) {
  const attributes = [
    'contentType="audio"',
    `mimeType="${escapeXml(track.mimeType || 'audio/mp4')}"`,
    `codecs="${escapeXml(track.codec || 'mp4a.40.2')}"`,
  ];
  if (track.sampleRate > 0) attributes.push(`audioSamplingRate="${track.sampleRate}"`);
  const channelConfiguration = track.channels > 0
    ? `<AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="${track.channels}" />`
    : '';
  return renderAdaptationSet(
    attributes.join(' '),
    renderRepresentation(track, baseUrl, 'audio'),
    channelConfiguration,
  );
}

function renderAdaptationSet(attributes, representation, extra = '') {
  return `    <AdaptationSet ${attributes} segmentAlignment="true">${extra ? `\n      ${extra}` : ''}\n${representation}\n    </AdaptationSet>`;
}

function renderRepresentation(track, baseUrl, type) {
  const attributes = [
    `id="${escapeXml(String(track.trackId || `${type}-0`))}"`,
    `bandwidth="${Math.max(1, Number(track.bandwidth) || 1)}"`,
  ];
  if (type === 'video') {
    if (track.width > 0) attributes.push(`width="${track.width}"`);
    if (track.height > 0) attributes.push(`height="${track.height}"`);
    if (track.frameRate) attributes.push(`frameRate="${escapeXml(track.frameRate)}"`);
  } else if (track.sampleRate > 0) {
    attributes.push(`audioSamplingRate="${track.sampleRate}"`);
  }
  const segmentBase = renderSegmentBase(track);
  return [
    `      <Representation ${attributes.join(' ')}>`,
    `        <BaseURL>${escapeXml(baseUrl)}</BaseURL>`,
    segmentBase ? `        ${segmentBase}` : '',
    '      </Representation>',
  ].filter(Boolean).join('\n');
}

function renderSegmentBase(track) {
  const attributes = [];
  if (track.indexRange) attributes.push(`indexRange="${escapeXml(track.indexRange)}"`);
  if (track.startWithSap > 0) attributes.push(`startWithSAP="${track.startWithSap}"`);
  const initialization = track.initialization
    ? `<Initialization range="${escapeXml(track.initialization)}" />`
    : '';
  if (!attributes.length && !initialization) return '';
  return `<SegmentBase${attributes.length ? ` ${attributes.join(' ')}` : ''}>${initialization}</SegmentBase>`;
}

function compareVideoTracks(left, right) {
  const qualityDifference = qualityRank(right.quality) - qualityRank(left.quality);
  if (qualityDifference !== 0) return qualityDifference;
  const heightDifference = Number(right.height || 0) - Number(left.height || 0);
  if (heightDifference !== 0) return heightDifference;
  return Number(right.bandwidth || 0) - Number(left.bandwidth || 0);
}

function isH264(codec) {
  return /^(?:avc|avc1)(?:[.\d]|$)/iu.test(String(codec || ''));
}

function isAac(codec) {
  return /(?:aac|mp4a\.40)/iu.test(String(codec || ''));
}

function formatDuration(seconds) {
  return `PT${Math.max(0, Number(seconds)).toFixed(3).replace(/0+$/u, '').replace(/\.$/u, '')}S`;
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

function isValidTicket(ticket) {
  return /^[A-Za-z0-9_-]{32}$/u.test(String(ticket || ''));
}

function isTicketExpired(record, now = Date.now()) {
  const expiresAt = Number(record?.ticketExpiresAt || 0);
  return expiresAt > 0 && expiresAt <= now;
}

function ticketRemainingSeconds(record, now = Date.now()) {
  const expiresAt = Number(record?.ticketExpiresAt || 0);
  if (!expiresAt) return Number.MAX_SAFE_INTEGER;
  return Math.ceil((expiresAt - now) / 1000);
}

function dashTicketKey(ticket) {
  const digest = createHash('sha256').update(String(ticket)).digest('hex');
  return `dash:ticket:${digest}`;
}
