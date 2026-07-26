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
    if (path === '/a') {
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
<title>Vrc2Link — 媒体直链解析</title>
<style>
  * { box-sizing:border-box;margin:0;padding:0; }
  body { font-family:system-ui,sans-serif;max-width:800px;margin:0 auto;padding:24px;line-height:1.7;background:#0f0f1a;color:#d0d0d0; }
  h1 { color:#fb7299;font-size:2em;margin-bottom:8px; }
  h1 span { color:#ec4141; }
  h2 { color:#fb7299;margin:32px 0 12px;border-bottom:1px solid #222;padding-bottom:6px; }
  h3 { color:#ccc;margin:16px 0 8px; }
  code { background:#1a1a30;padding:2px 8px;border-radius:4px;font-size:0.92em;color:#ffa0b0; }
  pre { background:#1a1a30;padding:16px;border-radius:8px;overflow-x:auto;font-size:0.9em;margin:8px 0; }
  a { color:#fb7299; }
  .badge { display:inline-block;padding:2px 10px;border-radius:12px;font-size:0.8em;font-weight:600;margin-right:6px; }
  .badge.get { background:#4caf50;color:#fff; }
  .badge.param { background:#555;color:#ccc; }
  .card { background:#1a1a30;border-radius:10px;padding:20px;margin:16px 0;border-left:3px solid #fb7299; }
  .card h3 { margin-top:0;color:#fb7299; }
  table { width:100%;border-collapse:collapse;margin:12px 0; }
  th,td { text-align:left;padding:8px 12px;border-bottom:1px solid #222; }
  th { color:#999;font-weight:600;font-size:0.85em; }
  td code { background:none;padding:0;color:#ffa0b0; }
  .tip { background:#1a2a1a;border-left:3px solid #4caf50;padding:10px 16px;border-radius:0 8px 8px 0;margin:12px 0;font-size:0.9em; }
  .warn { background:#2a1a1a;border-left:3px solid #ff9800;padding:10px 16px;border-radius:0 8px 8px 0;margin:12px 0;font-size:0.9em; }
  footer { margin-top:48px;padding:20px 0;border-top:1px solid #222;color:#666;font-size:.85em;text-align:center; }
  @media (max-width:600px) { body { padding:12px; } pre { font-size:0.75em; } }
</style>
</head>
<body>

<h1>Vrc<span style="color:#fff">2</span>Link</h1>
<p style="color:#999;font-size:1.1em">Bilibili · 网易云音乐 → 直链解析<br>专为 VRChat 播放器设计，也兼容浏览器 / 下载器</p>

<!-- ===== JSON API ===== -->
<h2>JSON 解析</h2>
<div class="card">
<h3><span class="badge get">GET</span> /a</h3>
<pre>/a?url=&lt;链接&gt;</pre>
<p>返回完整 JSON：标题、作者、封面、所有可用画质的 CDN 直链。</p>
</div>

<h3>示例</h3>

<p><strong>B站视频</strong></p>
<pre>/a?url=https://www.bilibili.com/video/BV1xx411c7mD</pre>

<p><strong>B站直播</strong></p>
<pre>/a?url=https://live.bilibili.com/6</pre>

<p><strong>网易云单曲</strong></p>
<pre>/a?url=https://music.163.com/song?id=5365570</pre>

<p><strong>网易云 MV</strong></p>
<pre>/a?url=https://music.163.com/mv?id=5365570</pre>

<p><strong>短链接也支持</strong></p>
<pre>/a?url=https://b23.tv/xxxxx
/a?url=https://163cn.tv/xxxxx</pre>

<!-- ===== Redirect ===== -->
<h2>直链跳转</h2>
<div class="card">
<h3><span class="badge get">GET</span> /r</h3>
<pre>/r?url=&lt;链接&gt;</pre>
<p>302 跳转到最佳画质的 CDN 直链。<strong>直接粘贴到 VRChat 播放器输入框即可。</strong></p>
</div>

<h3>示例</h3>
<pre>/r?url=https://www.bilibili.com/video/BV1xx411c7mD</pre>
<p style="color:#999;font-size:0.9em">→ 自动选最高可用画质（2K 封顶），302 跳到 CDN 直链，播放器开始播放。</p>

<p><strong>指定画质</strong></p>
<pre>/r?url=https://www.bilibili.com/video/BV1xx411c7mD&quality=720p</pre>

<!-- ===== Parameters ===== -->
<h2>通用参数</h2>
<table>
<tr><th>参数</th><th>用途</th><th>示例</th></tr>
<tr><td><code>url</code></td><td>目标链接（必填，需 URL 编码）</td><td>B站或网易云的视频/直播/歌曲/MV 链接</td></tr>
<tr><td><code>cookie</code></td><td>登录态 Cookie</td><td><code>SESSDATA=xxx;MUSIC_U=yyy</code></td></tr>
<tr><td><code>quality</code></td><td>指定画质（仅 <code>/r</code>）</td><td><code>1080p</code> / <code>720p</code> / <code>480p</code> / <code>320k</code></td></tr>
<tr><td><code>platform</code></td><td>强制指定平台</td><td><code>bilibili</code> / <code>netease</code></td></tr>
</table>

<div class="warn">
<strong>Cookie 说明</strong><br>
传 Cookie 可获得更高画质/音质：B站大会员 4K、网易云 320kbps/无损。<br>
不传也能解析，画质/音质自动降级。Cookie 不会记录到日志（敏感字段自动打码）。
</div>

<!-- ===== Supported ===== -->
<h2>支持的平台 & 画质</h2>
<table>
<tr><th>平台</th><th>类型</th><th>格式</th><th>最高画质</th></tr>
<tr><td>Bilibili</td><td>视频 (BV)</td><td>mp4 / flv</td><td>1440p (2K)</td></tr>
<tr><td>Bilibili</td><td>直播</td><td>m3u8 / flv</td><td>原画</td></tr>
<tr><td>网易云</td><td>单曲</td><td>mp3 / flac</td><td>无损 (需 Cookie)</td></tr>
<tr><td>网易云</td><td>MV</td><td>mp4</td><td>1080p</td></tr>
</table>

<div class="tip">
<strong>VRChat 使用技巧</strong><br>
把 <code>/r?url=链接</code> 粘贴到播放器输入框。直链有时效性，过期后重新解析即可。<br>
直播用 m3u8，播放器需支持 HLS（多数 Unity 播放器 Prefab 支持）。
</div>

<!-- ===== Footer ===== -->
<footer>
<p>Vrc2Link v2 · 国内服务器部署 · 零依赖</p>
<p><a href="https://github.com/yixijun/Vrc2Link">GitHub</a> · 解析失败？加 Cookie 重试</p>
</footer>

</body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
