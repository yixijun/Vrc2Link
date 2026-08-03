/**
 * Netease Cloud Music platform parser — song + MV.
 */

import { fetchWithRetry } from '../utils/http.js';
import { neteaseQuality, neteaseMvQuality } from '../utils/quality.js';

async function fetchJson(url, options = {}) {
  const resp = await fetchWithRetry(url, {
    platform: 'netease', cookie: options.cookie,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);
  return resp.json();
}

// ---- Song ----

export async function parseSong(songId, options = {}) {
  const { cookie = '', quality: targetQuality } = options;

  const detail = await fetchJson(`https://music.163.com/api/song/detail?ids=[${songId}]`, { cookie });
  const song = detail?.songs?.[0];
  if (!song) throw new Error(`Song not found: ${songId}`);

  const title = song.name || '';
  const author = (song.artists || []).map(a => a.name).join(' / ') || '';
  const cover = song.album?.picUrl || song.album?.blurPicUrl || '';
  const album = song.album?.name || '';
  const duration = Math.floor((song.duration || 0) / 1000);

  const bitrateByQuality = {
    lossless: 999000,
    '320k': 320000,
    '256k': 256000,
    '128k': 128000,
  };
  const bitrates = targetQuality
    ? [bitrateByQuality[targetQuality]].filter(Boolean)
    : [999000, 320000, 256000, 128000];

  // Try bitrates descending, or only the explicitly requested bitrate.
  let url = null, quality = '';
  for (const br of bitrates) {
    try {
      const pd = await fetchJson(
        `https://music.163.com/api/song/enhance/player/url?id=${songId}&ids=[${songId}]&br=${br}`,
        { cookie }
      );
      url = pd?.data?.[0]?.url;
      if (url) { quality = neteaseQuality(br); break; }
    } catch { continue; }
  }

  // Fallback to public mirror
  if (!url) { url = `https://music.163.com/song/media/outer/url?id=${songId}.mp3`; quality = '128k'; }

  return {
    platform: 'netease', type: 'song',
    meta: {
      id: songId, title, cover, author, album, duration,
      hasHighQuality: quality === '320k' || quality === 'lossless',
    },
    streams: [{
      quality, duration,
      format: url.includes('.flac') ? 'flac' : 'mp3',
      codec: url.includes('.flac') ? 'flac' : 'mp3',
      url,
    }],
  };
}

export async function parsePlaylist(playlist, options = {}) {
  const { cookie = '', resolverPrefix = '' } = options;
  const detail = await fetchJson(`https://music.163.com/api/playlist/detail?id=${encodeURIComponent(playlist.id)}&limit=1000&offset=0`, { cookie });
  const data = detail?.playlist || detail?.result;
  if (!data) throw new Error(`Netease playlist not found: ${playlist.id}`);
  const tracks = await hydratePlaylistTracks(data, cookie);
  if (!tracks.length) throw new Error(`Netease playlist is empty or unavailable: ${playlist.id}`);
  return {
    platform: 'netease',
    type: 'playlist',
    meta: { id: playlist.id, title: data.name || `\u7f51\u6613\u4e91\u6b4c\u5355 ${playlist.id}`, author: data.creator?.nickname || '', cover: data.coverImgUrl || '', duration: 0 },
    playlist: tracks.map((track, index) => {
      const source = `https://music.163.com/song?id=${track.id}`;
      return {
        id: String(track.id),
        title: `${index + 1}. ${track.name || '\u672a\u547d\u540d\u6b4c\u66f2'}`,
        sourceUrl: source,
        url: resolverUrl(source, resolverPrefix),
        cover: track.al?.picUrl || track.album?.picUrl || '',
        duration: Math.floor((track.dt ?? track.duration ?? 0) / 1000),
      };
    }),
  };
}

async function hydratePlaylistTracks(playlist, cookie) {
  const tracks = playlist.tracks || [];
  const trackIds = (playlist.trackIds || []).map((track) => String(track?.id ?? track));
  if (!trackIds.length || tracks.length >= trackIds.length) return tracks;

  const byId = new Map(tracks.map((track) => [String(track.id), track]));
  const missing = trackIds.filter((id) => !byId.has(id));
  for (let offset = 0; offset < missing.length; offset += 500) {
    const ids = missing.slice(offset, offset + 500);
    try {
      const detail = await fetchJson(
        `https://music.163.com/api/song/detail?ids=${encodeURIComponent(JSON.stringify(ids))}`,
        { cookie },
      );
      for (const song of detail?.songs || []) byId.set(String(song.id), song);
    } catch {
      // Keep the entries returned by the playlist endpoint when details are restricted.
    }
  }
  return trackIds.map((id) => byId.get(id)).filter(Boolean);
}

function resolverUrl(source, prefix) {
  if (!prefix) return source;
  return `${prefix}${encodeURIComponent(source)}`;
}

// ---- MV ----

export async function parseMv(mvId, options = {}) {
  const { cookie = '' } = options;

  const detail = await fetchJson(`https://music.163.com/api/mv/detail?id=${mvId}`, { cookie });
  const mv = detail?.data;
  if (!mv) throw new Error(`MV not found: ${mvId}`);

  const title = mv.name || '';
  const author = mv.artistName || mv.artist?.name || '';
  const cover = mv.cover || '';
  const duration = Math.floor((mv.duration || 0) / 1000);

  // Try resolutions, also check detail.brs for embedded URLs
  const streams = [];

  // First check if detail response has brs with direct URLs
  if (mv.brs) {
    for (const [res, url] of Object.entries(mv.brs)) {
      if (url) streams.push({ quality: neteaseMvQuality(parseInt(res)), format: 'mp4', codec: 'avc', url, duration });
    }
  }

  // Also try MV URL API for each resolution
  for (const r of [1080, 720, 480, 240]) {
    try {
      const urlData = await fetchJson(`https://music.163.com/api/mv/url?id=${mvId}&r=${r}`, { cookie });
      const u = urlData?.data?.url || urlData?.data?.data?.url ||
                (urlData?.data?.urls && urlData.data.urls[0]?.url);
      if (u && !streams.find(s => s.url === u)) {
        streams.push({ quality: neteaseMvQuality(r), format: 'mp4', codec: 'avc', url: u, duration });
      }
    } catch { continue; }
  }

  if (streams.length === 0) {
    throw new Error(`No playable MV URL found for: ${mvId}. Try passing a Netease cookie (MUSIC_U).`);
  }

  return {
    platform: 'netease', type: 'mv',
    meta: { id: mvId, title, cover, author, duration },
    streams,
  };
}
