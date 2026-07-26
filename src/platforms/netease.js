/**
 * Netease Cloud Music platform parser — song + MV.
 *
 * Song flow:
 *   1. song detail API → title, artist, cover, album
 *   2. player URL API (with cookie for high quality) → mp3/flac URL
 *   3. Fallback to public mirror URL if API returns empty
 *
 * MV flow:
 *   1. MV detail API → title, artist, cover
 *   2. MV URL API → mp4 streams at various resolutions
 */

import { fetchJson } from '../utils/http.js';
import { neteaseQuality, neteaseMvQuality } from '../utils/quality.js';

// ---- Song parsing ----

/**
 * Parse a Netease song.
 * @param {string} songId
 * @param {object} options
 * @param {string} [options.cookie]
 * @param {string} [options.forwardIp]
 * @returns {Promise<object>}
 */
export async function parseSong(songId, options = {}) {
  const { cookie = '', forwardIp } = options;

  // Step 1: Get song detail
  const detailData = await fetchJson(
    `https://music.163.com/api/song/detail?ids=[${songId}]`,
    { platform: 'netease', forwardIp, cookie }
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

  // Step 2: Get play URL — try official API first
  let streamUrl = null;
  let streamQuality = '';

  // Try multiple bitrates: lossless → 320k → 256k → 128k
  const bitrates = [999000, 320000, 256000, 128000];

  for (const br of bitrates) {
    try {
      const playerData = await fetchJson(
        `https://music.163.com/api/song/enhance/player/url?id=${songId}&ids=[${songId}]&br=${br}`,
        { platform: 'netease', forwardIp, cookie }
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

  // Step 3: Fallback to public mirror if official API returned nothing
  if (!streamUrl) {
    // The public mirror URL works without cookie but is unreliable
    const mirrorUrl = `https://music.163.com/song/media/outer/url?id=${songId}.mp3`;
    streamUrl = mirrorUrl;
    streamQuality = '128k'; // mirror only serves 128k
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
      // Track if we got high quality (cookie was effective)
      hasHighQuality: streamQuality === '320k' || streamQuality === 'lossless',
    },
    streams,
  };
}

// ---- MV parsing ----

/**
 * Parse a Netease MV.
 * @param {string} mvId
 * @param {object} options
 * @param {string} [options.cookie]
 * @param {string} [options.forwardIp]
 * @returns {Promise<object>}
 */
export async function parseMv(mvId, options = {}) {
  const { cookie = '', forwardIp } = options;

  // Step 1: Get MV detail
  const detailData = await fetchJson(
    `https://music.163.com/api/mv/detail?id=${mvId}`,
    { platform: 'netease', forwardIp, cookie }
  );

  const mvData = detailData?.data;
  if (!mvData) {
    throw new Error(`MV not found: ${mvId}`);
  }

  const title = mvData.name || '';
  const author = mvData.artistName || mvData.artist?.name || '';
  const cover = mvData.cover || '';
  const duration = Math.floor((mvData.duration || 0) / 1000);

  // Step 2: Get MV play URL at multiple resolutions
  const resolutions = [1080, 720, 480, 240];
  const streams = [];

  for (const r of resolutions) {
    try {
      const urlData = await fetchJson(
        `https://music.163.com/api/mv/url?id=${mvId}&r=${r}`,
        { platform: 'netease', forwardIp, cookie }
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

  // If no CDN URL at all, error
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
