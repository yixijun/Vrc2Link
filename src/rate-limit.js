import { createHash } from 'node:crypto';

import { AppError } from './errors.js';

export function enforceRateLimits({ state, env, authenticated, suppliedKey, clientIp }) {
  const windowSeconds = positiveInteger(env.RATE_LIMIT_WINDOW_SECONDS, 60);
  const principalLimit = positiveInteger(
    authenticated ? env.RATE_LIMIT_AUTH_PER_MINUTE : env.RATE_LIMIT_ANON_PER_MINUTE,
    authenticated ? 60 : 10,
  );
  const principal = authenticated ? suppliedKey : clientIp;
  const principalKind = authenticated ? 'auth' : 'anon';
  const principalQuota = consumeQuota(
    state,
    `rate:${principalKind}:${hashIdentity(principal)}`,
    principalLimit,
    windowSeconds,
  );
  if (principalQuota.rejected) throw rateLimitError(principalQuota);

  const ipQuota = consumeQuota(
    state,
    `rate:ip:${hashIdentity(clientIp)}`,
    positiveInteger(env.RATE_LIMIT_IP_PER_MINUTE, 120),
    windowSeconds,
  );
  if (ipQuota.rejected) throw rateLimitError(ipQuota);
  return quotaHeaders(principalQuota);
}

export function hashIdentity(value) {
  return createHash('sha256').update(String(value || 'unknown')).digest('hex');
}

export function enforceDanmakuRateLimit({ state, env, clientIp }) {
  const quota = consumeQuota(
    state,
    `rate:danmaku:${hashIdentity(clientIp)}`,
    positiveInteger(env.DANMAKU_RATE_LIMIT_PER_MINUTE, 90),
    positiveInteger(env.RATE_LIMIT_WINDOW_SECONDS, 60),
  );
  if (quota.rejected) throw rateLimitError(quota);
  return quotaHeaders(quota);
}

function consumeQuota(state, key, limit, windowSeconds) {
  const counter = state.increment(key, windowSeconds);
  return {
    limit,
    remaining: Math.max(0, limit - counter.count),
    expiresAt: counter.expiresAt,
    rejected: counter.count > limit,
  };
}

function rateLimitError(quota) {
  return new AppError(
    429,
    'rate_limited',
    'Request rate limit exceeded',
    { ...quotaHeaders(quota), 'Retry-After': retryAfter(quota.expiresAt) },
  );
}

function quotaHeaders(quota) {
  return {
    'X-RateLimit-Limit': String(quota.limit),
    'X-RateLimit-Remaining': String(quota.remaining),
    'X-RateLimit-Reset': String(Math.ceil(quota.expiresAt / 1000)),
  };
}

function retryAfter(expiresAt) {
  return String(Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)));
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
