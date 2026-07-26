/**
 * Bilibili platform parser — video + live.
 * Deployed on domestic server → direct API calls, no IP block.
 */

import { md5 } from '../utils/md5.js';
import { fetchWithRetry } from '../utils/http.js';
import { bilibiliQuality, pickBestQuality } from '../utils/quality.js';

// ---- WBI signing ----

let mixKey = null;
let mixKeyTime = 0;

async function getMixKey(cookie) {
  if (mixKey && Date.now() - mixKeyTime < 3600_000) return mixKey;

  const resp = await fetchWithRetry('https://api.bilibili.com/x/web-interface/nav', {
    platform: 'bilibili', cookie,
  });
  const data = await resp.json();
  const wbi = data?.data?.wbi_img;
  if (!wbi?.img_url || !wbi?.sub_url) throw new Error('WBI keys not found');

  const stem = (u) => { const f = u.split('/').pop(); return f.substring(0, f.lastIndexOf('.')); };
  mixKey = stem(wbi.img_url) + stem(wbi.sub_url);
  mixKeyTime = Date.now();
  return mixKey;
}

function signParams(params, key) {
  delete params.w_rid; delete params.wts;
  const sorted = Object.keys(params)
    .filter(k => params[k] != null).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  return { wts: Math.floor(Date.now() / 1000), w_rid: md5(sorted + key) };
}

async function signedUrl(base, params, cookie) {
  const key = await getMixKey(cookie);
  Object.assign(params, signParams({ ...params }, key));
  const q = Object.entries(params)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `${base}?${q}`;
}

// ---- Parse video ----

export async function parseVideo(bvid, options = {}) {
  const { cookie = '' } = options;

  // Step 1: get video info
  const viewResp = await fetchWithRetry(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
    { platform: 'bilibili', cookie }
  );
  const vdata = (await viewResp.json())?.data;
  if (!vdata) throw new Error(`Video not found: ${bvid}`);

  const { cid, title = '', pic: cover = '', duration = 0, pages = [] } = vdata;
  const author = vdata.owner?.name || '';

  // Step 2: get play URLs (combined stream, fnval=1)
  const playUrl = await signedUrl('https://api.bilibili.com/x/player/wbi/playurl', {
    bvid, cid: String(cid), qn: '120', fnval: '1', fnver: '0', fourk: '1', platform: 'web',
  }, cookie);

  const playResp = await fetchWithRetry(playUrl, { platform: 'bilibili', cookie });
  const playResult = (await playResp.json())?.data;
  if (!playResult) throw new Error('Failed to get play URL');

  // Build streams
  const streams = [];
  const currentQn = playResult.quality || 0;
  const quality = bilibiliQuality(currentQn);

  if (playResult.durl?.length) {
    for (const d of playResult.durl) {
      streams.push({
        quality, duration,
        format: d.url.includes('.m3u8') ? 'm3u8' : d.url.includes('.flv') ? 'flv' : 'mp4',
        codec: 'avc',
        url: d.url,
        size: d.size || 0,
        expiresAt: (d.url.match(/deadline=(\d+)/) || [])[1] || null,
      });
    }
  }

  if (playResult.dash && streams.length === 0) {
    for (const v of playResult.dash.video || []) {
      streams.push({
        quality: bilibiliQuality(v.id), format: 'mp4', codec: v.codecs || 'avc',
        url: v.baseUrl || v.base_url, type: 'video-only', bandwidth: v.bandwidth || 0,
      });
    }
    for (const a of playResult.dash.audio || []) {
      streams.push({
        quality: `${Math.round((a.bandwidth || 0) / 1000)}k`, format: 'mp4', codec: a.codecs || 'aac',
        url: a.baseUrl || a.base_url, type: 'audio-only', bandwidth: a.bandwidth || 0,
      });
    }
  }

  return {
    platform: 'bilibili', type: 'video',
    meta: {
      id: bvid, title, cover, author, duration, cid,
      pages: pages.map(p => ({ cid: p.cid, title: p.part || '', duration: p.duration || 0 })),
      qualityOptions: (playResult.accept_quality || []).map((qn, i) => ({
        raw: qn, label: bilibiliQuality(qn), description: (playResult.accept_description || [])[i] || bilibiliQuality(qn),
      })),
    },
    streams,
  };
}

// ---- Parse live ----

export async function parseLive(roomId, options = {}) {
  const { cookie = '' } = options;

  // Step 1: real room ID
  const initResp = await fetchWithRetry(
    `https://api.live.bilibili.com/room/v1/Room/room_init?id=${roomId}`,
    { platform: 'bilibili', cookie }
  );
  const initData = (await initResp.json())?.data;
  if (!initData?.room_id) throw new Error(`Live room not found: ${roomId}`);

  const realId = initData.room_id;

  // Step 2: play info
  const playResp = await fetchWithRetry(
    `https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${realId}&protocol=0,1&format=0,1,2&codec=0&platform=web`,
    { platform: 'bilibili', cookie }
  );
  const playurl = (await playResp.json())?.data?.playurl_info?.playurl;
  if (!playurl) throw new Error('Failed to get live play URL');

  const streams = [];
  for (const stream of playurl.stream || []) {
    for (const fmt of stream.format || []) {
      for (const codec of fmt.codec || []) {
        for (const info of codec.url_info || []) {
          const url = `${info.host}${codec.base_url || ''}${info.extra || ''}`;
          let format = fmt.format_name;
          if (stream.protocol_name === 'http_hls') format = 'm3u8';
          streams.push({
            quality: codec.codec_name === 'hevc' ? '1080p' : 'original',
            format, codec: codec.codec_name, url,
            bitrate: stream.stream_info?.bitrate || 0,
            protocol: stream.protocol_name,
          });
        }
      }
    }
  }

  return {
    platform: 'bilibili', type: 'live',
    meta: {
      id: String(realId),
      shortId: roomId !== String(realId) ? roomId : null,
      title: initData.title || `Room ${realId}`,
      liveStatus: initData.live_status,
    },
    streams,
  };
}
