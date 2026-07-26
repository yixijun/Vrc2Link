/**
 * Vrc2Link — Cloudflare Worker entry point.
 *
 * Routes:
 *   GET /api/parse?url=...  → JSON with parsed streams
 *   GET /r?url=...          → 302 redirect to direct stream URL
 *   GET /                   → simple usage page
 */

import { handleApi } from './routes/api.js';
import { handleRedirect } from './routes/redirect.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers — allow everything (VRChat, browsers, CLI)
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Cookie',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    let response;

    try {
      if (path === '/api/parse') {
        response = await handleApi(request);
      } else if (path === '/r') {
        response = await handleRedirect(request);
      } else if (path === '/' || path === '') {
        response = handleHome();
      } else {
        response = new Response('Not Found', { status: 404 });
      }
    } catch (err) {
      console.error(`[worker] unhandled error: ${err.message}`);
      response = new Response(
        JSON.stringify({ error: true, code: 500, message: 'Internal server error' }),
        { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    // Attach CORS headers to every response
    for (const [key, value] of Object.entries(corsHeaders)) {
      response.headers.set(key, value);
    }

    return response;
  },
};

/**
 * Home page — simple usage guide.
 */
function handleHome() {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vrc2Link</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #e0e0e0; background: #1a1a2e; }
    h1 { color: #e94560; }
    code { background: #16213e; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    pre { background: #16213e; padding: 16px; border-radius: 8px; overflow-x: auto; }
    a { color: #0f3460; }
    .endpoint { margin: 24px 0; padding: 16px; background: #16213e; border-radius: 8px; border-left: 3px solid #e94560; }
    .endpoint h3 { margin-top: 0; color: #e94560; }
  </style>
</head>
<body>
  <h1>Vrc2Link</h1>
  <p>解析 Bilibili / 网易云音乐 链接为直链，适配 VRChat 播放器。</p>

  <div class="endpoint">
    <h3>API 模式 — JSON 返回</h3>
    <pre>GET /api/parse?url=&lt;encoded_url&gt;&amp;cookie=&lt;optional&gt;</pre>
    <p>返回完整解析结果，包含元信息、画质列表、CDN 直链。</p>
    <p>示例：<a href="/api/parse?url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1GJ411x7h7">/api/parse?url=https://www.bilibili.com/video/BV1GJ411x7h7</a></p>
  </div>

  <div class="endpoint">
    <h3>重定向模式 — 302 跳转直链</h3>
    <pre>GET /r?url=&lt;encoded_url&gt;&amp;quality=&lt;optional&gt;&amp;cookie=&lt;optional&gt;</pre>
    <p>直接 302 跳转到最佳画质的 CDN 直链。适合粘贴到 VRChat 播放器。</p>
    <p>示例：<code>/r?url=https://www.bilibili.com/video/BV1GJ411x7h7</code></p>
  </div>

  <h2>支持的平台</h2>
  <ul>
    <li><strong>Bilibili</strong> — 视频 (BV/AV) + 直播 (m3u8/flv)</li>
    <li><strong>网易云音乐</strong> — 单曲 (mp3/flac) + MV (mp4)</li>
  </ul>

  <h2>Cookie 传参</h2>
  <p>通过 <code>?cookie=SESSDATA=xxx;MUSIC_U=yyy</code> 或 HTTP <code>Cookie</code> 请求头传入登录态，可获取更高画质/音质。</p>

  <h2>画质限制</h2>
  <p>自动选择最高可用画质，上限 2K (1440p)。</p>

  <footer style="margin-top: 60px; color: #666; font-size: 0.85em;">
    <p>Vrc2Link — Cloudflare Worker | <a href="https://github.com" style="color:#999">GitHub</a></p>
  </footer>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
