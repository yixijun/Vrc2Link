import { selectDashTracks } from './dash.js';
import { identifyPlatform, normalizeSourceUrl } from './utils/url.js';

export const PLAYBACK_MODES = Object.freeze(['single', 'dash', 'auto']);

export function assertPlaybackMode(mode) {
  if (!PLAYBACK_MODES.includes(mode)) return false;
  return true;
}

export function playbackModeForSource(requestedMode, sourceUrl, knownPlatform) {
  if (requestedMode === 'dash') return 'dash';
  if (requestedMode !== 'auto') return 'single';
  const platform = knownPlatform || identifyPlatform(normalizeSourceUrl(sourceUrl || ''));
  return platform === 'bilibili' ? 'auto' : 'single';
}

export function usesDashForResult(requestedMode, result, sourceUrl, quality) {
  if (requestedMode === 'dash') return true;
  if (requestedMode !== 'auto') return false;
  const platform = result?.platform || identifyPlatform(normalizeSourceUrl(sourceUrl || ''));
  if (platform !== 'bilibili' || result?.type !== 'video') return false;

  try {
    selectDashTracks(result, quality);
    return true;
  } catch {
    return !hasPlayableSingleStream(result, quality);
  }
}

export function hasPlayableSingleStream(result, quality) {
  return (result?.streams || []).some((stream) =>
    stream.url && stream.type !== 'video-only' && stream.type !== 'audio-only' &&
    (!quality || stream.quality === quality),
  );
}
