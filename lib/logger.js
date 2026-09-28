// Serverless-friendly logger. Always writes to stdout (captured by Vercel logs)
// and, when a store is available, appends to a capped Redis list so the
// dashboard's /api/logs can show recent entries across invocations.

import { pushCapped, listRange } from './store.js';

const LOG_KEY = 'tt:logs';
const CAP = 500;

async function push(level, message, meta) {
  const entry = { ts: new Date().toISOString(), level, message, meta: meta ?? null };
  const line = `[${entry.ts}] ${level.toUpperCase()} ${message}`;
  if (level === 'error') console.error(line, meta ?? '');
  else if (level === 'warn') console.warn(line, meta ?? '');
  else console.log(line, meta ?? '');

  // Fire-and-forget persistence; never let logging break a request.
  try {
    await pushCapped(LOG_KEY, entry, CAP);
  } catch {
    /* ignore persistence errors */
  }
  return entry;
}

export const logger = {
  info: (message, meta) => push('info', message, meta),
  warn: (message, meta) => push('warn', message, meta),
  error: (message, meta) => push('error', message, meta),
  list: (limit = 200) => listRange(LOG_KEY, limit),
};
