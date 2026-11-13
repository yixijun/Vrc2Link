import {
  buildDashMpd,
  buildDashUrls,
  createDashTicket,
  dashTicketNeedsRefresh,
  getDashTicket,
  makeDashRecord,
  selectDashTracks,
  updateDashTicket,
} from './dash.js';
import { getCredentialCookie } from './credentials.js';
import { AppError } from './errors.js';
import { jsonResponse, withCommonHeaders } from './http-response.js';
import { choosePlayableCdn } from './cdn-selection.js';
import { resolveMedia } from './resolver.js';
import { normalizeSourceUrl } from './utils/url.js';

// DASH is a beta playback strategy. Keeping ticket refresh and MPD output in
// this module lets the primary single-stream resolver evolve independently.
const dashRefreshLocks = new Map();

export async function handleDashAssetRequest(asset, request, dependencies, context, options = {}) {
  const env = dependencies.env || process.env;
  const state = dependencies.state;
  if (!state) throw new AppError(503, 'state_unavailable', 'DASH ticket state is unavailable');

  const record = await loadFreshDashTicket(asset.ticket, dependencies, options);
  context.platform = record.platform || null;
  const urls = buildDashUrls(request, env, asset.ticket);
  if (asset.kind === 'manifest.mpd') {
    const headers = {
      'Content-Type': 'application/dash+xml; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    };
    return withCommonHeaders(new Response(request.method === 'HEAD' ? null : buildDashMpd(record, urls), {
      status: 200,
      headers,
    }));
  }

  const track = asset.kind === 'video' ? record.video : record.audio;
  const selectedTrack = await choosePlayableCdn(track, record);
  const location = selectedTrack?.url || selectedTrack?.backupUrls?.[0];
  if (!location) throw new AppError(502, 'dash_track_unavailable', `DASH ${asset.kind} track is unavailable`);
  return withCommonHeaders(new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Stream-Quality': selectedTrack.quality || 'unknown',
      'X-Stream-Format': selectedTrack.format || 'mp4',
    },
  }));
}

export function createDashPlaybackResponse({
  request,
  env,
  state,
  rawUrl,
  authenticated,
  profileId,
  quality,
  result,
  pathname,
  responseMode,
  rateLimitHeaders = {},
  cacheKey,
  cacheHit,
}) {
  const session = createDashSession({ request, env, state, rawUrl, authenticated, profileId, quality, result });
  const headers = {
    'X-Stream-Quality': session.record.video.quality,
    'X-Stream-Format': 'mpd',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    ...rateLimitHeaders,
    ...(cacheKey ? { 'X-Cache': cacheHit ? 'HIT' : 'MISS' } : {}),
  };
  if (pathname === '/play' && responseMode === 'manifest') {
    return withCommonHeaders(new Response(buildDashMpd(session.record, session.urls), {
      status: 200,
      headers: { 'Content-Type': 'application/dash+xml; charset=utf-8', ...headers },
    }));
  }
  if (pathname === '/play') {
    return withCommonHeaders(new Response(null, {
      status: 302,
      headers: { Location: session.urls.manifestUrl, ...headers },
    }));
  }
  return jsonResponse({
    ...result,
    dash: dashDescriptor(session),
  }, { headers });
}

function createDashSession({ request, env, state, rawUrl, authenticated, profileId, quality, result }) {
  const sourceUrl = normalizeSourceUrl(rawUrl || '');
  const tracks = selectDashTracks(result, quality);
  const record = makeDashRecord({ sourceUrl, authenticated, profileId, quality, result, tracks });
  const ttlSeconds = dashTicketTtl(env, result);
  record.ticketExpiresAt = Date.now() + ttlSeconds * 1000;
  const ticketSession = createDashTicket(state, record, ttlSeconds);
  return {
    ticket: ticketSession.ticket,
    record: ticketSession.record,
    urls: buildDashUrls(request, env, ticketSession.ticket),
  };
}

function dashDescriptor(session) {
  const { record, urls } = session;
  return {
    mode: 'dash',
    ticket: session.ticket,
    ticketExpiresAt: record.ticketExpiresAt || null,
    manifestUrl: urls.manifestUrl,
    videoUrl: urls.videoUrl,
    audioUrl: urls.audioUrl,
    video: dashTrackDescriptor(record.video),
    audio: dashTrackDescriptor(record.audio),
  };
}

function dashTrackDescriptor(track) {
  return {
    quality: track.quality,
    codec: track.codec,
    bandwidth: track.bandwidth,
    trackId: track.trackId,
    ...(track.width ? { width: track.width } : {}),
    ...(track.height ? { height: track.height } : {}),
    ...(track.sampleRate ? { sampleRate: track.sampleRate } : {}),
  };
}

async function loadFreshDashTicket(ticket, dependencies, options) {
  const state = dependencies.state;
  const env = dependencies.env || process.env;
  const initial = getDashTicket(state, ticket);
  if (!initial) throw new AppError(404, 'dash_ticket_not_found', 'DASH ticket is missing or expired');
  if (initial.profileId) getCredentialCookie({ state, env, profileId: initial.profileId });
  if (!dashTicketNeedsRefresh(initial)) return initial;

  const existing = dashRefreshLocks.get(ticket);
  if (existing) return existing;
  const refresh = refreshDashTicket(ticket, dependencies, env, options)
    .finally(() => dashRefreshLocks.delete(ticket));
  dashRefreshLocks.set(ticket, refresh);
  return refresh;
}

async function refreshDashTicket(ticket, dependencies, env, options = {}) {
  const latest = getDashTicket(dependencies.state, ticket);
  if (!latest) throw new AppError(404, 'dash_ticket_not_found', 'DASH ticket is missing or expired');
  if (!dashTicketNeedsRefresh(latest)) return latest;

  const resolve = dependencies.resolve || resolveMedia;
  const result = await resolve(latest.sourceUrl, {
    authenticated: latest.authenticated === true,
    cookies: cookiesForAuthentication(latest.authenticated === true, env, latest.profileId, dependencies.state),
    quality: latest.quality,
    generic: options.genericOptions ? options.genericOptions(env) : undefined,
    bilibiliCdnPreference: options.getBilibiliCdnPreference
      ? options.getBilibiliCdnPreference(env)
      : [],
    mode: 'dash',
  });
  if ((latest.id && String(result.id || '') !== String(latest.id)) ||
      (latest.cid && String(result.cid || '') !== String(latest.cid))) {
    throw new AppError(409, 'dash_source_changed', 'DASH refresh resolved a different media item');
  }
  const tracks = selectDashTracks(result, latest.quality);
  const next = makeDashRecord({
    sourceUrl: latest.sourceUrl,
    authenticated: latest.authenticated === true,
    profileId: latest.profileId,
    quality: latest.quality,
    result,
    tracks,
  });
  next.ticketExpiresAt = latest.ticketExpiresAt;
  const updated = updateDashTicket(dependencies.state, ticket, latest, next, dashTicketTtl(env));
  if (updated) return updated;
  const concurrent = getDashTicket(dependencies.state, ticket);
  if (concurrent) return concurrent;
  throw new AppError(404, 'dash_ticket_not_found', 'DASH ticket expired during refresh');
}

function cookiesForAuthentication(authenticated, env, profileId = '', state) {
  if (!authenticated) return {};
  if (profileId) return { bilibili: getCredentialCookie({ state, env, profileId }) };
  return Object.fromEntries([
    ['bilibili', env.BILIBILI_COOKIE],
    ['netease', env.NETEASE_COOKIE],
    ['douyin', env.DOUYIN_COOKIE],
    ['kuaishou', env.KUAISHOU_COOKIE],
  ].filter(([, value]) => value));
}

function dashTicketTtl(env, result) {
  const configured = positiveInteger(env.DASH_TICKET_TTL_SECONDS, 3600);
  const duration = Number(result?.duration);
  const mediaWindow = Number.isFinite(duration) && duration > 0
    ? Math.min(86400, Math.ceil(duration) + 300)
    : 0;
  return Math.max(configured, mediaWindow);
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
