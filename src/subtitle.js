import { fetchBilibiliCcSubtitles } from './platforms/bilibili-subtitle.js';

export async function fetchCurrentSubtitle(session, query = {}, options = {}) {
  if (session.platform !== 'bilibili' || session.type !== 'video') {
    return unavailable(session.platform || 'unknown');
  }

  return fetchBilibiliCcSubtitles(session.id, {
    cookie: session.authenticated ? options.env?.BILIBILI_COOKIE || '' : '',
    state: options.state,
    track: query.track,
  });
}

function unavailable(platform) {
  return {
    available: false,
    platform,
    source: '',
    language: '',
    languageName: '',
    cues: [],
  };
}
