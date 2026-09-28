// Persistence layer for serverless.
//
// On Vercel, each function invocation may run in a fresh instance, so
// in-memory state is unreliable. We use Upstash Redis (HTTP/REST) when
// configured, and fall back to an in-memory store for local development.
//
// Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
//   (Vercel KV also exposes KV_REST_API_URL / KV_REST_API_TOKEN — we accept both.)

const REST_URL =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const REST_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';

export const hasRedis = Boolean(REST_URL && REST_TOKEN);

// --- In-memory fallback (single process, dev only) -------------------------
const mem = new Map();
const memExpiry = new Map();

function memGc(key) {
  const exp = memExpiry.get(key);
  if (exp && Date.now() > exp) {
    mem.delete(key);
    memExpiry.delete(key);
    return true;
  }
  return false;
}

// --- Upstash REST helper ---------------------------------------------------
// Upstash accepts pipelined commands as a JSON array of arrays at /pipeline,
// or a single command as path segments. We use the single-command JSON body
// form: POST {url} with body ["SET","key","value"].
async function redisCmd(command) {
  const res = await fetch(REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upstash error ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (json.error) throw new Error(`Upstash error: ${json.error}`);
  return json.result;
}

// --- Public API ------------------------------------------------------------

export async function getJSON(key) {
  if (hasRedis) {
    const raw = await redisCmd(['GET', key]);
    if (raw == null) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return raw;
    }
  }
  if (memGc(key)) return null;
  return mem.has(key) ? mem.get(key) : null;
}

export async function setJSON(key, value, ttlSeconds) {
  const payload = JSON.stringify(value);
  if (hasRedis) {
    if (ttlSeconds) await redisCmd(['SET', key, payload, 'EX', String(ttlSeconds)]);
    else await redisCmd(['SET', key, payload]);
    return;
  }
  mem.set(key, value);
  if (ttlSeconds) memExpiry.set(key, Date.now() + ttlSeconds * 1000);
  else memExpiry.delete(key);
}

export async function del(key) {
  if (hasRedis) {
    await redisCmd(['DEL', key]);
    return;
  }
  mem.delete(key);
  memExpiry.delete(key);
}

/**
 * Atomic lock acquire using SET NX EX. Returns true if the lock was taken.
 * With the in-memory fallback this is a best-effort emulation.
 */
export async function acquireLock(key, ttlSeconds = 300) {
  if (hasRedis) {
    const result = await redisCmd(['SET', key, '1', 'NX', 'EX', String(ttlSeconds)]);
    return result === 'OK';
  }
  memGc(key);
  if (mem.has(key)) return false;
  mem.set(key, '1');
  memExpiry.set(key, Date.now() + ttlSeconds * 1000);
  return true;
}

export async function releaseLock(key) {
  await del(key);
}

/** Increment a counter and return the new value. */
export async function incr(key) {
  if (hasRedis) {
    return await redisCmd(['INCR', key]);
  }
  memGc(key);
  const next = (Number(mem.get(key)) || 0) + 1;
  mem.set(key, next);
  return next;
}

/** Push onto a capped list (newest kept). */
export async function pushCapped(key, value, cap = 500) {
  if (hasRedis) {
    await redisCmd(['LPUSH', key, JSON.stringify(value)]);
    await redisCmd(['LTRIM', key, '0', String(cap - 1)]);
    return;
  }
  const arr = mem.get(key) || [];
  arr.unshift(value);
  if (arr.length > cap) arr.length = cap;
  mem.set(key, arr);
}

export async function listRange(key, limit = 200) {
  if (hasRedis) {
    const raw = await redisCmd(['LRANGE', key, '0', String(limit - 1)]);
    return (raw || []).map((r) => {
      try {
        return JSON.parse(r);
      } catch {
        return r;
      }
    });
  }
  const arr = mem.get(key) || [];
  return arr.slice(0, limit);
}
