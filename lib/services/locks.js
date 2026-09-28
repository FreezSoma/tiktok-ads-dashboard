// Idempotency + concurrency guard, backed by the store (Redis on Vercel,
// in-memory locally). All async because Redis calls are async.

import { acquireLock as storeAcquire, releaseLock as storeRelease, getJSON, setJSON } from '../store.js';

const IDEMPOTENCY_TTL_SECONDS = 10 * 60; // 10 minutes
const LOCK_TTL_SECONDS = 300; // safety auto-release after 5 min

export async function acquireLock(key) {
  return storeAcquire(`lock:${key}`, LOCK_TTL_SECONDS);
}

export async function releaseLock(key) {
  return storeRelease(`lock:${key}`);
}

export async function getIdempotent(key) {
  if (!key) return null;
  return getJSON(`idem:${key}`);
}

export async function saveIdempotent(key, result) {
  if (!key) return;
  await setJSON(`idem:${key}`, result, IDEMPOTENCY_TTL_SECONDS);
}
