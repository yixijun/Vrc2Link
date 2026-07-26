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

    // Sort streams by quality (best first)
    const sorted = [...result.streams];
    if (result.type === 'live') {
      // HLS first
      sorted.sort((a, b) => (b.format === 'm3u8' ? 1 : 0) - (a.format === 'm3u8' ? 1 : 0));
    } else if (result.type === 'song') {
      sorted.sort((a, b) => {
        const ranks = { lossless: 4, '320k': 3, '256k': 2, '128k': 1 };
        return (ranks[b.quality] || 0) - (ranks[a.quality] || 0);
      });
    } else {
      sorted.sort((a, b) => {
        const ranks = { '8k': 7, '4k': 6, '2k': 5, '1080p': 4, '720p': 3, '480p': 2, '360p': 1 };
        return (ranks[b.quality] || 0) - (ranks[a.quality] || 0);
      });
    }

    // Probe CDN URLs without Referer to filter out ones that will 403
    let chosen = null;
    for (const stream of sorted) {
      if (!stream.url) continue;
      if (targetQuality && stream.quality !== targetQuality) continue;

      const ok = await probeUrl(stream.url);
      if (ok) {
        chosen = stream;
        break;
      }
      console.log(`[redirect] skipped ${stream.quality} ${stream.format}: CDN unreachable without Referer`);
    }

    if (!chosen) {
      // All probed URLs failed — fall back to first available anyway
      chosen = sorted.find(s => s.url);
      if (!chosen) return textError('No suitable stream found');
      console.log(`[redirect] ⚠ all CDN URLs failed probe, using ${chosen.quality} anyway`);
    }

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

/**
 * Quick HEAD probe to check if a CDN URL works WITHOUT Referer/Origin.
 * Simulates VRChat's request behavior. Returns true if 2xx.
 */
async function probeUrl(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch(url, {
      method: 'HEAD',
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'VRChat/1.0 (Unity)',
        // Deliberately NO Referer, NO Origin — VRChat doesn't send them
      },
    });
    clearTimeout(t);
    return resp.ok;
  } catch {
    return false;
  }
}
