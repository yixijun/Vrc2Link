import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_BILIBILI_CDN_PREFERENCE, loadConfig, mergeConfig, parseConfigFile } from '../src/config.js';
import { createRuntimeConfig, playlistResolverPrefix, publicBaseUrl } from '../src/runtime-config.js';

test('parseConfigFile preserves complete cookie header values', () => {
  const config = parseConfigFile(`
PORT=7890
API_KEY=secret
BILIBILI_COOKIE=buvid3=abc==; SESSDATA=value%2Cmore; bili_jct=token
NETEASE_COOKIE=MUSIC_U=first==; __csrf=second
`);

  assert.equal(config.PORT, '7890');
  assert.equal(config.API_KEY, 'secret');
  assert.equal(config.BILIBILI_COOKIE, 'buvid3=abc==; SESSDATA=value%2Cmore; bili_jct=token');
  assert.equal(config.NETEASE_COOKIE, 'MUSIC_U=first==; __csrf=second');
});

test('environment variables override file config without empty PM2 values erasing it', () => {
  const config = mergeConfig(
    {
      API_KEY: 'file-key',
      BILIBILI_COOKIE: 'file-cookie',
      SQLITE_PATH: 'data/file.sqlite',
      RATE_LIMIT_ANON_PER_MINUTE: '10',
      TRUST_PROXY: 'false',
      GENERIC_RESOLVER_ENABLED: 'false',
      YT_DLP_PATH: 'file-yt-dlp',
    },
    {
      API_KEY: 'environment-key',
      BILIBILI_COOKIE: '',
      SQLITE_PATH: 'data/environment.sqlite',
      RATE_LIMIT_ANON_PER_MINUTE: '20',
      TRUST_PROXY: 'true',
      GENERIC_RESOLVER_ENABLED: 'true',
      YT_DLP_PATH: '/usr/local/bin/yt-dlp',
    },
  );

  assert.equal(config.API_KEY, 'environment-key');
  assert.equal(config.BILIBILI_COOKIE, 'file-cookie');
  assert.equal(config.SQLITE_PATH, 'data/environment.sqlite');
  assert.equal(config.RATE_LIMIT_ANON_PER_MINUTE, '20');
  assert.equal(config.TRUST_PROXY, 'true');
  assert.equal(config.GENERIC_RESOLVER_ENABLED, 'true');
  assert.equal(config.YT_DLP_PATH, '/usr/local/bin/yt-dlp');
});

test('loadConfig provides the compatible Bilibili CDN defaults', () => {
  const config = loadConfig({
    workingDirectory: process.cwd(),
    environment: { CONFIG_FILE: '__missing_cdn_defaults_test__.env' },
  });

  assert.equal(config.BILIBILI_CDN_PREFERENCE, DEFAULT_BILIBILI_CDN_PREFERENCE.join(','));
});

test('loadConfig provides a complete operational default set', () => {
  const config = loadConfig({
    workingDirectory: process.cwd(),
    environment: { CONFIG_FILE: '__missing_complete_defaults_test__.env' },
  });

  assert.equal(config.PORT, '7890');
  assert.equal(config.SQLITE_PATH, 'data/vrc2link.sqlite');
  assert.equal(config.PLAYLIST_SESSION_TTL_SECONDS, '21600');
  assert.equal(config.LEGACY_PLAYLIST_ENDPOINTS, 'true');
  assert.equal(config.PUBLIC_BASE_URL, 'https://vrc2link.luonako.cn');
});

test('runtime configuration normalizes numbers, booleans, and self-hosted URLs once', () => {
  const config = createRuntimeConfig({
    PUBLIC_BASE_URL: 'https://media.example///',
    PORT: '8123',
    TRUST_PROXY: 'true',
    GENERIC_RESOLVER_ENABLED: 'true',
    PLAYLIST_RESOLVER_PREFIX: '',
  });

  assert.equal(config.PORT, 8123);
  assert.equal(config.TRUST_PROXY, true);
  assert.equal(config.GENERIC_RESOLVER_ENABLED, true);
  assert.equal(publicBaseUrl(config), 'https://media.example');
  assert.equal(playlistResolverPrefix(config), 'https://media.example/api/v1/play?mode=auto&url=');
});

test('self-hosted public base derives the playlist resolver when no override is supplied', () => {
  const config = createRuntimeConfig({ PUBLIC_BASE_URL: 'https://media.example/' });

  assert.equal(config.PUBLIC_BASE_URL, 'https://media.example');
  assert.equal(config.PLAYLIST_RESOLVER_PREFIX, 'https://media.example/api/v1/play?mode=auto&url=');
});
