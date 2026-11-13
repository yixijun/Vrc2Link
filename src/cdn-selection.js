import { isBilibiliCdnUrl } from './utils/cdn.js';

export async function choosePlayableCdn(stream, result) {
  if (!stream || result?.platform !== 'bilibili' || !stream.backupUrls?.length) return stream;
  const candidates = [stream.url, ...stream.backupUrls]
    .filter(isBilibiliCdnUrl)
    .slice(0, 8);
  if (candidates.length < 2) return stream;

  const available = await Promise.all(candidates.map(probeBilibiliCdn));
  const selected = candidates.find((_candidate, index) => available[index]);
  if (!selected) return stream;
  return {
    ...stream,
    url: selected,
    backupUrls: candidates.filter((candidate) => candidate !== selected),
  };
}

async function probeBilibiliCdn(url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Range: 'bytes=0-1',
        Referer: 'https://www.bilibili.com/',
        'User-Agent': 'Mozilla/5.0',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(2500),
    });
    response.body?.cancel().catch(() => {});
    return response.status === 200 || response.status === 206;
  } catch {
    return false;
  }
}
