import assert from 'node:assert/strict';
import test from 'node:test';

import { handleRequest } from '../src/index.js';

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
  assert.deepEqual(detect('https://live.bilibili.com/6'), ['', 'original']);
  assert.deepEqual(detect('https://music.163.com/song?id=186016'), ['', '128k', '256k', '320k', 'lossless']);
  assert.match(controls['platform-hint'].textContent, /网易云歌曲/);
  assert.deepEqual(detect('https://music.163.com/#/mv?id=10970707'), ['', '360p', '480p', '720p', '1080p']);
  assert.deepEqual(detect('https://v.douyin.com/abc123'), ['', 'original']);
  assert.match(controls['platform-hint'].textContent, /抖音视频/);
  assert.deepEqual(detect('https://v.kuaishou.com/abc123'), ['', 'original']);
  assert.match(controls['platform-hint'].textContent, /快手视频/);

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
