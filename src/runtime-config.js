import {
  DEFAULT_BILIBILI_CDN_PREFERENCE,
  DEFAULT_CONFIG,
  DEFAULT_PLAYLIST_RESOLVER_PREFIX,
  DEFAULT_PUBLIC_BASE_URL,
} from './config.js';

/**
 * Runtime configuration seam. HTTP handlers receive this object instead of
 * rebuilding defaults independently for every request.
 */
export function createRuntimeConfig(raw = {}) {
  const input = raw || {};
  const source = { ...DEFAULT_CONFIG, ...input };
  const publicBaseUrl = normalizeBaseUrl(source.PUBLIC_BASE_URL);
  const explicitPrefix = Object.hasOwn(input, 'PLAYLIST_RESOLVER_PREFIX');
  const configuredPrefix = explicitPrefix
    ? source.PLAYLIST_RESOLVER_PREFIX
    : input.PUBLIC_BASE_URL
      ? ''
      : source.PLAYLIST_RESOLVER_PREFIX;
  const playlistResolverPrefix = String(configuredPrefix || '').trim() ||
    `${publicBaseUrl}/api/v1/play?mode=auto&url=`;

  return Object.freeze({
    ...source,
    PORT: positiveInteger(source.PORT, 7890),
    SQLITE_PATH: String(source.SQLITE_PATH || DEFAULT_CONFIG.SQLITE_PATH),
    CACHE_TTL_SECONDS: positiveInteger(source.CACHE_TTL_SECONDS, 300),
    RATE_LIMIT_ANON_PER_MINUTE: positiveInteger(source.RATE_LIMIT_ANON_PER_MINUTE, 10),
    RATE_LIMIT_AUTH_PER_MINUTE: positiveInteger(source.RATE_LIMIT_AUTH_PER_MINUTE, 60),
    RATE_LIMIT_IP_PER_MINUTE: positiveInteger(source.RATE_LIMIT_IP_PER_MINUTE, 120),
    RATE_LIMIT_WINDOW_SECONDS: positiveInteger(source.RATE_LIMIT_WINDOW_SECONDS, 60),
    DANMAKU_RATE_LIMIT_PER_MINUTE: positiveInteger(source.DANMAKU_RATE_LIMIT_PER_MINUTE, 90),
    DANMAKU_SESSION_TTL_SECONDS: positiveInteger(source.DANMAKU_SESSION_TTL_SECONDS, 21600),
    DANMAKU_MAX_VIDEO_MESSAGES: positiveInteger(source.DANMAKU_MAX_VIDEO_MESSAGES, 300),
    DANMAKU_MAX_LIVE_MESSAGES: positiveInteger(source.DANMAKU_MAX_LIVE_MESSAGES, 30),
    GENERIC_RESOLVER_ENABLED: booleanValue(source.GENERIC_RESOLVER_ENABLED, false),
    GENERIC_RESOLVER_REQUIRE_KEY: booleanValue(source.GENERIC_RESOLVER_REQUIRE_KEY, true),
    YT_DLP_PATH: String(source.YT_DLP_PATH || 'yt-dlp'),
    GENERIC_RESOLVER_TIMEOUT_MS: positiveInteger(source.GENERIC_RESOLVER_TIMEOUT_MS, 20000),
    GENERIC_RESOLVER_MAX_CONCURRENT: positiveInteger(source.GENERIC_RESOLVER_MAX_CONCURRENT, 2),
    PLAYLIST_RESOLVER_PREFIX: playlistResolverPrefix,
    PLAYLIST_SESSION_TTL_SECONDS: positiveInteger(source.PLAYLIST_SESSION_TTL_SECONDS, 21600),
    PUBLIC_BASE_URL: publicBaseUrl,
    DASH_TICKET_TTL_SECONDS: positiveInteger(source.DASH_TICKET_TTL_SECONDS, 3600),
    PLAYBACK_TICKET_TTL_SECONDS: positiveInteger(source.PLAYBACK_TICKET_TTL_SECONDS, 3600),
    QUEST_STREAM_PROXY: booleanValue(source.QUEST_STREAM_PROXY, false),
    TRUST_PROXY: booleanValue(source.TRUST_PROXY, false),
    LEGACY_PLAYLIST_ENDPOINTS: booleanValue(source.LEGACY_PLAYLIST_ENDPOINTS, true),
    BILIBILI_CDN_PREFERENCE: String(
      source.BILIBILI_CDN_PREFERENCE || source.BILIBILI_CDN_ALLOWLIST || DEFAULT_BILIBILI_CDN_PREFERENCE.join(','),
    ),
  });
}

export function playlistResolverPrefix(config) {
  return String(config?.PLAYLIST_RESOLVER_PREFIX || '').trim() || DEFAULT_PLAYLIST_RESOLVER_PREFIX;
}

export function publicBaseUrl(config) {
  return normalizeBaseUrl(config?.PUBLIC_BASE_URL);
}

function normalizeBaseUrl(value) {
  const configured = String(value || '').trim().replace(/\/+$/u, '');
  return configured || DEFAULT_PUBLIC_BASE_URL;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanValue(value, fallback) {
  if (value == null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}
