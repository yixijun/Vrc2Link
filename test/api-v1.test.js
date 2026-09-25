import assert from 'node:assert/strict';
import test from 'node:test';

import { handleRequest } from '../src/index.js';
import { createMemoryState } from '../src/state.js';

const SOURCE_URL = 'https://www.bilibili.com/video/BVv1fixture';

test('v1 root and OpenAPI document expose the versioned contract', async () => {
  const root = await handleRequest(new Request('http://localhost/api/v1'), {
    requestId: 'request-v1-root',
  });
  assert.equal(root.status, 200);
  assert.equal(root.headers.get('API-Version'), '1');
  assert.equal(root.headers.get('X-Request-Id'), 'request-v1-root');
  assert.deepEqual(await root.json(), {
    data: {
      service: 'Vrc2Link',
      apiVersion: '1',
      links: {
        openapi: '/api/v1/openapi.yaml',
        mediaResolve: '/api/v1/media/resolve',
        play: '/api/v1/play',
        currentPlaylist: '/api/v1/playlists/current',
        credentials: '/api/v1/credentials',
        playbackTickets: '/api/v1/playback-tickets',
      },
    },
    meta: { apiVersion: '1', requestId: 'request-v1-root' },
  });

  const specification = await handleRequest(new Request('http://localhost/api/v1/openapi.yaml'));
  assert.equal(specification.status, 200);
  assert.match(specification.headers.get('content-type'), /application\/yaml/u);
  const specificationText = await specification.text();
  assert.match(specificationText, /openapi: 3\.1\.0/u);
  assert.match(specificationText, /\/api\/v1\/playback-tickets/u);
  assert.match(specificationText, /AES-256-GCM/u);
});

test('v1 media resolution uses the standard envelope and Bearer authentication', async () => {
  let receivedOptions;
  const response = await handleRequest(
    new Request(`http://localhost/api/v1/media/resolve?url=${encodeURIComponent(SOURCE_URL)}`, {
      headers: { Authorization: 'Bearer test-secret' },
    }),
    {
      requestId: 'request-v1-media',
      env: { API_KEY: 'test-secret', BILIBILI_COOKIE: 'SESSDATA=fixture' },
      resolve: async (_url, options) => {
        receivedOptions = options;
        return { platform: 'bilibili', type: 'video', qualities: ['720p'], streams: [] };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('API-Version'), '1');
  assert.equal(receivedOptions.authenticated, true);
  assert.equal(receivedOptions.cookies.bilibili, 'SESSDATA=fixture');
  const body = await response.json();
  assert.equal(body.data.platform, 'bilibili');
  assert.equal(body.meta.requestId, 'request-v1-media');
});

test('v1 validation errors use the standard error envelope', async () => {
  const response = await handleRequest(
    new Request(`http://localhost/api/v1/media/resolve?mode=unknown&url=${encodeURIComponent(SOURCE_URL)}`),
    { requestId: 'request-v1-error' },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: 'invalid_play_mode', message: 'mode must be single, dash, or auto' },
    meta: { apiVersion: '1', requestId: 'request-v1-error' },
  });
});

test('v1 danmaku resource paths translate into enveloped video and live responses', async () => {
  const state = createMemoryState();
  const dependencies = {
    state,
    clientIp: '203.0.113.56',
    resolve: async () => ({
      platform: 'bilibili',
      type: 'video',
      id: 'BVv1fixture',
      streams: [{ quality: '720p', format: 'mp4', codec: 'avc', url: 'https://cdn.example/video.mp4' }],
    }),
    fetchDanmaku: async (_session, query) => ({
      platform: 'bilibili',
      mode: query.live ? 'live' : 'video',
      ...(query.live ? {} : { segment: query.segment, segmentSeconds: 360 }),
      messages: [{ id: 'message-1', time: 3, mode: 1, color: 0xffffff, text: 'fixture' }],
    }),
  };
  const source = encodeURIComponent(SOURCE_URL);
  await handleRequest(new Request(`http://localhost/api/v1/play?url=${source}`), dependencies);

  const video = await handleRequest(
    new Request('http://localhost/api/v1/danmaku/current/video/segments/2'),
    dependencies,
  );
  assert.equal(video.status, 200);
  assert.equal((await video.json()).data.segment, 2);

  const live = await handleRequest(
    new Request('http://localhost/api/v1/danmaku/current/live'),
    dependencies,
  );
  assert.equal(live.status, 200);
  assert.equal((await live.json()).data.mode, 'live');
});

test('v1 playback and playlist item endpoints retain redirects while enveloping JSON manifests', async () => {
  const state = createMemoryState();
  const resolve = async (url) => {
    if (url.includes('/playlist?')) {
      return {
        platform: 'netease',
        type: 'playlist',
        title: 'Fixture playlist',
        currentIndex: 0,
        playlist: [
          { title: 'Track 1', sourceUrl: 'https://music.163.com/song?id=1' },
          { title: 'Track 2', sourceUrl: 'https://music.163.com/song?id=2' },
        ],
      };
    }
    const id = new URL(url).searchParams.get('id');
    return {
      platform: 'netease',
      type: 'song',
      streams: [{ quality: '320k', format: 'mp3', codec: 'mp3', url: `https://cdn.example/${id}.mp3` }],
    };
  };
  const dependencies = { state, resolve, clientIp: '203.0.113.55' };
  const source = encodeURIComponent('https://music.163.com/playlist?id=789');

  const play = await handleRequest(new Request(`http://localhost/api/v1/play?mode=auto&url=${source}`), dependencies);
  assert.equal(play.status, 302);
  assert.equal(play.headers.get('location'), 'https://cdn.example/1.mp3');
  assert.equal(play.headers.get('API-Version'), '1');

  const manifest = await handleRequest(new Request('http://localhost/api/v1/playlists/current'), dependencies);
  assert.equal(manifest.status, 200);
  assert.deepEqual((await manifest.json()).data, {
    type: 'playlist',
    title: 'Fixture playlist',
    count: 2,
    currentIndex: 0,
    autoPlay: true,
    entries: [{ title: 'Track 1' }, { title: 'Track 2' }],
  });

  const item = await handleRequest(new Request('http://localhost/api/v1/playlists/current/items/1'), dependencies);
  assert.equal(item.status, 302);
  assert.equal(item.headers.get('location'), 'https://cdn.example/2.mp3');
});

test('v1 DASH links stay inside the versioned API namespace', async () => {
  const response = await handleRequest(
    new Request(`http://localhost/api/v1/play?mode=dash&quality=1080p&url=${encodeURIComponent(SOURCE_URL)}`),
    {
      state: createMemoryState(),
      env: { PUBLIC_BASE_URL: 'http://localhost' },
      resolve: async () => ({
        platform: 'bilibili',
        type: 'video',
        id: 'BVv1fixture',
        cid: '1',
        duration: 10,
        streams: [
          { type: 'video-only', quality: '1080p', codec: 'avc1.640028', url: 'https://cdn.example/video.m4s' },
          { type: 'audio-only', quality: '192k', codec: 'mp4a.40.2', url: 'https://cdn.example/audio.m4s' },
        ],
      }),
    },
  );

  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /^http:\/\/localhost\/api\/v1\/dash\/[A-Za-z0-9_-]{32}\/manifest\.mpd$/u);
});

test('auto playback uses a muxed stream when it preserves the selected DASH video quality', async () => {
  const response = await handleRequest(
    new Request(`http://localhost/api/v1/play?mode=auto&url=${encodeURIComponent(SOURCE_URL)}`),
    {
      state: createMemoryState(),
      env: { PUBLIC_BASE_URL: 'http://localhost' },
      resolve: async () => ({
        platform: 'bilibili',
        type: 'video',
        id: 'BVv1fixture',
        duration: 10,
        streams: [
          { quality: '1080p', format: 'mp4', codec: 'avc', url: 'https://cdn.example/muxed.mp4' },
          { type: 'video-only', quality: '1080p', codec: 'avc1.640028', url: 'https://cdn.example/video.m4s' },
          { type: 'audio-only', quality: '192k', codec: 'mp4a.40.2', url: 'https://cdn.example/audio.m4s' },
        ],
      }),
    },
  );

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://cdn.example/muxed.mp4');
  assert.equal(response.headers.get('X-Stream-Quality'), '1080p');
});

test('auto playback keeps DASH when the available muxed stream is lower quality', async () => {
  const response = await handleRequest(
    new Request(`http://localhost/api/v1/play?mode=auto&url=${encodeURIComponent(SOURCE_URL)}`),
    {
      state: createMemoryState(),
      env: { PUBLIC_BASE_URL: 'http://localhost' },
      resolve: async () => ({
        platform: 'bilibili',
        type: 'video',
        id: 'BVv1fixture',
        cid: '1',
        duration: 10,
        streams: [
          { quality: '720p', format: 'mp4', codec: 'avc', url: 'https://cdn.example/muxed.mp4' },
          { type: 'video-only', quality: '1080p', codec: 'avc1.640028', url: 'https://cdn.example/video.m4s' },
          { type: 'audio-only', quality: '192k', codec: 'mp4a.40.2', url: 'https://cdn.example/audio.m4s' },
        ],
      }),
    },
  );

  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /^http:\/\/localhost\/api\/v1\/dash\/[A-Za-z0-9_-]{32}\/manifest\.mpd$/u);
});
