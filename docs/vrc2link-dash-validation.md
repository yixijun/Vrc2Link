# Vrc2Link + VizVid Bilibili DASH 验证记录

更新时间：2026-11-13

当前采用方案 A：Vrc2Link 解析并生成 MPD，音视频入口只重定向到 Bilibili CDN；VRChat 客户端负责 DASH 解码、播放和音画同步。服务端没有下载、合流、转码或重新封装媒体。

DASH 目前作为 beta 播放策略隔离在 `src/dash-playback.js`；主解析入口默认继续走单流选择，只有明确请求 `mode=dash` 或 `mode=auto` 判定存在可用音视频轨时才进入该模块。

## 能力矩阵

| 能力 | 当前结论 | 证据 |
| --- | --- | --- |
| Bilibili DASH 请求 | 服务端路径已实现，实际轨道未证实 | `mode=dash` 使用 `fnval=16`，保留视频/音频编码、带宽、尺寸、时长、初始化范围和索引范围；公网样本未返回分离轨 |
| H.264/AAC 选轨 | 服务端逻辑已实现，实际轨道未证实 | 只接受请求画质的 H.264 视频和 AAC 音频；缺失时返回明确错误，不静默降级 |
| MPD 生成 | 服务端样例通过，客户端未验证 | `/api/v1/dash/<ticket>/manifest.mpd`；MPD XML 解析通过，含视频、音频、BaseURL、SegmentBase 和声道描述 |
| 音视频入口 | 服务端样例通过，客户端未验证 | `/api/v1/dash/<ticket>/video`、`/audio` 返回 302，不读取媒体 body；支持 DASH 资源的 HEAD |
| ticket 刷新 | 自动化验证，实际 CDN 恢复未验证 | 临近 CDN 直链过期时只重新解析相同 source、BV/CID、画质；绝对 ticket 有效期不会被刷新延长 |
| 服务端自动化测试 | 通过 | `npm test`：100 项通过 |
| 真实 Bilibili 1080p 单流解析 | 已验证（无 Cookie） | `BV1xx411c7mD` 返回 1080p、AVC、MP4 单文件流；`/play` 和 `mode=auto` 均返回 1080p CDN 重定向 |
| 公开 CDN 直连探针 | 已验证（1080p 单流样本） | 对 `BV1xx411c7mD` CDN 直链请求 `Range: bytes=0-1` 返回 `206 video/mp4`，`Content-Range: bytes 0-1/98632882`；未下载媒体 |
| 指定 Bilibili CDN 节点 | 已验证 | 设置 `BILIBILI_CDN_PREFERENCE=upos-sz-mirrorali.bilivideo.com` 后，真实 `/play` 重定向的 CDN 主机为该节点 |
| 公开 1080p DASH 样本 | 尚未证实 | `BV1xx411c7mD` 可返回 1080p 单文件 `durl`，但未返回 DASH 音视频分离轨；未使用账号 Cookie |
| 真实明确 DASH 请求 | 尚未证实 | 对 `BV1xx411c7mD` 请求 `mode=dash&quality=1080p` 返回 `upstream_error`，当前样本没有可用分离轨 |
| VizVid URL 选择 | 已修改，未编译 | `/api/v1/play?mode=auto&quality=1080p` 会让 Bilibili 视频走 DASH、其他平台走单流；Bilibili DASH 请求选择 AVPro |
| Windows VRChat 客户端播放 | 未验证 | 仍需用实际客户端测试 MPD 加载、声音、跳转和过期恢复 |
| Quest 客户端播放 | 未验证 | 需单独记录 CDN 直连和 AVPro/VRChat 实际行为 |

## 已加入的接口

```text
/api/v1/play?mode=dash&quality=1080p&url=<encoded-bilibili-url>
/api/v1/media/resolve?mode=dash&quality=1080p&url=<encoded-bilibili-url>
/api/v1/dash/<ticket>/manifest.mpd
/api/v1/dash/<ticket>/video
/api/v1/dash/<ticket>/audio
```

`ticket` 是随机不透明票据，只能访问绑定的媒体清单和两条轨道入口，不携带账号 Cookie 权限。刷新时如果 BV 或 CID 发生变化会拒绝更新。

## 尚未宣称的内容

- AVPro 商业版文档支持 DASH，不等于当前 VRChat 内置版本一定接受这份 MPD。
- 编辑器或静态代码检查不能替代 VRChat Windows/Quest 客户端测试。
- Bilibili CDN 是否长期允许 VRChat 直连、是否允许跳转和 Range 请求，必须以客户端实测为准。
- 如果直连被 CDN 拒绝，当前实现不会暗中启用媒体代理；那会作为单独依赖和方案决策处理。
