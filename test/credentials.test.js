import assert from 'node:assert/strict';
import test from 'node:test';

import { handleRequest } from '../src/index.js';
import { fetchCurrentDanmaku } from '../src/danmaku.js';
import { createMemoryState } from '../src/state.js';
import { hashIdentity } from '../src/rate-limit.js';

const MASTER_KEY = '47'.repeat(32);
const COOKIE = 'SESSDATA=private-fixture; bili_jct=csrf-fixture';
const VIDEO_URL = 'https://www.bilibili.com/video/BVv1fixture';

test('credential keys are one-time, hashed, encrypted, and authorize content-bound player tickets', async () => {
  const state = createMemoryState();
  const env = { CK_MASTER_KEY: MASTER_KEY, RATE_LIMIT_ANON_PER_MINUTE: '50' };
  const clientIp = '203.0.113.72';
  const resolveOptions = [];
  const logs = [];

  const create = await handleRequest(new Request('https://vrc2link.example/api/v1/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookie: COOKIE, retentionDays: 7 }),
  }), { state, env, clientIp, logger: (entry) => logs.push(entry) });
  assert.equal(create.status, 201);
  const credential = (await create.json()).data;
  assert.equal(credential.revealOnce, true);
  assert.equal(credential.retentionDays, 7);
  const profileId = credential.key.match(/^v2l_([^_]+)_/u)[1];
  const storedProfile = state.getJson(`credential:${profileId}`);
  assert.ok(storedProfile);
  assert.equal(JSON.stringify(storedProfile).includes(COOKIE), false);
  assert.notEqual(storedProfile.keyHash, credential.key);

  const ticketResponse = await handleRequest(new Request('https://vrc2link.example/api/v1/playback-tickets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credential.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: VIDEO_URL, mode: 'auto', quality: '1080p' }),
  }), { state, env, clientIp, logger: (entry) => logs.push(entry) });
  assert.equal(ticketResponse.status, 200);
  const ticket = (await ticketResponse.json()).data;
  assert.match(ticket.playUrl, /^https:\/\/vrc2link\.luonako\.cn\/api\/v1\/playback-tickets\/[A-Za-z0-9_-]{43}\/play$/u);
  assert.equal(ticket.playUrl.includes(credential.key), false);
  assert.equal(ticket.expiresInSeconds, 3600);

  const playResponse = await handleRequest(new Request(ticket.playUrl), {
    state,
    env,
    clientIp,
    resolve: async (_url, options) => {
      resolveOptions.push(options);
      return {
        platform: 'bilibili',
        type: 'video',
        id: 'BVv1fixture',
        authenticated: options.authenticated,
        streams: [
          { quality: '720p', format: 'mp4', codec: 'avc', url: 'https://cdn.example/muxed-720p.mp4' },
          { type: 'video-only', quality: '1080p', format: 'mp4', codec: 'avc1.640028', url: 'https://cdn.example/video.m4s' },
          { type: 'audio-only', quality: '192k', format: 'mp4', codec: 'mp4a.40.2', url: 'https://cdn.example/audio.m4s' },
        ],
      };
    },
    logger: (entry) => logs.push(entry),
  });
  assert.equal(playResponse.status, 302);
  assert.match(playResponse.headers.get('location'), /^https:\/\/vrc2link\.luonako\.cn\/api\/v1\/dash\/[A-Za-z0-9_-]{32}\/manifest\.mpd$/u);
  assert.equal(playResponse.headers.get('X-Stream-Format'), 'mpd');
  assert.equal(playResponse.headers.get('X-Stream-Quality'), '1080p');
  assert.equal(resolveOptions[0].authenticated, true);
  assert.equal(resolveOptions[0].cookies.bilibili, COOKIE);
  assert.equal(logs.some((entry) => entry.path.includes(credential.key)), false);
  assert.ok(logs.some((entry) => entry.path === '/api/v1/playback-tickets/:ticket/play'));
  assert.equal(state.getJson(`danmaku:session:${hashIdentity(clientIp)}`).profileId, profileId);

  const rotation = await handleRequest(new Request('https://vrc2link.example/api/v1/credentials/current/rotate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential.key}` },
  }), { state, env, clientIp });
  assert.equal(rotation.status, 200);
  const replacementKey = (await rotation.json()).data.key;
  assert.notEqual(replacementKey, credential.key);
  const oldKeyTicket = await handleRequest(new Request('https://vrc2link.example/api/v1/playback-tickets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: VIDEO_URL }),
  }), { state, env, clientIp });
  assert.equal(oldKeyTicket.status, 401);

  const revoked = await handleRequest(new Request('https://vrc2link.example/api/v1/credentials/current', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${replacementKey}` },
  }), { state, env, clientIp });
  assert.equal(revoked.status, 200);

  const afterRevocation = await handleRequest(new Request(ticket.playUrl), { state, env, clientIp });
  assert.equal(afterRevocation.status, 401);
  assert.equal((await afterRevocation.json()).error.code, 'credential_revoked');
});

test('DASH refresh keeps using the profile CK and checks revocation before serving ticket assets', async () => {
  const state = createMemoryState();
  const env = { CK_MASTER_KEY: MASTER_KEY, RATE_LIMIT_ANON_PER_MINUTE: '50' };
  const clientIp = '203.0.113.76';
  const calls = [];
  const create = await handleRequest(new Request('https://vrc2link.example/api/v1/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookie: COOKIE, retentionDays: 1 }),
  }), { state, env, clientIp });
  const key = (await create.json()).data.key;
  const ticketResponse = await handleRequest(new Request('https://vrc2link.example/api/v1/playback-tickets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: VIDEO_URL, mode: 'dash', quality: '1080p' }),
  }), { state, env, clientIp });
  const playUrl = (await ticketResponse.json()).data.playUrl;
  const dependencies = {
    state,
    env,
    clientIp,
    resolve: async (url, options) => {
      calls.push({ url, options });
      return {
        platform: 'bilibili', type: 'video', id: 'BVv1fixture', cid: '888', authenticated: options.authenticated,
        streams: [
          { type: 'video-only', quality: '1080p', format: 'mp4', codec: 'avc1.640028', url: calls.length === 1 ? 'https://cdn.example/video.m4s?deadline=1' : 'https://cdn.example/fresh-video.m4s?deadline=1999999999', bandwidth: 1, width: 1920, height: 1080 },
          { type: 'audio-only', quality: '192k', format: 'mp4', codec: 'mp4a.40.2', url: calls.length === 1 ? 'https://cdn.example/audio.m4s?deadline=1' : 'https://cdn.example/fresh-audio.m4s?deadline=1999999999', bandwidth: 1 },
        ],
      };
    },
  };
  const play = await handleRequest(new Request(playUrl), dependencies);
  assert.equal(play.status, 302);
  const manifestUrl = play.headers.get('location');
  const manifest = await handleRequest(new Request(manifestUrl), dependencies);
  assert.equal(manifest.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.cookies.bilibili, COOKIE);

  const remove = await handleRequest(new Request('https://vrc2link.example/api/v1/credentials/current', {
    method: 'DELETE', headers: { Authorization: `Bearer ${key}` },
  }), { state, env, clientIp });
  assert.equal(remove.status, 200);
  const rejected = await handleRequest(new Request(manifestUrl), dependencies);
  assert.equal(rejected.status, 401);
  assert.equal((await rejected.json()).error.code, 'credential_revoked');
});

test('playlist tickets preserve their CK profile through item switching', async () => {
  const state = createMemoryState();
  const env = { CK_MASTER_KEY: MASTER_KEY, RATE_LIMIT_ANON_PER_MINUTE: '50' };
  const clientIp = '203.0.113.73';
  const receivedCookies = [];
  const create = await handleRequest(new Request('https://vrc2link.example/api/v1/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookie: COOKIE, retentionDays: 3 }),
  }), { state, env, clientIp });
  const key = (await create.json()).data.key;
  const createTicket = await handleRequest(new Request('https://vrc2link.example/api/v1/playback-tickets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.bilibili.com/list/455?bvid=BVv1fixture', mode: 'auto' }),
  }), { state, env, clientIp });
  assert.equal(createTicket.status, 200);
  const playUrl = (await createTicket.json()).data.playUrl;

  const dependencies = {
    state,
    env,
    clientIp,
    resolve: async (url, options) => {
      receivedCookies.push(options.cookies.bilibili);
      if (url.includes('/list/')) {
        return {
          platform: 'bilibili', type: 'playlist', authenticated: true,
          currentIndex: 0, meta: { title: 'Fixture list' },
          playlist: [
            { title: 'One', sourceUrl: VIDEO_URL },
            { title: 'Two', sourceUrl: 'https://www.bilibili.com/video/BVv2fixture' },
          ],
        };
      }
      return {
        platform: 'bilibili', type: 'video', id: url.includes('BVv2') ? 'BVv2fixture' : 'BVv1fixture',
        authenticated: options.authenticated,
        streams: [{ quality: '720p', format: 'mp4', codec: 'avc', url: 'https://cdn.example/video.mp4' }],
      };
    },
  };

  const play = await handleRequest(new Request(playUrl), dependencies);
  assert.equal(play.status, 302);
  const next = await handleRequest(new Request('https://vrc2link.example/api/v1/playlists/current/items/1'), dependencies);
  assert.equal(next.status, 302);
  assert.deepEqual(receivedCookies, [COOKIE, COOKIE, COOKIE]);
  assert.equal(state.getJson(`danmaku:session:${hashIdentity(clientIp)}`).profileId,
    key.match(/^v2l_([^_]+)_/u)[1]);
});

test('danmaku fetch decrypts the cookie bound to the current credential profile', async () => {
  const state = createMemoryState();
  const env = { CK_MASTER_KEY: MASTER_KEY, RATE_LIMIT_ANON_PER_MINUTE: '50' };
  const create = await handleRequest(new Request('https://vrc2link.example/api/v1/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookie: COOKIE, retentionDays: 1 }),
  }), { state, env, clientIp: '203.0.113.74' });
  const key = (await create.json()).data.key;
  const ticketResponse = await handleRequest(new Request('https://vrc2link.example/api/v1/playback-tickets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: VIDEO_URL }),
  }), { state, env, clientIp: '203.0.113.74' });
  const playUrl = (await ticketResponse.json()).data.playUrl;
  await handleRequest(new Request(playUrl), {
    state,
    env,
    clientIp: '203.0.113.74',
    resolve: async (_url, options) => ({
      platform: 'bilibili', type: 'video', id: 'BVv1fixture', authenticated: options.authenticated,
      streams: [{ quality: '720p', format: 'mp4', codec: 'avc', url: 'https://cdn.example/video.mp4' }],
    }),
  });

  const originalFetch = globalThis.fetch;
  const seenCookies = [];
  globalThis.fetch = async (url, init) => {
    seenCookies.push(new Headers(init.headers).get('cookie'));
    if (String(url).includes('/x/web-interface/view')) {
      return new Response(JSON.stringify({ data: { cid: 888 } }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(new Uint8Array());
  };
  try {
    const session = state.getJson(`danmaku:session:${hashIdentity('203.0.113.74')}`);
    const result = await fetchCurrentDanmaku(session, { segment: 1, live: false }, { state, env });
    assert.equal(result.mode, 'video');
    assert.deepEqual(seenCookies, [COOKIE, COOKIE]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('credential creation validates retention and the encryption master key', async () => {
  const request = (body) => new Request('https://vrc2link.example/api/v1/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const state = createMemoryState();
  const invalidRetention = await handleRequest(request({ cookie: COOKIE, retentionDays: 366 }), {
    state, env: { CK_MASTER_KEY: MASTER_KEY }, clientIp: '203.0.113.75',
  });
  assert.equal(invalidRetention.status, 400);
  assert.equal((await invalidRetention.json()).error.code, 'invalid_retention_days');

  const missingMasterKey = await handleRequest(request({ cookie: COOKIE, retentionDays: 7 }), {
    state, env: {}, clientIp: '203.0.113.75',
  });
  assert.equal(missingMasterKey.status, 503);
  assert.equal((await missingMasterKey.json()).error.code, 'credential_encryption_unavailable');
});
