/**
 * Bilibili platform parser — video + live.
 * Deployed on domestic server → direct API calls, no IP block.
 */

import { fetchWithRetry } from '../utils/http.js';
import { bilibiliQuality, bilibiliQnForQuality } from '../utils/quality.js';

// ---- Parse video ----

export async function parseVideo(videoId, options = {}) {
  const {
    cookie = '', quality: targetQuality, page = 1,
    includeSeasonPlaylist = false, resolverPrefix = '',
  } = options;
  const avMatch = String(videoId).match(/^av(\d+)$/iu);
  const viewQuery = avMatch ? { aid: avMatch[1] } : { bvid: videoId };

  // Step 1: get video info
  const viewResp = await fetchWithRetry(
    `https://api.bilibili.com/x/web-interface/view?${new URLSearchParams(viewQuery)}`,
    { platform: 'bilibili', cookie }
  );
  const vdata = (await viewResp.json())?.data;
  if (!vdata) throw new Error(`Video not found: ${videoId}`);

  const { title = '', pic: cover = '', duration = 0, pages = [] } = vdata;
  const pageIndex = Math.min(Math.max(Number(page) - 1, 0), Math.max(pages.length - 1, 0));
  const pageData = pages[pageIndex] || pages[0] || {};
  const cid = pageData.cid || vdata.cid;
  const pageTitle = pageData.part || title;
  const pageDuration = pageData.duration || duration;
  const bvid = vdata.bvid || (avMatch ? '' : videoId);
  if (!bvid) throw new Error(`Bilibili BV id not found for: ${videoId}`);
  const author = vdata.owner?.name || '';

  if (includeSeasonPlaylist && vdata.ugc_season?.sections?.length) {
    const season = vdata.ugc_season;
    const entries = [];
    const seen = new Set();
    for (const section of season.sections) {
      for (const episode of section.episodes || []) {
        const episodeBvid = episode.bvid || episode.arc?.bvid || '';
        if (!episodeBvid || seen.has(episodeBvid)) continue;
        seen.add(episodeBvid);
        const source = `https://www.bilibili.com/video/${episodeBvid}`;
        entries.push({
          id: episodeBvid,
          title: episode.title || episode.arc?.title || `视频 ${entries.length + 1}`,
          sourceUrl: source,
          url: resolverUrl(source, resolverPrefix),
          cover: episode.arc?.pic || episode.cover || '',
          duration: Number(episode.arc?.duration ?? episode.duration) || 0,
        });
      }
    }
    if (entries.length) {
      return {
        platform: 'bilibili', type: 'playlist',
        meta: {
          id: String(season.id || bvid),
          title: season.title || title,
          author,
          cover: season.cover || cover,
          duration: 0,
        },
        playlist: entries,
      };
    }
  }

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
        quality, duration: pageDuration,
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
      id: bvid, title: pageTitle, cover, author, duration: pageDuration, cid,
      pages: pages.map(p => ({ cid: p.cid, title: p.part || '', duration: p.duration || 0 })),
      qualityOptions: (playResult.accept_quality || []).map((qn, i) => ({
        raw: qn, label: bilibiliQuality(qn), description: (playResult.accept_description || [])[i] || bilibiliQuality(qn),
      })),
    },
    streams,
  };
}

export async function parsePlaylist(playlist, options = {}) {
  const { cookie = '', resolverPrefix = '' } = options;
  const entries = await fetchPlaylistEntries(playlist, cookie);
  if (!entries.length) throw new Error(`Bilibili playlist is empty or unavailable: ${playlist.id}`);
  return {
    platform: 'bilibili',
    type: 'playlist',
    meta: { id: playlist.id, title: playlist.title || `Bilibili ${playlist.kind || 'playlist'} ${playlist.id}`, author: playlist.author || '', cover: '', duration: 0 },
    playlist: entries.map((entry, index) => {
      const source = `https://www.bilibili.com/video/${entry.bvid}${entry.page && entry.page > 1 ? `?p=${entry.page}` : ''}`;
      return {
        id: entry.bvid,
        title: entry.title || `\u89c6\u9891 ${index + 1}`,
        sourceUrl: source,
        url: resolverUrl(source, resolverPrefix),
        cover: entry.cover || '',
        duration: Number(entry.duration) || 0,
      };
    }),
  };
}

async function fetchPlaylistEntries(playlist, cookie) {
  const requests = [];
  let mid = playlist.mid || '';
  if (!mid && playlist.bvid) {
    try {
      const response = await fetchWithRetry(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(playlist.bvid)}`, { platform: 'bilibili', cookie });
      mid = String((await response.json())?.data?.owner?.mid || '');
    } catch {
      // Collection endpoints below will report the actual failure.
    }
  }
  if (playlist.kind === 'favorite') {
    requests.push({
      pageSize: 100,
      buildUrl: (page) => `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${encodeURIComponent(playlist.id)}&pn=${page}&ps=100&platform=web`,
    });
  } else if (mid) {
    if (playlist.kind !== 'series') {
      requests.push({
        pageSize: 100,
        buildUrl: (page) => `https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?mid=${encodeURIComponent(mid)}&season_id=${encodeURIComponent(playlist.id)}&sort_reverse=false&pn=${page}&ps=100`,
      });
      requests.push({
        pageSize: 100,
        buildUrl: (page) => `https://api.bilibili.com/x/space/season/archives?mid=${encodeURIComponent(mid)}&season_id=${encodeURIComponent(playlist.id)}&sort_reverse=false&pn=${page}&ps=100`,
      });
    }
    if (playlist.kind !== 'season') {
      requests.push({
        pageSize: 100,
        buildUrl: (page) => `https://api.bilibili.com/x/series/archives?mid=${encodeURIComponent(mid)}&series_id=${encodeURIComponent(playlist.id)}&pn=${page}&ps=100`,
      });
    }
  }
  for (const request of requests) {
    const entries = [];
    const seen = new Set();
    try {
      for (let page = 1; page <= 100; page += 1) {
        const response = await fetchWithRetry(request.buildUrl(page), { platform: 'bilibili', cookie });
        const body = await response.json();
        if (body?.code && body.code !== 0) break;
        const data = body?.data || {};
        const list = data.archives || data.items || data.medias || data.resources || [];
        for (const item of list) {
          const entry = {
            bvid: item.bvid || item.bv_id || item.arc?.bvid || '',
            title: item.title || item.arc?.title || item.name || '',
            cover: item.pic || item.cover || item.arc?.pic || '',
            duration: item.duration || item.arc?.duration || 0,
          };
          if (!entry.bvid || seen.has(entry.bvid)) continue;
          seen.add(entry.bvid);
          entries.push(entry);
        }
        if (!hasMorePlaylistPages(data, list.length, entries.length, request.pageSize)) break;
      }
      if (entries.length) return entries;
    } catch {
      // Try the next public Bilibili collection endpoint.
    }
  }
  return [];
}

function hasMorePlaylistPages(data, pageLength, loadedLength, pageSize) {
  const explicit = data.has_more ?? data.hasMore;
  if (typeof explicit === 'boolean') return explicit;
  if (typeof explicit === 'number') return explicit !== 0;
  const total = Number(data.page?.total ?? data.info?.media_count ?? data.total ?? 0);
  if (Number.isFinite(total) && total > 0) return loadedLength < total;
  return pageLength >= pageSize;
}

function resolverUrl(source, prefix) {
  if (!prefix) return source;
  return `${prefix}${encodeURIComponent(source)}`;
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
