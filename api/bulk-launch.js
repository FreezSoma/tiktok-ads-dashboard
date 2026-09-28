import { bulkLaunch } from '../lib/services/bulkLaunch.js';
import { acquireLock, releaseLock, getIdempotent, saveIdempotent } from '../lib/services/locks.js';
import { logger } from '../lib/logger.js';
import { handler, requireConfigured, getAdvertiserId, parseBody } from '../lib/http.js';

/**
 * POST /api/bulk-launch
 * Body: {
 *   advertiser_id, template_campaign_id, status: 'PAUSE'|'ACTIVE',
 *   items: [{ name, link, budget, start_time }]
 * }
 * Optional header: Idempotency-Key (avoids double-launch on double-click).
 */
export default handler(['POST'], async (req, res) => {
  if (!requireConfigured(res)) return;
  const advertiserId = getAdvertiserId(req, res);
  if (!advertiserId) return;

  const body = parseBody(req);
  const templateCampaignId = body.template_campaign_id || body.templateCampaignId;
  const status = body.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSE';
  const items = body.items;

  if (!templateCampaignId) {
    return res.status(400).json({ error: 'template_campaign_id is required.', code: 'MISSING_TEMPLATE' });
  }

  const idempotencyKey = req.headers['idempotency-key'] || null;
  const cached = await getIdempotent(idempotencyKey);
  if (cached) {
    logger.info(`Returning idempotent bulk-launch result for key ${idempotencyKey}`);
    return res.json({ ...cached, idempotent_replay: true });
  }

  const lockKey = `bulk:${advertiserId}:${templateCampaignId}`;
  const got = await acquireLock(lockKey);
  if (!got) {
    return res.status(409).json({
      error: 'A bulk launch for this template is already in progress. Please wait.',
      code: 'BULK_IN_PROGRESS',
    });
  }

  try {
    const result = await bulkLaunch({ advertiserId, templateCampaignId, status, items });
    await saveIdempotent(idempotencyKey, result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message, code: 'BULK_FAILED' });
  } finally {
    await releaseLock(lockKey);
  }
});
