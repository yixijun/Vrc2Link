const HOME_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Vrc2Link API</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f6f8;
      --surface: #ffffff;
      --ink: #17202a;
      --muted: #657180;
      --line: #d8dee6;
      --accent: #d83d6c;
      --accent-dark: #ad2450;
      --teal: #087f74;
      --code: #111827;
      --code-ink: #e5e7eb;
      --focus: #2563eb;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 16px;
      line-height: 1.65;
      letter-spacing: 0;
    }
    button, input, select { font: inherit; letter-spacing: 0; }
    a { color: var(--accent-dark); }
    code, pre { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 10;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.96);
    }
    .topbar-inner {
      width: min(1120px, calc(100% - 40px));
      min-height: 58px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--ink);
      font-weight: 760;
      text-decoration: none;
    }
    .brand-mark {
      width: 30px;
      height: 30px;
      display: grid;
      place-items: center;
      border: 2px solid var(--ink);
      border-radius: 6px;
      color: var(--accent);
      font-size: 12px;
      font-weight: 800;
    }
    nav { display: flex; align-items: center; gap: 22px; }
    nav a { color: var(--muted); font-size: 14px; text-decoration: none; }
    nav a:hover { color: var(--ink); }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: var(--teal);
      font-size: 13px;
      font-weight: 700;
    }
    .status::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--teal);
    }

    main { width: min(1120px, calc(100% - 40px)); margin: 0 auto; }
    .intro {
      min-height: 280px;
      padding: 48px 0 36px;
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(300px, 0.8fr);
      align-items: end;
      gap: 64px;
      border-bottom: 1px solid var(--line);
    }
    .eyebrow {
      margin: 0 0 10px;
      color: var(--accent-dark);
      font-size: 13px;
      font-weight: 800;
      text-transform: uppercase;
    }
    h1, h2, h3, p { letter-spacing: 0; }
    h1 { margin: 0; font-size: 52px; line-height: 1.08; }
    .lead { max-width: 650px; margin: 18px 0 0; color: var(--muted); font-size: 18px; }
    .route-summary { border-top: 3px solid var(--ink); }
    .route-row {
      min-height: 68px;
      display: grid;
      grid-template-columns: 64px 88px 1fr;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid var(--line);
    }
    .method { color: var(--teal); font-size: 12px; font-weight: 800; }
    .route-row code { color: var(--ink); font-weight: 750; }
    .route-row span:last-child { color: var(--muted); font-size: 14px; }

    section { padding: 48px 0; border-bottom: 1px solid var(--line); }
    .section-heading { margin-bottom: 24px; }
    h2 { margin: 0 0 7px; font-size: 28px; line-height: 1.25; }
    .section-heading p { margin: 0; color: var(--muted); }

    .request-builder {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: 32px;
      padding: 28px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: 0 12px 32px rgba(23, 32, 42, 0.07);
    }
    .field { display: grid; gap: 7px; margin-bottom: 18px; }
    .field:last-child { margin-bottom: 0; }
    .field-label, legend { color: var(--ink); font-size: 13px; font-weight: 750; }
    .field-help { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
    .platform-hint {
      min-height: 22px;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 7px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .platform-hint::before {
      content: "";
      width: 7px;
      height: 7px;
      flex: 0 0 7px;
      border-radius: 50%;
      background: #8a94a1;
    }
    .platform-hint[data-platform="bilibili"] { color: #b82f5b; }
    .platform-hint[data-platform="bilibili"]::before { background: var(--accent); }
    .platform-hint[data-platform="netease"] { color: #b42318; }
    .platform-hint[data-platform="netease"]::before { background: #d92d20; }
    .platform-hint[data-platform="douyin"] { color: #344054; }
    .platform-hint[data-platform="douyin"]::before { background: #101828; }
    .platform-hint[data-platform="kuaishou"] { color: #c4320a; }
    .platform-hint[data-platform="kuaishou"]::before { background: #f04438; }
    .platform-hint[data-platform="youtube"] { color: #b42318; }
    .platform-hint[data-platform="youtube"]::before { background: #ff0000; }
    input[type="text"], input[type="url"], input[type="password"], select {
      width: 100%;
      min-height: 44px;
      padding: 9px 12px;
      border: 1px solid #b9c2cd;
      border-radius: 6px;
      background: #fff;
      color: var(--ink);
      outline: none;
    }
    .input-with-action {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 88px;
    }
    .input-with-action input {
      position: relative;
      z-index: 1;
      min-width: 0;
      border-radius: 6px 0 0 6px;
    }
    .input-with-action input:focus { z-index: 2; }
    .paste-button {
      min-height: 44px;
      margin-left: -1px;
      padding: 8px 12px;
      border-color: #b9c2cd;
      border-radius: 0 6px 6px 0;
      background: #f7f8fa;
      color: var(--ink);
      white-space: nowrap;
    }
    .paste-button:hover { background: #e9edf2; }
    input:focus, select:focus, button:focus-visible {
      border-color: var(--focus);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
      outline: none;
    }
    fieldset { margin: 0 0 18px; padding: 0; border: 0; }
    legend { margin-bottom: 7px; }
    .segment {
      display: grid;
      grid-template-columns: 1fr 1fr;
      padding: 3px;
      border: 1px solid #b9c2cd;
      border-radius: 6px;
      background: #edf0f3;
    }
    .segment input { position: absolute; opacity: 0; pointer-events: none; }
    .segment label {
      min-height: 36px;
      display: grid;
      place-items: center;
      border-radius: 4px;
      color: var(--muted);
      cursor: pointer;
      font-size: 14px;
      font-weight: 700;
    }
    .segment input:checked + label { background: #fff; color: var(--ink); box-shadow: 0 1px 3px rgba(23, 32, 42, 0.14); }
    .segment input:focus-visible + label { outline: 2px solid var(--focus); outline-offset: -2px; }
    select:disabled { background: #edf0f3; color: #8a94a1; cursor: not-allowed; }
    .builder-side { display: flex; flex-direction: column; min-width: 0; }
    .request-preview {
      flex: 1;
      min-height: 132px;
      margin: 0 0 16px;
      padding: 16px;
      overflow-wrap: anywhere;
      border-radius: 6px;
      background: var(--code);
      color: var(--code-ink);
      font-size: 13px;
      line-height: 1.6;
    }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    button {
      min-height: 42px;
      padding: 8px 14px;
      border: 1px solid var(--ink);
      border-radius: 6px;
      background: var(--ink);
      color: #fff;
      cursor: pointer;
      font-weight: 750;
    }
    button.secondary { background: #fff; color: var(--ink); }
    button:hover { background: #2d3946; }
    button.secondary:hover { background: #edf0f3; }

    .endpoint {
      display: grid;
      grid-template-columns: 230px minmax(0, 1fr);
      gap: 42px;
      padding: 34px 0;
      border-top: 1px solid var(--line);
    }
    .endpoint:first-of-type { border-top: 3px solid var(--ink); }
    .endpoint h3 { margin: 0 0 6px; font-size: 20px; }
    .endpoint-copy > p { margin: 0 0 18px; color: var(--muted); }
    .compat-note {
      margin-top: 18px;
      padding: 12px 14px;
      border-left: 3px solid #c47b16;
      background: #fff8e8;
      color: #5f471f;
      font-size: 14px;
    }
    .compat-note strong { display: block; margin-bottom: 3px; color: #49330f; }
    .tag { color: var(--teal); font-size: 12px; font-weight: 800; }
    table { width: 100%; border-collapse: collapse; margin: 0 0 22px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 12px; font-weight: 750; }
    td { font-size: 14px; }
    td code { color: var(--accent-dark); }
    pre {
      margin: 0;
      padding: 17px;
      overflow: auto;
      border-radius: 6px;
      background: var(--code);
      color: var(--code-ink);
      font-size: 13px;
      line-height: 1.6;
    }
    .note-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
    .note-grid h3 { margin: 0 0 8px; font-size: 17px; }
    .note-grid p { margin: 0; color: var(--muted); }
    .config-guide {
      display: grid;
      grid-template-columns: minmax(0, 0.8fr) minmax(420px, 1.2fr);
      gap: 42px;
      margin-top: 34px;
      padding-top: 30px;
      border-top: 1px solid var(--line);
    }
    .config-guide h3 { margin: 0 0 8px; font-size: 18px; }
    .config-guide p { margin: 0; color: var(--muted); }
    .error-list { display: grid; grid-template-columns: repeat(4, 1fr); border-top: 3px solid var(--ink); }
    .error-item { padding: 18px 16px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    .error-item:last-child { border-right: 0; }
    .error-item strong { display: block; font-size: 20px; }
    .error-item span { color: var(--muted); font-size: 13px; }
    footer {
      width: min(1120px, calc(100% - 40px));
      margin: 0 auto;
      padding: 30px 0 42px;
      display: flex;
      justify-content: space-between;
      gap: 20px;
      color: var(--muted);
      font-size: 13px;
    }

    @media (max-width: 780px) {
      .topbar-inner, main, footer { width: min(100% - 28px, 1120px); }
      nav a { display: none; }
      .intro { min-height: 0; grid-template-columns: 1fr; gap: 34px; padding-top: 42px; }
      h1 { font-size: 40px; }
      .request-builder, .endpoint { grid-template-columns: 1fr; gap: 24px; }
      .note-grid { grid-template-columns: 1fr; gap: 24px; }
      .config-guide { grid-template-columns: 1fr; gap: 20px; }
      .error-list { grid-template-columns: 1fr 1fr; }
      .error-item:nth-child(2) { border-right: 0; }
      footer { flex-direction: column; }
    }

    @media (max-width: 460px) {
      .route-row { grid-template-columns: 54px 72px 1fr; }
      section { padding: 38px 0; }
      .request-builder { padding: 18px; }
      .actions, .error-list { grid-template-columns: 1fr; }
      .error-item { border-right: 0; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="/" aria-label="Vrc2Link 首页">
        <span class="brand-mark" aria-hidden="true">V2L</span>
        <span>Vrc2Link</span>
      </a>
      <nav aria-label="页面导航">
        <a href="#request">请求生成器</a>
        <a href="#endpoints">接口</a>
        <a href="#auth">鉴权</a>
        <a href="#runtime">运行状态</a>
        <span class="status">服务在线</span>
      </nav>
    </div>
  </header>

  <main>
    <section class="intro">
      <div>
        <p class="eyebrow">VRChat Media Resolver</p>
        <h1>Vrc2Link</h1>
        <p class="lead">解析 Bilibili、抖音、快手视频与直播，以及网易云歌曲与 MV；YouTube 链接直接交给 VRChat。详细结果使用 API，播放器地址使用 302 跳转。</p>
      </div>
      <div class="route-summary" aria-label="接口摘要">
        <div class="route-row"><span class="method">GET</span><code>/api</code><span>详细解析结果</span></div>
        <div class="route-row"><span class="method">GET</span><code>/play</code><span>302 播放跳转</span></div>
      </div>
    </section>

    <section id="request">
      <div class="section-heading">
        <h2>请求生成器</h2>
        <p>填写媒体地址或粘贴平台分享文本，直接生成当前服务的请求链接。</p>
      </div>
      <form class="request-builder" id="request-builder">
        <div>
          <div class="field">
            <label class="field-label" for="media-url">媒体链接或分享文本</label>
            <div class="input-with-action">
              <input id="media-url" name="url" type="text" inputmode="url" required placeholder="【分享标题】 粘贴 Bilibili、抖音、快手、YouTube 或网易云链接" autocomplete="off" aria-describedby="platform-hint">
              <button class="paste-button" id="paste-media" type="button">粘贴</button>
            </div>
            <p class="platform-hint" id="platform-hint">等待识别媒体平台</p>
          </div>
          <fieldset>
            <legend>请求模式</legend>
            <div class="segment">
              <input id="mode-api" type="radio" name="mode" value="api" checked>
              <label for="mode-api">详细解析</label>
              <input id="mode-play" type="radio" name="mode" value="play">
              <label for="mode-play">直接播放</label>
            </div>
          </fieldset>
          <div class="field">
            <label class="field-label" for="api-key">访问密钥（可选）</label>
            <input id="api-key" name="key" type="password" placeholder="API_KEY" autocomplete="off">
          </div>
          <div class="field">
            <label class="field-label" for="quality">指定画质</label>
            <select id="quality" name="quality" disabled>
              <option value="">自动选择</option>
            </select>
            <p class="field-help" id="quality-help">识别媒体平台后显示对应的画质或音质。</p>
          </div>
        </div>
        <div class="builder-side">
          <output class="request-preview" id="request-preview" aria-live="polite">等待输入媒体链接</output>
          <div class="actions">
            <button type="submit">打开请求</button>
            <button class="secondary" id="copy-request" type="button">复制链接</button>
          </div>
        </div>
      </form>
    </section>

    <section id="endpoints">
      <div class="section-heading">
        <h2>接口</h2>
        <p>所有媒体地址都应作为经过 URL 编码的 <code>url</code> 参数传入。</p>
      </div>

      <article class="endpoint">
        <div>
          <span class="tag">GET</span>
          <h3><code>/api</code></h3>
          <p>详细 JSON</p>
        </div>
        <div class="endpoint-copy">
          <p>返回统一的媒体元数据、平台画质选项和实际播放流，不直接透传平台原始响应。<code>qualities</code> 是平台公布的选项，真正取得的直链以 <code>streams</code> 为准。</p>
          <table>
            <thead><tr><th>参数</th><th>必填</th><th>说明</th></tr></thead>
            <tbody>
              <tr><td><code>url</code></td><td>是</td><td>Bilibili、抖音、快手、YouTube、网易云媒体地址或复制的分享文本</td></tr>
              <tr><td><code>key</code></td><td>否</td><td>启用服务器 Cookie 权限</td></tr>
            </tbody>
          </table>
          <div class="compat-note">
            <strong>Bilibili 高画质说明</strong>
            1080p、4K、8K 通常只提供 DASH 分离的视频轨和音频轨。Cookie 可以解锁账号有权访问的画质，但不会把两条轨道转换成一个带声音的文件。
          </div>
          <pre><code>GET /api?url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV...</code></pre>
        </div>
      </article>

      <article class="endpoint">
        <div>
          <span class="tag">GET</span>
          <h3><code>/play</code></h3>
          <p>302 Redirect</p>
        </div>
        <div class="endpoint-copy">
          <p>选择一个带画面和声音、可直接播放的单文件并跳转。不指定画质时自动选择最高可播放画质。</p>
          <table>
            <thead><tr><th>参数</th><th>必填</th><th>说明</th></tr></thead>
            <tbody>
              <tr><td><code>url</code></td><td>是</td><td>Bilibili、抖音、快手、YouTube、网易云媒体地址或复制的分享文本</td></tr>
              <tr><td><code>quality</code></td><td>否</td><td>精确画质；不存在时返回 422</td></tr>
              <tr><td><code>key</code></td><td>否</td><td>启用服务器 Cookie 权限</td></tr>
            </tbody>
          </table>
          <div class="compat-note">
            <strong>为什么 1080p 会返回 422？</strong>
            <code>/play</code> 只做一次 302，不在服务器上合并 DASH 音视频。目标画质只有分离流时会返回 <code>quality_unavailable</code>，不会静默降到 720p，也不会返回无声视频。
          </div>
          <pre><code>GET /play?quality=720p&amp;url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV...</code></pre>
        </div>
      </article>
    </section>

    <section id="auth">
      <div class="section-heading">
        <h2>鉴权与 Cookie</h2>
          <p>平台 Cookie 只保存在服务器环境变量中，只有携带正确 <code>key</code> 时才会启用。</p>
      </div>
      <div class="note-grid">
        <div>
          <h3>匿名请求</h3>
          <p>不传 <code>key</code> 时不会使用任何服务器 Cookie，按平台公开权限解析。</p>
        </div>
        <div>
          <h3>鉴权请求</h3>
          <p><code>key</code> 与服务器 <code>API_KEY</code> 一致时，才会使用对应平台 Cookie。错误 key 返回 401。</p>
        </div>
      </div>
      <div class="config-guide">
        <div>
          <h3>配置文件</h3>
          <p>复制 <code>config.example.env</code> 为 <code>config.env</code>。在浏览器开发者工具的 Network 中选择平台请求，从 Request Headers 复制完整 <code>Cookie</code> 值，直接粘贴到等号后面。修改后重启服务。</p>
        </div>
        <pre><code>PORT=7890
API_KEY=替换成随机密钥
BILIBILI_COOKIE=完整的 Bilibili Cookie 请求头
NETEASE_COOKIE=完整的网易云 Cookie 请求头
DOUYIN_COOKIE=完整的抖音 Cookie 请求头
KUAISHOU_COOKIE=完整的快手 Cookie 请求头</code></pre>
      </div>
    </section>

    <section id="runtime">
      <div class="section-heading">
        <h2>缓存、限流与日志</h2>
        <p>生产运行状态保存在本机 SQLite，不需要额外部署 Redis。</p>
      </div>
      <div class="note-grid">
        <div>
          <h3>匿名缓存</h3>
          <p>匿名解析默认缓存 300 秒，重启后仍然有效；鉴权请求不会缓存。响应头 <code>X-Cache</code> 表示是否命中。</p>
        </div>
        <div>
          <h3>请求限额</h3>
          <p>匿名默认 10 次/分钟，鉴权默认 60 次/分钟，每个 IP 总计 120 次/分钟。超额返回 <code>429 rate_limited</code> 和 <code>Retry-After</code>。</p>
        </div>
      </div>
      <div class="config-guide">
        <div>
          <h3>请求追踪</h3>
          <p>每个响应包含 <code>X-Request-Id</code>。服务输出单行 JSON 日志，不记录 Cookie、完整 API key、查询串或原始 IP。</p>
        </div>
        <pre><code>SQLITE_PATH=data/vrc2link.sqlite
CACHE_TTL_SECONDS=300
RATE_LIMIT_ANON_PER_MINUTE=10
RATE_LIMIT_AUTH_PER_MINUTE=60
RATE_LIMIT_IP_PER_MINUTE=120
TRUST_PROXY=false</code></pre>
      </div>
    </section>

    <section id="errors">
      <div class="section-heading">
        <h2>常见状态码</h2>
        <p>错误响应统一使用 <code>{ "error": { "code": "...", "message": "..." } }</code>。</p>
      </div>
      <div class="error-list">
        <div class="error-item"><strong>400</strong><span>地址缺失或无法识别</span></div>
        <div class="error-item"><strong>401</strong><span>访问密钥错误</span></div>
        <div class="error-item"><strong>422</strong><span>指定画质不可用</span></div>
        <div class="error-item"><strong>429</strong><span>请求频率超过限额</span></div>
        <div class="error-item"><strong>502</strong><span>平台接口解析失败</span></div>
      </div>
    </section>
  </main>

  <footer>
    <span>Vrc2Link v2.0.0</span>
    <span>Bilibili / Netease / VRChat</span>
  </footer>

  <script>
    const form = document.getElementById('request-builder');
    const mediaUrl = document.getElementById('media-url');
    const apiKey = document.getElementById('api-key');
    const quality = document.getElementById('quality');
    const qualityHelp = document.getElementById('quality-help');
    const platformHint = document.getElementById('platform-hint');
    const preview = document.getElementById('request-preview');
    const pasteButton = document.getElementById('paste-media');
    const copyButton = document.getElementById('copy-request');
    let currentMediaKind = '';

    const mediaKinds = {
      bilibiliVideo: {
        platform: 'bilibili',
        label: '已识别：Bilibili 视频',
        help: '1080p 及以上通常是 DASH 音视频分离流；多数视频可直接播放的单文件最高为 720p。',
        qualities: [
          ['', '自动选择'], ['360p', '360p'], ['480p', '480p'], ['720p', '720p'],
          ['1080p', '1080p（通常需要合并）'], ['4k', '4k（通常需要合并）'],
          ['8k', '8k（通常需要合并）'],
        ],
      },
      bilibiliLive: {
        platform: 'bilibili',
        label: '已识别：Bilibili 直播',
        help: '不指定画质时优先选择可直接播放的 HLS 直播流。',
        qualities: [['', '自动选择'], ['original', '原画']],
      },
      neteaseSong: {
        platform: 'netease',
        label: '已识别：网易云歌曲',
        help: '320k 和无损音质取决于歌曲版权及当前 Cookie 对应账号的权限。',
        qualities: [
          ['', '自动选择'], ['128k', '128k'], ['256k', '256k'],
          ['320k', '320k'], ['lossless', '无损'],
        ],
      },
      neteaseMv: {
        platform: 'netease',
        label: '已识别：网易云 MV',
        help: '只显示网易云 MV 使用的视频画质。',
        qualities: [
          ['', '自动选择'], ['360p', '360p'], ['480p', '480p'],
          ['720p', '720p'], ['1080p', '1080p'],
        ],
      },
      douyinVideo: {
        platform: 'douyin',
        label: '已识别：抖音视频',
        help: '抖音分享页通常提供一个可直接播放的原画视频流；需要登录时请在服务端配置 Cookie。',
        qualities: [['', '自动选择'], ['original', '原画']],
      },
      kuaishouVideo: {
        platform: 'kuaishou',
        label: '已识别：快手视频',
        help: '快手分享页通常提供一个可直接播放的原画视频流；需要登录时请在服务端配置 Cookie。',
        qualities: [['', '自动选择'], ['original', '原画']],
      },
      youtubeVideo: {
        platform: 'youtube',
        label: '已识别：YouTube 视频',
        help: '不解析 YouTube 媒体流，/play 直接把原链接交给 VRChat。',
        qualities: [['', '直接跳转']],
      },
    };

    function selectedMode() {
      return form.elements.mode.value;
    }

    function extractUrl(input) {
      const lower = input.toLowerCase();
      const http = lower.indexOf('http://');
      const https = lower.indexOf('https://');
      let start = -1;
      if (http !== -1 && https !== -1) start = Math.min(http, https);
      else start = Math.max(http, https);
      if (start === -1) return '';

      const tail = input.slice(start);
      const delimiters = [' ', '\\n', '\\t', '，', '。', ',', ';', '；', '！', '、', '）', '】'];
      let end = tail.length;
      for (const delimiter of delimiters) {
        const position = tail.indexOf(delimiter);
        if (position !== -1 && position < end) end = position;
      }
      return tail.slice(0, end);
    }

    function detectMedia(input) {
      const candidate = extractUrl(input.trim());
      if (!candidate) return '';

      try {
        const url = new URL(candidate);
        const hostname = url.hostname.toLowerCase();
        const route = (url.pathname + url.hash).toLowerCase();
        if (hostname === 'live.bilibili.com') return 'bilibiliLive';
        if (hostname === 'b23.tv' || hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com')) {
          return 'bilibiliVideo';
        }
        if (hostname === 'music.163.com' || hostname.endsWith('.music.163.com') ||
            hostname === '163cn.tv' || hostname === 'y.music.163.com') {
          return route.includes('/mv') ? 'neteaseMv' : 'neteaseSong';
        }
        if (hostname === 'douyin.com' || hostname.endsWith('.douyin.com') ||
            hostname === 'iesdouyin.com' || hostname.endsWith('.iesdouyin.com')) {
          return 'douyinVideo';
        }
        if (hostname === 'kuaishou.com' || hostname.endsWith('.kuaishou.com') ||
            hostname === 'kwai.com' || hostname.endsWith('.kwai.com')) {
          return 'kuaishouVideo';
        }
        if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com') ||
            hostname === 'youtu.be' || hostname.endsWith('.youtu.be') ||
            hostname === 'youtube-nocookie.com' || hostname.endsWith('.youtube-nocookie.com')) {
          return 'youtubeVideo';
        }
      } catch {
        return '';
      }
      return '';
    }

    function updateMediaOptions() {
      const kind = detectMedia(mediaUrl.value);
      if (kind === currentMediaKind) return;
      currentMediaKind = kind;

      const media = mediaKinds[kind];
      const options = media?.qualities || [['', '自动选择']];
      quality.replaceChildren(...options.map(function (item) {
        const option = document.createElement('option');
        option.value = item[0];
        option.textContent = item[1];
        return option;
      }));

      platformHint.dataset.platform = media?.platform || '';
      platformHint.textContent = media?.label || '未识别：请粘贴 Bilibili、抖音、快手、YouTube 或网易云链接';
      qualityHelp.textContent = media?.help || '识别媒体平台后显示对应的画质或音质。';
    }

    function buildRequestUrl() {
      if (!mediaUrl.value.trim()) return '';
      const request = new URL('/' + selectedMode(), window.location.origin);
      request.searchParams.set('url', mediaUrl.value.trim());
      if (apiKey.value) request.searchParams.set('key', apiKey.value);
      if (selectedMode() === 'play' && quality.value) request.searchParams.set('quality', quality.value);
      return request.href;
    }

    function updatePreview() {
      updateMediaOptions();
      quality.disabled = selectedMode() !== 'play';
      const requestUrl = buildRequestUrl();
      preview.textContent = requestUrl || '等待输入媒体链接';
    }

    form.addEventListener('input', updatePreview);
    form.addEventListener('change', updatePreview);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      window.open(buildRequestUrl(), '_blank', 'noopener');
    });
    pasteButton.addEventListener('click', async function () {
      try {
        const text = await navigator.clipboard.readText();
        if (!text.trim()) {
          platformHint.dataset.platform = '';
          platformHint.textContent = '剪贴板为空';
          return;
        }
        mediaUrl.value = text.trim();
        updatePreview();
        pasteButton.textContent = '已粘贴';
        window.setTimeout(function () { pasteButton.textContent = '粘贴'; }, 1200);
      } catch {
        platformHint.dataset.platform = '';
        platformHint.textContent = '无法读取剪贴板，请允许浏览器权限或手动粘贴';
        mediaUrl.focus();
      }
    });
    copyButton.addEventListener('click', async function () {
      const requestUrl = buildRequestUrl();
      if (!requestUrl) {
        mediaUrl.focus();
        return;
      }
      await navigator.clipboard.writeText(requestUrl);
      copyButton.textContent = '已复制';
      window.setTimeout(function () { copyButton.textContent = '复制链接'; }, 1200);
    });
    updatePreview();
  </script>
</body>
</html>`;

export function homePage() {
  return new Response(HOME_HTML, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}
