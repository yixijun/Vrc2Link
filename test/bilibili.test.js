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

test('parseVideo resolves an AV number through aid and returns its canonical BV id', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/x/web-interface/view')) {
      return Response.json({
        code: 0,
        data: {
          aid: 170001,
          bvid: 'BV17x411w7KC',
          cid: 279786,
          title: 'AV fixture',
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
          accept_quality: [64],
          accept_description: ['720P'],
          durl: [{ url: 'https://cdn.example/av.mp4' }],
        },
      });
    }
    return Response.json({ code: -404, message: 'wrong endpoint' });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await parseVideo('av170001');
  const viewCall = new URL(calls.find((url) => url.includes('/x/web-interface/view')));
  const playCall = new URL(calls.find((url) => url.includes('/x/player/playurl')));

  assert.equal(viewCall.searchParams.get('aid'), '170001');
  assert.equal(viewCall.searchParams.has('bvid'), false);
  assert.equal(playCall.searchParams.get('bvid'), 'BV17x411w7KC');
  assert.equal(result.meta.id, 'BV17x411w7KC');
  assert.equal(result.streams[0].url, 'https://cdn.example/av.mp4');
});

test('parseVideo explicitly requests DASH and keeps track metadata', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/x/web-interface/view')) {
      return Response.json({
        code: 0,
        data: {
          bvid: 'BVdashfixture',
          cid: 987654,
          title: 'DASH fixture',
          duration: 91,
          owner: { name: 'Uploader' },
          pages: [],
        },
      });
    }
    if (url.includes('/x/player/playurl')) {
      return Response.json({
        code: 0,
        data: {
          quality: 80,
          accept_quality: [80, 64],
          accept_description: ['1080P', '720P'],
          durl: [{ url: 'https://cdn.example/should-not-be-used.mp4' }],
          dash: {
            video: [{
              id: 80,
              baseUrl: 'https://upos.example/video.m4s?deadline=1999999999',
              backupUrl: ['https://backup.example/video.m4s'],
              bandwidth: 4000000,
              codecs: 'avc1.640028',
              width: 1920,
              height: 1080,
              frame_rate: '30',
              mime_type: 'video/mp4',
              segment_base: { Initialization: '0-999', indexRange: '1000-2000' },
            }],
            audio: [{
              id: 30280,
              base_url: 'https://upos.example/audio.m4s?deadline=1999999999',
              bandwidth: 192000,
              codecs: 'mp4a.40.2',
              sample_rate: 48000,
              channels: 2,
              segment_base: { Initialization: '0-500', indexRange: '501-1000' },
            }],
          },
        },
      });
    }
    return Response.json({ code: -404, message: 'wrong endpoint' });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await parseVideo('BVdashfixture', { mode: 'dash', quality: '1080p' });
  const playCall = new URL(calls.find((url) => url.includes('/x/player/playurl')));
  const video = result.streams.find((stream) => stream.type === 'video-only');
  const audio = result.streams.find((stream) => stream.type === 'audio-only');

  assert.equal(playCall.searchParams.get('fnval'), '16');
  assert.equal(result.meta.cid, 987654);
  assert.equal(video.url, 'https://upos.example/video.m4s?deadline=1999999999');
  assert.equal(video.initialization, '0-999');
  assert.equal(video.indexRange, '1000-2000');
  assert.deepEqual(video.backupUrls, ['https://backup.example/video.m4s']);
  assert.equal(audio.codec, 'mp4a.40.2');
  assert.equal(audio.sampleRate, 48000);
  assert.equal(result.streams.some((stream) => stream.url.includes('should-not-be-used')), false);
});

test('parseVideo auto mode requests DASH while retaining direct streams as fallback', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/x/web-interface/view')) {
      return Response.json({
        code: 0,
        data: {
          bvid: 'BVautofixture',
          cid: 987654,
          title: 'Auto fixture',
          duration: 91,
          owner: { name: 'Uploader' },
          pages: [],
        },
      });
    }
    if (url.includes('/x/player/playurl')) {
      return Response.json({
        code: 0,
        data: {
          quality: 80,
          accept_quality: [80],
          durl: [{ url: 'https://cdn.example/fallback.mp4' }],
          dash: {
            video: [{
              id: 80,
              baseUrl: 'https://upos.example/video.m4s',
              bandwidth: 4000000,
              codecs: 'avc1.640028',
              width: 1920,
              height: 1080,
            }],
            audio: [{
              id: 30280,
              baseUrl: 'https://upos.example/audio.m4s',
              bandwidth: 192000,
              codecs: 'mp4a.40.2',
            }],
          },
        },
      });
    }
    return Response.json({ code: -404, message: 'wrong endpoint' });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await parseVideo('BVautofixture', { mode: 'auto' });
  const playCall = new URL(calls.find((url) => url.includes('/x/player/playurl')));

  assert.equal(playCall.searchParams.get('fnval'), '16');
  assert.ok(result.streams.some((stream) => stream.url === 'https://cdn.example/fallback.mp4' && !stream.type));
  assert.ok(result.streams.some((stream) => stream.type === 'video-only'));
  assert.ok(result.streams.some((stream) => stream.type === 'audio-only'));
});
