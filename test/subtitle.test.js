import assert from 'node:assert/strict';
import test from 'node:test';

import { handleRequest } from '../src/index.js';
import {
  fetchBilibiliCcSubtitles,
  normalizeSubtitleCues,
  normalizeSubtitleUrl,
  selectSubtitleTrack,
} from '../src/platforms/bilibili-subtitle.js';
import { fetchCurrentSubtitle } from '../src/subtitle.js';
import { createMemoryState } from '../src/state.js';

const SOURCE_URL = 'https://www.bilibili.com/video/BV1fixture';
const MEDIA = {
  platform: 'bilibili', type: 'video', id: 'BV1fixture', title: 'Fixture', duration: 120,
  streams: [{ quality: '720p', format: 'mp4', codec: 'avc', url: 'https://cdn.example/video.mp4' }],
};

test('/play binds subtitles and both current subtitle routes use the session', async () => {
  const state = createMemoryState();
  let receivedSession;
  const dependencies = {
    state,
    clientIp: '203.0.113.20',
    resolve: async () => MEDIA,
    fetchSubtitle: async (session, query) => {
      receivedSession = session;
      return {
        available: true, platform: 'bilibili', source: 'bilibili-cc',
        language: 'zh-CN', languageName: '中文',
        selectedTrack: query.track, tracks: [{ index: 0, language: 'zh-CN', name: '中文' }],
        cues: [{ from: 1, to: 2, text: '字幕' }],
      };
    },
  };

  const play = await handleRequest(new Request(
    `http://localhost/play?url=${encodeURIComponent(SOURCE_URL)}`,
  ), dependencies);
  assert.equal(play.status, 302);

  for (const path of ['/subtitle/current?track=0', '/api?subtitle=1&track=0']) {
    const response = await handleRequest(new Request(`http://localhost${path}`), dependencies);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).cues[0].text, '字幕');
  }
  assert.equal(receivedSession.id, 'BV1fixture');
});

test('/subtitle/current rejects clients without a recent /play request', async () => {
  const response = await handleRequest(new Request('http://localhost/subtitle/current'), {
    state: createMemoryState(), clientIp: '198.51.100.40',
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'no_subtitle_session');
});

test('current Bilibili subtitles use the configured Cookie for a public play session', async () => {
  const calls = [];
  const result = await fetchCurrentSubtitle(
    { platform: 'bilibili', type: 'video', id: 'BV1fixture', authenticated: false },
    { track: 0 },
    {
      env: { BILIBILI_COOKIE: 'SESSDATA=server-cookie' },
      fetcher: async (url, options) => {
        calls.push({ url, options });
        if (url.includes('/view?')) return Response.json({ code: 0, data: { aid: 42, cid: 99 } });
        if (url.includes('/player/wbi/v2?')) return Response.json({
          code: 0,
          data: { subtitle: { subtitles: [{ lan: 'zh-CN', lan_doc: 'Chinese', type: 0, subtitle_url: '//i.example/sub.json' }] } },
        });
        return Response.json({ body: [{ from: 1, to: 3, content: 'hello' }] });
      },
    },
  );

  assert.equal(result.available, true);
  assert.ok(calls.every((call) => call.options.cookie === 'SESSDATA=server-cookie'));
  assert.equal(result.tracks[0].name, 'Chinese（人工）');
});

test('Bilibili subtitle helpers prefer Simplified Chinese and normalize cues', () => {
  const selected = selectSubtitleTrack([
    { lan: 'en-US', subtitle_url: '//example/en.json' },
    { lan: 'ai-zh', subtitle_url: '//example/ai.json' },
    { lan: 'zh-CN', subtitle_url: '//example/zh.json' },
  ]);
  assert.equal(selected.lan, 'zh-CN');
  assert.equal(normalizeSubtitleUrl(selected.subtitle_url), 'https://example/zh.json');
  assert.deepEqual(normalizeSubtitleCues([
    { from: 2, to: 4, content: '第二句<br>下一行' },
    { from: 0.5, to: 1.5, content: '<b>第一句</b>' },
    { from: 5, to: 4, content: 'invalid' },
  ]), [
    { from: 0.5, to: 1.5, text: '第一句' },
    { from: 2, to: 4, text: '第二句\n下一行' },
  ]);
});

test('Bilibili CC fetch passes Cookie, normalizes protocol-relative URL and caches', async () => {
  const state = createMemoryState();
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/view?')) return Response.json({ code: 0, data: { aid: 42, cid: 99 } });
    if (url.includes('/player/wbi/v2?')) return Response.json({
      code: 0,
      data: { subtitle: { subtitles: [{ lan: 'zh-CN', lan_doc: '中文', subtitle_url: '//i.example/sub.json' }] } },
    });
    return Response.json({ body: [{ from: 1, to: 3, content: 'hello' }] });
  };

  const first = await fetchBilibiliCcSubtitles('BV1fixture', {
    cookie: 'SESSDATA=private', state, fetcher,
  });
  const second = await fetchBilibiliCcSubtitles('BV1fixture', {
    cookie: 'SESSDATA=private', state, fetcher,
  });
  assert.equal(first.available, true);
  assert.equal(first.cues[0].text, 'hello');
  assert.equal(first.tracks[0].name, '中文（人工）');
  assert.deepEqual(second, first);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, 'https://i.example/sub.json');
  assert.ok(calls.every((call) => call.options.cookie === 'SESSDATA=private'));
});

test('Bilibili videos without CC return an empty successful result', async () => {
  const fetcher = async (url) => url.includes('/view?')
    ? Response.json({ code: 0, data: { cid: 99 } })
    : Response.json({ code: 0, data: { subtitle: { subtitles: [] } } });
  const result = await fetchBilibiliCcSubtitles('BV1none', { fetcher });
  assert.equal(result.available, false);
  assert.deepEqual(result.cues, []);
});

test('an unavailable saved track falls back to the first subtitle without stalling the client', async () => {
  const fetcher = async (url) => {
    if (url.includes('/view?')) return Response.json({ code: 0, data: { cid: 99 } });
    if (url.includes('/player/wbi/v2?')) return Response.json({
      code: 0,
      data: { subtitle: { subtitles: [{ lan: 'zh-CN', lan_doc: '中文', subtitle_url: '//i.example/sub.json' }] } },
    });
    return Response.json({ body: [{ from: 1, to: 3, content: 'fallback' }] });
  };
  const result = await fetchBilibiliCcSubtitles('BV1fallback', { track: 3, fetcher });
  assert.equal(result.selectedTrack, 3);
  assert.equal(result.actualTrack, 1);
  assert.equal(result.cues[0].text, 'fallback');
});

test('Bilibili CC ignores a preferred track whose subtitle URL is empty', async () => {
  const fetcher = async (url) => {
    if (url.includes('/view?')) return Response.json({ code: 0, data: { cid: 99 } });
    if (url.includes('/player/wbi/v2?')) return Response.json({
      code: 0,
      data: { subtitle: { subtitles: [
        { lan: 'zh-CN', lan_doc: '中文', type: 0, subtitle_url: '' },
        { lan: 'ai-zh', lan_doc: '中文', type: 1, subtitle_url: '//i.example/ai.json' },
      ] } },
    });
    return Response.json({ body: [{ from: 1, to: 3, content: 'AI fallback' }] });
  };
  const result = await fetchBilibiliCcSubtitles('BV1empty-url', { fetcher });
  assert.equal(result.available, true);
  assert.equal(result.language, 'ai-zh');
  assert.equal(result.cues[0].text, 'AI fallback');
});
