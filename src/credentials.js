import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import { AppError } from './errors.js';

const CREDENTIAL_PREFIX = 'v2l';
const PROFILE_TTL_PREFIX = 'credential:';
const PLAYBACK_TICKET_PREFIX = 'playback-ticket:';
const MAX_RETENTION_DAYS = 365;
const MAX_PLAYBACK_TICKET_TTL_SECONDS = 24 * 60 * 60;

export function createCredential({ state, env, cookie, retentionDays }) {
  const masterKey = getMasterKey(env);
  if (!state) throw new AppError(503, 'state_unavailable', 'Credential storage is unavailable');
  const value = String(cookie || '').trim();
  if (!value || value.length > 16_384 || /[\r\n]/u.test(value)) {
    throw new AppError(400, 'invalid_bilibili_cookie', 'Enter a valid Bilibili Cookie header value');
  }
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > MAX_RETENTION_DAYS) {
    throw new AppError(400, 'invalid_retention_days', `retentionDays must be an integer from 1 to ${MAX_RETENTION_DAYS}`);
  }

  const profileId = randomUUID();
  const key = `${CREDENTIAL_PREFIX}_${profileId}_${randomBytes(32).toString('base64url')}`;
  const expiresAt = Date.now() + retentionDays * 86_400_000;
  const record = {
    keyHash: hashKey(key),
    encryptedCookie: encryptCookie(value, masterKey),
    createdAt: Date.now(),
    expiresAt,
  };
  state.setJson(profileKey(profileId), record, retentionDays * 86_400);
  return { profileId, key, expiresAt };
}

export function authenticateCredential({ state, env, key }) {
  const { profileId, record } = findCredential({ state, key });
  return {
    profileId,
    cookie: decryptCookie(record.encryptedCookie, getMasterKey(env)),
    expiresAt: record.expiresAt,
  };
}

export function rotateCredential({ state, key }) {
  const { profileId, record } = findCredential({ state, key });
  const remainingSeconds = Math.floor((record.expiresAt - Date.now()) / 1000);
  if (remainingSeconds <= 0) throw invalidCredential();
  const nextKey = `${CREDENTIAL_PREFIX}_${profileId}_${randomBytes(32).toString('base64url')}`;
  state.setJson(profileKey(profileId), { ...record, keyHash: hashKey(nextKey) }, remainingSeconds);
  return { profileId, key: nextKey, expiresAt: record.expiresAt };
}

export function deleteCredential({ state, key }) {
  const { profileId } = findCredential({ state, key });
  state.deleteJson(profileKey(profileId));
  return { profileId };
}

export function getCredentialCookie({ state, env, profileId }) {
  if (!profileId) return '';
  const record = state?.getJson(profileKey(profileId));
  if (!record) throw new AppError(401, 'credential_revoked', 'The Bilibili credential expired or was deleted');
  return decryptCookie(record.encryptedCookie, getMasterKey(env));
}

export function createPlaybackTicket({ state, env, profileId, sourceUrl, mode, quality }) {
  if (!state) throw new AppError(503, 'state_unavailable', 'Playback ticket storage is unavailable');
  const token = randomBytes(32).toString('base64url');
  const ttlSeconds = playbackTicketTtl(env);
  const expiresAt = Date.now() + ttlSeconds * 1000;
  state.setJson(`${PLAYBACK_TICKET_PREFIX}${token}`, {
    profileId,
    sourceUrl,
    mode,
    quality: quality || '',
    expiresAt,
  }, ttlSeconds);
  return { token, expiresAt, ttlSeconds };
}

export function getPlaybackTicket({ state, token }) {
  if (!state || !/^[A-Za-z0-9_-]{43}$/u.test(String(token || ''))) return undefined;
  const ticket = state.getJson(`${PLAYBACK_TICKET_PREFIX}${token}`);
  if (!ticket || ticket.expiresAt <= Date.now()) return undefined;
  return ticket;
}

export function getCredentialProfileId(key) {
  const match = String(key || '').match(/^v2l_([0-9a-f-]{36})_([A-Za-z0-9_-]{43})$/u);
  return match?.[1] || '';
}

function findCredential({ state, key }) {
  if (!state) throw new AppError(503, 'state_unavailable', 'Credential storage is unavailable');
  const profileId = getCredentialProfileId(key);
  if (!profileId) throw invalidCredential();
  const record = state.getJson(profileKey(profileId));
  if (!record || !constantTimeHexEqual(record.keyHash, hashKey(key))) throw invalidCredential();
  return { profileId, record };
}

function getMasterKey(env = {}) {
  const value = String(env.CK_MASTER_KEY || '').trim();
  if (!/^[0-9a-f]{64}$/iu.test(value)) {
    throw new AppError(503, 'credential_encryption_unavailable', 'CK_MASTER_KEY must be configured as 64 hexadecimal characters');
  }
  return Buffer.from(value, 'hex');
}

function encryptCookie(cookie, masterKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(cookie, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
  };
}

function decryptCookie(encrypted, masterKey) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(encrypted.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new AppError(503, 'credential_decryption_failed', 'The stored Bilibili credential could not be decrypted');
  }
}

function hashKey(key) {
  return createHash('sha256').update(String(key)).digest('hex');
}

function constantTimeHexEqual(left, right) {
  if (!/^[0-9a-f]{64}$/iu.test(String(left || ''))) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function profileKey(profileId) {
  return `${PROFILE_TTL_PREFIX}${profileId}`;
}

function playbackTicketTtl(env = {}) {
  const value = Number.parseInt(env.PLAYBACK_TICKET_TTL_SECONDS, 10);
  if (!Number.isInteger(value) || value <= 0) return 3600;
  return Math.min(value, MAX_PLAYBACK_TICKET_TTL_SECONDS);
}

function invalidCredential() {
  return new AppError(401, 'invalid_credential_key', 'Invalid or expired Bilibili credential key');
}
