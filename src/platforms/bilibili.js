/**
 * Bilibili platform parser — video (BV) + live (room_id).
 *
 * Video flow:
 *   1. view API  → cid, title, cover, author
 *   2. playurl API (WBI signed) → durl (combined flv/mp4 streams)
 *
 * Live flow:
 *   1. room_init → real_room_id
 *   2. getRoomPlayInfo → HLS (m3u8) + FLV streams
 */

import { md5 } from '../utils/md5.js';
import { fetchJson } from '../utils/http.js';
import { bilibiliQuality, pickBestQuality, bilibiliQnForQuality } from '../utils/quality.js';

// ---- WBI signing ----

let cachedMixKey = null;
let cachedMixKeyTime = 0;
const MIX_KEY_TTL = 3600_000; // 1 hour

/**
 * Fetch and cache the WBI mix key from the nav API.
 * @returns {Promise<string>}
 */
async function getMixKey(forwardIp, cookie) {
  if (cachedMixKey && Date.now() - cachedMixKeyTime < MIX_KEY_TTL) {
    return cachedMixKey;
  }

  const data = await fetchJson('https://api.bilibili.com/x/web-interface/nav', {
    platform: 'bilibili',
    forwardIp,
    cookie,
  });

  const wbi = data?.data?.wbi_img;
  if (!wbi?.img_url || !wbi?.sub_url) {
    throw new Error('Failed to fetch WBI keys from nav API');
  }

  // Extract stem from URLs: "https://i0.hdslb.com/bfs/wbi/xxx.png" → "xxx"
  const extractStem = (url) => {
    const parts = url.split('/');
    const filename = parts[parts.length - 1];
    return filename.substring(0, filename.lastIndexOf('.'));
  };

  cachedMixKey = extractStem(wbi.img_url) + extractStem(wbi.sub_url);
  cachedMixKeyTime = Date.now();
  return cachedMixKey;
}

/**
 * Sort query params and generate WBI signature.
 * @param {Record<string, string>} params
 * @param {string} mixKey
 * @returns {{ wts: number, w_rid: string }}
 */
function signParams(params, mixKey) {
  // Remove signing params if present
  delete params.w_rid;
  delete params.wts;

  // Sort by key
  const sorted = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const wts = Math.floor(Date.now() / 1000);
  const toHash = sorted + mixKey;
  const w_rid = md5(toHash);

  return { wts, w_rid };
}

/**
 * Build a signed URL for Bilibili player API.
 */
async function buildSignedUrl(baseUrl, params, forwardIp, cookie) {
  const mixKey = await getMixKey(forwardIp, cookie);
  const { wts, w_rid } = signParams({ ...params }, mixKey);
  params.wts = wts;
  params.w_rid = w_rid;

  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  return `${baseUrl}?${query}`;
}

// ---- Video parsing ----

/**
 * Parse a Bilibili video (BV/AV).
 * @param {string} bvid
 * @param {object} options
 * @param {string} [options.cookie]
 * @param {string} [options.forwardIp]
 * @returns {Promise<object>}
 */
export async function parseVideo(bvid, options = {}) {
  const { cookie = '', forwardIp } = options;

  // Step 1: Get video info (cid, title, etc.)
  const viewData = await fetchJson(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
    { platform: 'bilibili', forwardIp, cookie }
  );

  const vdata = viewData?.data;
  if (!vdata) {
    throw new Error(`Video not found: ${bvid}`);
  }

  const cid = vdata.cid;
  const pages = vdata.pages || [];
  const title = vdata.title || '';
  const cover = vdata.pic || '';
  const author = vdata.owner?.name || '';
  const duration = vdata.duration || 0;

  // Step 2: Get play URLs (combined stream, fnval=1)
  const signedUrl = await buildSignedUrl(
    'https://api.bilibili.com/x/player/wbi/playurl',
    {
      bvid,
      cid: String(cid),
      qn: String(bilibiliQnForQuality('2k')), // request up to 4K, cap later
      fnval: '1',   // combined flv/mp4 (not dash)
      fnver: '0',
      fourk: '1',
      platform: 'web',
    },
    forwardIp,
    cookie
  );

  const playData = await fetchJson(signedUrl, {
    platform: 'bilibili',
    forwardIp,
    cookie,
  });

  const playResult = playData?.data || playData?.result;
  if (!playResult) {
    throw new Error('Failed to get play URL');
  }

  // Extract streams from durl
  const streams = [];
  const acceptQuality = playResult.accept_quality || [];
  const acceptDesc = playResult.accept_description || [];

  if (playResult.durl && playResult.durl.length > 0) {
    // Combined stream: durl is the array of CDN URLs for the selected quality
    const currentQn = playResult.quality || 0;
    const quality = bilibiliQuality(currentQn);

    for (const d of playResult.durl) {
      streams.push({
        quality,
        format: d.url.includes('.m3u8') ? 'm3u8' : d.url.includes('.flv') ? 'flv' : 'mp4',
        codec: 'avc',
        url: d.url,
        size: d.size || 0,
        duration,
        // Bilibili CDN URLs have embedded deadline param
        expiresAt: extractDeadline(d.url),
      });
    }
  } else if (playResult.dash) {
    // Fallback: no combined stream available, return dash audio+video separately
    const dash = playResult.dash;
    const videoStreams = (dash.video || []).map((v) => ({
      quality: bilibiliQuality(v.id),
      format: 'mp4',
      codec: v.codecs || 'avc',
      url: v.baseUrl || v.base_url,
      type: 'video-only',
      bandwidth: v.bandwidth || 0,
    }));
    const audioStreams = (dash.audio || []).map((a) => ({
      quality: `${Math.round((a.bandwidth || 0) / 1000)}k`,
      format: 'mp4',
      codec: a.codecs || 'aac',
      url: a.baseUrl || a.base_url,
      type: 'audio-only',
      bandwidth: a.bandwidth || 0,
    }));
    // Mark as dash so client knows to merge
    streams.push(
      ...videoStreams.filter((s) => {
        const q = pickBestQuality([s.quality]);
        return q === s.quality;
      }),
      ...audioStreams
    );
  }

  // Multi-page info
  const pageList = pages.map((p) => ({
    cid: p.cid,
    title: p.part || '',
    duration: p.duration || 0,
  }));

  // Available quality options (what this video actually supports)
  const qualityOptions = acceptQuality.map((qn, i) => ({
    raw: qn,
    label: bilibiliQuality(qn),
    description: acceptDesc[i] || bilibiliQuality(qn),
  }));

  return {
    platform: 'bilibili',
    type: 'video',
    meta: {
      id: bvid,
      title,
      cover,
      author,
      duration,
      cid,
      pages: pageList,
      qualityOptions,
    },
    streams,
  };
}

// ---- Live parsing ----

/**
 * Parse a Bilibili live room.
 * @param {string} roomId
 * @param {object} options
 * @param {string} [options.cookie]
 * @param {string} [options.forwardIp]
 * @returns {Promise<object>}
 */
export async function parseLive(roomId, options = {}) {
  const { cookie = '', forwardIp } = options;

  // Step 1: Get real room ID
  const initData = await fetchJson(
    `https://api.live.bilibili.com/room/v1/Room/room_init?id=${roomId}`,
    { platform: 'bilibili', forwardIp, cookie }
  );

  const realRoomId = initData?.data?.room_id;
  if (!realRoomId) {
    throw new Error(`Live room not found: ${roomId}`);
  }

  const liveStatus = initData?.data?.live_status;
  const title = initData?.data?.title || `Room ${realRoomId}`;

  // Step 2: Get play info with HLS support
  const playData = await fetchJson(
    `https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${realRoomId}&protocol=0,1&format=0,1,2&codec=0&platform=web`,
    { platform: 'bilibili', forwardIp, cookie }
  );

  const playurlInfo = playData?.data?.playurl_info?.playurl;
  if (!playurlInfo) {
    throw new Error('Failed to get live play URL');
  }

  const streams = [];

  // The stream structure: playurl.stream[] → format[] → codec[] → url_info[] → host + extra
  for (const stream of playurlInfo.stream || []) {
    const protocolName = stream.protocol_name; // http_hls, http_stream (flv)
    for (const fmt of stream.format || []) {
      const formatName = fmt.format_name; // ts, flv, fmp4
      for (const codec of fmt.codec || []) {
        const codecName = codec.codec_name; // avc, hevc
        const baseUrl = codec.base_url || '';
        const urlInfoList = codec.url_info || [];

        // Build CDN URLs
        for (const info of urlInfoList) {
          const fullUrl = `${info.host}${baseUrl}${info.extra || ''}`;

          let format;
          if (protocolName === 'http_hls') {
            format = 'm3u8';
          } else if (formatName === 'flv') {
            format = 'flv';
          } else {
            format = formatName;
          }

          streams.push({
            quality: codecName === 'hevc' ? '1080p' : 'original',
            format,
            codec: codecName,
            url: fullUrl,
            bitrate: stream.stream_info?.bitrate || 0,
            protocol: protocolName,
          });
        }
      }
    }
  }

  return {
    platform: 'bilibili',
    type: 'live',
    meta: {
      id: String(realRoomId),
      shortId: roomId !== String(realRoomId) ? roomId : null,
      title,
      liveStatus, // 1 = live, 0 = offline
    },
    streams,
  };
}

// ---- Helpers ----

/**
 * Extract deadline timestamp from a Bilibili CDN URL.
 */
function extractDeadline(url) {
  if (!url) return null;
  const match = url.match(/deadline=(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}
