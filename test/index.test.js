import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { getClientIp } from '../src/client-ip.js';
import { handleRequest } from '../src/index.js';
import { createMemoryState, createSqliteState } from '../src/state.js';

const SOURCE_URL = 'https://www.bilibili.com/video/BV1xx411c7mD';
const MEDIA = {
  platform: 'bilibili',
  type: 'video',
  id: 'BV1xx411c7mD',
  title: 'Fixture',
  author: 'Tester',
  cover: '',
  duration: 60,
  authenticated: false,
  qualities: ['720p', '360p'],
  streams: [
    { quality: '720p', format: 'mp4', codec: 'avc', url: 'https://cdn.example/720.mp4' },
    { quality: '360p', format: 'mp4', codec: 'avc', url: 'https://cdn.example/360.mp4' },
  ],
};

test('only the new API endpoints are exposed', async () => {
  const root = await handleRequest(new Request('http://localhost/'));
  assert.equal(root.status, 200);
  assert.match(root.headers.get('content-type'), /^text\/html/);
  const html = await root.text();
  assert.match(html, /<title>Vrc2Link API<\/title>/);
  assert.match(html, /id="request-builder"/);
  assert.match(html, /id="paste-media"/);
  assert.match(html, /<code>\/api<\/code>/);
  assert.match(html, /<code>\/play<\/code>/);
  assert.match(html, /DASH 音视频分离流/);
  assert.match(html, /为什么 1080p 会返回 422/);
  assert.match(html, /生产运行状态保存在本机 SQLite/);
  assert.match(html, /429 rate_limited/);
  assert.match(html, /function detectMedia\(input\)/);
  assert.match(html, /已识别：Bilibili 视频/);
  assert.match(html, /已识别：网易云歌曲/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));

  const createControl = (initial = {}) => ({
    value: '',
    disabled: false,
    textContent: '',
    dataset: {},
    children: [],
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    replaceChildren(...children) { this.children = children; },
    focus() {},
    ...initial,
  });
  const controls = {
    'request-builder': createControl({
      elements: { mode: { value: 'play' } },
      reportValidity: () => true,
    }),
    'media-url': createControl(),
    'api-key': createControl(),
    quality: createControl(),
    'quality-help': createControl(),
    'platform-hint': createControl(),
    'request-preview': createControl(),
    'paste-media': createControl(),
    'copy-request': createControl(),
  };
  const documentStub = {
    getElementById: (id) => controls[id],
    createElement: () => createControl(),
  };
  const windowStub = {
    location: { origin: 'http://localhost' },
    open() {},
    setTimeout() {},
  };
  const pastedText = '【分享标题】 https://music.163.com/song?id=186016，复制打开';
  const navigatorStub = {
    clipboard: {
      readText: async () => pastedText,
      writeText: async () => {},
    },
  };
  new Function('document', 'window', 'navigator', script)(documentStub, windowStub, navigatorStub);

  const detect = (url) => {
    controls['media-url'].value = url;
    controls['request-builder'].listeners.input();
    return controls.quality.children.map((option) => option.value);
  };
  assert.deepEqual(
    detect('【杜比视界·全景声】 https://www.bilibili.com/video/BV1W4PXzJEDy/?share_source=copy_web，要这种也能识别'),
    ['', '360p', '480p', '720p', '1080p', '4k', '8k'],
  );
  assert.match(controls['platform-hint'].textContent, /Bilibili 视频/);
  assert.deepEqual(detect('av170001'), ['', '360p', '480p', '720p', '1080p', '4k', '8k']);
  assert.match(controls['platform-hint'].textContent, /Bilibili 视频/);
  assert.deepEqual(detect('https://live.bilibili.com/6'), ['', 'original']);
  assert.deepEqual(detect('https://music.163.com/song?id=186016'), ['', '128k', '256k', '320k', 'lossless']);
  assert.match(controls['platform-hint'].textContent, /网易云歌曲/);
  assert.deepEqual(detect('https://music.163.com/#/mv?id=10970707'), ['', '360p', '480p', '720p', '1080p']);
  assert.deepEqual(detect('https://v.douyin.com/abc123'), ['', 'original']);
  assert.match(controls['platform-hint'].textContent, /抖音视频/);
  assert.deepEqual(
    detect('3.51 M@J.Vl 05/03 :9pm pDu:/ 我也要跳 # MMD # vrchat https://v.douyin.com/A7VeP3Y8yfc/ 复制此链接，打开Dou音搜索'),
    ['', 'original'],
  );
  assert.match(controls['platform-hint'].textContent, /抖音视频/);
  assert.deepEqual(detect('https://v.kuaishou.com/abc123'), ['', 'original']);
  assert.match(controls['platform-hint'].textContent, /快手视频/);
  assert.deepEqual(detect('看看这个 https://youtu.be/dQw4w9WgXcQ?t=42 复制打开'), ['']);
  assert.match(controls['platform-hint'].textContent, /YouTube 视频/);
  assert.deepEqual(detect('https://video.example/watch/123'), ['']);
  assert.match(controls['platform-hint'].textContent, /通用视频网站/);

  await controls['paste-media'].listeners.click();
  assert.equal(controls['media-url'].value, pastedText);
  assert.match(controls['platform-hint'].textContent, /网易云歌曲/);
  assert.equal(controls['paste-media'].textContent, '已粘贴');

  for (const path of ['/a', '/r', '/api/parse']) {
    const response = await handleRequest(new Request(`http://localhost${path}`));
    assert.equal(response.status, 404);
  }
});

test('anonymous API requests do not receive server cookies', async () => {
  let receivedOptions;
  const response = await handleRequest(
    new Request(`http://localhost/api?url=${encodeURIComponent(SOURCE_URL)}`),
    {
      env: {
        API_KEY: 'secret',
        BILIBILI_COOKIE: 'SESSDATA=private',
        NETEASE_COOKIE: 'MUSIC_U=private',
      },
      resolve: async (_url, options) => {
        receivedOptions = options;
        return MEDIA;
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(receivedOptions.authenticated, false);
  assert.deepEqual(receivedOptions.cookies, {});
});

test('generic resolver configuration is passed to the media resolver', async () => {
  let receivedOptions;
  const source = 'https://video.example/watch/123';
  const response = await handleRequest(
    new Request(`http://localhost/api?key=secret&url=${encodeURIComponent(source)}`),
    {
      env: {
        API_KEY: 'secret',
        GENERIC_RESOLVER_ENABLED: 'true',
        GENERIC_RESOLVER_REQUIRE_KEY: 'true',
        YT_DLP_PATH: '/opt/yt-dlp',
        GENERIC_RESOLVER_TIMEOUT_MS: '15000',
        GENERIC_RESOLVER_MAX_CONCURRENT: '3',
      },
      resolve: async (_url, options) => {
        receivedOptions = options;
        return { ...MEDIA, platform: 'generic', authenticated: true };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(receivedOptions.generic, {
    enabled: true,
    requireKey: true,
    ytDlpPath: '/opt/yt-dlp',
    timeoutMs: 15000,
    maxConcurrent: 3,
  });
});

test('a valid key enables server cookies and an invalid key returns 401', async () => {
  let receivedOptions;
  const env = {
    API_KEY: 'secret',
    BILIBILI_COOKIE: 'SESSDATA=private',
    NETEASE_COOKIE: 'MUSIC_U=private',
  };
  const resolve = async (_url, options) => {
    receivedOptions = options;
    return { ...MEDIA, authenticated: options.authenticated };
  };

  const valid = await handleRequest(
    new Request(`http://localhost/api?url=${encodeURIComponent(SOURCE_URL)}&key=secret`),
    { env, resolve },
  );
  assert.equal(valid.status, 200);
  assert.equal(receivedOptions.authenticated, true);
  assert.deepEqual(receivedOptions.cookies, {
    bilibili: 'SESSDATA=private',
    netease: 'MUSIC_U=private',
  });

  const invalid = await handleRequest(
    new Request(`http://localhost/api?url=${encodeURIComponent(SOURCE_URL)}&key=wrong`),
    { env, resolve },
  );
  assert.equal(invalid.status, 401);
  assert.equal((await invalid.json()).error.code, 'invalid_key');
});

test('/play redirects to the exact requested quality', async () => {
  const resolve = async () => MEDIA;
  const selected = await handleRequest(
    new Request(`http://localhost/play?quality=360p&url=${encodeURIComponent(SOURCE_URL)}`),
    { resolve },
  );
  assert.equal(selected.status, 302);
  assert.equal(selected.headers.get('location'), 'https://cdn.example/360.mp4');
  assert.equal(selected.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(selected.headers.get('x-stream-quality'), '360p');

  const unavailable = await handleRequest(
    new Request(`http://localhost/play?quality=1080p&url=${encodeURIComponent(SOURCE_URL)}`),
    { resolve },
  );
  assert.equal(unavailable.status, 422);
  assert.equal((await unavailable.json()).error.code, 'quality_unavailable');
});

test('/play passes YouTube URLs through without upstream parsing', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('YouTube must not be fetched'); };
  t.after(() => { globalThis.fetch = originalFetch; });

  const source = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42';
  const response = await handleRequest(new Request(
    `http://localhost/play?url=${encodeURIComponent(source)}`,
  ));

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), source);
  assert.equal(response.headers.get('x-stream-format'), 'url');
});

test('anonymous parse results persist in SQLite across application instances', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vrc2link-'));
  const databasePath = join(directory, 'state.sqlite');

  const firstState = createSqliteState(databasePath);
  const first = await handleRequest(
    new Request(`http://localhost/api?url=${encodeURIComponent(SOURCE_URL)}`),
    { env: { CACHE_TTL_SECONDS: '300' }, resolve: async () => MEDIA, state: firstState },
  );
  assert.equal(first.status, 200);
  firstState.close();

  const secondState = createSqliteState(databasePath);
  t.after(async () => {
    secondState.close();
    await rm(directory, { recursive: true, force: true });
  });
  const second = await handleRequest(
    new Request(`http://localhost/api?url=${encodeURIComponent(SOURCE_URL)}`),
    {
      env: { CACHE_TTL_SECONDS: '300' },
      resolve: async () => { throw new Error('resolver should not run for a cache hit'); },
      state: secondState,
    },
  );

  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), MEDIA);
  assert.equal(second.headers.get('x-cache'), 'HIT');
});

test('authenticated parse results are never cached', async () => {
  const state = createMemoryState();
  let resolveCount = 0;
  const dependencies = {
    env: { API_KEY: 'secret' },
    resolve: async (_url, options) => {
      resolveCount += 1;
      return { ...MEDIA, authenticated: options.authenticated };
    },
    state,
  };
  const requestUrl = `http://localhost/api?key=secret&url=${encodeURIComponent(SOURCE_URL)}`;

  const first = await handleRequest(new Request(requestUrl), dependencies);
  const second = await handleRequest(new Request(requestUrl), dependencies);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.headers.get('x-cache'), null);
  assert.equal(second.headers.get('x-cache'), null);
  assert.equal(resolveCount, 2);
});

test('anonymous requests over quota return 429 with retry information', async () => {
  const state = createMemoryState();
  const dependencies = {
    env: {
      RATE_LIMIT_ANON_PER_MINUTE: '1',
      RATE_LIMIT_IP_PER_MINUTE: '10',
      RATE_LIMIT_WINDOW_SECONDS: '60',
    },
    clientIp: '203.0.113.10',
    resolve: async () => MEDIA,
    state,
  };
  const requestUrl = `http://localhost/api?url=${encodeURIComponent(SOURCE_URL)}`;

  const accepted = await handleRequest(new Request(requestUrl), dependencies);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get('x-ratelimit-remaining'), '0');

  const rejected = await handleRequest(new Request(requestUrl), dependencies);
  assert.equal(rejected.status, 429);
  assert.equal((await rejected.json()).error.code, 'rate_limited');
  assert.match(rejected.headers.get('retry-after'), /^\d+$/u);
  assert.equal(rejected.headers.get('x-ratelimit-limit'), '1');
  assert.equal(rejected.headers.get('x-ratelimit-remaining'), '0');
});

test('authenticated requests use their separate API key quota', async () => {
  const state = createMemoryState();
  const dependencies = {
    env: {
      API_KEY: 'secret',
      RATE_LIMIT_AUTH_PER_MINUTE: '1',
      RATE_LIMIT_IP_PER_MINUTE: '10',
    },
    clientIp: '203.0.113.11',
    resolve: async (_url, options) => ({ ...MEDIA, authenticated: options.authenticated }),
    state,
  };
  const requestUrl = `http://localhost/api?key=secret&url=${encodeURIComponent(SOURCE_URL)}`;

  const accepted = await handleRequest(new Request(requestUrl), dependencies);
  const rejected = await handleRequest(new Request(requestUrl), dependencies);

  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get('x-ratelimit-limit'), '1');
  assert.equal(rejected.status, 429);
  assert.equal((await rejected.json()).error.code, 'rate_limited');
});

test('anonymous and authenticated requests share the per-IP ceiling', async () => {
  const state = createMemoryState();
  const dependencies = {
    env: {
      API_KEY: 'secret',
      RATE_LIMIT_ANON_PER_MINUTE: '10',
      RATE_LIMIT_AUTH_PER_MINUTE: '10',
      RATE_LIMIT_IP_PER_MINUTE: '1',
    },
    clientIp: '203.0.113.12',
    resolve: async () => MEDIA,
    state,
  };
  const anonymousUrl = `http://localhost/api?url=${encodeURIComponent(SOURCE_URL)}`;
  const authenticatedUrl = `http://localhost/api?key=secret&url=${encodeURIComponent(SOURCE_URL)}`;

  const accepted = await handleRequest(new Request(anonymousUrl), dependencies);
  const rejected = await handleRequest(new Request(authenticatedUrl), dependencies);

  assert.equal(accepted.status, 200);
  assert.equal(rejected.status, 429);
  assert.equal(rejected.headers.get('x-ratelimit-limit'), '1');
});

test('request logs are structured, correlated, and do not expose credentials', async () => {
  const entries = [];
  const response = await handleRequest(
    new Request(`http://localhost/api?key=super-secret&url=${encodeURIComponent(SOURCE_URL)}`),
    {
      clientIp: '203.0.113.20',
      env: {
        API_KEY: 'super-secret',
        BILIBILI_COOKIE: 'SESSDATA=private-cookie',
      },
      logger: (entry) => entries.push(entry),
      requestId: 'request-fixture',
      resolve: async () => ({ ...MEDIA, authenticated: true }),
      state: createMemoryState(),
    },
  );

  assert.equal(response.headers.get('x-request-id'), 'request-fixture');
  assert.equal(entries.length, 1);
  assert.deepEqual(
    Object.fromEntries(Object.entries(entries[0]).filter(([key]) => key !== 'durationMs')),
    {
      event: 'http_request',
      requestId: 'request-fixture',
      method: 'GET',
      path: '/api',
      status: 200,
      platform: 'bilibili',
      cacheHit: null,
      clientIpHash: entries[0].clientIpHash,
    },
  );
  assert.equal(typeof entries[0].durationMs, 'number');
  assert.match(entries[0].clientIpHash, /^[a-f0-9]{64}$/u);
  const serialized = JSON.stringify(entries[0]);
  assert.doesNotMatch(serialized, /super-secret|private-cookie|203\.0\.113\.20/u);
  assert.equal(serialized.includes(SOURCE_URL), false);
});

test('proxy IP headers are trusted only when explicitly enabled', () => {
  const headers = new Headers({
    'X-Forwarded-For': '198.51.100.10, 10.0.0.2',
    'X-Real-IP': '198.51.100.20',
  });

  assert.equal(getClientIp(headers, '10.0.0.1', false), '10.0.0.1');
  assert.equal(getClientIp(headers, '10.0.0.1', true), '198.51.100.10');
  assert.equal(getClientIp(new Headers(), '10.0.0.1', true), '10.0.0.1');
});
