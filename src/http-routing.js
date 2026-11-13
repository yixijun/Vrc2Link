import { AppError } from './errors.js';

export function isApiV1Path(pathname) {
  return pathname === '/api/v1' || pathname.startsWith('/api/v1/');
}

export function isDashAssetPath(pathname) {
  return /^\/(?:api\/v1\/)?dash\/[A-Za-z0-9_-]{32}\/(?:manifest\.mpd|video|audio)$/u.test(pathname);
}

export function isPlaybackTicketPath(pathname) {
  return /^\/api\/v1\/playback-tickets\/[A-Za-z0-9_-]{43}\/(?:play|manifest\.mpd)$/u.test(String(pathname || ''));
}

export function parseDashAsset(pathname) {
  const match = String(pathname || '').match(/^\/dash\/([A-Za-z0-9_-]{32})\/(manifest\.mpd|video|audio)$/u);
  if (!match) return null;
  return { ticket: match[1], kind: match[2] };
}

export function normalizeApiV1Url(url) {
  if (!isApiV1Path(url.pathname)) return url;
  const path = url.pathname;
  const fixedRoutes = new Map([
    ['/api/v1/media/resolve', '/api'],
    ['/api/v1/play', '/play'],
    ['/api/v1/playlists/resolve', '/playlist'],
    ['/api/v1/playlists/current', '/playlist/current'],
  ]);
  if (fixedRoutes.has(path)) {
    url.pathname = fixedRoutes.get(path);
    return url;
  }

  const itemMatch = path.match(/^\/api\/v1\/playlists\/current\/items\/([^/]+)$/u);
  if (itemMatch) {
    url.pathname = `/playlist/current/item/${itemMatch[1]}`;
    return url;
  }

  const segmentMatch = path.match(/^\/api\/v1\/danmaku\/current\/video\/segments\/(\d+)$/u);
  if (segmentMatch) {
    url.pathname = '/danmaku/current';
    url.searchParams.set('segment', segmentMatch[1]);
    url.searchParams.set('live', '0');
    return url;
  }
  if (path === '/api/v1/danmaku/current/live') {
    url.pathname = '/danmaku/current';
    url.searchParams.set('live', '1');
    return url;
  }

  if (path.startsWith('/api/v1/dash/')) {
    url.pathname = path.slice('/api/v1'.length);
  }
  return url;
}

export function requestApiKey(request, url) {
  const authorization = request.headers.get('authorization');
  if (!authorization) return url.searchParams.get('key');
  const match = authorization.match(/^Bearer\s+([^\s]+)$/iu);
  if (!match) {
    throw new AppError(401, 'invalid_authorization', 'Authorization must use the Bearer scheme');
  }
  return match[1];
}

export function requiredBearerKey(request) {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+([^\s]+)$/iu);
  if (!match) throw new AppError(401, 'invalid_authorization', 'Authorization must use the Bearer scheme');
  return match[1];
}

export function extractTrailingQueryValue(requestUrl, name) {
  const marker = `${name}=`;
  const query = String(requestUrl || '').split('?')[1] || '';
  const markerIndex = query.indexOf(marker);
  if (markerIndex < 0) return '';
  const rawValue = query.slice(markerIndex + marker.length);
  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
}

export function safeLogPath(pathname) {
  return String(pathname || '')
    .replace(/(\/api\/v1\/playback-tickets\/)[A-Za-z0-9_-]{43}(\/(?:play|manifest\.mpd))/u, '$1:ticket$2')
    .replace(/(\/(?:api\/v1\/)?dash\/)[A-Za-z0-9_-]{32}(\/)/u, '$1:ticket$2');
}
