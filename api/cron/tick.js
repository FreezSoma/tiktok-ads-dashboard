import * as automation from '../../lib/services/automation.js';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { handler } from '../../lib/http.js';

/**
 * Triggered by Vercel Cron (see vercel.json "crons"). Vercel sends a GET
 * request; when CRON_SECRET is set, it includes "Authorization: Bearer <secret>".
 * We verify that so the endpoint can't be triggered by anyone.
 *
 * Each invocation runs at most one duplication batch, gated by the automation
 * config's interval / time window / daily maximum.
 */
export default handler(['GET', 'POST'], async (req, res) => {
  if (config.cronSecret) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${config.cronSecret}`) {
      logger.warn('Cron tick rejected: bad or missing authorization.');
      return res.status(401).json({ error: 'Unauthorized cron request.' });
    }
  }

  const result = await automation.runTickOnce();
  logger.info(`Cron tick: ${JSON.stringify(result)}`);
  res.json({ ok: true, ...result });
});
