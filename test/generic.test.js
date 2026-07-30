import assert from 'node:assert/strict';
import test from 'node:test';

import { parseGenericVideo, sniffHtmlMedia } from '../src/platforms/generic.js';
import { resolveMedia, selectPlayableStream } from '../src/resolver.js';
import { assertPublicHttpUrl } from '../src/utils/public-url.js';

const SOURCE_URL = 'https://video.example/watch/123';
const PAYLOAD = {
  id: '123',
  title: 'Generic fixture',
  uploader: 'Tester',
  duration: 90,
  thumbnail: 'https://cdn.example/cover.jpg',
  formats: [
    {
      height: 720,
      ext: 'mp4',
      protocol: 'https',
      vcodec: 'avc1.64001f',
      acodec: 'mp4a.40.2',
      url: 'https://cdn.example/combined.mp4',
    },
    {
      height: 1080,
      ext: 'mp4',
      protocol: 'https',
      vcodec: 'avc1.640028',
      acodec: 'none',
      url: 'https://cdn.example/video-only.mp4',
    },
    {
      height: 2160,
      ext: 'mp4',
      protocol: 'https',
      vcodec: 'av01',
      acodec: 'opus',
      has_drm: true,
      url: 'https://cdn.example/drm.mp4',
    },
  ],
};

test('generic parser returns non-DRM streams and marks separated formats', async () => {
  const result = await parseGenericVideo(SOURCE_URL, {
    validateUrl: async (url) => url,
    fetchPage: async () => null,
    runYtDlp: async () => PAYLOAD,
  });

  assert.equal(result.platform, 'generic');
  assert.equal(result.meta.title, 'Generic fixture');
  assert.equal(result.streams.length, 2);
  assert.equal(result.streams[0].quality, '720p');
  assert.equal(result.streams[0].type, undefined);
  assert.equal(result.streams[1].type, 'video-only');
  assert.equal(selectPlayableStream({ ...result, type: 'video' }).url, 'https://cdn.example/combined.mp4');
});

test('HTML sniffer extracts the current MacCMS player stream', async () => {
  const html = `<html><head><title>Fixture</title></head><body>
    <script>var player_aaaa={"encrypt":0,"vod_data":{"vod_name":"回复术士的重来人生"},"url":"https:\/\/cdn.example\/current\/index.m3u8","url_next":"https:\/\/cdn.example\/next\/index.m3u8"}</script>
  </body></html>`;
  const result = await sniffHtmlMedia(SOURCE_URL, {
    fetchPage: async () => ({
      finalUrl: SOURCE_URL,
      contentType: 'text/html; charset=utf-8',
      html,
      title: 'Fixture',
    }),
  });

  assert.equal(result.meta.title, '回复术士的重来人生');
  assert.equal(result.streams[0].url, 'https://cdn.example/current/index.m3u8');
  assert.equal(result.streams[0].format, 'm3u8');

  const escapedHtml = String.raw`<script type=\"text\/javascript\">var player_aaaa={\"encrypt\":0,\"vod_data\":{\"vod_name\":\"\\u56de\\u590d\\u672f\\u58eb\"},\"url\":\"https:\\\/\\\/cdn.example\\\/escaped\\\/index.m3u8\"}<\/script>`;
  const escapedResult = await sniffHtmlMedia(SOURCE_URL, {
    fetchPage: async () => ({
      finalUrl: SOURCE_URL,
      contentType: 'text/html',
      html: escapedHtml,
      title: '',
    }),
  });
  assert.equal(escapedResult.meta.title, '回复术士');
  assert.equal(escapedResult.streams[0].url, 'https://cdn.example/escaped/index.m3u8');
});

test('generic resolver is opt-in and requires authentication by default', async () => {
  await assert.rejects(
    resolveMedia(SOURCE_URL),
    (error) => error.code === 'unsupported_url',
  );
  await assert.rejects(
    resolveMedia(SOURCE_URL, { generic: { enabled: true } }),
    (error) => error.code === 'generic_auth_required',
  );

  const result = await resolveMedia(SOURCE_URL, {
    authenticated: true,
    generic: {
      enabled: true,
      validateUrl: async (url) => url,
      fetchPage: async () => null,
      runYtDlp: async () => PAYLOAD,
    },
  });
  assert.equal(result.platform, 'generic');
  assert.equal(result.id, '123');
});

test('public URL validation blocks local and private destinations', async () => {
  for (const url of [
    'http://127.0.0.1/video',
    'http://10.0.0.1/video',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/video',
    'http://[::ffff:127.0.0.1]/video',
  ]) {
    await assert.rejects(
      assertPublicHttpUrl(url),
      (error) => error.code === 'unsafe_url',
    );
  }

  assert.equal(
    await assertPublicHttpUrl('https://93.184.216.34/video'),
    'https://93.184.216.34/video',
  );
});
