import assert from 'node:assert/strict';
import test from 'node:test';

import { createDashTicket, getDashTicket } from '../src/dash.js';
import { handleRequest } from '../src/index.js';
import { createMemoryState } from '../src/state.js';

const SOURCE_URL = 'https://www.bilibili.com/video/BVdashfixture';

function dashMedia(videoUrl = 'https://upos.example/video.m4s', audioUrl = 'https://upos.example/audio.m4s') {
  return {
    platform: 'bilibili',
    type: 'video',
    id: 'BVdashfixture',
    cid: '987654',
    title: 'DASH fixture',
    duration: 91,
    authenticated: false,
    qualities: ['1080p', '192k'],
    streams: [
      {
        type: 'video-only',
        quality: '1080p',
        format: 'mp4',
        codec: 'avc1.640028',
        url: videoUrl,
        backupUrls: ['https://backup.example/video.m4s'],
        bandwidth: 4000000,
        trackId: 80,
        width: 1920,
        height: 1080,
        frameRate: '30',
        mimeType: 'video/mp4',
        initialization: '0-999',
        indexRange: '1000-2000',
      },
      {
        type: 'audio-only',
        quality: '192k',
        format: 'mp4',
        codec: 'mp4a.40.2',
        url: audioUrl,
        bandwidth: 192000,
        trackId: 30280,
        sampleRate: 48000,
        channels: 2,
        mimeType: 'audio/mp4',
        initialization: '0-500',
        indexRange: '501-1000',
      },
    ],
  };
}

test('DASH API creates a ticket and serves MPD and paired redirect endpoints', async () => {
  const state = createMemoryState();
  const resolveCalls = [];
  const resolve = async (url, options) => {
    resolveCalls.push({ url, options });
    return dashMedia();
  };
  const dependencies = {
    state,
    resolve,
    clientIp: '203.0.113.40',
    env: { DASH_TICKET_TTL_SECONDS: '3600' },
  };

  const response = await handleRequest(
    new Request(`http://localhost/api?mode=dash&quality=1080p&url=${encodeURIComponent(SOURCE_URL)}`),
    dependencies,
  );
  assert.equal(response.status, 200);
  assert.equal(resolveCalls.length, 1);
  assert.equal(resolveCalls[0].url, SOURCE_URL);
  assert.equal(resolveCalls[0].options.mode, 'dash');
  assert.equal(resolveCalls[0].options.quality, '1080p');

  const body = await response.json();
  assert.equal(body.dash.mode, 'dash');
  assert.match(body.dash.ticket, /^[A-Za-z0-9_-]{32}$/u);
  assert.match(body.dash.manifestUrl, /\/dash\/[A-Za-z0-9_-]{32}\/manifest\.mpd$/u);
  assert.match(body.dash.videoUrl, /\/video$/u);
  assert.match(body.dash.audioUrl, /\/audio$/u);

  const manifest = await handleRequest(new Request(body.dash.manifestUrl), dependencies);
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers.get('content-type'), 'application/dash+xml; charset=utf-8');
  const mpd = await manifest.text();
  assert.match(mpd, /<AdaptationSet contentType="video"/u);
  assert.match(mpd, /<AdaptationSet contentType="audio"/u);
  assert.match(mpd, /<BaseURL>http:\/\/localhost\/dash\/[^<]+\/video<\/BaseURL>/u);
  assert.match(mpd, /<Initialization range="0-999" \/>/u);
  assert.match(mpd, /<SegmentBase indexRange="1000-2000" startWithSAP="1">/u);
  assert.match(mpd, /<AudioChannelConfiguration[^>]+value="2" \/>/u);

  const videoHead = await handleRequest(new Request(body.dash.videoUrl, { method: 'HEAD' }), dependencies);
  assert.equal(videoHead.status, 302);
  assert.equal(videoHead.headers.get('location'), 'https://upos.example/video.m4s');

  const audio = await handleRequest(new Request(body.dash.audioUrl), dependencies);
  assert.equal(audio.status, 302);
  assert.equal(audio.headers.get('location'), 'https://upos.example/audio.m4s');

  const play = await handleRequest(
    new Request(`http://localhost/play?mode=dash&quality=1080p&url=${encodeURIComponent(SOURCE_URL)}`),
    dependencies,
  );
  assert.equal(play.status, 302);
  assert.equal(play.headers.get('x-stream-format'), 'mpd');
  assert.match(play.headers.get('location'), /\/manifest\.mpd$/u);
});

test('DASH ticket refresh re-resolves only the same source and quality', async () => {
  const state = createMemoryState();
  const calls = [];
  const resolve = async (url, options) => {
    calls.push({ url, options });
    return dashMedia(
      'https://upos.example/fresh-video.m4s?deadline=1999999999',
      'https://upos.example/fresh-audio.m4s?deadline=1999999999',
    );
  };
  const first = await handleRequest(
    new Request(`http://localhost/api?mode=dash&quality=1080p&url=${encodeURIComponent(SOURCE_URL)}`),
    {
      state,
      clientIp: '203.0.113.41',
      env: { DASH_TICKET_TTL_SECONDS: '3600' },
      resolve: async () => dashMedia(
        'https://upos.example/expired-video.m4s?deadline=1',
        'https://upos.example/expired-audio.m4s?deadline=1',
      ),
    },
  );
  const firstBody = await first.json();
  const refreshed = await handleRequest(new Request(firstBody.dash.videoUrl), {
    state,
    clientIp: '203.0.113.41',
    env: { DASH_TICKET_TTL_SECONDS: '3600' },
    resolve,
  });

  assert.equal(refreshed.status, 302);
  assert.equal(refreshed.headers.get('location'), 'https://upos.example/fresh-video.m4s?deadline=1999999999');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SOURCE_URL);
  assert.equal(calls[0].options.mode, 'dash');
  assert.equal(calls[0].options.quality, '1080p');
});

test('DASH refresh rejects a different BV or CID instead of replacing the ticket target', async () => {
  const state = createMemoryState();
  const first = await handleRequest(
    new Request(`http://localhost/api?mode=dash&quality=1080p&url=${encodeURIComponent(SOURCE_URL)}`),
    {
      state,
      clientIp: '203.0.113.42',
      env: { DASH_TICKET_TTL_SECONDS: '3600' },
      resolve: async () => dashMedia(
        'https://upos.example/expired-video.m4s?deadline=1',
        'https://upos.example/expired-audio.m4s?deadline=1',
      ),
    },
  );
  const firstBody = await first.json();
  const resolveDifferentMedia = async () => ({
    ...dashMedia(
      'https://upos.example/other-video.m4s?deadline=1999999999',
      'https://upos.example/other-audio.m4s?deadline=1999999999',
    ),
    id: 'BVdifferent',
    cid: 'different-cid',
  });

  const refreshed = await handleRequest(new Request(firstBody.dash.videoUrl), {
    state,
    clientIp: '203.0.113.42',
    env: { DASH_TICKET_TTL_SECONDS: '3600' },
    resolve: resolveDifferentMedia,
  });

  assert.equal(refreshed.status, 409);
  assert.equal((await refreshed.json()).error.code, 'dash_source_changed');
});

test('DASH ticket expiration is absolute and is not extended by state refreshes', async () => {
  const state = createMemoryState();
  const { ticket } = createDashTicket(state, {
    ticketExpiresAt: Date.now() - 1,
    sourceUrl: SOURCE_URL,
  }, 3600);

  assert.equal(getDashTicket(state, ticket), undefined);
  const response = await handleRequest(
    new Request(`http://localhost/dash/${ticket}/manifest.mpd`),
    { state, env: { DASH_TICKET_TTL_SECONDS: '3600' } },
  );
  assert.equal(response.status, 404);
});

test('DASH mode reports missing separated tracks instead of falling back to a combined stream', async () => {
  const response = await handleRequest(
    new Request(`http://localhost/api?mode=dash&quality=1080p&url=${encodeURIComponent(SOURCE_URL)}`),
    {
      resolve: async () => ({
        platform: 'bilibili',
        type: 'video',
        id: 'BVdashfixture',
        cid: '987654',
        streams: [{
          type: 'combined',
          quality: '720p',
          format: 'mp4',
          codec: 'avc1',
          url: 'https://upos.example/combined.mp4',
        }],
      }),
    },
  );

  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, 'quality_unavailable');
});

test('DASH capability lasts for the video duration plus a playback margin', async () => {
  const state = createMemoryState();
  const response = await handleRequest(new Request(
    `http://localhost/play?mode=dash&url=${encodeURIComponent(SOURCE_URL)}`,
  ), {
    state,
    resolve: async () => ({ ...dashMedia(), duration: 7200 }),
  });
  assert.equal(response.status, 302);
  const ticket = response.headers.get('location').match(/\/dash\/([A-Za-z0-9_-]{32})\/manifest\.mpd$/u)?.[1];
  const record = getDashTicket(state, ticket);
  assert.ok(record.ticketExpiresAt >= record.createdAt + (7200 + 300 - 1) * 1000);
});
