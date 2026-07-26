/**
 * Vrc2Link — unified media resolver.
 *
 * Routes:
 *   GET /api/parse?url=...  → JSON with parsed streams
 *   GET /r?url=...          → 302 redirect to direct stream
 *   GET /                   → API reference
 */

import { handleApi } from './routes/api.js';
import { handleRedirect } from './routes/redirect.js';

export async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cookie',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  let response;
  try {
    if (path === '/api/parse') {
      response = await handleApi(request);
    } else if (path === '/r') {
      response = await handleRedirect(request);
    } else {
      response = homePage();
    }
  } catch (err) {
    console.error(`[worker] unhandled: ${err.message}`);
    response = new Response(JSON.stringify({ error: true, code: 500, message: 'Internal server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
  return response;
}

function homePage() {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Vrc2Link</title>
<style>
  body { font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6;background:#1a1a2e;color:#e0e0e0; }
  h1 { color:#e94560; } code { background:#16213e;padding:2px 6px;border-radius:4px; }
  pre { background:#16213e;padding:16px;border-radius:8px;overflow-x:auto; }
  a { color:#e94560; }
  .ep { margin:24px 0;padding:16px;background:#16213e;border-radius:8px;border-left:3px solid #e94560; }
  .ep h3 { margin-top:0;color:#e94560; }
  footer { margin-top:60px;color:#666;font-size:.85em; }
</style>
</head>
<body>
<h1>Vrc2Link</h1>
<p>Bilibili / 网易云音乐 → 直链解析，适配 VRChat 播放器。</p>

<div class="ep">
<h3>API — JSON</h3>
<pre>GET /api/parse?url=&lt;encoded_url&gt;&amp;cookie=&lt;optional&gt;</pre>
<p>返回完整解析结果：元信息、画质列表、CDN 直链。</p>
</div>

<div class="ep">
<h3>直链 — 302 跳转</h3>
<pre>GET /r?url=&lt;encoded_url&gt;&amp;quality=&lt;optional&gt;&amp;cookie=&lt;optional&gt;</pre>
<p>直接 302 跳转到最佳画质 CDN 直链。粘贴到 VRChat 播放器即可。</p>
</div>

<h2>支持的平台</h2>
<ul>
<li><strong>Bilibili</strong> — 视频、直播 (m3u8/flv)</li>
<li><strong>网易云音乐</strong> — 单曲、MV</li>
</ul>

<footer><p>Vrc2Link — <a href="https://github.com/yixijun/Vrc2Link">GitHub</a></p></footer>
</body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
