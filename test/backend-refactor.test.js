import assert from 'node:assert/strict';
import test from 'node:test';

import { handleRequest } from '../src/index.js';
import { createMemoryState } from '../src/state.js';
import {
  normalizeApiV1Url,
  parseDashAsset,
  safeLogPath,
} from '../src/http-routing.js';

const playlistUrl = 'https://music.163.com/playlist?id=789';

test('http routing keeps version translation and ticket redaction in one seam', () => {
  const playUrl = normalizeApiV1Url(new URL('https://localhost/api/v1/play?url=https%3A%2F%2Fexample.com'));
  assert.equal(playUrl.pathname, '/play');
  assert.equal(playUrl.searchParams.get('url'), 'https://example.com');

  const dash = parseDashAsset('/dash/12345678901234567890123456789012/manifest.mpd');
  assert.deepEqual(dash, {
    ticket: '12345678901234567890123456789012',
    kind: 'manifest.mpd',
  });
  assert.equal(
    safeLogPath('/api/v1/playback-tickets/1234567890123456789012345678901234567890123/manifest.mpd'),
    '/api/v1/playback-tickets/:ticket/manifest.mpd',
  );
});

test('primary API parsing stays on the single-stream path unless DASH is requested', async () => {
  const sourceUrl = 'https://www.bilibili.com/video/BVprimary';
  const response = await handleRequest(
    new Request(`http://localhost/api?url=${encodeURIComponent(sourceUrl)}`),
    {
      resolve: async () => ({
        platform: 'bilibili',
        type: 'video',
        streams: [
          { quality: '1080p', type: 'video-only', format: 'mp4', url: 'https://cdn.example/video' },
          { quality: '1080p', type: 'audio-only', format: 'mp4', url: 'https://cdn.example/audio' },
          { quality: '720p', format: 'mp4', codec: 'avc', url: 'https://cdn.example/muxed' },
        ],
      }),
    },
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.dash, undefined);
  assert.equal(body.streams[2].url, 'https://cdn.example/muxed');
});

test('default playback rejects separated tracks when no muxed MP4 exists', async () => {
  const response = await handleRequest(
    new Request('http://localhost/play?url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBVseparated'),
    {
      resolve: async () => ({
        platform: 'bilibili',
        type: 'video',
        streams: [
          { quality: '1080p', type: 'video-only', format: 'mp4', url: 'https://cdn.example/video.m4s' },
          { quality: '128k', type: 'audio-only', format: 'mp4', url: 'https://cdn.example/audio.m4s' },
        ],
      }),
    },
  );

  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, 'no_muxed_mp4');
});

function createPlaylistResolver() {
  return async (url) => {
    if (url === playlistUrl) {
      return {
        platform: 'netease',
        type: 'playlist',
        title: 'Compatibility playlist',
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
      id,
      streams: [{ quality: '320k', format: 'mp3', codec: 'mp3', url: `https://cdn.example/${id}.mp3` }],
    };
  };
}

test('legacy Unity playlist endpoints route through the current playlist session', async () => {
  const state = createMemoryState();
  const dependencies = {
    state,
    clientIp: '203.0.113.40',
    resolve: createPlaylistResolver(),
  };

  const play = await handleRequest(new Request(`http://localhost/play?url=${encodeURIComponent(playlistUrl)}`), dependencies);
  assert.equal(play.status, 302);

  const manifest = await handleRequest(new Request('http://localhost/api?playlist=1'), dependencies);
  assert.equal(manifest.status, 200);
  assert.deepEqual(await manifest.json(), {
    type: 'playlist',
    title: 'Compatibility playlist',
    count: 2,
    currentIndex: 0,
    autoPlay: true,
    entries: [{ title: 'Track 1' }, { title: 'Track 2' }],
  });

  const item = await handleRequest(new Request('http://localhost/api?playlistItem=1'), dependencies);
  assert.equal(item.status, 302);
  assert.equal(item.headers.get('location'), 'https://cdn.example/2.mp3');
});

test('legacy playlist compatibility can be disabled after Unity migration', async () => {
  const response = await handleRequest(
    new Request('http://localhost/api?playlist=1'),
    { env: { LEGACY_PLAYLIST_ENDPOINTS: 'false' }, state: createMemoryState() },
  );

  assert.equal(response.status, 410);
  assert.equal((await response.json()).error.code, 'playlist_endpoint_moved');
});
