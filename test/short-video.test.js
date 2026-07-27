import assert from 'node:assert/strict';
import test from 'node:test';

import { handleRequest } from '../src/index.js';
import { parseShortVideo } from '../src/platforms/short-video.js';

test('parseShortVideo extracts a playable Douyin URL from page data', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`
    <script>window.data = {"desc":"测试视频","nickname":"作者","play_addr":{"url_list":["https:\\/\\/cdn.example\\/video.mp4"]}};</script>
  `);
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await parseShortVideo('douyin', 'https://www.douyin.com/video/123', { id: '123' });

  assert.equal(result.platform, 'douyin');
  assert.equal(result.meta.title, '测试视频');
  assert.equal(result.streams[0].quality, 'original');
  assert.equal(result.streams[0].url, 'https://cdn.example/video.mp4');
});

test('parseShortVideo caches anonymous Kuaishou results', async (t) => {
  const originalFetch = globalThis.fetch;
  let upstreamRequests = 0;
  globalThis.fetch = async () => {
    upstreamRequests += 1;
    return new Response(`
      {"caption":"快手视频","playUrl":"https:\\/\\/cdn.example\\/kuaishou.mp4"}
    `);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const source = 'https://www.kuaishou.com/short-video/cacheFixture';
  const first = await parseShortVideo('kuaishou', source, { id: 'cacheFixture' });
  const second = await parseShortVideo('kuaishou', source, { id: 'cacheFixture' });

  assert.equal(first.streams[0].url, 'https://cdn.example/kuaishou.mp4');
  assert.equal(second.streams[0].url, 'https://cdn.example/kuaishou.mp4');
  assert.equal(upstreamRequests, 1);
});

test('/play uses the Kuaishou mobile page because desktop pages can omit streams', async (t) => {
  const originalFetch = globalThis.fetch;
  const userAgents = [];
  globalThis.fetch = async (_input, init = {}) => {
    const userAgent = new Headers(init.headers).get('user-agent') || '';
    userAgents.push(userAgent);
    if (!userAgent.includes('Mobile')) return Response.json({ result: 2, error_msg: null });
    return new Response(`
      {"downloadUrl":"https:\\/\\/cp.m.kuaishou.com\\/2022\\/download?layoutType=4",
       "adaptationSet":[{"representation":[{"backupUrl":["https:\\/\\/cdn.example\\/kuaishou-mobile.mp4"]}]}]}
    `);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const source = 'https://www.kuaishou.com/short-video/mobileFallbackFixture';
  const response = await handleRequest(new Request(
    `http://localhost/play?url=${encodeURIComponent(source)}`,
  ));

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://cdn.example/kuaishou-mobile.mp4');
  assert.equal(userAgents.length, 1);
  assert.equal(userAgents[0].includes('Mobile'), true);
});

test('/play resolves a Douyin Jingxuan URL through the mobile share page', async (t) => {
  const originalFetch = globalThis.fetch;
  let upstreamRequests = 0;
  globalThis.fetch = async (input) => {
    if (String(input).includes('iesdouyin.com/share/video/7666774315384372859')) {
      upstreamRequests += 1;
      return new Response(`
        <script id="RENDER_DATA" type="application/json">
          {"desc":"精选视频","video":{"play_addr":{"url_list":["https:\\u002F\\u002Fcdn.example\\u002Fdouyin.mp4"]}}}
        </script>
      `);
    }
    return new Response('<html><body>desktop challenge</body></html>');
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const source = 'https://www.douyin.com/jingxuan?modal_id=7666774315384372859';
  const response = await handleRequest(new Request(
    `http://localhost/play?url=${encodeURIComponent(source)}`,
  ));
  const repeated = await handleRequest(new Request(
    `http://localhost/play?url=${encodeURIComponent(source)}`,
  ));

  assert.equal(response.status, 302);
  assert.equal(repeated.status, 302);
  assert.equal(response.headers.get('location'), 'https://cdn.example/douyin.mp4');
  assert.equal(upstreamRequests, 1);
});

test('/play reuses a successful Douyin short-link expansion', async (t) => {
  const originalFetch = globalThis.fetch;
  let shortLinkRequests = 0;
  let pageRequests = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === 'https://v.douyin.com/cacheTest/') {
      shortLinkRequests += 1;
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://www.iesdouyin.com/share/video/7555555555555555555/' },
      });
    }
    if (url.includes('iesdouyin.com/share/video/7555555555555555555')) {
      pageRequests += 1;
      return new Response(`
        {"video":{"play_addr":{"url_list":["https:\\u002F\\u002Fcdn.example\\u002Fcached.mp4"]}}}
      `);
    }
    return new Response('not found', { status: 404 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const source = 'https://v.douyin.com/cacheTest/';
  const request = () => handleRequest(new Request(
    `http://localhost/play?url=${encodeURIComponent(source)}`,
  ));
  const first = await request();
  const second = await request();

  assert.equal(first.status, 302);
  assert.equal(second.status, 302);
  assert.equal(shortLinkRequests, 1);
  assert.equal(pageRequests, 1);
});
