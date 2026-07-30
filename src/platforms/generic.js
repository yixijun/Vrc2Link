import { spawn } from 'node:child_process';

import { AppError } from '../errors.js';
import { assertPublicHttpUrl } from '../utils/public-url.js';

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_CONCURRENT = 2;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
let activeProcesses = 0;

export async function parseGenericVideo(sourceUrl, options = {}) {
  const validateUrl = options.validateUrl || assertPublicHttpUrl;
  const safeUrl = await validateUrl(sourceUrl);
  try {
    const sniffed = await sniffHtmlMedia(safeUrl, { ...options, validateUrl });
    if (sniffed) return sniffed;
  } catch (error) {
    if (error instanceof AppError && error.code === 'unsafe_url') throw error;
    // yt-dlp remains the fallback when the page cannot be fetched or inspected.
  }
  const runYtDlp = options.runYtDlp || executeYtDlp;
  const payload = await runYtDlp(safeUrl, options);
  const result = normalizeYtDlpResult(payload, safeUrl);
  if (!result.streams.length) {
    throw new AppError(422, 'no_direct_stream', 'No non-DRM media streams were found');
  }
  return result;
}

export async function sniffHtmlMedia(sourceUrl, options = {}) {
  const page = await (options.fetchPage || fetchHtmlPage)(sourceUrl, options);
  if (!page) return null;
  if (isMediaContentType(page.contentType)) {
    return directMediaResult(page.finalUrl, page.finalUrl, '', page.contentType);
  }

  const player = extractMacCmsPlayer(page.html);
  if (player?.url) {
    const mediaUrl = new URL(decodePlayerValue(player.url), page.finalUrl).href;
    const title = decodePlayerValue(player.vod_data?.vod_name || player.vod_name || '');
    return directMediaResult(mediaUrl, page.finalUrl, title);
  }

  const mediaElement = page.html.match(
    /<(?:video|source)\b[^>]*\b(?:src|data-src)\s*=\s*["']([^"']+)["']/iu,
  );
  if (mediaElement) {
    const mediaUrl = new URL(decodeHtmlEntities(mediaElement[1]), page.finalUrl).href;
    return directMediaResult(mediaUrl, page.finalUrl, page.title || '');
  }
  return null;
}

function decodePlayerValue(value) {
  return String(value || '')
    .replace(/\\+\//gu, '/')
    .replace(/\\+u([0-9a-f]{4})/giu, (_match, code) =>
      String.fromCharCode(Number.parseInt(code, 16)))
    .replaceAll('\\"', '"')
    .replaceAll('\\\\', '\\');
}

export async function fetchHtmlPage(sourceUrl, options = {}) {
  const validateUrl = options.validateUrl || assertPublicHttpUrl;
  const timeoutMs = Math.min(positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS), 15000);
  let currentUrl = sourceUrl;

  for (let redirects = 0; redirects <= 5; redirects++) {
    currentUrl = await validateUrl(currentUrl);
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });

    if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
      response.body?.cancel().catch(() => {});
      currentUrl = new URL(response.headers.get('location'), currentUrl).href;
      continue;
    }
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (isMediaContentType(contentType)) {
      response.body?.cancel().catch(() => {});
      return { finalUrl: currentUrl, contentType, html: '', title: '' };
    }
    if (contentType && !/html|json|javascript|text\//iu.test(contentType)) {
      response.body?.cancel().catch(() => {});
      return null;
    }

    const html = await readLimitedText(response, MAX_HTML_BYTES);
    const title = decodeHtmlEntities(html.match(/<title[^>]*>([^<]*)<\/title>/iu)?.[1] || '').trim();
    return { finalUrl: currentUrl, contentType, html, title };
  }

  throw new AppError(400, 'too_many_redirects', 'Generic page redirected too many times');
}

function extractMacCmsPlayer(html) {
  const text = String(html);
  const marker = text.search(/(?:var\s+)?player_aaaa\s*=/iu);
  if (marker === -1) return null;
  const fragment = text.slice(marker, marker + 100000)
    .replaceAll('\\"', '"')
    .replaceAll('\\/', '/');
  const json = extractAssignedJsonObject(fragment, 'player_aaaa');
  if (json) {
    try {
      const player = JSON.parse(json);
      if (Number(player.encrypt || 0) === 0) return player;
    } catch {
      // Some MacCMS templates escape parts of the script tag inconsistently.
    }
  }

  const encrypted = fragment.match(/["']?encrypt["']?\s*:\s*(\d+)/iu)?.[1];
  if (Number(encrypted || 0) !== 0) return null;
  const url = jsonStringField(fragment, 'url');
  if (!url) return null;
  const vodName = jsonStringField(fragment, 'vod_name');
  return { url, vod_data: { vod_name: vodName || '' }, encrypt: 0 };
}

function jsonStringField(fragment, field) {
  const match = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'iu').exec(fragment);
  if (!match) return '';
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1].replaceAll('\\/', '/');
  }
}

function extractAssignedJsonObject(text, variableName) {
  const assignment = new RegExp(`(?:var\\s+)?${variableName}\\s*=`, 'iu').exec(text);
  if (!assignment) return null;
  const start = text.indexOf('{', assignment.index + assignment[0].length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth++;
    else if (character === '}' && --depth === 0) return text.slice(start, index + 1);
  }
  return null;
}

function directMediaResult(mediaUrl, sourceUrl, title, contentType = '') {
  return {
    platform: 'generic',
    type: 'video',
    meta: {
      id: sourceUrl,
      title: title || new URL(sourceUrl).hostname,
      author: '',
      cover: '',
      duration: 0,
    },
    streams: [{
      quality: 'original',
      format: mediaFormat({
        ext: extensionFromUrl(mediaUrl),
        protocol: /mpegurl|m3u8/iu.test(contentType) ? 'm3u8' : new URL(mediaUrl).protocol,
      }),
      codec: 'unknown',
      url: mediaUrl,
      protocol: new URL(mediaUrl).protocol.replace(':', ''),
    }],
  };
}

async function readLimitedText(response, limit) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      throw new AppError(422, 'generic_page_too_large', 'Generic page was too large to inspect');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function decodeHtmlEntities(value) {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function isMediaContentType(contentType) {
  return /^(?:video|audio)\//iu.test(contentType) || /mpegurl|application\/vnd\.apple\.mpegurl/iu.test(contentType);
}

function extensionFromUrl(rawUrl) {
  try {
    return new URL(rawUrl).pathname.match(/\.([a-z0-9]{2,5})$/iu)?.[1]?.toLowerCase() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function normalizeYtDlpResult(payload, sourceUrl) {
  if (!payload || payload._type === 'playlist') {
    throw new AppError(422, 'generic_playlist_unsupported', 'Playlists are not supported');
  }

  const formats = Array.isArray(payload.formats) ? [...payload.formats] : [];
  if (payload.url) formats.push(payload);
  const streams = [];
  const seenUrls = new Set();

  for (const format of formats) {
    if (!format?.url || format.has_drm === true || seenUrls.has(format.url)) continue;
    if (!isHttpMediaProtocol(format.protocol, format.url)) continue;

    const hasVideo = format.vcodec && format.vcodec !== 'none';
    const hasAudio = format.acodec && format.acodec !== 'none';
    if (!hasVideo && !hasAudio) continue;

    const stream = {
      quality: qualityLabel(format),
      format: mediaFormat(format),
      codec: [hasVideo ? format.vcodec : '', hasAudio ? format.acodec : '']
        .filter(Boolean)
        .join('+') || 'unknown',
      url: format.url,
      protocol: format.protocol || new URL(format.url).protocol.replace(':', ''),
    };
    if (!hasAudio) stream.type = 'video-only';
    if (!hasVideo) stream.type = 'audio-only';
    if (format.filesize || format.filesize_approx) {
      stream.size = format.filesize || format.filesize_approx;
    }
    if (format.tbr) stream.bitrate = Math.round(format.tbr * 1000);
    streams.push(stream);
    seenUrls.add(format.url);
  }

  return {
    platform: 'generic',
    type: payload.is_live ? 'live' : 'video',
    meta: {
      id: payload.id || sourceUrl,
      title: payload.title || new URL(sourceUrl).hostname,
      author: payload.uploader || payload.channel || payload.creator || '',
      cover: payload.thumbnail || '',
      duration: Number(payload.duration) || 0,
      liveStatus: payload.is_live ? 1 : undefined,
    },
    streams,
  };
}

export function executeYtDlp(sourceUrl, options = {}) {
  const executable = options.ytDlpPath || 'yt-dlp';
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxConcurrent = positiveInteger(options.maxConcurrent, DEFAULT_MAX_CONCURRENT);
  if (activeProcesses >= maxConcurrent) {
    throw new AppError(503, 'generic_resolver_busy', 'Generic resolver is busy; try again later');
  }

  activeProcesses++;
  return new Promise((resolve, reject) => {
    const args = [
      '--ignore-config',
      '--dump-single-json',
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '--skip-download',
      '--socket-timeout', String(Math.max(1, Math.ceil(timeoutMs / 1000))),
      '--retries', '1',
      '--extractor-retries', '1',
      '--', sourceUrl,
    ];
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(new AppError(502, 'generic_output_too_large', 'Generic resolver output was too large'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (Buffer.concat(stderr).length < 4096) stderr.push(chunk);
    });
    child.on('error', (error) => {
      const unavailable = error.code === 'ENOENT';
      finish(new AppError(
        unavailable ? 503 : 502,
        unavailable ? 'generic_resolver_unavailable' : 'generic_resolver_failed',
        unavailable ? 'yt-dlp is not installed or YT_DLP_PATH is incorrect' : 'Failed to start yt-dlp',
      ));
    });
    child.on('close', (code) => {
      if (settled) return;
      if (timedOut) {
        finish(new AppError(504, 'generic_resolver_timeout', 'Generic resolver timed out'));
        return;
      }
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim().slice(-500);
        finish(new AppError(502, 'generic_resolver_failed', detail || `yt-dlp exited with code ${code}`));
        return;
      }
      try {
        finish(null, JSON.parse(Buffer.concat(stdout).toString('utf8')));
      } catch {
        finish(new AppError(502, 'generic_resolver_invalid_output', 'yt-dlp returned invalid JSON'));
      }
    });

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeProcesses--;
      if (error) reject(error);
      else resolve(value);
    }
  });
}

function isHttpMediaProtocol(protocol, rawUrl) {
  if (String(protocol || '').startsWith('http') || String(protocol || '').startsWith('m3u8')) {
    return true;
  }
  try {
    return ['http:', 'https:'].includes(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}

function qualityLabel(format) {
  const height = Number(format.height);
  if (Number.isFinite(height) && height > 0) return `${height}p`;
  if (format.format_note && !/audio only/iu.test(format.format_note)) return format.format_note;
  if (format.vcodec === 'none' && format.abr) return `${Math.round(format.abr)}k`;
  return 'original';
}

function mediaFormat(format) {
  if (String(format.protocol || '').startsWith('m3u8')) return 'm3u8';
  return format.ext || 'unknown';
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
