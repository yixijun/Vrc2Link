import { AppError } from './errors.js';
import {
  fetchBilibiliLiveDanmaku,
  fetchBilibiliVideoDanmaku,
} from './platforms/bilibili-danmaku.js';

export async function fetchCurrentDanmaku(session, query, options = {}) {
  const env = options.env || process.env;
  const state = options.state;
  const identity = options.clientIdentity || 'unknown';
  const maxVideoMessages = positiveInteger(env.DANMAKU_MAX_VIDEO_MESSAGES, 300);
  const maxLiveMessages = positiveInteger(env.DANMAKU_MAX_LIVE_MESSAGES, 30);

  if (session.platform === 'bilibili' && session.type === 'video') {
    if (query.live) throw unsupportedMode();
    return fetchBilibiliVideoDanmaku(session.id, query.segment, {
      cookie: session.authenticated ? env.BILIBILI_COOKIE || '' : '',
      state,
      maxMessages: maxVideoMessages,
    });
  }

  let fetched;
  if (session.platform === 'bilibili' && session.type === 'live') {
    if (!query.live) throw unsupportedMode();
    fetched = {
      messages: await fetchBilibiliLiveDanmaku(session.id, {
        cookie: session.authenticated ? env.BILIBILI_COOKIE || '' : '',
        maxMessages: maxLiveMessages,
      }),
    };
  } else {
    throw new AppError(422, 'danmaku_unsupported', 'Danmaku is unavailable for the current media');
  }

  return {
    platform: session.platform,
    mode: 'live',
    messages: removeSeen(fetched.messages, session, identity, state, maxLiveMessages),
  };
}

function removeSeen(messages, session, identity, state, limit) {
  if (!state) return messages.slice(-limit);
  const key = `danmaku:seen:${identity}:${session.platform}:${session.id}`;
  const previous = state.getJson(key)?.ids || [];
  const seen = new Set(previous);
  const fresh = messages.filter((message) => !seen.has(message.id)).slice(-limit);
  const ids = [...previous, ...messages.map((message) => message.id)].slice(-256);
  state.setJson(key, { ids }, 21600);
  return fresh;
}

function unsupportedMode() {
  return new AppError(422, 'danmaku_mode_mismatch', 'Danmaku mode does not match the current media');
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
