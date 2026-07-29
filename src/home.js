const HOME_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Vrc2Link API</title>
  <style>
    :root {
      color-scheme: light dark;
      --page: #f5f5f7;
      --surface: #ffffff;
      --surface-raised: rgba(255, 255, 255, 0.82);
      --surface-soft: #f0f0f2;
      --label: #1d1d1f;
      --secondary: #6e6e73;
      --tertiary: #8e8e93;
      --separator: rgba(60, 60, 67, 0.16);
      --separator-strong: rgba(60, 60, 67, 0.28);
      --blue: #007aff;
      --blue-pressed: #0066d6;
      --green: #248a3d;
      --orange: #c93400;
      --code: #1d1d1f;
      --code-label: #f5f5f7;
      --focus: rgba(0, 122, 255, 0.24);
      --shadow: 0 14px 38px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: var(--page);
      color: var(--label);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
      font-size: 16px;
      line-height: 1.55;
      letter-spacing: 0;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    button, input, select { font: inherit; letter-spacing: 0; }
    button, a, input, select { -webkit-tap-highlight-color: transparent; }
    a { color: var(--blue); }
    code, pre, output { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
    h1, h2, h3, p { letter-spacing: 0; }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      min-height: 52px;
      background: rgba(250, 250, 252, 0.74);
      backdrop-filter: blur(22px) saturate(180%);
      -webkit-backdrop-filter: blur(22px) saturate(180%);
      box-shadow: 0 1px 0 var(--separator), 0 8px 20px rgba(0, 0, 0, 0.03);
    }
    .topbar-inner, .section-inner, footer {
      width: min(1080px, calc(100% - 40px));
      margin: 0 auto;
    }
    .topbar-inner {
      min-height: 52px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      color: var(--label);
      font-size: 15px;
      font-weight: 650;
      text-decoration: none;
    }
    .brand-mark {
      width: 26px;
      height: 26px;
      display: grid;
      place-items: center;
      border-radius: 7px;
      background: var(--label);
      color: var(--surface);
      font-size: 9px;
      font-weight: 750;
    }
    nav { display: flex; align-items: center; gap: 22px; }
    nav a {
      color: var(--secondary);
      font-size: 13px;
      font-weight: 520;
      text-decoration: none;
      transition: color 120ms ease-out;
    }
    nav a:hover { color: var(--label); }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--green);
      font-size: 12px;
      font-weight: 620;
    }
    .status::before {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #30d158;
      box-shadow: 0 0 0 3px rgba(48, 209, 88, 0.14);
      content: "";
    }

    main { display: block; }
    section { scroll-margin-top: 60px; }
    .workspace-band { padding: 36px 0 52px; }
    .docs-band {
      padding: 56px 0;
      border-top: 1px solid var(--separator);
      background: var(--surface);
    }
    .plain-band {
      padding: 52px 0;
      border-top: 1px solid var(--separator);
    }
    .workspace-heading {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
      gap: 24px;
      margin-bottom: 24px;
    }
    .eyebrow {
      margin: 0 0 4px;
      color: var(--blue);
      font-size: 12px;
      font-weight: 650;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      font-size: 36px;
      font-weight: 720;
      line-height: 1.12;
    }
    .lead {
      max-width: 660px;
      margin: 8px 0 0;
      color: var(--secondary);
      font-size: 15px;
    }
    .route-summary { display: flex; align-items: center; gap: 8px; }
    .route-row {
      min-width: 116px;
      padding: 8px 10px;
      border: 1px solid var(--separator);
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.5);
    }
    .route-row .method {
      display: block;
      color: var(--green);
      font-size: 10px;
      font-weight: 720;
    }
    .route-row code { color: var(--label); font-size: 13px; font-weight: 650; }
    .route-row span:last-child { display: none; }

    .request-builder {
      display: grid;
      grid-template-columns: minmax(0, 1.18fr) minmax(300px, 0.82fr);
      overflow: hidden;
      border: 1px solid var(--separator);
      border-radius: 8px;
      background: var(--surface-raised);
      box-shadow: var(--shadow);
      backdrop-filter: blur(26px) saturate(150%);
      -webkit-backdrop-filter: blur(26px) saturate(150%);
      animation: materialize 360ms cubic-bezier(0.2, 0.75, 0.25, 1) both;
    }
    .builder-form { min-width: 0; padding: 26px; }
    .builder-side {
      min-width: 0;
      padding: 26px;
      display: flex;
      flex-direction: column;
      border-left: 1px solid var(--separator);
      background: rgba(245, 245, 247, 0.58);
    }
    .panel-title {
      margin: 0 0 18px;
      color: var(--label);
      font-size: 13px;
      font-weight: 650;
    }
    .field { display: grid; gap: 7px; margin-bottom: 17px; }
    .field:last-child { margin-bottom: 0; }
    .field-label, legend {
      color: var(--label);
      font-size: 12px;
      font-weight: 620;
    }
    .field-help {
      min-height: 19px;
      margin: 0;
      color: var(--secondary);
      font-size: 12px;
      line-height: 1.5;
    }
    .platform-hint {
      min-height: 19px;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 7px;
      color: var(--secondary);
      font-size: 12px;
      font-weight: 560;
    }
    .platform-hint::before {
      width: 7px;
      height: 7px;
      flex: 0 0 7px;
      border-radius: 50%;
      background: var(--tertiary);
      content: "";
    }
    .platform-hint[data-platform="bilibili"] { color: #a52a52; }
    .platform-hint[data-platform="bilibili"]::before { background: #fb7299; }
    .platform-hint[data-platform="netease"] { color: #b42318; }
    .platform-hint[data-platform="netease"]::before { background: #e94235; }
    .platform-hint[data-platform="douyin"] { color: var(--label); }
    .platform-hint[data-platform="douyin"]::before { background: #25f4ee; box-shadow: 2px 0 #fe2c55; }
    .platform-hint[data-platform="kuaishou"] { color: var(--orange); }
    .platform-hint[data-platform="kuaishou"]::before { background: #ff5000; }
    .platform-hint[data-platform="youtube"] { color: #b42318; }
    .platform-hint[data-platform="youtube"]::before { background: #ff0033; }

    input[type="text"], input[type="url"], input[type="password"], select {
      width: 100%;
      min-height: 42px;
      padding: 9px 11px;
      border: 1px solid var(--separator-strong);
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.82);
      color: var(--label);
      outline: none;
      transition: border-color 120ms ease-out, box-shadow 120ms ease-out, background 120ms ease-out;
    }
    input::placeholder { color: var(--tertiary); }
    input:hover, select:hover { border-color: rgba(60, 60, 67, 0.42); }
    input:focus, select:focus, button:focus-visible {
      border-color: var(--blue);
      box-shadow: 0 0 0 4px var(--focus);
      outline: none;
    }
    .input-with-action { display: grid; grid-template-columns: minmax(0, 1fr) 78px; }
    .input-with-action input {
      position: relative;
      z-index: 1;
      min-width: 0;
      border-radius: 7px 0 0 7px;
    }
    .input-with-action input:focus { z-index: 2; }
    .paste-button {
      min-height: 42px;
      margin-left: -1px;
      padding: 7px 11px;
      border: 1px solid var(--separator-strong);
      border-radius: 0 7px 7px 0;
      background: var(--surface-soft);
      color: var(--blue);
      white-space: nowrap;
    }
    .paste-button:hover { background: #e7e7eb; }
    fieldset { margin: 0 0 17px; padding: 0; border: 0; }
    legend { margin-bottom: 7px; }
    .segment {
      display: grid;
      grid-template-columns: 1fr 1fr;
      padding: 3px;
      border-radius: 7px;
      background: rgba(118, 118, 128, 0.12);
    }
    .segment input { position: absolute; opacity: 0; pointer-events: none; }
    .segment label {
      min-height: 34px;
      display: grid;
      place-items: center;
      border-radius: 5px;
      color: var(--secondary);
      cursor: pointer;
      font-size: 13px;
      font-weight: 580;
      transition: background 140ms ease-out, color 140ms ease-out, box-shadow 140ms ease-out;
    }
    .segment label:active { transform: scale(0.985); }
    .segment input:checked + label {
      background: var(--surface);
      color: var(--label);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    }
    .segment input:focus-visible + label { box-shadow: 0 0 0 3px var(--focus); }
    select:disabled { background: rgba(118, 118, 128, 0.08); color: var(--tertiary); cursor: not-allowed; }

    .request-preview {
      flex: 1;
      min-height: 150px;
      margin: 0 0 14px;
      padding: 15px;
      overflow: auto;
      overflow-wrap: anywhere;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 7px;
      background: var(--code);
      color: var(--code-label);
      font-size: 12px;
      line-height: 1.6;
    }
    .preview-meta {
      margin: 0 0 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: var(--secondary);
      font-size: 12px;
    }
    .preview-meta code { color: var(--green); font-weight: 650; }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
    button {
      min-height: 40px;
      padding: 8px 13px;
      border: 1px solid transparent;
      border-radius: 7px;
      background: var(--blue);
      color: #fff;
      cursor: pointer;
      font-weight: 620;
      transition: background 110ms ease-out, transform 80ms ease-out, box-shadow 120ms ease-out;
    }
    button:hover { background: #0a84ff; }
    button:active { transform: scale(0.975); background: var(--blue-pressed); }
    button.secondary {
      border-color: var(--separator-strong);
      background: var(--surface);
      color: var(--label);
    }
    button.secondary:hover { background: var(--surface-soft); }
    button.secondary:active { background: #dedee3; }

    .section-heading {
      display: grid;
      grid-template-columns: minmax(0, 0.65fr) minmax(280px, 1fr);
      gap: 36px;
      align-items: start;
      margin-bottom: 30px;
    }
    h2 { margin: 0; font-size: 25px; font-weight: 700; line-height: 1.2; }
    .section-heading p { margin: 1px 0 0; color: var(--secondary); font-size: 14px; }
    .endpoint {
      display: grid;
      grid-template-columns: 178px minmax(0, 1fr);
      gap: 36px;
      padding: 30px 0;
      border-top: 1px solid var(--separator);
    }
    .endpoint:last-child { padding-bottom: 0; }
    .endpoint h3 { margin: 3px 0 4px; font-size: 20px; font-weight: 680; }
    .endpoint > div:first-child p { margin: 0; color: var(--secondary); font-size: 13px; }
    .endpoint-copy > p { margin: 0 0 18px; color: var(--secondary); font-size: 14px; }
    .tag { color: var(--green); font-size: 10px; font-weight: 720; }
    table { width: 100%; margin: 0 0 20px; border-collapse: collapse; }
    th, td { padding: 10px 9px; border-bottom: 1px solid var(--separator); text-align: left; vertical-align: top; }
    th { color: var(--secondary); font-size: 11px; font-weight: 650; }
    td { font-size: 13px; }
    td code { color: var(--blue); }
    .compat-note {
      margin: 18px 0;
      padding: 12px 14px;
      border-left: 3px solid #ff9f0a;
      background: rgba(255, 159, 10, 0.09);
      color: #6e4300;
      font-size: 13px;
    }
    .compat-note strong { display: block; margin-bottom: 3px; color: #573500; }
    pre {
      margin: 0;
      padding: 15px;
      overflow: auto;
      border-radius: 7px;
      background: var(--code);
      color: var(--code-label);
      font-size: 12px;
      line-height: 1.6;
    }
    .note-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 36px; }
    .note-grid > div { padding-top: 18px; border-top: 1px solid var(--separator); }
    .note-grid h3, .config-guide h3 { margin: 0 0 7px; font-size: 16px; font-weight: 650; }
    .note-grid p, .config-guide p { margin: 0; color: var(--secondary); font-size: 14px; }
    .config-guide {
      display: grid;
      grid-template-columns: minmax(0, 0.72fr) minmax(390px, 1.28fr);
      gap: 36px;
      margin-top: 30px;
      padding-top: 24px;
      border-top: 1px solid var(--separator);
    }
    .error-list { display: grid; grid-template-columns: repeat(5, 1fr); border-top: 1px solid var(--separator); }
    .error-item { min-width: 0; padding: 16px 12px; border-right: 1px solid var(--separator); }
    .error-item:last-child { border-right: 0; }
    .error-item strong { display: block; font-size: 17px; font-weight: 680; }
    .error-item span { color: var(--secondary); font-size: 12px; }
    footer {
      padding: 26px 0 34px;
      display: flex;
      justify-content: space-between;
      gap: 20px;
      color: var(--secondary);
      font-size: 12px;
    }

    @keyframes materialize {
      from { opacity: 0; transform: translateY(6px) scale(0.995); filter: blur(4px); }
      to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
    }

    @media (max-width: 820px) {
      .topbar-inner, .section-inner, footer { width: min(100% - 28px, 1080px); }
      nav a { display: none; }
      .workspace-heading { grid-template-columns: 1fr; gap: 16px; }
      .route-summary { justify-content: flex-start; }
      .request-builder, .endpoint { grid-template-columns: 1fr; }
      .builder-side { border-top: 1px solid var(--separator); border-left: 0; }
      .section-heading { grid-template-columns: 1fr; gap: 8px; }
      .endpoint { gap: 14px; }
      .note-grid, .config-guide { grid-template-columns: 1fr; gap: 22px; }
      .error-list { grid-template-columns: repeat(3, 1fr); }
      .error-item:nth-child(3) { border-right: 0; }
    }

    @media (max-width: 520px) {
      .workspace-band { padding: 26px 0 36px; }
      .docs-band, .plain-band { padding: 40px 0; }
      h1 { font-size: 30px; }
      .lead { font-size: 14px; }
      .route-row { min-width: 104px; }
      .builder-form, .builder-side { padding: 18px; }
      .input-with-action { grid-template-columns: minmax(0, 1fr) 70px; }
      .actions { grid-template-columns: 1fr; }
      .request-preview { min-height: 112px; }
      .error-list { grid-template-columns: 1fr 1fr; }
      .error-item:nth-child(3) { border-right: 1px solid var(--separator); }
      .error-item:nth-child(even) { border-right: 0; }
      footer { flex-direction: column; gap: 4px; }
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --page: #000000;
        --surface: #1c1c1e;
        --surface-raised: rgba(37, 37, 39, 0.86);
        --surface-soft: #2c2c2e;
        --label: #f5f5f7;
        --secondary: #aeaeb2;
        --tertiary: #8e8e93;
        --separator: rgba(235, 235, 245, 0.14);
        --separator-strong: rgba(235, 235, 245, 0.28);
        --blue: #0a84ff;
        --blue-pressed: #0071e3;
        --green: #30d158;
        --code: #101011;
        --code-label: #f5f5f7;
        --focus: rgba(10, 132, 255, 0.28);
        --shadow: 0 16px 46px rgba(0, 0, 0, 0.42);
      }
      .topbar { background: rgba(18, 18, 19, 0.76); }
      .brand-mark { background: var(--label); color: #111; }
      .route-row { background: rgba(44, 44, 46, 0.58); }
      input[type="text"], input[type="url"], input[type="password"], select { background: rgba(44, 44, 46, 0.78); }
      .paste-button:hover, button.secondary:hover { background: #3a3a3c; }
      button.secondary:active { background: #48484a; }
      .compat-note { color: #ffd18a; }
      .compat-note strong { color: #ffe2b2; }
    }

    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; }
      .request-builder { animation-name: none; }
    }

    @media (prefers-reduced-transparency: reduce) {
      .topbar, .request-builder { background: var(--surface); backdrop-filter: none; -webkit-backdrop-filter: none; }
    }

    @media (prefers-contrast: more) {
      .topbar, .request-builder, input, select, .paste-button { border-color: currentColor; }
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
    <section class="workspace-band" id="request">
      <div class="section-inner">
        <div class="workspace-heading">
          <div>
            <p class="eyebrow">VRChat Media Resolver</p>
            <h1>Vrc2Link</h1>
            <p class="lead">把平台链接转换成 VRChat 可用的播放地址，或查看完整解析结果。</p>
          </div>
          <div class="route-summary" aria-label="接口摘要">
            <div class="route-row"><span class="method">GET</span><code>/api</code><span>详细解析结果</span></div>
            <div class="route-row"><span class="method">GET</span><code>/play</code><span>302 播放跳转</span></div>
          </div>
        </div>

        <form class="request-builder" id="request-builder">
          <div class="builder-form">
            <p class="panel-title">创建请求</p>
            <div class="field">
              <label class="field-label" for="media-url">媒体链接、AV 号或分享文本</label>
              <div class="input-with-action">
                <input id="media-url" name="url" type="text" inputmode="url" required placeholder="粘贴平台链接、Bilibili AV 号或分享文本" autocomplete="off" aria-describedby="platform-hint">
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
            <div class="preview-meta"><span>请求预览</span><code>HTTPS</code></div>
            <output class="request-preview" id="request-preview" aria-live="polite">等待输入媒体链接</output>
            <div class="actions">
              <button type="submit">打开请求</button>
              <button class="secondary" id="copy-request" type="button">复制链接</button>
            </div>
          </div>
        </form>
      </div>
    </section>

    <section class="docs-band" id="endpoints">
      <div class="section-inner">
        <div class="section-heading">
          <h2>接口</h2>
          <p>媒体地址通过 URL 编码后的 <code>url</code> 参数传入。支持完整平台链接、Bilibili AV 号和分享文本。</p>
        </div>

        <article class="endpoint">
          <div>
            <span class="tag">GET</span>
            <h3><code>/api</code></h3>
            <p>详细 JSON</p>
          </div>
          <div class="endpoint-copy">
            <p>返回统一的媒体元数据、画质选项和实际播放流。<code>qualities</code> 是平台提供的选项，真正取得的直链以 <code>streams</code> 为准。</p>
            <table>
              <thead><tr><th>参数</th><th>必填</th><th>说明</th></tr></thead>
              <tbody>
                <tr><td><code>url</code></td><td>是</td><td>媒体地址或复制的平台分享文本</td></tr>
                <tr><td><code>key</code></td><td>否</td><td>启用服务器 Cookie 权限</td></tr>
              </tbody>
            </table>
            <div class="compat-note">
              <strong>Bilibili 高画质</strong>
              1080p、4K、8K 通常只提供 DASH 音视频分离流。Cookie 能解锁账号画质权限，但不会把两条轨道转换成带声音的单文件。
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
            <p>选择一个带画面和声音的可播放单文件并直接 302 跳转。不指定画质时选择最高可播放画质。</p>
            <table>
              <thead><tr><th>参数</th><th>必填</th><th>说明</th></tr></thead>
              <tbody>
                <tr><td><code>url</code></td><td>是</td><td>媒体地址或复制的平台分享文本</td></tr>
                <tr><td><code>quality</code></td><td>否</td><td>精确画质，不存在时返回 422</td></tr>
                <tr><td><code>key</code></td><td>否</td><td>启用服务器 Cookie 权限</td></tr>
              </tbody>
            </table>
            <div class="compat-note">
              <strong>为什么 1080p 会返回 422？</strong>
              <code>/play</code> 只做一次 302，不在服务器上合并 DASH 音视频。目标画质只有分离流时返回 <code>quality_unavailable</code>，不会静默降级或返回无声视频。
            </div>
            <pre><code>GET /play?quality=720p&amp;url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV...</code></pre>
          </div>
        </article>
      </div>
    </section>

    <section class="plain-band" id="auth">
      <div class="section-inner">
        <div class="section-heading">
          <h2>鉴权与 Cookie</h2>
          <p>平台 Cookie 只保存在服务器配置中，只有请求携带正确 <code>key</code> 时才会启用。</p>
        </div>
        <div class="note-grid">
          <div>
            <h3>匿名请求</h3>
            <p>不传 <code>key</code> 时不会使用服务器 Cookie，按平台公开权限解析。</p>
          </div>
          <div>
            <h3>鉴权请求</h3>
            <p><code>key</code> 与 <code>API_KEY</code> 一致时使用对应平台 Cookie；错误密钥返回 401。</p>
          </div>
        </div>
        <div class="config-guide">
          <div>
            <h3>配置文件</h3>
            <p>复制 <code>config.example.env</code> 为 <code>config.env</code>，粘贴完整 Cookie 请求头并重启服务。</p>
          </div>
          <pre><code>PORT=7890
API_KEY=替换成随机密钥
BILIBILI_COOKIE=完整的 Bilibili Cookie 请求头
NETEASE_COOKIE=完整的网易云 Cookie 请求头
DOUYIN_COOKIE=完整的抖音 Cookie 请求头
KUAISHOU_COOKIE=完整的快手 Cookie 请求头</code></pre>
        </div>
      </div>
    </section>

    <section class="docs-band" id="runtime">
      <div class="section-inner">
        <div class="section-heading">
          <h2>运行状态</h2>
          <p>生产运行状态保存在本机 SQLite，不需要额外部署 Redis。</p>
        </div>
        <div class="note-grid">
          <div>
            <h3>匿名缓存</h3>
            <p>匿名解析默认缓存 300 秒，重启后仍有效；鉴权请求不会缓存。<code>X-Cache</code> 表示命中状态。</p>
          </div>
          <div>
            <h3>请求限额</h3>
            <p>匿名默认 10 次/分钟，鉴权默认 60 次/分钟，每个 IP 总计 120 次/分钟。超额返回 <code>429 rate_limited</code>。</p>
          </div>
        </div>
        <div class="config-guide">
          <div>
            <h3>请求追踪</h3>
            <p>响应包含 <code>X-Request-Id</code>。JSON 日志不记录 Cookie、完整 API key、查询串或原始 IP。</p>
          </div>
          <pre><code>SQLITE_PATH=data/vrc2link.sqlite
CACHE_TTL_SECONDS=300
RATE_LIMIT_ANON_PER_MINUTE=10
RATE_LIMIT_AUTH_PER_MINUTE=60
RATE_LIMIT_IP_PER_MINUTE=120
TRUST_PROXY=false</code></pre>
        </div>
      </div>
    </section>

    <section class="plain-band" id="errors">
      <div class="section-inner">
        <div class="section-heading">
          <h2>状态码</h2>
          <p>错误响应统一使用 <code>{ "error": { "code": "...", "message": "..." } }</code>。</p>
        </div>
        <div class="error-list">
          <div class="error-item"><strong>400</strong><span>地址缺失或无法识别</span></div>
          <div class="error-item"><strong>401</strong><span>访问密钥错误</span></div>
          <div class="error-item"><strong>422</strong><span>指定画质不可用</span></div>
          <div class="error-item"><strong>429</strong><span>请求频率超过限额</span></div>
          <div class="error-item"><strong>502</strong><span>平台接口解析失败</span></div>
        </div>
      </div>
    </section>
  </main>

  <footer>
    <span>Vrc2Link v2.0.0</span>
    <span>Bilibili · Douyin · Kuaishou · Netease · YouTube</span>
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
      const trimmed = input.trim();
      if (/(?:^|[^a-zA-Z0-9])av\\d+(?![a-zA-Z0-9])/i.test(trimmed)) return 'bilibiliVideo';
      const candidate = extractUrl(trimmed);
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
