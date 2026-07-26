/**
 * GET /api/parse?url=<encoded>&cookie=<optional>&platform=<optional>
 *
 * Returns JSON with parsed media info and direct stream URLs.
 */

import { identifyPlatform, extractId, expandShortLink } from '../utils/url.js';
import { extractCookie, maskCookie } from '../utils/cookie.js';
import { parseVideo, parseLive } from '../platforms/bilibili.js';
import { parseSong, parseMv } from '../platforms/netease.js';

/**
 * Handle the /api/parse route.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function handleApi(request) {
  const url = new URL(request.url);
  const rawUrl = url.searchParams.get('url');
  const platformOverride = url.searchParams.get('platform');
  const cookie = extractCookie(request);
  const forwardIp = request.headers.get('CF-Connecting-IP') || '';

  // Validate input
  if (!rawUrl) {
    return jsonError(400, 'Missing required parameter: url');
  }

  let targetUrl = rawUrl.trim();

  console.log(`[api] url=${targetUrl} platform=${platformOverride || 'auto'} cookie=${maskCookie(cookie)} ip=${forwardIp}`);

  // Step 1: Expand short links
  try {
    targetUrl = await expandShortLink(targetUrl);
  } catch (err) {
    return jsonError(400, `Failed to resolve short link: ${err.message}`);
  }

  // Step 2: Identify platform
  const platform = platformOverride || identifyPlatform(targetUrl);
  if (!platform) {
    return jsonError(400, `Unsupported platform. Supported: bilibili (b23.tv, bilibili.com), netease (music.163.com)`);
  }

  // Step 3: Extract resource ID
  const extracted = extractId(targetUrl, platform);
  if (!extracted) {
    return jsonError(400, `Could not extract valid ID from URL: ${targetUrl}`);
  }

  // Step 4: Parse based on platform + type
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

    // If streams is empty after parsing, that's a problem
    if (!result.streams || result.streams.length === 0) {
      return jsonError(502, 'No playable streams found. The content may require login or is region-restricted.');
    }

    console.log(`[api] success platform=${result.platform} type=${result.type} streams=${result.streams.length}`);

    return new Response(JSON.stringify(result, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    console.error(`[api] error: ${err.message}`);
    return jsonError(502, `Upstream error: ${err.message}`);
  }
}

/**
 * Build a JSON error response.
 */
function jsonError(status, message) {
  return new Response(
    JSON.stringify({ error: true, code: status, message }, null, 2),
    {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }
  );
}
