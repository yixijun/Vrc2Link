import { createHash } from 'node:crypto';

import { fetchWithRetry } from '../utils/http.js';

const SEGMENT_SECONDS = 360;

export async function fetchBilibiliVideoDanmaku(bvid, segment, options = {}) {
  const { cookie = '', state, maxMessages = 300 } = options;
  const cid = await getCid(bvid, { cookie, state });
  const response = await fetchWithRetry(
    `https://api.bilibili.com/x/v2/dm/web/seg.so?${new URLSearchParams({
      type: '1',
      oid: String(cid),
      segment_index: String(segment),
    })}`,
    { platform: 'bilibili', cookie },
  );
  if (!response.ok) throw new Error(`Bilibili danmaku HTTP ${response.status}`);

  const messages = limitMessages(
    decodeBilibiliDmSegment(new Uint8Array(await response.arrayBuffer()))
      .filter((message) => message.text && message.mode >= 1 && message.mode <= 5),
    maxMessages,
  );
  return {
    platform: 'bilibili',
    mode: 'video',
    segment,
    segmentSeconds: SEGMENT_SECONDS,
    messages,
  };
}

export async function fetchBilibiliLiveDanmaku(roomId, options = {}) {
  const { cookie = '', maxMessages = 30 } = options;
  const response = await fetchWithRetry(
    `https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?${new URLSearchParams({
      roomid: String(roomId),
      room_type: '0',
    })}`,
    { platform: 'bilibili', cookie },
  );
  if (!response.ok) throw new Error(`Bilibili live danmaku HTTP ${response.status}`);
  return normalizeBilibiliLiveMessages(await response.json()).slice(-maxMessages);
}

export function decodeBilibiliDmSegment(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const reader = new ProtoReader(bytes);
  const messages = [];

  while (!reader.done) {
    let tag;
    try {
      tag = reader.varintNumber();
    } catch {
      break;
    }
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (field === 1 && wireType === 2) {
      try {
        const element = decodeElement(reader.bytes());
        if (element) messages.push(element);
      } catch {
        // Ignore a malformed entry and continue with later entries.
      }
    } else {
      try {
        reader.skip(wireType);
      } catch {
        // Unknown trailing fields are not needed for rendering danmaku.
        break;
      }
    }
  }
  return messages.filter(Boolean).sort((left, right) => left.time - right.time);
}

export function normalizeBilibiliLiveMessages(payload) {
  const entries = [
    ...(payload?.data?.admin || []),
    ...(payload?.data?.room || []),
  ];
  return entries
    .map((entry) => {
      const text = String(entry?.text || '').trim();
      const user = String(entry?.nickname || entry?.uname || '').trim();
      const identity = `${entry?.uid || ''}\n${entry?.timeline || ''}\n${user}\n${text}`;
      return {
        id: createHash('sha256').update(identity).digest('hex').slice(0, 20),
        user,
        text,
        color: normalizeColor(entry?.color),
      };
    })
    .filter((entry) => entry.text);
}

async function getCid(bvid, options) {
  const cacheKey = `danmaku:cid:${bvid}`;
  const cached = options.state?.getJson(cacheKey);
  if (cached?.cid) return cached.cid;

  const response = await fetchWithRetry(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
    { platform: 'bilibili', cookie: options.cookie },
  );
  const data = (await response.json())?.data;
  if (!data?.cid) throw new Error(`Bilibili video CID not found: ${bvid}`);
  options.state?.setJson(cacheKey, { cid: data.cid }, 86400);
  return data.cid;
}

function decodeElement(bytes) {
  const reader = new ProtoReader(bytes);
  const result = {
    id: '',
    time: 0,
    mode: 1,
    size: 25,
    color: 0xffffff,
    text: '',
  };

  while (!reader.done) {
    const tag = reader.varintNumber();
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (wireType === 0) {
      const value = reader.varint();
      if (field === 1) result.id = value.toString();
      else if (field === 2) result.time = Number(value) / 1000;
      else if (field === 3) result.mode = Number(value);
      else if (field === 4) result.size = Number(value);
      else if (field === 5) result.color = Number(value);
    } else if (wireType === 2) {
      const value = reader.bytes();
      if (field === 7) result.text = cleanText(new TextDecoder().decode(value));
      else if (field === 12) result.id = new TextDecoder().decode(value) || result.id;
    } else {
      reader.skip(wireType);
    }
  }
  return result.text ? result : null;
}

class ProtoReader {
  constructor(bytes) {
    this.bytesValue = bytes;
    this.offset = 0;
  }

  get done() {
    return this.offset >= this.bytesValue.length;
  }

  varint() {
    let value = 0n;
    let shift = 0n;
    while (!this.done && shift <= 70n) {
      const byte = this.bytesValue[this.offset++];
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7n;
    }
    throw new Error('Invalid protobuf varint');
  }

  varintNumber() {
    return Number(this.varint());
  }

  bytes() {
    const length = this.varintNumber();
    const end = this.offset + length;
    if (end > this.bytesValue.length) throw new Error('Invalid protobuf length');
    const value = this.bytesValue.subarray(this.offset, end);
    this.offset = end;
    return value;
  }

  skip(wireType) {
    if (wireType === 0) this.varint();
    else if (wireType === 1) this.offset += 8;
    else if (wireType === 2) this.offset += this.varintNumber();
    // Some Bilibili replies contain a legacy end-group marker. It carries no
    // payload and is safe to ignore while walking the length-delimited entry.
    else if (wireType === 4) return;
    else if (wireType === 5) this.offset += 4;
    else throw new Error(`Unsupported protobuf wire type: ${wireType}`);
    if (this.offset > this.bytesValue.length) throw new Error('Invalid protobuf field');
  }
}

function cleanText(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 120);
}

function normalizeColor(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffffff ? parsed : 0xffffff;
}

function limitMessages(messages, limit) {
  const parsedLimit = Number.parseInt(limit, 10);
  if (!Number.isInteger(parsedLimit) || parsedLimit <= 0 || messages.length <= parsedLimit) {
    return messages;
  }
  const output = [];
  const step = messages.length / parsedLimit;
  for (let index = 0; index < parsedLimit; index++) {
    output.push(messages[Math.floor(index * step)]);
  }
  return output;
}
