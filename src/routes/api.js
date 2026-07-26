/**
 * GET /api/parse?url=<encoded>&cookie=<optional>&platform=<optional>
 */

import { identifyPlatform, extractId, expandShortLink } from '../utils/url.js';
import { extractCookie, maskCookie } from '../utils/cookie.js';
import { parseVideo, parseLive } from '../platforms/bilibili.js';
import { parseSong, parseMv } from '../platforms/netease.js';

export async function handleApi(request) {
  const url = new URL(request.url);
  const rawUrl = url.searchParams.get('url');
  const platformOverride = url.searchParams.get('platform');
  const cookie = extractCookie(request);

  if (!rawUrl) return jsonError(400, 'Missing required parameter: url');

  let target = rawUrl.trim();
  console.log(`[api] url=${target} platform=${platformOverride || 'auto'} cookie=${maskCookie(cookie)}`);

  try { target = await expandShortLink(target); } catch (err) {
    return jsonError(400, `Failed to resolve short link: ${err.message}`);
  }

  const platform = platformOverride || identifyPlatform(target);
  if (!platform) return jsonError(400, 'Unsupported platform. Supported: bilibili, netease');

  const extracted = extractId(target, platform);
  if (!extracted) return jsonError(400, `Could not extract ID from URL: ${target}`);

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

    if (!result.streams?.length) return jsonError(502, 'No playable streams found.');

    console.log(`[api] ok ${result.platform}/${result.type} streams=${result.streams.length}`);
    return new Response(JSON.stringify(result, null, 2), {
      status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    console.error(`[api] error: ${err.message}`);
    return jsonError(502, `Upstream error: ${err.message}`);
  }
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: true, code: status, message }, null, 2), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
