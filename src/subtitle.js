import { fetchBilibiliCcSubtitles } from './platforms/bilibili-subtitle.js';

export async function fetchCurrentSubtitle(session, query = {}, options = {}) {
  if (session.platform !== 'bilibili' || session.type !== 'video') {
    return unavailable(session.platform || 'unknown');
  }

  return fetchBilibiliCcSubtitles(session.id, {
    // Bilibili hides many public-video CC tracks from anonymous player APIs
    // responses. The Cookie stays server-side and is only used to read CC data.
    cookie: options.env?.BILIBILI_COOKIE || '',
    state: options.state,
    track: query.track,
    fetcher: options.fetcher,
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
