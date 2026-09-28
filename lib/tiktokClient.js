import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Thin, resilient wrapper around the TikTok Marketing API (v1.3).
 *
 * All endpoints live under {apiBase}/open_api/v1.3/. Auth uses the
 * "Access-Token" header (NOT a Bearer token). Every TikTok response has the
 * shape { code, message, request_id, data }. code === 0 means success.
 */

export class TikTokApiError extends Error {
  constructor(message, { code, requestId, httpStatus, endpoint } = {}) {
    super(message);
    this.name = 'TikTokApiError';
    this.code = code;
    this.requestId = requestId;
    this.httpStatus = httpStatus;
    this.endpoint = endpoint;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RETRYABLE_CODES = new Set([40100, 40016, 50000, 51000]);
const MAX_RETRIES = 4;

function buildUrl(path, query) {
  const base = `${config.tiktok.apiBase}/open_api/${config.tiktok.apiVersion}/${path.replace(/^\/|\/$/g, '')}/`;
  const url = new URL(base);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'object') url.searchParams.set(key, JSON.stringify(value));
      else url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function doRequest(method, path, { query, body, accessToken } = {}) {
  const token = accessToken || config.tiktok.accessToken;
  if (!token) {
    throw new TikTokApiError(
      'No TikTok access token configured. Set TIKTOK_ACCESS_TOKEN in your environment.',
      { code: 'NO_TOKEN', endpoint: path }
    );
  }

  const url = method === 'GET' ? buildUrl(path, query) : buildUrl(path);
  const headers = { 'Access-Token': token, 'Content-Type': 'application/json' };

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      });
    } catch (networkErr) {
      if (attempt <= MAX_RETRIES) {
        const backoff = 300 * 2 ** (attempt - 1);
        logger.warn(`Network error calling ${path}, retry ${attempt}/${MAX_RETRIES} in ${backoff}ms`, {
          error: networkErr.message,
        });
        await sleep(backoff);
        continue;
      }
      throw new TikTokApiError(`Network error calling TikTok: ${networkErr.message}`, {
        code: 'NETWORK',
        endpoint: path,
      });
    }

    if (res.status === 429 && attempt <= MAX_RETRIES) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
      const backoff = retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1);
      logger.warn(`HTTP 429 from ${path}, retry ${attempt}/${MAX_RETRIES} in ${backoff}ms`);
      await sleep(backoff);
      continue;
    }

    let json;
    try {
      json = await res.json();
    } catch {
      throw new TikTokApiError(`TikTok returned a non-JSON response (HTTP ${res.status}) for ${path}`, {
        httpStatus: res.status,
        endpoint: path,
      });
    }

    if (json.code === 0) return json.data;

    if (json.code === 40105 || json.code === 40001 || json.code === 40002) {
      throw new TikTokApiError(
        `TikTok authentication error: ${json.message}. Your access token may be invalid or expired.`,
        { code: json.code, requestId: json.request_id, endpoint: path }
      );
    }

    if (RETRYABLE_CODES.has(json.code) && attempt <= MAX_RETRIES) {
      const backoff = 500 * 2 ** (attempt - 1);
      logger.warn(`TikTok code ${json.code} (${json.message}) on ${path}, retry ${attempt}/${MAX_RETRIES} in ${backoff}ms`);
      await sleep(backoff);
      continue;
    }

    throw new TikTokApiError(json.message || `TikTok API error (code ${json.code})`, {
      code: json.code,
      requestId: json.request_id,
      endpoint: path,
      httpStatus: res.status,
    });
  }
}

export const tiktok = {
  get: (path, query, accessToken) => doRequest('GET', path, { query, accessToken }),
  post: (path, body, accessToken) => doRequest('POST', path, { body, accessToken }),

  async exchangeAuthCode(authCode) {
    const url = buildUrl('oauth2/access_token');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: config.tiktok.appId,
        secret: config.tiktok.appSecret,
        auth_code: authCode,
      }),
    });
    const json = await res.json();
    if (json.code !== 0) {
      throw new TikTokApiError(json.message || 'Failed to exchange auth code', {
        code: json.code,
        requestId: json.request_id,
        endpoint: 'oauth2/access_token',
      });
    }
    return json.data;
  },
};
