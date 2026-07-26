/**
 * Unified quality label mapping across platforms.
 *
 * Quality tiers (UI-friendly labels):
 *   8k, 4k, 2k, 1080p, 720p, 480p, 360p
 *   lossless, 320k, 256k, 128k
 */

const MAX_VIDEO_QUALITY = '2k';

// Priority order: higher index = higher quality
const VIDEO_QUALITY_RANK = ['360p', '480p', '720p', '1080p', '2k', '4k', '8k'];
const AUDIO_QUALITY_RANK = ['128k', '256k', '320k', 'lossless'];

// --- Bilibili qn (quality number) mappings ---
const BILIBILI_QN_MAP = {
  16: '360p',
  32: '480p',
  64: '720p',
  80: '1080p',
  112: '1080p',  // 高码率 1080p+
  116: '1080p',  // 1080p60
  120: '4k',
  125: '4k',     // HDR
  126: '4k',     // 杜比
  127: '8k',
};

const QUALITY_TO_BILIBILI_QN = {
  '360p': 16,
  '480p': 32,
  '720p': 64,
  '1080p': 80,
  '2k': 120,     // 4K qn, but will be capped
  '4k': 120,
  '8k': 127,
};

// --- Netease br (bitrate) mappings ---
const NETEASE_BR_MAP = {
  128000: '128k',
  192000: '192k', // intermediate
  256000: '256k', // "higher"
  320000: '320k', // "exhigh"
  999000: 'lossless', // flac / HR
};

const NETEASE_MV_RESOLUTION = {
  240: '360p',
  480: '480p',
  720: '720p',
  1080: '1080p',
};

/**
 * Map Bilibili qn value to unified quality label.
 * @param {number} qn
 * @returns {string}
 */
export function bilibiliQuality(qn) {
  return BILIBILI_QN_MAP[qn] || `${qn}`;
}

/**
 * Map Netease br value to unified quality label.
 * @param {number} br
 * @returns {string}
 */
export function neteaseQuality(br) {
  return NETEASE_BR_MAP[br] || `${Math.round(br / 1000)}k`;
}

/**
 * Map Netease MV resolution to unified label.
 * @param {number} r
 * @returns {string}
 */
export function neteaseMvQuality(r) {
  return NETEASE_MV_RESOLUTION[r] || `${r}p`;
}

/**
 * Pick the best quality up to the max allowed.
 * @param {string[]} available - quality labels available
 * @param {string} [max='2k'] - cap
 * @returns {string|null}
 */
export function pickBestQuality(available, max = MAX_VIDEO_QUALITY) {
  const maxRank = VIDEO_QUALITY_RANK.indexOf(max);
  if (maxRank === -1) return available[0] || null;

  let best = null;
  let bestRank = -1;
  for (const q of available) {
    const rank = VIDEO_QUALITY_RANK.indexOf(q);
    if (rank !== -1 && rank <= maxRank && rank > bestRank) {
      best = q;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * Pick best audio quality.
 * @param {string[]} available
 * @returns {string|null}
 */
export function pickBestAudioQuality(available) {
  for (let i = AUDIO_QUALITY_RANK.length - 1; i >= 0; i--) {
    if (available.includes(AUDIO_QUALITY_RANK[i])) return AUDIO_QUALITY_RANK[i];
  }
  return available[0] || null;
}

/**
 * Get the Bilibili qn value for a target quality, capped at max.
 * @param {string} target
 * @param {string} [max='2k']
 * @returns {number}
 */
export function bilibiliQnForQuality(target, max = MAX_VIDEO_QUALITY) {
  const targetRank = VIDEO_QUALITY_RANK.indexOf(target);
  const maxRank = VIDEO_QUALITY_RANK.indexOf(max);
  const effective = targetRank <= maxRank ? target : max;
  return QUALITY_TO_BILIBILI_QN[effective] || 80;
}
