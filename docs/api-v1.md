# Vrc2Link HTTP API v1

所有新客户端统一使用 `/api/v1`。接口采用 HTTPS 和 UTF-8；资源读取使用 `GET`，跨域预检使用 `OPTIONS`；DASH 票据资源也支持无响应体的 `HEAD`。媒体播放、合集选曲和 DASH 轨道通过 HTTP 重定向交给 VRChat 客户端，不代理或加工媒体。

完整机器可读规范位于 [`openapi-v1.yaml`](openapi-v1.yaml)，服务也通过 `GET /api/v1/openapi.yaml` 提供该文件。

## JSON 格式

成功的 JSON 响应统一使用 `data` 与 `meta`：

```json
{
  "data": {
    "platform": "bilibili",
    "type": "video"
  },
  "meta": {
    "apiVersion": "1",
    "requestId": "3e9e16c5-0eb2-46f7-b62c-0f7a14293b1a"
  }
}
```

JSON 错误统一使用 `error` 与 `meta`，HTTP 状态码表达错误类别，`error.code` 是稳定的机器码：

```json
{
  "error": {
    "code": "quality_unavailable",
    "message": "Requested quality is unavailable"
  },
  "meta": {
    "apiVersion": "1",
    "requestId": "3e9e16c5-0eb2-46f7-b62c-0f7a14293b1a"
  }
}
```

每个 v1 响应都带 `API-Version: 1` 和 `X-Request-Id`。限流响应还带 `Retry-After`、`X-RateLimit-Limit`、`X-RateLimit-Remaining` 与 `X-RateLimit-Reset`。重定向和 MPD 使用相应媒体类型，不包装成 JSON。

## 端点

| 方法与路径 | 成功响应 | 用途 |
| --- | --- | --- |
| `GET /api/v1` | JSON 信封 | 服务信息与规范入口 |
| `GET /api/v1/openapi.yaml` | `application/yaml` | OpenAPI 3.1 规范 |
| `GET /api/v1/media/resolve?url=...` | JSON 信封 | 解析媒体元数据、画质与播放流 |
| `GET /api/v1/play?url=...` | `302 Location` | 跳转到单流或 MPD；合集链接播放当前项或第一项 |
| `GET /api/v1/playlists/resolve?url=...` | JSON 信封 | 解析任意合集或歌单 |
| `GET /api/v1/playlists/current` | JSON 信封 | 获取本客户端最近播放链接对应的合集 |
| `GET /api/v1/playlists/current/items/{index}` | `302 Location` | 播放当前合集的指定条目，索引从 0 开始 |
| `GET /api/v1/danmaku/current/video/segments/{segment}` | JSON 信封 | 获取当前 Bilibili 视频的历史弹幕分段 |
| `GET /api/v1/danmaku/current/live` | JSON 信封 | 获取当前 Bilibili 直播的新弹幕 |
| `GET /api/v1/dash/{ticket}/manifest.mpd` | MPD | 获取固定票据对应的 DASH 清单 |
| `GET /api/v1/dash/{ticket}/video` | `302 Location` | 跳转到 DASH 视频 CDN 直链 |
| `GET /api/v1/dash/{ticket}/audio` | `302 Location` | 跳转到 DASH 音频 CDN 直链 |

### 媒体解析与播放

`url` 是必填的 HTTP(S) 平台链接或分享文本，必须按 URL 查询参数规则编码。`mode` 可选值为 `single`、`dash`、`auto`，默认 `single`。`quality` 是可选的精确画质。`auto` 会优先为 Bilibili 视频选择兼容的 DASH 音视频轨；上游没有可用 DASH 轨时，回落到匹配所选画质的单文件流。其他受支持平台使用单流。指定画质不可用时返回 `422`，不会静默切换到其他画质。

```text
GET /api/v1/media/resolve?url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV...
GET /api/v1/play?mode=auto&quality=1080p&url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV...
```

`media/resolve` 的 `data` 是媒体解析对象；DASH 模式还包含 `data.dash.manifestUrl`、`videoUrl`、`audioUrl` 和选轨信息。`play` 成功时直接返回 `302`，`Location` 指向媒体直链或 `manifest.mpd`。

### 合集与会话

`playlists/resolve` 接受 `url` 并返回合集条目。播放 `/api/v1/play` 后，服务端按请求来源 IP 记录当前播放会话；播放器用 `/playlists/current` 读取同一会话的合集，再请求 `/items/{index}` 切换曲目。曲目端点沿用会话创建时的 `mode` 和 `quality`。直接打开合集会自动开始当前项或第一项；从单个视频读取到合集时不会因此打断该视频。

合集会话是短期播放状态，不是账号或鉴权凭证。共享公网出口的客户端可能共用来源 IP，因此无法依赖 IP 做强隔离；世界中不要放置服务管理密钥。

### 弹幕

播放受支持的 Bilibili 媒体后，视频端点的 `segment` 从 1 开始，每段 360 秒；直播端点只返回本次轮询新出现的弹幕。`data.messages` 中每条记录包含 `id`、`time`、`mode`、`color` 和 `text`。当前会话没有对应媒体、模式不匹配或平台不支持时，服务返回标准错误信封。

### 鉴权

服务端配置 Cookie 后，通用 API 客户端通过标准请求头申请使用这些 Cookie：

```http
Authorization: Bearer YOUR_API_KEY
```

没有凭证的请求按匿名权限处理。`?key=...` 仅为旧客户端和浏览器跳转场景保留兼容；不要把密钥写入公开世界资产、日志或可分享链接。固定的合集与弹幕读取接口不接受账号 Cookie 权限。

### 状态码与错误码

| HTTP | 常见错误码 | 含义 |
| --- | --- | --- |
| `400` | `missing_url`、`invalid_url`、`invalid_play_mode`、`invalid_segment` | 参数格式错误 |
| `401` | `invalid_key`、`invalid_authorization` | 鉴权凭证错误 |
| `404` | `not_found`、`dash_ticket_not_found` | 路径或票据不存在/过期 |
| `405` | `method_not_allowed` | 使用了不支持的方法 |
| `409` | `no_playlist_session`、`no_danmaku_session`、`playlist_session_pending` | 当前会话尚未建立或状态冲突 |
| `422` | `quality_unavailable`、`not_a_playlist`、`danmaku_unsupported` | 请求有效，但当前内容无法提供该功能 |
| `429` | `rate_limited` | 超出请求额度；按 `Retry-After` 重试 |
| `502` | `upstream_error`、`dash_track_unavailable` | 上游平台或媒体源失败 |
| `503` | `state_unavailable` | 服务端状态存储不可用 |

客户端应以 `error.code` 分支处理，不解析英文 `error.message`。服务端可能增加错误码；同一错误码的含义保持稳定。

## 兼容策略

原有 `/api`、`/play`、`/playlist`、`/playlist/current`、`/playlist/current/item/{index}`、`/danmaku/current` 与 `/dash/{ticket}/...` 路径继续作为兼容入口。兼容入口维持旧 JSON 结构；从新客户端迁移时请使用 `/api/v1` 和本文的信封格式。早期 `/api?playlist=1` 与 `/api?playlistItem=N` 已停用并返回 `410`。
