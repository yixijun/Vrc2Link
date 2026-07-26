/**
 * GET /resolve?url=<bilibili_url>&cookie=<optional>
 *
 * Returns an HTML page that runs B站 resolution entirely in the user's browser.
 * No Cloudflare Worker outbound requests to B站 — avoids the IP block entirely.
 *
 * The user opens this page, JS resolves the B站 video, and displays direct URLs
 * that can be copied into VRChat.
 */

export function handleResolve(request) {
  const url = new URL(request.url);
  const rawUrl = url.searchParams.get('url') || '';

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>B站解析 — Vrc2Link</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #1a1a2e; color: #e0e0e0; min-height: 100vh; padding: 20px; }
  .container { max-width: 720px; margin: 0 auto; }
  h1 { color: #e94560; margin-bottom: 20px; }
  .input-row { display: flex; gap: 8px; margin-bottom: 20px; }
  input { flex: 1; padding: 12px 16px; border: 2px solid #333; border-radius: 8px; background: #16213e; color: #eee; font-size: 14px; }
  input:focus { outline: none; border-color: #e94560; }
  button { padding: 12px 24px; background: #e94560; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; }
  button:hover { background: #d63851; }
  button:disabled { background: #555; cursor: not-allowed; }
  .status { padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; display: none; }
  .status.info { display: block; background: #16213e; color: #88aaff; }
  .status.error { display: block; background: #3e1a1a; color: #ff8888; }
  .status.success { display: block; background: #1a3e1a; color: #88ff88; }
  .result { background: #16213e; border-radius: 8px; padding: 16px; margin-bottom: 16px; display: none; }
  .result h3 { color: #e94560; margin-bottom: 8px; }
  .result .meta { color: #999; font-size: 0.9em; margin-bottom: 12px; }
  .stream { background: #0f0f23; border-radius: 6px; padding: 12px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
  .stream .info { display: flex; gap: 12px; align-items: center; }
  .stream .quality { background: #e94560; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.8em; font-weight: 600; }
  .stream .format { color: #aaa; font-size: 0.85em; }
  .stream button { padding: 8px 16px; font-size: 0.85em; }
  .stream a { color: #88aaff; word-break: break-all; font-size: 0.8em; }
  .loading { text-align: center; padding: 40px; color: #888; }
  .spinner { display: inline-block; width: 24px; height: 24px; border: 3px solid #333; border-top-color: #e94560; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }
  footer { margin-top: 40px; text-align: center; color: #666; font-size: 0.8em; }
  footer a { color: #666; }
</style>
</head>
<body>
<div class="container">
  <h1>Vrc2Link — B站解析</h1>
  <p style="margin-bottom:16px;color:#aaa">在浏览器本地解析 B站视频，解决 Cloudflare Worker IP 被 B站封锁的问题。解析后复制直链到 VRChat。</p>

  <div class="input-row">
    <input id="urlInput" type="text" placeholder="粘贴 B站视频链接：https://www.bilibili.com/video/BVxxx" value="${escapeHtml(rawUrl)}">
    <button id="goBtn" onclick="resolve()">解析</button>
  </div>

  <div id="status" class="status info" style="display:none"></div>
  <div id="result" class="result"></div>
  <div id="loading" class="loading" style="display:none"><span class="spinner"></span>正在解析...</div>

  <div style="margin-top:24px;padding:16px;background:#16213e;border-radius:8px">
    <h4 style="color:#e94560;margin-bottom:8px">使用方法</h4>
    <ol style="color:#aaa;padding-left:20px;line-height:1.8">
      <li>把 B站视频链接粘贴到上方输入框</li>
      <li>点击「解析」，等几秒拿到直链</li>
      <li>点「复制链接」或手动复制 URL</li>
      <li>粘贴到 VRChat 播放器里</li>
    </ol>
    <p style="margin-top:12px;color:#666;font-size:0.85em">
      网易云音乐仍然可以直接用 <code>/api/parse?url=...</code> 和 <code>/r?url=...</code>（服务端解析，不会被封）。
    </p>
  </div>

  <footer>
    <p>Vrc2Link — <a href="/">服务端解析</a> | <a href="https://github.com/yixijun/Vrc2Link">GitHub</a></p>
  </footer>
</div>

<script>
// ---- MD5 (pure JS) ----
function md5(s){function md5cycle(x,k){var a=x[0],b=x[1],c=x[2],d=x[3];a=ff(a,b,c,d,k[0],7,-680876936);d=ff(d,a,b,c,k[1],12,-389564586);c=ff(c,d,a,b,k[2],17,606105819);b=ff(b,c,d,a,k[3],22,-1044525330);a=ff(a,b,c,d,k[4],7,-176418897);d=ff(d,a,b,c,k[5],12,1200080426);c=ff(c,d,a,b,k[6],17,-1473231341);b=ff(b,c,d,a,k[7],22,-45705983);a=ff(a,b,c,d,k[8],7,1770035416);d=ff(d,a,b,c,k[9],12,-1958414417);c=ff(c,d,a,b,k[10],17,-42063);b=ff(b,c,d,a,k[11],22,-1990404162);a=ff(a,b,c,d,k[12],7,1804603682);d=ff(d,a,b,c,k[13],12,-40341101);c=ff(c,d,a,b,k[14],17,-1502002290);b=ff(b,c,d,a,k[15],22,1236535329);a=gg(a,b,c,d,k[1],5,-165796510);d=gg(d,a,b,c,k[6],9,-1069501632);c=gg(c,d,a,b,k[11],14,643717713);b=gg(b,c,d,a,k[0],20,-373897302);a=gg(a,b,c,d,k[5],5,-701558691);d=gg(d,a,b,c,k[10],9,38016083);c=gg(c,d,a,b,k[15],14,-660478335);b=gg(b,c,d,a,k[4],20,-405537848);a=gg(a,b,c,d,k[9],5,568446438);d=gg(d,a,b,c,k[14],9,-1019803690);c=gg(c,d,a,b,k[3],14,-187363961);b=gg(b,c,d,a,k[8],20,1163531501);a=gg(a,b,c,d,k[13],5,-1444681467);d=gg(d,a,b,c,k[2],9,-51403784);c=gg(c,d,a,b,k[7],14,1735328473);b=gg(b,c,d,a,k[12],20,-1926607734);a=hh(a,b,c,d,k[5],4,-378558);d=hh(d,a,b,c,k[8],11,-2022574463);c=hh(c,d,a,b,k[11],16,1839030562);b=hh(b,c,d,a,k[14],23,-35309556);a=hh(a,b,c,d,k[1],4,-1530992060);d=hh(d,a,b,c,k[4],11,1272893353);c=hh(c,d,a,b,k[7],16,-155497632);b=hh(b,c,d,a,k[10],23,-1094730640);a=hh(a,b,c,d,k[13],4,681279174);d=hh(d,a,b,c,k[0],11,-358537222);c=hh(c,d,a,b,k[3],16,-722521979);b=hh(b,c,d,a,k[6],23,76029189);a=hh(a,b,c,d,k[9],4,-640364487);d=hh(d,a,b,c,k[12],11,-421815835);c=hh(c,d,a,b,k[15],16,530742520);b=hh(b,c,d,a,k[2],23,-995338651);a=ii(a,b,c,d,k[0],6,-198630844);d=ii(d,a,b,c,k[7],10,1126891415);c=ii(c,d,a,b,k[14],15,-1416354905);b=ii(b,c,d,a,k[5],21,-57434055);a=ii(a,b,c,d,k[12],6,1700485571);d=ii(d,a,b,c,k[3],10,-1894986606);c=ii(c,d,a,b,k[10],15,-1051523);b=ii(b,c,d,a,k[1],21,-2054922799);a=ii(a,b,c,d,k[8],6,1873313359);d=ii(d,a,b,c,k[15],10,-30611744);c=ii(c,d,a,b,k[6],15,-1560198380);b=ii(b,c,d,a,k[13],21,1309151649);a=ii(a,b,c,d,k[4],6,-145523070);d=ii(d,a,b,c,k[11],10,-1120210379);c=ii(c,d,a,b,k[2],15,718787259);b=ii(b,c,d,a,k[9],21,-343485551);x[0]=add32(a,x[0]);x[1]=add32(b,x[1]);x[2]=add32(c,x[2]);x[3]=add32(d,x[3]);}function cmn(q,a,b,x,s,t){a=add32(add32(a,q),add32(x,t));return add32((a<<s)|(a>>>(32-s)),b);}function ff(a,b,c,d,x,s,t){return cmn((b&c)|((~b)&d),a,b,x,s,t);}function gg(a,b,c,d,x,s,t){return cmn((b&d)|(c&(~d)),a,b,x,s,t);}function hh(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t);}function ii(a,b,c,d,x,s,t){return cmn(c^(b|(~d)),a,b,x,s,t);}function md51(s){var n=s.length,state=[1732584193,-271733879,-1732584194,271733878],i;for(i=64;i<=n;i+=64)md5cycle(state,md5blk(s.substring(i-64,i)));s=s.substring(i-64);var tail=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];for(i=0;i<s.length;i++)tail[i>>2]|=s.charCodeAt(i)<<((i%4)<<3);tail[i>>2]|=0x80<<((i%4)<<3);if(i>55){md5cycle(state,tail);for(i=0;i<16;i++)tail[i]=0;}tail[14]=n*8;md5cycle(state,tail);return state;}function md5blk(s){var md5blks=[];for(var i=0;i<64;i+=4)md5blks[i>>2]=s.charCodeAt(i)+(s.charCodeAt(i+1)<<8)+(s.charCodeAt(i+2)<<16)+(s.charCodeAt(i+3)<<24);return md5blks;}var hex_chr='0123456789abcdef'.split('');function rhex(n){var s='';for(var j=0;j<4;j++)s+=hex_chr[(n>>(j*8+4))&0x0f]+hex_chr[(n>>(j*8))&0x0f];return s;}function hex(x){for(var i=0;i<x.length;i++)x[i]=rhex(x[i]);return x.join('');}function add32(a,b){return(a+b)&0xffffffff;}return hex(md51(s));}

// ---- Quality mapping ----
var QN_MAP = {16:'360p',32:'480p',64:'720p',80:'1080p',112:'1080p',116:'1080p',120:'4k',125:'4k',126:'4k',127:'8k'};
function mapQuality(qn) { return QN_MAP[qn] || String(qn); }

// ---- Helpers ----
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

var statusEl = document.getElementById('status');
var resultEl = document.getElementById('result');
var loadingEl = document.getElementById('loading');
var goBtn = document.getElementById('goBtn');

function setStatus(cls, msg) {
  statusEl.className = 'status ' + cls;
  statusEl.textContent = msg;
  statusEl.style.display = 'block';
}

function setLoading(loading) {
  loadingEl.style.display = loading ? 'block' : 'none';
  resultEl.style.display = 'none';
  statusEl.style.display = 'none';
  goBtn.disabled = loading;
}

// ---- WBI signing ----
var wbiCache = null;

async function getMixKey(cookie) {
  if (wbiCache && Date.now() - wbiCache.time < 3600000) return wbiCache.key;
  var resp = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: cookie ? { Cookie: cookie } : {}
  });
  var data = await resp.json();
  var wbi = data && data.data && data.data.wbi_img;
  if (!wbi || !wbi.img_url || !wbi.sub_url) throw new Error('Failed to get WBI keys');
  var extract = function(u) { var f = u.split('/').pop(); return f.substring(0, f.lastIndexOf('.')); };
  var key = extract(wbi.img_url) + extract(wbi.sub_url);
  wbiCache = { key: key, time: Date.now() };
  return key;
}

function signParams(params, mixKey) {
  delete params.w_rid;
  delete params.wts;
  var keys = Object.keys(params).filter(function(k) { return params[k] != null; }).sort();
  var sorted = keys.map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
  var wts = Math.floor(Date.now() / 1000);
  var w_rid = md5(sorted + mixKey);
  return { wts: wts, w_rid: w_rid };
}

// ---- Main resolution ----
async function resolve() {
  var rawUrl = document.getElementById('urlInput').value.trim();
  if (!rawUrl) { setStatus('error','请输入 B站视频链接'); return; }

  // Extract BV id
  var bvid = null;
  var m = rawUrl.match(/BV[a-zA-Z0-9]+/);
  if (m) bvid = m[0];
  if (!bvid) { setStatus('error','未识别到 BV 号，请检查链接格式'); return; }

  // Get cookie from query param if present
  var pageUrl = new URL(window.location.href);
  var cookie = pageUrl.searchParams.get('cookie') || '';

  setLoading(true);

  try {
    // Step 1: Fetch video page, extract __INITIAL_STATE__
    setStatus('info','正在获取视频页面...');
    var pageResp = await fetch('https://www.bilibili.com/video/' + bvid, {
      headers: cookie ? { Cookie: cookie } : {}
    });
    if (!pageResp.ok) throw new Error('获取视频页面失败: HTTP ' + pageResp.status);
    var html = await pageResp.text();

    // Extract JSON from window.__INITIAL_STATE__
    var start = html.indexOf('window.__INITIAL_STATE__');
    if (start === -1) throw new Error('未找到视频数据');
    var jsonStart = html.indexOf('{', start);
    var depth = 0, jsonEnd = -1;
    for (var i = jsonStart; i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}') { depth--; if (depth === 0) { jsonEnd = i + 1; break; } }
    }
    if (jsonEnd === -1) throw new Error('解析视频数据失败');
    var state = JSON.parse(html.substring(jsonStart, jsonEnd));
    var vdata = state.videoData;
    if (!vdata) throw new Error('视频不存在: ' + bvid);

    var cid = vdata.cid;
    var title = vdata.title || '';

    setStatus('info','正在获取播放地址...');

    // Step 2: WBI sign and fetch playurl
    var mixKey = await getMixKey(cookie);
    var params = {
      bvid: bvid,
      cid: String(cid),
      qn: '120',
      fnval: '1',
      fnver: '0',
      fourk: '1',
      platform: 'web'
    };
    var sig = signParams(params, mixKey);
    params.wts = sig.wts;
    params.w_rid = sig.w_rid;
    var query = Object.keys(params).filter(function(k) { return params[k] != null; })
      .map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    var playUrl = 'https://api.bilibili.com/x/player/wbi/playurl?' + query;

    var playResp = await fetch(playUrl, {
      headers: cookie ? { Cookie: cookie, Referer: 'https://www.bilibili.com/' } : { Referer: 'https://www.bilibili.com/' }
    });
    if (!playResp.ok) throw new Error('获取播放地址失败: HTTP ' + playResp.status);
    var playData = await playResp.json();
    var playResult = playData.data || playData.result;
    if (!playResult) throw new Error('播放地址为空（可能需要 cookie 或视频需要大会员）');

    // Step 3: Build result
    var streams = [];
    var currentQn = playResult.quality || 0;

    if (playResult.durl && playResult.durl.length > 0) {
      for (var d = 0; d < playResult.durl.length; d++) {
        var du = playResult.durl[d];
        streams.push({
          quality: mapQuality(currentQn),
          format: du.url.indexOf('.m3u8') !== -1 ? 'm3u8' : du.url.indexOf('.flv') !== -1 ? 'flv' : 'mp4',
          url: du.url,
          size: du.size || 0
        });
      }
    }

    if (streams.length === 0 && playResult.dash && playResult.dash.video) {
      for (var v = 0; v < playResult.dash.video.length; v++) {
        streams.push({
          quality: mapQuality(playResult.dash.video[v].id),
          format: 'mp4 (仅视频)',
          url: playResult.dash.video[v].baseUrl || playResult.dash.video[v].base_url,
          note: '需要与音频流合并'
        });
      }
      for (var a = 0; a < (playResult.dash.audio || []).length; a++) {
        streams.push({
          quality: 'audio',
          format: 'mp4 (仅音频)',
          url: (playResult.dash.audio[a].baseUrl || playResult.dash.audio[a].base_url),
          note: '需要与视频流合并'
        });
      }
    }

    if (streams.length === 0) throw new Error('未找到可播放的流');

    // Render result
    var metaHtml = '<h3>' + escapeHtml(title) + '</h3>';
    metaHtml += '<p class="meta">BV号: ' + bvid + ' | 画质: ' + mapQuality(currentQn);
    if (cookie) metaHtml += ' | 已传 Cookie';
    metaHtml += '</p>';

    var streamsHtml = '';
    for (var s = 0; s < streams.length; s++) {
      var st = streams[s];
      streamsHtml += '<div class="stream">';
      streamsHtml += '<div class="info"><span class="quality">' + escapeHtml(st.quality) + '</span>';
      streamsHtml += '<span class="format">' + escapeHtml(st.format) + '</span>';
      if (st.note) streamsHtml += '<span style="color:#ff8888;font-size:0.8em">' + escapeHtml(st.note) + '</span>';
      streamsHtml += '</div>';
      streamsHtml += '<button onclick="copyUrl(\\'' + st.url.replace(/'/g, "\\'") + '\\', this)">复制链接</button>';
      streamsHtml += '<div style="width:100%"><a href="' + escapeHtml(st.url) + '" target="_blank" style="font-size:0.75em;color:#666">' + escapeHtml(st.url.substring(0, 80)) + '...</a></div>';
      streamsHtml += '</div>';
    }
    streamsHtml += '<p style="color:#888;font-size:0.8em;margin-top:12px">链接有效期约 2-6 小时，过期需重新解析。</p>';

    resultEl.innerHTML = metaHtml + streamsHtml;
    resultEl.style.display = 'block';
    setStatus('success','解析成功！复制链接粘贴到 VRChat 播放器即可。');

  } catch (err) {
    setStatus('error','解析失败: ' + err.message);
  } finally {
    setLoading(false);
  }
}

function copyUrl(url, btn) {
  navigator.clipboard.writeText(url).then(function() {
    var orig = btn.textContent;
    btn.textContent = '已复制!';
    btn.style.background = '#4caf50';
    setTimeout(function() { btn.textContent = orig; btn.style.background = '#e94560'; }, 2000);
  }).catch(function() {
    alert('复制失败，请手动复制链接');
  });
}

// Auto-resolve if URL param present
if (document.getElementById('urlInput').value) {
  resolve();
}

// Enter key triggers resolve
document.getElementById('urlInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') resolve();
});
</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
