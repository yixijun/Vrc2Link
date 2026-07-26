/**
 * GET /r?url=<encoded>&quality=<optional>&cookie=<optional>
 * 302 redirect to best direct stream URL.
 */

import { identifyPlatform, extractId, expandShortLink } from '../utils/url.js';
import { extractCookie, maskCookie } from '../utils/cookie.js';
import { parseVideo, parseLive } from '../platforms/bilibili.js';
import { parseSong, parseMv } from '../platforms/netease.js';
import { pickBestQuality, pickBestAudioQuality } from '../utils/quality.js';

export async function handleRedirect(request) {
  const url = new URL(request.url);
  const rawUrl = url.searchParams.get('url');
  const targetQuality = url.searchParams.get('quality');
  const platformOverride = url.searchParams.get('platform');
  const cookie = extractCookie(request);

  if (!rawUrl) return textError('Missing required parameter: url');

  let target = rawUrl.trim();
  console.log(`[redirect] url=${target} quality=${targetQuality || 'best'} cookie=${maskCookie(cookie)}`);

  try { target = await expandShortLink(target); } catch (err) {
    return textError(`Failed to resolve short link: ${err.message}`);
  }

  const platform = platformOverride || identifyPlatform(target);
  if (!platform) return textError('Unsupported platform');

  const extracted = extractId(target, platform);
  if (!extracted) return textError(`Could not parse URL: ${target}`);

  try {
    let result;
    if (platform === 'bilibili') {
      result = extracted.type === 'live'
        ? await parseLive(extracted.id, { cookie })
        : await parseVideo(extracted.id, { cookie });
    } else {
      result = extracted.type === 'mv'
        ? await parseMv(extracted.id, { cookie })
        : await parseSong(extracted.id, { cookie });
    }

    if (!result.streams?.length) return textError('No playable streams found');

    // Pick best stream
    let chosen;
    if (result.type === 'live') {
      chosen = result.streams.find(s => s.format === 'm3u8') || result.streams[0];
    } else if (result.type === 'song') {
      const best = pickBestAudioQuality(result.streams.map(s => s.quality));
      chosen = result.streams.find(s => s.quality === best) || result.streams[0];
    } else {
      if (targetQuality) chosen = result.streams.find(s => s.quality === targetQuality);
      if (!chosen) {
        const best = pickBestQuality(result.streams.map(s => s.quality));
        chosen = result.streams.find(s => s.quality === best) || result.streams[0];
      }
    }

    if (!chosen?.url) return textError('No suitable stream found');

    console.log(`[redirect] → ${chosen.quality} ${chosen.format}`);
    return new Response(null, {
      status: 302,
      headers: {
        Location: chosen.url,
        'X-Stream-Quality': chosen.quality,
        'X-Stream-Format': chosen.format,
      },
    });
  } catch (err) {
    console.error(`[redirect] error: ${err.message}`);
    return textError(`Upstream error: ${err.message}`);
  }
}

function textError(msg) {
  return new Response(`Error: ${msg}\n`, {
    status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
