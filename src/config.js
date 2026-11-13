import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const DEFAULT_PUBLIC_BASE_URL = 'https://vrc2link.luonako.cn';
export const DEFAULT_BILIBILI_CDN_PREFERENCE = [
  'upos-sz-mirror08c.bilivideo.com',
  'upos-sz-mirrorali.bilivideo.com',
  'upos-sz-mirrorhw.bilivideo.com',
  'upos-sz-mirrorcos.bilivideo.com',
  'upos-sz-mirrorcoso1.bilivideo.com',
  'upos-sz-estgcos.bilivideo.com',
];
export const DEFAULT_BILIBILI_CDN_ALLOWLIST = DEFAULT_BILIBILI_CDN_PREFERENCE;
export const DEFAULT_PLAYLIST_RESOLVER_PREFIX = `${DEFAULT_PUBLIC_BASE_URL}/api/v1/play?mode=auto&url=`;

// Keep operational defaults in one place. The request layer still accepts a
// partial environment object in tests and embedded deployments, but the
// process entry point now receives a complete configuration after loadConfig.
export const DEFAULT_CONFIG = {
  PORT: '7890',
  SQLITE_PATH: 'data/vrc2link.sqlite',
  CACHE_TTL_SECONDS: '300',
  RATE_LIMIT_ANON_PER_MINUTE: '10',
  RATE_LIMIT_AUTH_PER_MINUTE: '60',
  RATE_LIMIT_IP_PER_MINUTE: '120',
  RATE_LIMIT_WINDOW_SECONDS: '60',
  DANMAKU_RATE_LIMIT_PER_MINUTE: '90',
  DANMAKU_SESSION_TTL_SECONDS: '21600',
  DANMAKU_MAX_VIDEO_MESSAGES: '300',
  DANMAKU_MAX_LIVE_MESSAGES: '30',
  GENERIC_RESOLVER_ENABLED: 'false',
  GENERIC_RESOLVER_REQUIRE_KEY: 'true',
  YT_DLP_PATH: 'yt-dlp',
  GENERIC_RESOLVER_TIMEOUT_MS: '20000',
  GENERIC_RESOLVER_MAX_CONCURRENT: '2',
  PLAYLIST_RESOLVER_PREFIX: DEFAULT_PLAYLIST_RESOLVER_PREFIX,
  PLAYLIST_SESSION_TTL_SECONDS: '21600',
  PUBLIC_BASE_URL: DEFAULT_PUBLIC_BASE_URL,
  DASH_TICKET_TTL_SECONDS: '3600',
  PLAYBACK_TICKET_TTL_SECONDS: '3600',
  QUEST_STREAM_PROXY: 'false',
  TRUST_PROXY: 'false',
  LEGACY_PLAYLIST_ENDPOINTS: 'true',
};

const CONFIG_KEYS = [
  'PORT', 'API_KEY', 'BILIBILI_COOKIE', 'NETEASE_COOKIE', 'DOUYIN_COOKIE', 'KUAISHOU_COOKIE',
  'SQLITE_PATH', 'CACHE_TTL_SECONDS', 'TRUST_PROXY', 'BILIBILI_CDN_PREFERENCE', 'BILIBILI_CDN_ALLOWLIST',
  'RATE_LIMIT_ANON_PER_MINUTE', 'RATE_LIMIT_AUTH_PER_MINUTE',
  'RATE_LIMIT_IP_PER_MINUTE', 'RATE_LIMIT_WINDOW_SECONDS',
  'DANMAKU_RATE_LIMIT_PER_MINUTE', 'DANMAKU_SESSION_TTL_SECONDS',
  'DANMAKU_MAX_VIDEO_MESSAGES', 'DANMAKU_MAX_LIVE_MESSAGES',
  'GENERIC_RESOLVER_ENABLED', 'GENERIC_RESOLVER_REQUIRE_KEY', 'YT_DLP_PATH',
  'GENERIC_RESOLVER_TIMEOUT_MS', 'GENERIC_RESOLVER_MAX_CONCURRENT',
  'PLAYLIST_RESOLVER_PREFIX',
  'PUBLIC_BASE_URL', 'DASH_TICKET_TTL_SECONDS', 'CK_MASTER_KEY', 'PLAYBACK_TICKET_TTL_SECONDS',
  'QUEST_STREAM_PROXY', 'LEGACY_PLAYLIST_ENDPOINTS',
];

export function parseConfigFile(text) {
  const config = {};
  const lines = String(text).replace(/^\uFEFF/u, '').split(/\r?\n/u);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator <= 0) {
      throw new Error(`Invalid config line ${index + 1}: expected NAME=value`);
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    config[key] = value;
  }

  return config;
}

export function mergeConfig(fileConfig, environment = {}) {
  const config = { ...fileConfig };
  for (const key of CONFIG_KEYS) {
    if (environment[key] != null && environment[key] !== '') {
      config[key] = environment[key];
    }
  }
  return config;
}

export function loadConfig(options = {}) {
  const environment = options.environment || process.env;
  const workingDirectory = options.workingDirectory || process.cwd();
  const filename = environment.CONFIG_FILE || 'config.env';
  const path = resolve(workingDirectory, filename);

  let fileConfig = {};
  try {
    fileConfig = parseConfigFile(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`Failed to load ${filename}: ${error.message}`);
    }
  }

  const merged = mergeConfig(fileConfig, environment);
  const config = { ...DEFAULT_CONFIG, ...merged };
  if (!Object.hasOwn(merged, 'PLAYLIST_RESOLVER_PREFIX') && Object.hasOwn(merged, 'PUBLIC_BASE_URL')) {
    config.PLAYLIST_RESOLVER_PREFIX = `${String(config.PUBLIC_BASE_URL).trim().replace(/\/+$/u, '')}/api/v1/play?mode=auto&url=`;
  }
  if (!String(config.BILIBILI_CDN_PREFERENCE || config.BILIBILI_CDN_ALLOWLIST || '').trim()) {
    config.BILIBILI_CDN_PREFERENCE = DEFAULT_BILIBILI_CDN_PREFERENCE.join(',');
  }
  return config;
}
