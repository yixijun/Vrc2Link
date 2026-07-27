import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function createSqliteState(path) {
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS cache_entries (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rate_counters (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);

  const readCache = database.prepare(
    'SELECT value FROM cache_entries WHERE key = ? AND expires_at > ?',
  );
  const deleteCache = database.prepare('DELETE FROM cache_entries WHERE key = ?');
  const writeCache = database.prepare(`
    INSERT INTO cache_entries (key, value, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at
  `);
  const incrementCounter = database.prepare(`
    INSERT INTO rate_counters (key, count, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN rate_counters.expires_at <= ? THEN 1 ELSE rate_counters.count + 1 END,
      expires_at = CASE WHEN rate_counters.expires_at <= ? THEN excluded.expires_at ELSE rate_counters.expires_at END
    RETURNING count, expires_at
  `);
  const deleteExpiredCache = database.prepare('DELETE FROM cache_entries WHERE expires_at <= ?');
  const deleteExpiredCounters = database.prepare('DELETE FROM rate_counters WHERE expires_at <= ?');
  let mutationCount = 0;

  function cleanupExpired(now, force = false) {
    mutationCount += 1;
    if (!force && mutationCount % 256 !== 0) return;
    deleteExpiredCache.run(now);
    deleteExpiredCounters.run(now);
  }

  cleanupExpired(Date.now(), true);

  return {
    getJson(key) {
      const row = readCache.get(key, Date.now());
      if (!row) return undefined;
      try {
        return JSON.parse(row.value);
      } catch {
        deleteCache.run(key);
        return undefined;
      }
    },
    setJson(key, value, ttlSeconds) {
      writeCache.run(key, JSON.stringify(value), expiresAt(ttlSeconds));
      cleanupExpired(Date.now());
    },
    increment(key, ttlSeconds) {
      const now = Date.now();
      const row = incrementCounter.get(key, now + seconds(ttlSeconds) * 1000, now, now);
      cleanupExpired(now);
      return { count: row.count, expiresAt: row.expires_at };
    },
    close() {
      database.close();
    },
  };
}

export function createMemoryState() {
  const cache = new Map();
  const counters = new Map();

  return {
    getJson(key) {
      const entry = cache.get(key);
      if (!entry || entry.expiresAt <= Date.now()) {
        cache.delete(key);
        return undefined;
      }
      return structuredClone(entry.value);
    },
    setJson(key, value, ttlSeconds) {
      cache.set(key, { value: structuredClone(value), expiresAt: expiresAt(ttlSeconds) });
    },
    increment(key, ttlSeconds) {
      const now = Date.now();
      const current = counters.get(key);
      const entry = !current || current.expiresAt <= now
        ? { count: 1, expiresAt: now + seconds(ttlSeconds) * 1000 }
        : { count: current.count + 1, expiresAt: current.expiresAt };
      counters.set(key, entry);
      return { ...entry };
    },
    close() {},
  };
}

function expiresAt(ttlSeconds) {
  return Date.now() + seconds(ttlSeconds) * 1000;
}

function seconds(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}
