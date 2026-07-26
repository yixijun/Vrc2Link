import assert from 'node:assert/strict';
import test from 'node:test';

import { parseVideo } from '../src/platforms/bilibili.js';

test('parseVideo uses the PGC play endpoint for bangumi videos', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);

    if (url.includes('/x/web-interface/view')) {
      return Response.json({
        code: 0,
        data: {
          bvid: 'BV1Dr3g65EJ2',
          cid: 40287407775,
          title: 'PGC fixture',
          duration: 120,
          redirect_url: 'https://www.bilibili.com/bangumi/play/ep3537939',
          owner: { name: 'Bilibili' },
          pages: [],
        },
      });
    }

    if (url.includes('/pgc/player/web/playurl/html5')) {
      return Response.json({
        code: 0,
        result: {
          quality: 32,
          accept_quality: [32, 16],
          accept_description: ['480P', '360P'],
          durl: [{ url: 'https://cdn.example/pgc.mp4', size: 1234 }],
        },
      });
    }

    return Response.json({ code: -404, message: 'wrong endpoint' });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await parseVideo('BV1Dr3g65EJ2');

  assert.equal(result.streams[0].url, 'https://cdn.example/pgc.mp4');
  const playCall = calls.find((url) => url.includes('/pgc/player/web/playurl/html5'));
  assert.ok(playCall);
  assert.equal(new URL(playCall).searchParams.get('platform'), 'html5');
});

test('parseVideo requests HTML5 streams for direct UGC playback', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/x/web-interface/view')) {
      return Response.json({
        code: 0,
        data: {
          cid: 123,
          title: 'UGC fixture',
          duration: 60,
          owner: { name: 'Uploader' },
          pages: [],
        },
      });
    }
    if (url.includes('/x/player/playurl')) {
      return Response.json({
        code: 0,
        data: {
          quality: 64,
          accept_quality: [64, 16],
          accept_description: ['720P', '360P'],
          durl: [{ url: 'https://cdn.example/ugc.mp4', size: 5678 }],
        },
      });
    }
    return Response.json({ code: -404, message: 'wrong endpoint' });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await parseVideo('BV1fixture');
  const playCall = calls.find((url) => url.includes('/x/player/playurl'));

  assert.equal(result.streams[0].url, 'https://cdn.example/ugc.mp4');
  assert.ok(playCall);
  assert.equal(new URL(playCall).searchParams.get('platform'), 'html5');
});
