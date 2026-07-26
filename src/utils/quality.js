const VIDEO_QUALITY_RANK = ['360p', '480p', '720p', '1080p', '4k', '8k', 'original'];
const AUDIO_QUALITY_RANK = ['128k', '192k', '256k', '320k', 'lossless'];

const BILIBILI_QN_MAP = {
  16: '360p',
  32: '480p',
  64: '720p',
  80: '1080p',
  112: '1080p',
  116: '1080p',
  120: '4k',
  125: '4k',
  126: '4k',
  127: '8k',
};

const QUALITY_TO_BILIBILI_QN = {
  '360p': 16,
  '480p': 32,
  '720p': 64,
  '1080p': 80,
  '4k': 120,
  '8k': 127,
};

const NETEASE_BR_MAP = {
  128000: '128k',
  192000: '192k',
  256000: '256k',
  320000: '320k',
  999000: 'lossless',
};

const NETEASE_MV_RESOLUTION = {
  240: '360p',
  480: '480p',
  720: '720p',
  1080: '1080p',
};

export function bilibiliQuality(qn) {
  return BILIBILI_QN_MAP[qn] || String(qn);
}

export function bilibiliQnForQuality(quality) {
  return QUALITY_TO_BILIBILI_QN[quality] || 127;
}

export function neteaseQuality(bitrate) {
  return NETEASE_BR_MAP[bitrate] || `${Math.round(bitrate / 1000)}k`;
}

export function neteaseMvQuality(resolution) {
  return NETEASE_MV_RESOLUTION[resolution] || `${resolution}p`;
}

export function qualityRank(quality) {
  const videoRank = VIDEO_QUALITY_RANK.indexOf(quality);
  if (videoRank !== -1) return 100 + videoRank;
  return AUDIO_QUALITY_RANK.indexOf(quality);
}
