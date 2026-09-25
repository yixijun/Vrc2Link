# Vrc2Link + VizVid Bilibili DASH 验证记录

更新时间：2026-09-20

当前采用方案 A：Vrc2Link 解析并生成 MPD，音视频入口只重定向到 Bilibili CDN；VRChat 客户端负责 DASH 解码、播放和音画同步。服务端没有下载、合流、转码或重新封装媒体。

## 能力矩阵

| 能力 | 当前结论 | 证据 |
| --- | --- | --- |
| Bilibili DASH 请求 | 已实现 | `mode=dash` 使用 `fnval=16`，保留视频/音频编码、带宽、尺寸、时长、初始化范围和索引范围 |
| H.264/AAC 选轨 | 已实现 | 只接受请求画质的 H.264 视频和 AAC 音频；缺失时返回明确错误，不静默降级 |
| MPD 生成 | 已实现（服务端样例） | `/dash/<ticket>/manifest.mpd`；MPD XML 解析通过，含视频、音频、BaseURL、SegmentBase 和声道描述 |
| 音视频入口 | 已实现（服务端样例） | `/dash/<ticket>/video`、`/audio` 返回 302，不读取媒体 body；支持 DASH 资源的 HEAD |
| ticket 刷新 | 已实现（服务端样例） | 临近 CDN 直链过期时只重新解析相同 source、BV/CID、画质；绝对 ticket 有效期不会被刷新延长 |
| 服务端自动化测试 | 通过 | `npm test`：67 项通过 |
| 公开 CDN 直连探针 | 通过（普通单文件样本） | 不带 Referer 的 `Range: bytes=0-0` 返回 206；仅取 1 字节，没有下载媒体 |
| 公开 1080p DASH 样本 | 尚未证实 | 当前公开探测样本只返回 720p `durl`，没有 DASH 音视频轨；未使用账号 Cookie |
| VizVid URL 选择 | 已修改，未编译 | `/play?mode=auto&quality=1080p` 会让 Bilibili 视频走 DASH、其他平台走单流；Bilibili DASH 请求选择 AVPro |
| Windows VRChat 客户端播放 | 未验证 | 仍需用实际客户端测试 MPD 加载、声音、跳转和过期恢复 |
| Quest 客户端播放 | 未验证 | 需单独记录 CDN 直连和 AVPro/VRChat 实际行为 |

## 已加入的接口

```text
/play?mode=dash&quality=1080p&url=<encoded-bilibili-url>
/api?mode=dash&quality=1080p&url=<encoded-bilibili-url>
/dash/<ticket>/manifest.mpd
/dash/<ticket>/video
/dash/<ticket>/audio
```

`ticket` 是随机不透明票据，只能访问绑定的媒体清单和两条轨道入口，不携带账号 Cookie 权限。刷新时如果 BV 或 CID 发生变化会拒绝更新。

## 尚未宣称的内容

- AVPro 商业版文档支持 DASH，不等于当前 VRChat 内置版本一定接受这份 MPD。
- 编辑器或静态代码检查不能替代 VRChat Windows/Quest 客户端测试。
- Bilibili CDN 是否长期允许 VRChat 直连、是否允许跳转和 Range 请求，必须以客户端实测为准。
- 如果直连被 CDN 拒绝，当前实现不会暗中启用媒体代理；那会作为单独依赖和方案决策处理。
