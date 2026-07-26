/**
 * Bilibili platform parser — video (BV) + live (room_id).
 *
 * Strategy: scrape the video page HTML (window.__INITIAL_STATE__) instead of
 * calling api.bilibili.com directly, because Cloudflare Worker IPs are often
 * blocked by B站's API gateway (412). The public web page is served via CDN
 * and works from any IP.
 */

import { md5 } from '../utils/md5.js';
import { fetchWithRetry } from '../utils/http.js';
import { bilibiliQuality, pickBestQuality, bilibiliQnForQuality } from '../utils/quality.js';

// ---- Helpers ----

/**
 * Extract a JSON object from HTML by bracket counting.
 * More robust than regex for nested JSON.
 */
function extractJson(html, marker) {
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const jsonStart = html.indexOf('{', start);
  if (jsonStart === -1) return null;
  let depth = 0;
  for (let i = jsonStart; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) return html.substring(jsonStart, i + 1);
    }
  }
  return null;
}

/**
 * Extract deadline timestamp from a Bilibili CDN URL.
 */
function extractDeadline(url) {
  if (!url) return null;
  const match = url.match(/deadline=(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// ---- WBI signing ----

let cachedMixKey = null;
let cachedMixKeyTime = 0;
const MIX_KEY_TTL = 3600_000; // 1 hour

async function getMixKey(forwardIp, cookie) {
  if (cachedMixKey && Date.now() - cachedMixKeyTime < MIX_KEY_TTL) {
    return cachedMixKey;
  }

  const resp = await fetchWithRetry('https://api.bilibili.com/x/web-interface/nav', {
    platform: 'bilibili',
    mode: 'api',
    forwardIp,
    headers: cookie ? { Cookie: cookie } : {},
  });

  if (!resp.ok) {
    // If nav API is blocked, use a hardcoded fallback key (rotates periodically)
    // Most open-source parsers cache the key for 1h to reduce API calls
    throw new Error(`Failed to fetch WBI keys: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const wbi = data?.data?.wbi_img;
  if (!wbi?.img_url || !wbi?.sub_url) {
    throw new Error('WBI keys not found in nav response');
  }

  const extractStem = (url) => {
    const parts = url.split('/');
    const filename = parts[parts.length - 1];
    return filename.substring(0, filename.lastIndexOf('.'));
  };

  cachedMixKey = extractStem(wbi.img_url) + extractStem(wbi.sub_url);
  cachedMixKeyTime = Date.now();
  return cachedMixKey;
}

function signParams(params, mixKey) {
  delete params.w_rid;
  delete params.wts;

  const sorted = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const wts = Math.floor(Date.now() / 1000);
  const w_rid = md5(sorted + mixKey);

  return { wts, w_rid };
}

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

// ---- Video page scraping ----

/**
 * Scrape the video page to extract __INITIAL_STATE__ JSON.
 */
async function scrapeVideoPage(bvid, forwardIp, cookie) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;

  const resp = await fetchWithRetry(`https://www.bilibili.com/video/${bvid}`, {
    platform: 'bilibili',
    mode: 'page',
    forwardIp,
    headers,
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch video page: HTTP ${resp.status}`);
  }

  const html = await resp.text();

  // Extract the embedded state JSON
  const jsonStr = extractJson(html, 'window.__INITIAL_STATE__');
  if (!jsonStr) {
    throw new Error('Could not find __INITIAL_STATE__ in page (video may not exist)');
  }

  let state;
  try {
    state = JSON.parse(jsonStr);
  } catch {
    throw new Error('Failed to parse __INITIAL_STATE__ JSON');
  }

  return { state, html };
}

// ---- Video parsing ----

export async function parseVideo(bvid, options = {}) {
  const { cookie = '', forwardIp } = options;

  // Step 1: Scrape the video page for metadata
  const { state } = await scrapeVideoPage(bvid, forwardIp, cookie);

  const vdata = state.videoData;
  if (!vdata) {
    throw new Error(`Video not found: ${bvid}`);
  }

  const cid = vdata.cid;
  const title = vdata.title || '';
  const cover = vdata.pic || '';
  const author = vdata.owner?.name || '';
  const duration = vdata.duration || 0;
  const pages = vdata.pages || [];
  const aid = vdata.aid || state.aid;

  // Step 2: Get play URLs via API (with WBI signing)
  const signedUrl = await buildSignedUrl(
    'https://api.bilibili.com/x/player/wbi/playurl',
    {
      bvid,
      cid: String(cid),
      qn: String(bilibiliQnForQuality('2k')),
      fnval: '1',
      fnver: '0',
      fourk: '1',
      platform: 'web',
    },
    forwardIp,
    cookie
  );

  const playResp = await fetchWithRetry(signedUrl, {
    platform: 'bilibili',
    mode: 'api',
    forwardIp,
    headers: cookie ? { Cookie: cookie } : {},
  });

  if (!playResp.ok) {
    // If playurl API is also blocked, fall back to page-embedded playinfo
    return fallbackFromPage(state, bvid, title, cover, author, duration, pages, aid);
  }

  const playData = await playResp.json();
  const playResult = playData?.data || playData?.result;

  if (!playResult || (!playResult.durl && !playResult.dash)) {
    return fallbackFromPage(state, bvid, title, cover, author, duration, pages, aid);
  }

  return buildVideoResult(bvid, title, cover, author, duration, pages, aid, playResult);
}

/**
 * Fallback: try to extract play URLs from the page's embedded data.
 * B站 sometimes embeds playurl info directly in __INITIAL_STATE__.
 */
async function fallbackFromPage(state, bvid, title, cover, author, duration, pages, aid) {
  // Check if play info is embedded in the page state
  const playInfo = state.videoData?.dash || state.playinfo || state.videoData?.durl;

  if (playInfo) {
    return buildVideoResult(bvid, title, cover, author, duration, pages, aid, {
      durl: state.videoData?.durl,
      dash: state.videoData?.dash,
      quality: state.videoData?.quality || 80,
      accept_quality: state.videoData?.accept_quality || [80, 64, 32, 16],
      accept_description: state.videoData?.accept_description || ['1080P', '720P', '480P', '360P'],
    });
  }

  throw new Error('Play URL API blocked and no embedded playinfo found. Try passing a valid cookie.');
}

function buildVideoResult(bvid, title, cover, author, duration, pages, aid, playResult) {
  const streams = [];
  const acceptQuality = playResult.accept_quality || [];
  const acceptDesc = playResult.accept_description || [];

  if (playResult.durl && playResult.durl.length > 0) {
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
        expiresAt: extractDeadline(d.url),
      });
    }
  }

  if (playResult.dash && streams.length === 0) {
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
    streams.push(
      ...videoStreams.filter((s) => pickBestQuality([s.quality]) === s.quality),
      ...audioStreams
    );
  }

  const pageList = pages.map((p) => ({
    cid: p.cid,
    title: p.part || '',
    duration: p.duration || 0,
  }));

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
      cid: playResult.cid || pages[0]?.cid,
      pages: pageList,
      qualityOptions,
    },
    streams,
  };
}

// ---- Live parsing ----

export async function parseLive(roomId, options = {}) {
  const { cookie = '', forwardIp } = options;

  // Try the live API — this one is often reachable from Cloudflare IPs
  const initResp = await fetchWithRetry(
    `https://api.live.bilibili.com/room/v1/Room/room_init?id=${roomId}`,
    {
      platform: 'bilibili',
      mode: 'api',
      forwardIp,
      headers: cookie ? { Cookie: cookie } : {},
    }
  );

  if (!initResp.ok) {
    throw new Error(`Live API blocked: HTTP ${initResp.status}`);
  }

  const initData = await initResp.json();
  const realRoomId = initData?.data?.room_id;
  if (!realRoomId) {
    throw new Error(`Live room not found: ${roomId}`);
  }

  const liveStatus = initData?.data?.live_status;
  const title = initData?.data?.title || `Room ${realRoomId}`;

  // Get play info
  const playResp = await fetchWithRetry(
    `https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${realRoomId}&protocol=0,1&format=0,1,2&codec=0&platform=web`,
    {
      platform: 'bilibili',
      mode: 'api',
      forwardIp,
      headers: cookie ? { Cookie: cookie } : {},
    }
  );

  if (!playResp.ok) {
    throw new Error(`Live play API blocked: HTTP ${playResp.status}`);
  }

  const playData = await playResp.json();
  const playurlInfo = playData?.data?.playurl_info?.playurl;
  if (!playurlInfo) {
    throw new Error('Failed to get live play URL');
  }

  const streams = [];
  for (const stream of playurlInfo.stream || []) {
    const protocolName = stream.protocol_name;
    for (const fmt of stream.format || []) {
      const formatName = fmt.format_name;
      for (const codec of fmt.codec || []) {
        const codecName = codec.codec_name;
        const baseUrl = codec.base_url || '';
        for (const info of codec.url_info || []) {
          const fullUrl = `${info.host}${baseUrl}${info.extra || ''}`;

          let format;
          if (protocolName === 'http_hls') format = 'm3u8';
          else if (formatName === 'flv') format = 'flv';
          else format = formatName;

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
      liveStatus,
    },
    streams,
  };
}
