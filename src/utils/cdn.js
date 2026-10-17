export function parseCdnAllowlist(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(normalizeHostname).filter(Boolean))];
  }
  return [...new Set(String(value || '')
    .split(',')
    .map(normalizeHostname)
    .filter(Boolean))];
}

export function preferCdnUrls(primaryUrl, backupUrls, allowlist = []) {
  const candidates = uniqueUrls([
    primaryUrl,
    ...(Array.isArray(backupUrls) ? backupUrls : [backupUrls]),
  ]);
  const hosts = parseCdnAllowlist(allowlist);
  if (!hosts.length) return candidates;

  const rank = new Map(hosts.map((host, index) => [host, index]));
  return candidates
    .filter((url) => rank.has(urlHostname(url)))
    .sort((left, right) => rank.get(urlHostname(left)) - rank.get(urlHostname(right)));
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
