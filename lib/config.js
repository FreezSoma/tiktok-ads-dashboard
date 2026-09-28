// On Vercel, environment variables are injected directly (no .env file at
// runtime). For local dev we optionally load a .env if dotenv is present.
try {
  // Optional: only used locally. Ignored if dotenv isn't installed.
  const dotenv = await import('dotenv');
  dotenv.config();
} catch {
  /* dotenv not available in production build — fine */
}

export const config = {
  corsOrigin: (process.env.CORS_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  tiktok: {
    appId: process.env.TIKTOK_APP_ID || '',
    appSecret: process.env.TIKTOK_APP_SECRET || '',
    redirectUri: process.env.TIKTOK_REDIRECT_URI || '',
    accessToken: process.env.TIKTOK_ACCESS_TOKEN || '',
    apiBase: (process.env.TIKTOK_API_BASE || 'https://business-api.tiktok.com').replace(/\/$/, ''),
    apiVersion: 'v1.3',
  },

  // Secret shared between vercel.json cron and the tick endpoint.
  cronSecret: process.env.CRON_SECRET || '',

  timezone: process.env.TIMEZONE || 'Europe/Paris',
  currency: process.env.CURRENCY || 'EUR',
};

export function isConfigured() {
  return Boolean(config.tiktok.accessToken);
}
export function hasAppCredentials() {
  return Boolean(config.tiktok.appId && config.tiktok.appSecret);
}
