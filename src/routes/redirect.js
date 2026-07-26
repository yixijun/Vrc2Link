/**
 * GET /r?url=<encoded>&quality=<optional>&cookie=<optional>&platform=<optional>
 *
 * 302 redirects to the best direct stream URL.
 * For VRChat players that just need a direct URL to paste in.
 */

import { identifyPlatform, extractId, expandShortLink } from '../utils/url.js';
import { extractCookie, maskCookie } from '../utils/cookie.js';
import { parseVideo, parseLive } from '../platforms/bilibili.js';
import { parseSong, parseMv } from '../platforms/netease.js';
import { pickBestQuality, pickBestAudioQuality } from '../utils/quality.js';

/**
 * Handle the /r redirect route.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function handleRedirect(request) {
  const url = new URL(request.url);
  const rawUrl = url.searchParams.get('url');
  const targetQuality = url.searchParams.get('quality') || null;
  const platformOverride = url.searchParams.get('platform');
  const cookie = extractCookie(request);
  const forwardIp = request.headers.get('CF-Connecting-IP') || '';

  if (!rawUrl) {
    return redirectError('Missing required parameter: url');
  }

  let targetUrl = rawUrl.trim();

  console.log(`[redirect] url=${targetUrl} quality=${targetQuality || 'best'} cookie=${maskCookie(cookie)}`);

  // Expand short links
  try {
    targetUrl = await expandShortLink(targetUrl);
  } catch (err) {
    return redirectError(`Failed to resolve short link: ${err.message}`);
  }

  // Identify platform
  const platform = platformOverride || identifyPlatform(targetUrl);
  if (!platform) {
    return redirectError('Unsupported platform');
  }

  // Extract ID
  const extracted = extractId(targetUrl, platform);
  if (!extracted) {
    return redirectError(`Could not parse URL: ${targetUrl}`);
  }

  // Parse
  try {
    let result;

    if (platform === 'bilibili') {
      if (extracted.type === 'live') {
        result = await parseLive(extracted.id, { cookie, forwardIp });
      } else {
        result = await parseVideo(extracted.id, { cookie, forwardIp });
      }
    } else if (platform === 'netease') {
      if (extracted.type === 'mv') {
        result = await parseMv(extracted.id, { cookie, forwardIp });
      } else {
        result = await parseSong(extracted.id, { cookie, forwardIp });
      }
    }

    if (!result.streams || result.streams.length === 0) {
      return redirectError('No playable streams found');
    }

    // Pick the right stream
    let chosen;

    if (result.type === 'live') {
      // For live, prefer HLS (m3u8) for automatic refresh
      const hls = result.streams.find((s) => s.format === 'm3u8');
      chosen = hls || result.streams[0];
    } else if (result.type === 'song') {
      // For audio, pick best quality
      const qualities = result.streams.map((s) => s.quality);
      const best = pickBestAudioQuality(qualities);
      chosen = result.streams.find((s) => s.quality === best) || result.streams[0];
    } else {
      // For video/MV, respect quality param or pick best up to 2k
      if (targetQuality) {
        chosen = result.streams.find((s) => s.quality === targetQuality);
      }
      if (!chosen) {
        const qualities = result.streams.map((s) => s.quality);
        const best = pickBestQuality(qualities);
        chosen = result.streams.find((s) => s.quality === best) || result.streams[0];
      }
    }

    if (!chosen || !chosen.url) {
      return redirectError('No suitable stream found');
    }

    console.log(`[redirect] → ${chosen.quality} ${chosen.format} ${chosen.url.substring(0, 80)}...`);

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
    return redirectError(`Upstream error: ${err.message}`);
  }
}

/**
 * Return a plain-text error for the redirect endpoint.
 * (Not JSON — VRChat players can't read JSON from a redirect endpoint anyway.)
 */
function redirectError(message) {
  return new Response(`Error: ${message}\nTry /api/parse for JSON output with details.\n`, {
    status: 502,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
