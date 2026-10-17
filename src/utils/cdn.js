export function parseCdnPreference(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(normalizeHostname).filter(Boolean))];
  }
  return [...new Set(String(value || '')
    .split(',')
    .map(normalizeHostname)
    .filter(Boolean))];
}

export function preferCdnUrls(primaryUrl, backupUrls, preferredHosts = []) {
  const candidates = uniqueUrls([
    primaryUrl,
    ...(Array.isArray(backupUrls) ? backupUrls : [backupUrls]),
  ]);
  const hosts = parseCdnPreference(preferredHosts);
  if (!hosts.length) return candidates;

  const preferred = [];
  for (const host of hosts) {
    for (const candidate of candidates) {
      if (urlHostname(candidate) === host) preferred.push(candidate);
    }
    for (const candidate of candidates) {
      const rewrittenUrl = rewriteCdnHost(candidate, host);
      if (rewrittenUrl) preferred.push(rewrittenUrl);
    }
  }
  return uniqueUrls([...preferred, ...candidates]);
}

export function isBilibiliCdnUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.port && url.pathname.includes('/upgcxcode/') &&
      (host.endsWith('.bilivideo.com') || host.endsWith('.akamaized.net'));
  } catch {
    return false;
  }
}

function uniqueUrls(urls) {
  const seen = new Set();
  const result = [];
  for (const value of urls) {
    const url = String(value || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

function normalizeHostname(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\.+$/u, '');
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname
      .toLowerCase()
      .replace(/\.+$/u, '');
  } catch {
    return '';
  }
}

function urlHostname(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/\.+$/u, '');
  } catch {
    return '';
  }
}

function rewriteCdnHost(rawUrl, targetHost) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return '';
  }
  if (!isBilibiliCdnUrl(rawUrl)) return '';
  const sourceHost = url.hostname.toLowerCase();
  if (sourceHost === targetHost) return rawUrl;
  url.hostname = targetHost;
  return url.href;
}
