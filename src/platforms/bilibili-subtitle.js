import { fetchWithRetry } from '../utils/http.js';

const CACHE_SECONDS = 21600;

export async function fetchBilibiliCcSubtitles(bvid, options = {}) {
  const { cookie = '', state, fetcher = fetchWithRetry, track = 0 } = options;
  const cacheKey = `subtitle:bilibili:${bvid}:${cookie ? 'auth' : 'anon'}:${track}`;
  const cached = state?.getJson(cacheKey);
  if (cached) return cached;

  const video = await fetchJson(
    fetcher,
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
    cookie,
  );
  const cid = video?.data?.cid;
  const aid = video?.data?.aid;
  if (!cid) throw new Error(`Bilibili video CID not found: ${bvid}`);

  const expectedSubtitleIds = new Set(
    (video?.data?.subtitle?.list || [])
      .map((item) => String(item?.id_str || item?.id || ''))
      .filter(Boolean),
  );
  const player = await fetchJson(
    fetcher,
    `https://api.bilibili.com/x/player/wbi/v2?${new URLSearchParams({
      bvid: String(bvid),
      cid: String(cid),
      ...(aid ? { aid: String(aid) } : {}),
    })}`,
    cookie,
  );
  const responseTracks = player?.data?.subtitle?.subtitles || [];
  const consistentTracks = expectedSubtitleIds.size > 0
    ? responseTracks.filter((item) => expectedSubtitleIds.has(String(item?.id_str || item?.id || '')))
    : responseTracks;
  const tracks = sortSubtitleTracks(consistentTracks);
  const playableTracks = tracks.filter((item) => normalizeSubtitleUrl(item?.subtitle_url));
  const selectedIndex = track <= 0 ? 0 : track - 1;
  const requestedTrack = tracks[selectedIndex];
  const selectedTrack = requestedTrack?.subtitle_url ? requestedTrack : playableTracks[0];
  if (!selectedTrack?.subtitle_url) {
    const result = unavailable(tracks);
    state?.setJson(cacheKey, result, CACHE_SECONDS);
    return result;
  }

  const subtitleUrl = normalizeSubtitleUrl(selectedTrack.subtitle_url);
  const payload = await fetchJson(fetcher, subtitleUrl, cookie);
  const result = {
    available: true,
    platform: 'bilibili',
    source: 'bilibili-cc',
    language: String(selectedTrack.lan || ''),
    languageName: String(selectedTrack.lan_doc || selectedTrack.lan || ''),
    selectedTrack: track,
    actualTrack: Math.max(1, tracks.indexOf(selectedTrack) + 1),
    tracks: normalizeTracks(tracks),
    cues: normalizeSubtitleCues(payload?.body),
  };
  if (result.cues.length === 0) result.available = false;
  state?.setJson(cacheKey, result, CACHE_SECONDS);
  return result;
}

export function selectSubtitleTrack(tracks) {
  return sortSubtitleTracks(tracks)[0] || null;
}

export function sortSubtitleTracks(tracks) {
  if (!Array.isArray(tracks)) return [];
  return tracks
    .map((track, index) => ({ track, index }))
    .sort((left, right) => languageRank(left.track?.lan) - languageRank(right.track?.lan) || left.index - right.index)
    .map((entry) => entry.track);
}

export function normalizeSubtitleCues(body) {
  if (!Array.isArray(body)) return [];
  return body
    .map((cue) => ({
      from: finiteNumber(cue?.from),
      to: finiteNumber(cue?.to),
      text: cleanText(cue?.content),
    }))
    .filter((cue) => cue.from >= 0 && cue.to > cue.from && cue.text)
    .sort((left, right) => left.from - right.from);
}

export function normalizeSubtitleUrl(value) {
  const url = String(value || '').trim();
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `https://api.bilibili.com${url}`;
  return url;
}

function unavailable(tracks = []) {
  return {
    available: false,
    platform: 'bilibili',
    source: '',
    language: '',
    languageName: '',
    selectedTrack: 0,
    tracks: normalizeTracks(tracks),
    cues: [],
  };
}

function normalizeTracks(tracks) {
  return tracks.map((track, index) => ({
    index,
    language: String(track?.lan || ''),
    name: subtitleTrackName(track, index),
  }));
}

function subtitleTrackName(track, index) {
  const base = String(track?.lan_doc || track?.lan || `Track ${index + 1}`);
  const language = String(track?.lan || '').toLowerCase();
  const isAi = Number(track?.type) === 1 || language.startsWith('ai-');
  return `${base}${isAi ? '（AI）' : '（人工）'}`;
}

function languageRank(language) {
  const value = String(language || '').toLowerCase();
  if (value === 'zh-cn' || value === 'zh-hans') return 0;
  if (value === 'ai-zh' || value.startsWith('zh')) return 1;
  if (value.startsWith('ai-zh')) return 2;
  return 10;
}

async function fetchJson(fetcher, url, cookie) {
  const response = await fetcher(url, { platform: 'bilibili', cookie });
  if (!response.ok) throw new Error(`Bilibili subtitle HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.code != null && payload.code !== 0) {
    throw new Error(`Bilibili subtitle API ${payload.code}: ${payload.message || 'unknown error'}`);
  }
  return payload;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -1;
}

function cleanText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<[^>]*>/gu, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .trim()
    .slice(0, 500);
}
