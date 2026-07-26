# Vrc2Link

Bilibili / Netease Cloud Music → direct stream URL. Built for VRChat players.

Deploy on a domestic (Chinese) server — no Cloudflare, no proxy needed.

## Quick Start

```bash
npm start        # → http://localhost:3000
npm run dev      # auto-restart on changes
```

Set port: `PORT=8080 npm start`

## Endpoints

### `GET /api/parse?url=<encoded>`

Returns JSON with all streams, metadata, and quality options.

```
curl "http://localhost:3000/api/parse?url=https://www.bilibili.com/video/BV1xx411c7mD"
```

### `GET /r?url=<encoded>`

302 redirects to the best direct stream URL. Paste into VRChat.

```
http://localhost:3000/r?url=https://www.bilibili.com/video/BV1xx411c7mD
```

### Query params

| Param | Value |
|-------|-------|
| `url` | Encoded B站/网易云 URL (required) |
| `cookie` | Login cookie string for higher quality |
| `quality` | Override quality selection (`/r` only) |
| `platform` | Force platform: `bilibili` or `netease` |

## Supported

| Platform | Types | Formats |
|----------|-------|---------|
| Bilibili | Video, Live | mp4, flv, m3u8 |
| Netease | Song, MV | mp3, flac, mp4 |

## Deploy

Deploy on any domestic server with Node.js 18+:

```bash
git clone https://github.com/yixijun/Vrc2Link.git
cd Vrc2Link
npm start
```

For production, use PM2 or systemd to keep it running.
