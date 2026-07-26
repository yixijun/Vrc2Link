/**
 * Bilibili platform parser — video + live.
 * Deployed on domestic server → direct API calls, no IP block.
 */

import { fetchWithRetry } from '../utils/http.js';
import { bilibiliQuality, bilibiliQnForQuality } from '../utils/quality.js';

// ---- Parse video ----

export async function parseVideo(bvid, options = {}) {
  const { cookie = '', quality: targetQuality } = options;

  // Step 1: get video info
  const viewResp = await fetchWithRetry(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
    { platform: 'bilibili', cookie }
  );
  const vdata = (await viewResp.json())?.data;
  if (!vdata) throw new Error(`Video not found: ${bvid}`);

  const { cid, title = '', pic: cover = '', duration = 0, pages = [] } = vdata;
  const author = vdata.owner?.name || '';

  // PGC videos use a different player endpoint even when opened through a BV URL.
  const isPgc = /\/bangumi\/play\//.test(vdata.redirect_url || '');
  const playEndpoint = isPgc
    ? 'https://api.bilibili.com/pgc/player/web/playurl/html5'
    : 'https://api.bilibili.com/x/player/playurl';
  const qn = targetQuality
    ? bilibiliQnForQuality(targetQuality)
    : bilibiliQnForQuality('8k');
  const playUrl = `${playEndpoint}?${new URLSearchParams({
    bvid,
    cid: String(cid),
    qn: String(qn),
    fnval: '0',
    fnver: '0',
    fourk: '1',
    platform: 'html5',
    type: 'mp4',
    high_quality: '1',
  })}`;

  const playResp = await fetchWithRetry(playUrl, { platform: 'bilibili', cookie });
  const playPayload = await playResp.json();
  const playResult = isPgc ? playPayload?.result : playPayload?.data;
  if (playPayload?.code !== 0 || !playResult) {
    const detail = playPayload?.message || playResult?.message || 'unknown upstream error';
    throw new Error(`Failed to get play URL: ${detail} (${playPayload?.code ?? 'no code'})`);
  }

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
