import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePlaylist as parseBilibiliPlaylist, parseVideo as parseBilibiliVideo } from '../src/platforms/bilibili.js';
import { parsePlaylist as parseNeteasePlaylist } from '../src/platforms/netease.js';
import { handleRequest } from '../src/index.js';
import { createMemoryState } from '../src/state.js';
import { extractId } from '../src/utils/url.js';

test('recognises Bilibili collection, series, and Netease playlist URLs', () => {
  assert.deepEqual(
    extractId('https://space.bilibili.com/123/channel/collectiondetail?sid=456', 'bilibili'),
    { type: 'playlist', id: '456', kind: 'season', mid: '123', bvid: '' },
  );
  assert.deepEqual(
    extractId('https://www.bilibili.com/list/455?bvid=BVfixture1', 'bilibili'),
    { type: 'playlist', id: '455', kind: 'collection', mid: '', bvid: 'BVfixture1' },
  );
  assert.deepEqual(
    extractId('https://music.163.com/#/playlist?id=789', 'netease'),
    { type: 'playlist', id: '789' },
  );
});
test('Bilibili playlist parser returns resolver URLs', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /seasons_archives_list/);
    return Response.json({ code: 0, data: { archives: [{ bvid: 'BVfixture1', title: '\u7b2c\u4e00\u96c6', pic: 'https://cdn.example/1.jpg' }] } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await parseBilibiliPlaylist(
    { id: '456', kind: 'season', mid: '123' },
    { resolverPrefix: 'https://vrc2link.example/play?url=' },
  );
  assert.equal(result.type, 'playlist');
  assert.equal(result.playlist[0].title, '\u7b2c\u4e00\u96c6');
  assert.equal(result.playlist[0].url, 'https://vrc2link.example/play?url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBVfixture1');
});
test('Bilibili playlist parser follows collection pagination', async (t) => {
  const originalFetch = globalThis.fetch;
  const pages = [];
  globalThis.fetch = async (input) => {
    const page = Number(new URL(String(input)).searchParams.get('pn'));
    pages.push(page);
    return Response.json({ code: 0, data: {
      has_more: page === 1,
      archives: page === 1
        ? [{ bvid: 'BVpage1', title: 'Page 1' }, { bvid: 'BVpage2', title: 'Page 2' }]
        : [{ bvid: 'BVpage3', title: 'Page 3' }],
    } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await parseBilibiliPlaylist(
    { id: '456', kind: 'season', mid: '123' },
    { resolverPrefix: 'https://vrc2link.example/play?url=' },
  );
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(result.playlist.map((item) => item.id), ['BVpage1', 'BVpage2', 'BVpage3']);
});

test('Bilibili video exposes its UGC season when playlist mode is requested', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /web-interface\/view/);
    return Response.json({ code: 0, data: {
      bvid: 'BV12x3u6iEUM',
      title: 'Current episode',
      owner: { mid: 1745143606, name: 'Uploader' },
      ugc_season: {
        id: 1571735,
        title: 'Season fixture',
        sections: [{ episodes: [
          { bvid: 'BVepisode1', title: 'Episode 1', arc: { pic: 'https://cdn.example/1.jpg', duration: 61 } },
          { bvid: 'BVepisode2', title: 'Episode 2', arc: { pic: 'https://cdn.example/2.jpg', duration: 62 } },
        ] }],
      },
    } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await parseBilibiliVideo('BV12x3u6iEUM', {
    includeSeasonPlaylist: true,
    resolverPrefix: 'https://vrc2link.example/play?url=',
  });
  assert.equal(result.type, 'playlist');
  assert.equal(result.meta.title, 'Season fixture');
  assert.deepEqual(result.playlist.map((item) => item.id), ['BVepisode1', 'BVepisode2']);
  assert.match(result.playlist[1].url, /BVepisode2$/);
  assert.equal(result.currentIndex, -1);
});

test('Netease playlist parser returns songs in order', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /playlist\/detail/);
    return Response.json({ playlist: {
      name: '\u6b4c\u5355 fixture',
      creator: { nickname: 'Tester' },
      tracks: [{ id: 1, name: '\u7b2c\u4e00\u9996', dt: 61000 }, { id: 2, name: '\u7b2c\u4e8c\u9996', dt: 62000 }],
    } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await parseNeteasePlaylist(
    { id: '789' },
    { resolverPrefix: 'https://vrc2link.example/play?url=' },
  );
  assert.equal(result.meta.title, '\u6b4c\u5355 fixture');
  assert.deepEqual(result.playlist.map((item) => item.title), ['1. \u7b2c\u4e00\u9996', '2. \u7b2c\u4e8c\u9996']);
  assert.match(result.playlist[1].url, /song%3Fid%3D2$/);
});

test('Netease playlist parser fetches track details omitted from playlist response', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/playlist/detail')) {
      return Response.json({ playlist: {
        name: 'Long fixture',
        tracks: [{ id: 1, name: 'First', dt: 1000 }],
        trackIds: [{ id: 1 }, { id: 2 }],
      } });
    }
    assert.match(url, /song\/detail/);
    return Response.json({ songs: [{ id: 2, name: 'Second', dt: 2000 }] });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await parseNeteasePlaylist(
    { id: '789' },
    { resolverPrefix: 'https://vrc2link.example/play?url=' },
  );
  assert.deepEqual(result.playlist.map((item) => item.id), ['1', '2']);
});

test('Netease playlist parser accepts the public result response shape', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /playlist\/detail/);
    return Response.json({ code: 200, result: {
      name: 'Public playlist fixture',
      creator: { nickname: 'Tester' },
      tracks: [{ id: 2481925967, name: 'Public track', duration: 63000, album: { picUrl: 'https://cdn.example/cover.jpg' } }],
    } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await parseNeteasePlaylist(
    { id: '2481925967' },
    { resolverPrefix: 'https://vrc2link.example/play?url=' },
  );
  assert.equal(result.meta.title, 'Public playlist fixture');
  assert.equal(result.playlist[0].duration, 63);
  assert.equal(result.playlist[0].cover, 'https://cdn.example/cover.jpg');
});


test('/play keeps VizVid playlist JSON while fixed API endpoints expose and play the current list', async () => {
  const state = createMemoryState();
  const resolvedUrls = [];
  const resolve = async (url) => {
    resolvedUrls.push(url);
    if (url.includes('/playlist?')) {
      return {
        platform: 'netease',
        type: 'playlist',
        title: 'Fixture playlist',
        currentIndex: 0,
        playlist: [
          { title: 'Track 1', sourceUrl: 'https://music.163.com/song?id=1', url: 'https://vrc2link.example/play?url=song-1' },
          { title: 'Track 2', sourceUrl: 'https://music.163.com/song?id=2', url: 'https://vrc2link.example/play?url=song-2' },
        ],
      };
    }
    const id = new URL(url).searchParams.get('id');
    return {
      platform: 'netease', type: 'song', id,
      streams: [{ quality: '320k', format: 'mp3', codec: 'mp3', url: `https://cdn.example/${id}.mp3` }],
    };
  };
  const response = await handleRequest(
    new Request('http://localhost/play?url=https%3A%2F%2Fmusic.163.com%2Fplaylist%3Fid%3D789'),
    { state, resolve, clientIp: '203.0.113.10' },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(await response.json(), {
    'Fixture playlist': [
      { title: 'Track 1', url: 'https://vrc2link.example/play?url=song-1', playerIndex: 1 },
      { title: 'Track 2', url: 'https://vrc2link.example/play?url=song-2', playerIndex: 1 },
    ],
  });

  const manifestResponse = await handleRequest(
    new Request('http://localhost/api?playlist=1'),
    { state, resolve, clientIp: '203.0.113.10' },
  );
  assert.equal(manifestResponse.status, 200);
  assert.deepEqual(await manifestResponse.json(), {
    type: 'playlist', title: 'Fixture playlist', count: 2, currentIndex: 0, autoPlay: true,
    entries: [{ title: 'Track 1' }, { title: 'Track 2' }],
  });

  const itemResponse = await handleRequest(
    new Request('http://localhost/api?playlistItem=1'),
    { state, resolve, clientIp: '203.0.113.10' },
  );
  assert.equal(itemResponse.status, 302);
  assert.equal(itemResponse.headers.get('location'), 'https://cdn.example/2.mp3');
  assert.deepEqual(resolvedUrls, [
    'https://music.163.com/playlist?id=789',
    'https://music.163.com/song?id=2',
  ]);

  const updatedManifestResponse = await handleRequest(
    new Request('http://localhost/api?playlist=1'),
    { state, resolve, clientIp: '203.0.113.10' },
  );
  assert.equal(updatedManifestResponse.status, 200);
  assert.deepEqual(await updatedManifestResponse.json(), {
    type: 'playlist', title: 'Fixture playlist', count: 2, currentIndex: 1, autoPlay: false,
    entries: [{ title: 'Track 1' }, { title: 'Track 2' }],
  });
});

test('a played Bilibili video lazily exposes its UGC season without replacing playback', async () => {
  const state = createMemoryState();
  const playlistModes = [];
  const resolve = async (_url, options) => {
    playlistModes.push(options.playlistMode);
    if (options.playlistMode) {
      return {
        platform: 'bilibili', type: 'playlist', meta: { title: 'Season fixture' }, currentIndex: 1,
        playlist: [
          { title: 'Episode 1', sourceUrl: 'https://www.bilibili.com/video/BVepisode1' },
          { title: 'Episode 2', sourceUrl: 'https://www.bilibili.com/video/BVepisode2' },
        ],
      };
    }
    return {
      platform: 'bilibili', type: 'video', id: 'BVepisode2',
      streams: [{ quality: '720p', format: 'mp4', codec: 'avc', url: 'https://cdn.example/current.mp4' }],
    };
  };
  const source = encodeURIComponent('https://www.bilibili.com/video/BVepisode2');

  const playResponse = await handleRequest(
    new Request(`http://localhost/play?url=${source}`),
    { state, resolve, clientIp: '203.0.113.11' },
  );
  assert.equal(playResponse.status, 302);
  assert.equal(playResponse.headers.get('location'), 'https://cdn.example/current.mp4');

  const manifestResponse = await handleRequest(
    new Request('http://localhost/api?playlist=1'),
    { state, resolve, clientIp: '203.0.113.11' },
  );
  assert.equal(manifestResponse.status, 200);
  assert.deepEqual(await manifestResponse.json(), {
    type: 'playlist', title: 'Season fixture', count: 2, currentIndex: 1, autoPlay: false,
    entries: [{ title: 'Episode 1' }, { title: 'Episode 2' }],
  });
  assert.deepEqual(playlistModes, [false, true]);
});

test('/playlist returns normalized playlist data for the Unity editor importer', async () => {
  const response = await handleRequest(
    new Request('http://localhost/playlist?url=https%3A%2F%2Fmusic.163.com%2Fplaylist%3Fid%3D789'),
    { resolve: async () => ({
      platform: 'netease',
      type: 'playlist',
      title: 'Fixture playlist',
      playlist: [{ id: '1', title: 'Track 1', url: 'https://vrc2link.example/play?url=song-1' }],
    }) },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    platform: 'netease',
    type: 'playlist',
    title: 'Fixture playlist',
    playlist: [{ id: '1', title: 'Track 1', url: 'https://vrc2link.example/play?url=song-1' }],
  });
});

test('/play and /playlist keep separate cache entries for the same Bilibili video', async () => {
  const state = createMemoryState();
  const playlistModes = [];
  const resolve = async (_url, options) => {
    playlistModes.push(options.playlistMode);
    if (options.playlistMode) {
      return {
        platform: 'bilibili', type: 'playlist', title: 'Season fixture',
        playlist: [{ id: '1', title: 'Episode 1', url: 'https://vrc2link.example/play?url=episode-1' }],
      };
    }
    return {
      platform: 'bilibili', type: 'video', title: 'Episode 1',
      streams: [{ quality: '720p', format: 'mp4', codec: 'avc', url: 'https://cdn.example/video.mp4' }],
    };
  };
  const source = encodeURIComponent('https://www.bilibili.com/video/BV12x3u6iEUM');

  const playResponse = await handleRequest(new Request(`http://localhost/play?url=${source}`), { state, resolve });
  const playlistResponse = await handleRequest(new Request(`http://localhost/playlist?url=${source}`), { state, resolve });

  assert.equal(playResponse.status, 302);
  assert.equal(playlistResponse.status, 200);
  assert.deepEqual(playlistModes, [false, true]);
});
