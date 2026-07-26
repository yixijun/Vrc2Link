# Vrc2Link

Bilibili / Netease Cloud Music → direct stream URL resolver for VRChat players.

Deployed on Cloudflare Workers.

## Endpoints

### `GET /api/parse`

Returns JSON with parsed media info and all available stream URLs.

```
GET /api/parse?url=https://www.bilibili.com/video/BV1GJ411x7h7
GET /api/parse?url=https://music.163.com/song?id=xxx
```

Optional params:
- `cookie` — login cookie string for higher quality
- `platform` — force platform detection (`bilibili` | `netease`)

### `GET /r`

302 redirects to the best direct stream URL. Paste into VRChat players.

```
GET /r?url=https://www.bilibili.com/video/BV1GJ411x7h7
GET /r?url=https://music.163.com/song?id=xxx&quality=320k
```

Optional params:
- `quality` — request specific quality tier
- `cookie` — login cookie for higher quality

## Supported

| Platform | Types | Formats |
|----------|-------|---------|
| Bilibili | Video (BV/AV), Live | mp4, flv, m3u8 |
| Netease | Song, MV | mp3, flac, mp4 |

## Quality

- **Bilibili**: 360p → 2K (capped at 1440p for VRChat compatibility)
- **Netease**: 128k → lossless (requires cookie for >128k)
- **Live**: HLS (m3u8) for automatic stream refresh

## Development

```bash
npm install
npm run dev     # wrangler dev — local dev server
npm run deploy  # wrangler deploy — push to Cloudflare
```

## Deploy

1. `npm install`
2. `npx wrangler login`
3. `npm run deploy`

Or configure `wrangler.toml` with your custom domain.
