/**
 * Netease Cloud Music platform parser — song + MV.
 */

import { fetchWithRetry } from '../utils/http.js';
import { neteaseQuality, neteaseMvQuality } from '../utils/quality.js';

/**
 * Helper: fetch JSON from an API endpoint.
 */
async function fetchApiJson(url, options = {}) {
  const { cookie, forwardIp } = options;
  const headers = {};
  if (cookie) headers.Cookie = cookie;

  const resp = await fetchWithRetry(url, {
    platform: 'netease',
    mode: 'api',
    forwardIp,
    headers,
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} from ${url}`);
  }

  return resp.json();
}

// ---- Song parsing ----

export async function parseSong(songId, options = {}) {
  const { cookie = '', forwardIp } = options;

  // Step 1: Get song detail
  const detailData = await fetchApiJson(
    `https://music.163.com/api/song/detail?ids=[${songId}]`,
    { cookie, forwardIp }
  );

  const song = detailData?.songs?.[0];
  if (!song) {
    throw new Error(`Song not found: ${songId}`);
  }

  const title = song.name || '';
  const author = (song.artists || []).map((a) => a.name).join(' / ') || '';
  const cover = song.album?.picUrl || song.album?.blurPicUrl || '';
  const album = song.album?.name || '';
  const duration = Math.floor((song.duration || 0) / 1000);

  // Step 2: Get play URL — try official API with descending bitrates
  let streamUrl = null;
  let streamQuality = '';
  const bitrates = [999000, 320000, 256000, 128000];

  for (const br of bitrates) {
    try {
      const playerData = await fetchApiJson(
        `https://music.163.com/api/song/enhance/player/url?id=${songId}&ids=[${songId}]&br=${br}`,
        { cookie, forwardIp }
      );

      const url = playerData?.data?.[0]?.url;
      if (url) {
        streamUrl = url;
        streamQuality = neteaseQuality(br);
        break;
      }
    } catch {
      continue;
    }
  }

  // Step 3: Fallback to public mirror
  if (!streamUrl) {
    streamUrl = `https://music.163.com/song/media/outer/url?id=${songId}.mp3`;
    streamQuality = '128k';
  }

  const streams = [];
  if (streamUrl) {
    streams.push({
      quality: streamQuality,
      format: streamUrl.includes('.flac') ? 'flac' : 'mp3',
      codec: streamUrl.includes('.flac') ? 'flac' : 'mp3',
      url: streamUrl,
      duration,
    });
  }

  return {
    platform: 'netease',
    type: 'song',
    meta: {
      id: songId,
      title,
      cover,
      author,
      album,
      duration,
      hasHighQuality: streamQuality === '320k' || streamQuality === 'lossless',
    },
    streams,
  };
}

// ---- MV parsing ----

export async function parseMv(mvId, options = {}) {
  const { cookie = '', forwardIp } = options;

  // Step 1: Get MV detail
  const detailData = await fetchApiJson(
    `https://music.163.com/api/mv/detail?id=${mvId}`,
    { cookie, forwardIp }
  );

  const mvData = detailData?.data;
  if (!mvData) {
    throw new Error(`MV not found: ${mvId}`);
  }

  const title = mvData.name || '';
  const author = mvData.artistName || mvData.artist?.name || '';
  const cover = mvData.cover || '';
  const duration = Math.floor((mvData.duration || 0) / 1000);

  // Step 2: Get MV play URLs at multiple resolutions
  const resolutions = [1080, 720, 480, 240];
  const streams = [];

  for (const r of resolutions) {
    try {
      const urlData = await fetchApiJson(
        `https://music.163.com/api/mv/url?id=${mvId}&r=${r}`,
        { cookie, forwardIp }
      );

      const url = urlData?.data?.url;
      if (url) {
        streams.push({
          quality: neteaseMvQuality(r),
          format: 'mp4',
          codec: 'avc',
          url,
          duration,
        });
      }
    } catch {
      continue;
    }
  }

  if (streams.length === 0) {
    throw new Error(`No playable MV URL found for: ${mvId}`);
  }

  return {
    platform: 'netease',
    type: 'mv',
    meta: {
      id: mvId,
      title,
      cover,
      author,
      duration,
    },
    streams,
  };
}
