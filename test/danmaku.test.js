import assert from 'node:assert/strict';
import test from 'node:test';

import { handleRequest } from '../src/index.js';
import {
  decodeBilibiliDmSegment,
  normalizeBilibiliLiveMessages,
} from '../src/platforms/bilibili-danmaku.js';
import { createMemoryState } from '../src/state.js';

const SOURCE_URL = 'https://www.bilibili.com/video/BV1fixture';
const MEDIA = {
  platform: 'bilibili',
  type: 'video',
  id: 'BV1fixture',
  title: 'Fixture',
  duration: 720,
  streams: [
    { quality: '720p', format: 'mp4', codec: 'avc', url: 'https://cdn.example/video.mp4' },
  ],
};

test('/play binds the current media and /danmaku/current uses that session', async () => {
  const state = createMemoryState();
  let receivedSession;
  let receivedQuery;
  const dependencies = {
    state,
    clientIp: '203.0.113.9',
    resolve: async () => MEDIA,
    fetchDanmaku: async (session, query) => {
      receivedSession = session;
      receivedQuery = query;
      return {
        platform: 'bilibili',
        mode: 'video',
        segment: query.segment,
        messages: [{ id: '1', time: 721.5, text: 'hello', color: 0xffffff }],
      };
    },
  };

  const play = await handleRequest(new Request(
    `http://localhost/play?url=${encodeURIComponent(SOURCE_URL)}`,
  ), dependencies);
  assert.equal(play.status, 302);

  const danmaku = await handleRequest(
    new Request('http://localhost/danmaku/current?segment=2'),
    dependencies,
  );
  assert.equal(danmaku.status, 200);
  assert.equal(receivedSession.platform, 'bilibili');
  assert.equal(receivedSession.type, 'video');
  assert.equal(receivedSession.id, 'BV1fixture');
  assert.equal(receivedSession.sourceUrl, SOURCE_URL);
  assert.deepEqual(receivedQuery, { segment: 2, live: false });
  assert.equal((await danmaku.json()).messages[0].text, 'hello');

  const unified = await handleRequest(
    new Request('http://localhost/api?danmaku=1&segment=2'),
    dependencies,
  );
  assert.equal(unified.status, 200);
  assert.equal((await unified.json()).messages[0].text, 'hello');

  const mediaWithDanmaku = await handleRequest(new Request(
    `http://localhost/api?danmaku=1&segment=2&url=${encodeURIComponent(SOURCE_URL)}`,
  ), dependencies);
  assert.equal(mediaWithDanmaku.status, 200);
  const combined = await mediaWithDanmaku.json();
  assert.equal(combined.platform, 'bilibili');
  assert.equal(combined.danmaku.messages[0].text, 'hello');
});

test('compact video danmaku uses arrays and samples the complete segment', async () => {
  const state = createMemoryState();
  const messages = Array.from({ length: 300 }, (_, index) => ({
    id: String(index + 1),
    time: index * 1.2,
    text: `message-${index + 1}`,
    color: 0xff0000 + index,
  }));
  const dependencies = {
    state,
    clientIp: '203.0.113.19',
    resolve: async () => MEDIA,
    fetchDanmaku: async () => ({
      platform: 'bilibili',
      mode: 'video',
      segment: 1,
      segmentSeconds: 360,
      messages,
    }),
  };

  await handleRequest(new Request(
    `http://localhost/play?url=${encodeURIComponent(SOURCE_URL)}`,
  ), dependencies);

  const response = await handleRequest(
    new Request('http://localhost/api?danmaku=1&segment=1&compact=1'),
    dependencies,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.compact, true);
  assert.equal(body.messages.length, 120);
  assert.deepEqual(body.messages[0], [0, 'message-1', 0xff0000]);
  assert.deepEqual(body.messages.at(-1), [358.8, 'message-300', 0xff0000 + 299]);

  const normal = await handleRequest(
    new Request('http://localhost/api?danmaku=1&segment=1'),
    dependencies,
  );
  const normalBody = await normal.json();
  assert.equal(normalBody.compact, undefined);
  assert.equal(normalBody.messages.length, 300);
  assert.deepEqual(normalBody.messages[0], messages[0]);
});

test('/danmaku/current rejects clients without a recent /play request', async () => {
  const response = await handleRequest(
    new Request('http://localhost/danmaku/current?live=1'),
    { state: createMemoryState(), clientIp: '198.51.100.4' },
  );

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'no_danmaku_session');
});

test('Bilibili protobuf video segments decode the fields used by Unity', () => {
  const element = concat(
    varintField(1, 123456789n),
    varintField(2, 721500),
    varintField(3, 1),
    varintField(4, 25),
    varintField(5, 0xff66aa),
    stringField(7, '测试弹幕'),
    stringField(12, '123456789'),
  );
  const reply = bytesField(1, element);

  assert.deepEqual(decodeBilibiliDmSegment(reply), [{
    id: '123456789',
    time: 721.5,
    mode: 1,
    size: 25,
    color: 0xff66aa,
    text: '测试弹幕',
  }]);
});

test('Bilibili protobuf decoding keeps valid messages before unknown trailing fields', () => {
  const element = concat(
    varintField(1, 42),
    varintField(2, 1500),
    varintField(3, 1),
    stringField(7, 'hello'),
  );
  const reply = concat(bytesField(1, element), Uint8Array.of(0x0f));

  assert.deepEqual(decodeBilibiliDmSegment(reply), [{
    id: '42',
    time: 1.5,
    mode: 1,
    size: 25,
    color: 0xffffff,
    text: 'hello',
  }]);
});

test('Bilibili live history is normalized and assigned stable IDs', () => {
  const payload = {
    data: {
      room: [{
        uid: 42,
        nickname: 'Alice',
        text: 'Live hello',
        timeline: '2026-07-29 10:00:00',
        color: 16711680,
      }],
    },
  };

  const first = normalizeBilibiliLiveMessages(payload);
  const second = normalizeBilibiliLiveMessages(payload);
  assert.equal(first.length, 1);
  assert.equal(first[0].id, second[0].id);
  assert.equal(first[0].user, 'Alice');
  assert.equal(first[0].text, 'Live hello');
  assert.equal(first[0].color, 16711680);
});


function varintField(field, value) {
  return concat(varint(BigInt(field << 3)), varint(BigInt(value)));
}

function stringField(field, value) {
  return bytesField(field, new TextEncoder().encode(value));
}

function bytesField(field, value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return concat(varint(BigInt((field << 3) | 2)), varint(BigInt(bytes.length)), bytes);
}

function varint(value) {
  const output = [];
  let remaining = BigInt(value);
  while (remaining >= 0x80n) {
    output.push(Number((remaining & 0x7fn) | 0x80n));
    remaining >>= 7n;
  }
  output.push(Number(remaining));
  return Uint8Array.from(output);
}

function concat(...arrays) {
  const result = new Uint8Array(arrays.reduce((total, item) => total + item.length, 0));
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}
