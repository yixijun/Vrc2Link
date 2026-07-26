import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeConfig, parseConfigFile } from '../src/config.js';

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
    { API_KEY: 'file-key', BILIBILI_COOKIE: 'file-cookie' },
    { API_KEY: 'environment-key', BILIBILI_COOKIE: '' },
  );

  assert.equal(config.API_KEY, 'environment-key');
  assert.equal(config.BILIBILI_COOKIE, 'file-cookie');
});
