# Vrc2Link

面向 VRChat 的 Bilibili、抖音、快手、YouTube 和网易云媒体链接服务。运行时零第三方依赖，需要 Node.js 24 或更高版本（使用内置 SQLite）。

## 启动

```powershell
Copy-Item config.example.env config.env
notepad config.env
npm start
```

默认监听 `http://localhost:7890`。浏览器打开根路径即可查看 Web 使用说明，并通过请求生成器创建 `/api` 或 `/play` 链接。

请求生成器会根据粘贴的链接自动识别 Bilibili 视频/直播、抖音/快手视频、YouTube 视频、网易云歌曲/MV，并只显示对应选项。Bilibili 视频支持 `b23.tv` 短链、`av170001`、标准 AV/BV 链接以及包含这些内容的分享文本；AV 号会转换为对应 BV 号供播放和弹幕使用。YouTube 不解析媒体流，`/play` 直接 302 到原链接并交给 VRChat 处理。

`config.env` 使用一行一个配置的格式：

```dotenv
PORT=7890
API_KEY=替换成随机密钥
BILIBILI_COOKIE=粘贴完整的 Bilibili Cookie 请求头
NETEASE_COOKIE=粘贴完整的网易云 Cookie 请求头
DOUYIN_COOKIE=粘贴完整的抖音 Cookie 请求头
KUAISHOU_COOKIE=粘贴完整的快手 Cookie 请求头
SQLITE_PATH=data/vrc2link.sqlite
CACHE_TTL_SECONDS=300
RATE_LIMIT_ANON_PER_MINUTE=10
RATE_LIMIT_AUTH_PER_MINUTE=60
RATE_LIMIT_IP_PER_MINUTE=120
RATE_LIMIT_WINDOW_SECONDS=60
TRUST_PROXY=false
```

Cookie 不需要挑选字段。在已登录的平台页面打开开发者工具，进入 Network，刷新页面，选择一个同平台请求，在 Request Headers 中复制完整的 `Cookie` 值，然后直接粘贴到对应等号后面。

`config.env` 已被 Git 忽略。也可以使用同名环境变量，环境变量会优先于配置文件：

## Bilibili 弹幕

`/play` 成功后，服务器会按客户端记录当前媒体；Unity 弹幕层通过固定的 `/api?danmaku=1` 地址读取数据，不需要在 Udon 运行时拼接 `VRCUrl`。Bilibili 普通视频按 6 分钟分段读取历史弹幕，Bilibili 直播读取最近弹幕并去重。旧的 `/danmaku/current` 地址仍保留兼容。

示例：

```text
/api?danmaku=1&segment=1
/api?danmaku=1&live=1
/api?url=<媒体地址>&danmaku=1&segment=1
```

需要在生产 `config.env` 增加：

```dotenv
DANMAKU_RATE_LIMIT_PER_MINUTE=90
DANMAKU_SESSION_TTL_SECONDS=21600
DANMAKU_MAX_VIDEO_MESSAGES=300
DANMAKU_MAX_LIVE_MESSAGES=30
```

抖音直播弹幕不在本次范围内；原有抖音短视频解析不受影响。Unity 安装步骤见 `Unity/Assets/Vrc2LinkDanmaku/README.md`。

| 环境变量 | 用途 |
| --- | --- |
| `PORT` | HTTP 端口，默认 `7890` |
| `API_KEY` | 启用服务器 Cookie 的访问密钥 |
| `BILIBILI_COOKIE` | Bilibili 登录 Cookie |
| `NETEASE_COOKIE` | 网易云登录 Cookie |
| `DOUYIN_COOKIE` | 抖音登录 Cookie |
| `KUAISHOU_COOKIE` | 快手登录 Cookie |
| `SQLITE_PATH` | SQLite 文件，默认 `data/vrc2link.sqlite` |
| `CACHE_TTL_SECONDS` | 匿名解析缓存秒数，默认 `300` |
| `RATE_LIMIT_ANON_PER_MINUTE` | 每个匿名客户端每窗口请求数，默认 `10` |
| `RATE_LIMIT_AUTH_PER_MINUTE` | 每个 API key 每窗口请求数，默认 `60` |
| `RATE_LIMIT_IP_PER_MINUTE` | 每个 IP 的总请求数，默认 `120` |
| `RATE_LIMIT_WINDOW_SECONDS` | 限流窗口秒数，默认 `60` |
| `TRUST_PROXY` | 是否信任代理 IP 请求头，默认 `false` |

修改配置后需要重启服务。不传 `key` 时使用匿名解析；传入正确的 `key` 时才会使用服务器 Cookie；错误的 `key` 返回 `401`。

## 缓存与限流

匿名解析结果会写入 SQLite，服务重启后仍可复用；携带正确 `key` 的请求使用 Cookie，永不缓存。缓存键只保存链接与画质的 SHA-256，不保存 API key。缓存命中状态通过 `X-Cache: HIT` 或 `MISS` 返回。

超过匿名、鉴权或 IP 任一额度时返回 `429` 和稳定错误码 `rate_limited`。响应包含 `Retry-After`、`X-RateLimit-Limit`、`X-RateLimit-Remaining`、`X-RateLimit-Reset`。

## `GET /api`

返回详细解析结果。`url` 可以是纯媒体地址，也可以是包含地址的平台分享文本。

```text
/api?url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1xx411c7mD
/api?key=YOUR_KEY&url=https%3A%2F%2Fmusic.163.com%2Fsong%3Fid%3D186016
```

响应字段经过统一，不直接透传平台原始响应：

```json
{
  "platform": "bilibili",
  "type": "video",
  "id": "BV1xx411c7mD",
  "title": "...",
  "author": "...",
  "cover": "https://...",
  "duration": 120,
  "authenticated": false,
  "qualities": ["1080p", "720p", "360p"],
  "streams": [
    {
      "quality": "720p",
      "format": "mp4",
      "codec": "avc",
      "url": "https://..."
    }
  ]
}
```

## `GET /play`

选择播放流并返回 `302`。不传 `quality` 时选择最高可播放画质；指定画质不存在时返回 `422`，不会静默降级。

Bilibili 的 1080p、4K、8K 通常是 DASH 音视频分离流，而 `/play` 只跳转到一个带声音的可播放文件，不负责服务器合并。因此多数 B 站视频的直接播放上限是 720p。Cookie 只能解锁账号权限，不能把 DASH 转换成单文件；`/api` 中应以 `streams` 判断实际取得的直链。

```text
/play?url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1xx411c7mD
/play?key=YOUR_KEY&quality=1080p&url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1xx411c7mD
```

支持的常用画质：`360p`、`480p`、`720p`、`1080p`、`4k`、`8k`、`original`、`128k`、`256k`、`320k`、`lossless`。抖音和快手当前返回分享页提供的 `original` 单文件流。

## 安全

生产环境必须使用 HTTPS。VRChat 只能通过 URL 传递 `key`，因此不要公开分享含有 `key` 的播放链接，也不要提交或分享 `config.env`。

每个响应都有 `X-Request-Id`。服务日志为单行 JSON，只记录方法、路径、状态、平台、缓存命中、耗时和客户端 IP 哈希，不记录查询串、Cookie、完整 API key 或原始 IP。

直接对公网监听时保持 `TRUST_PROXY=false`。只有服务位于可信 Nginx、Caddy 或 CDN 后方，并且源站端口不对公网开放时才设置为 `true`；此时限流会读取 `X-Forwarded-For` 或 `X-Real-IP`。

## PM2

```bash
npm run pm2:start
npm run pm2:logs
```
