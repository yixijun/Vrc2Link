import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CONFIG_KEYS = [
  'PORT', 'API_KEY', 'BILIBILI_COOKIE', 'NETEASE_COOKIE', 'DOUYIN_COOKIE', 'KUAISHOU_COOKIE',
  'SQLITE_PATH', 'CACHE_TTL_SECONDS', 'TRUST_PROXY',
  'RATE_LIMIT_ANON_PER_MINUTE', 'RATE_LIMIT_AUTH_PER_MINUTE',
  'RATE_LIMIT_IP_PER_MINUTE', 'RATE_LIMIT_WINDOW_SECONDS',
  'DANMAKU_RATE_LIMIT_PER_MINUTE', 'DANMAKU_SESSION_TTL_SECONDS',
  'DANMAKU_MAX_VIDEO_MESSAGES', 'DANMAKU_MAX_LIVE_MESSAGES',
  'GENERIC_RESOLVER_ENABLED', 'GENERIC_RESOLVER_REQUIRE_KEY', 'YT_DLP_PATH',
  'GENERIC_RESOLVER_TIMEOUT_MS', 'GENERIC_RESOLVER_MAX_CONCURRENT',
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

  return mergeConfig(fileConfig, environment);
}
