import { createHash, randomUUID } from 'node:crypto';

export function playlistSessionKey(clientIp) {
  return `playlist:session:${hashIdentity(clientIp)}`;
}

export function beginPlaylistSession({ state, ttlSeconds, clientIp, rawUrl, authenticated, profileId, mode, quality }) {
  if (!state) return undefined;
  const sourceUrl = normalizeSourceUrl(rawUrl || '');
  if (!sourceUrl) return undefined;
  const sessionId = randomUUID();
  state.setJson(playlistSessionKey(clientIp), {
    sourceUrl,
    authenticated: authenticated === true,
    profileId: profileId || '',
    mode: mode || 'single',
    quality,
    autoPlay: false,
    pending: true,
    sessionId,
  }, ttlSeconds);
  return sessionId;
}

export function bindPlaylistSession({ state, ttlSeconds, clientIp, rawUrl, authenticated, profileId, result, sessionId, mode, quality }) {
  if (!state) return;
  const sourceUrl = normalizeSourceUrl(rawUrl || '');
  if (!sourceUrl) return;
  const key = playlistSessionKey(clientIp);
  const current = state.getJson(key);
  if (sessionId && current?.sessionId !== sessionId) return;
  state.setJson(key, {
    sourceUrl,
    authenticated: authenticated === true,
    profileId: profileId || current?.profileId || '',
    mode: mode || current?.mode || 'single',
    quality: quality ?? current?.quality,
    autoPlay: Boolean(result?.playlist),
    pending: false,
    ...(sessionId ? { sessionId } : {}),
    ...(result?.playlist ? { result } : {}),
  }, ttlSeconds);
}

export function playlistManifest(result, session) {
  const playlist = result.playlist || [];
  return {
    type: 'playlist',
    title: result.meta?.title || result.title || 'Playlist',
    count: playlist.length,
    currentIndex: normalizePlaylistIndex(result.currentIndex, playlist.length),
    autoPlay: session?.autoPlay === true,
    entries: playlist.map((entry, index) => ({ title: entry.title || `Item ${index + 1}` })),
  };
}

export function playlistEntrySource(entry) {
  if (entry?.sourceUrl) return entry.sourceUrl;
  if (!entry?.url) return '';
  try {
    return new URL(entry.url).searchParams.get('url') || entry.url;
  } catch {
    return entry.url;
  }
}

export function normalizePlaylistIndex(value, length) {
  if (length <= 0) return 0;
  const index = Number.parseInt(value, 10);
  return Number.isInteger(index) && index >= 0 && index < length ? index : 0;
}

function normalizeSourceUrl(value) {
  return String(value || '').trim();
}

function hashIdentity(value) {
  return createHash('sha256').update(String(value || 'unknown')).digest('hex');
}
