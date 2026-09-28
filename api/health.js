import { config, isConfigured, hasAppCredentials } from '../lib/config.js';
import { hasRedis } from '../lib/store.js';
import { handler } from '../lib/http.js';

export default handler(['GET'], async (_req, res) => {
  res.json({
    ok: true,
    configured: isConfigured(),
    has_app_credentials: hasAppCredentials(),
    has_store: hasRedis,
    currency: config.currency,
    timezone: config.timezone,
  });
});
