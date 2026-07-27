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

test('/play resolves a Douyin Jingxuan URL through the mobile share page', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).includes('iesdouyin.com/share/video/7666774315384372859')) {
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

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://cdn.example/douyin.mp4');
});
