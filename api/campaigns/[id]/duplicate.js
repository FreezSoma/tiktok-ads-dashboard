import { duplicateCampaign } from '../../../lib/services/duplicate.js';
import {
  acquireLock,
  releaseLock,
  getIdempotent,
  saveIdempotent,
} from '../../../lib/services/locks.js';
import { logger } from '../../../lib/logger.js';
import {
  handler,
  requireConfigured,
  getAdvertiserId,
  parseBody,
} from '../../../lib/http.js';

export default handler(['POST'], async (req, res) => {
  if (!requireConfigured(res)) return;
  const advertiserId = getAdvertiserId(req, res);
  if (!advertiserId) return;

  const campaignId = req.query.id;
  const body = parseBody(req);
  const { copies = 1, budget, name_pattern: namePattern, status = 'PAUSE' } = body;

  const copiesN = Math.min(Math.max(parseInt(copies, 10) || 1, 1), 100);
  const cleanStatus = status === 'ACTIVE' ? 'ACTIVE' : 'PAUSE';

  // Idempotency: honour an optional Idempotency-Key header.
  const idempotencyKey = req.headers['idempotency-key'] || null;
  const cached = await getIdempotent(idempotencyKey);
  if (cached) {
    logger.info(`Returning idempotent duplicate result for key ${idempotencyKey}`);
    return res.json({ ...cached, idempotent_replay: true });
  }

  // Concurrency lock to prevent double-click / repeated duplicates.
  const lockKey = `duplicate:${advertiserId}:${campaignId}`;
  const got = await acquireLock(lockKey);
  if (!got) {
    return res.status(409).json({
      error: 'A duplication for this campaign is already in progress. Please wait.',
      code: 'DUPLICATION_IN_PROGRESS',
    });
  }

  try {
    const result = await duplicateCampaign({
      advertiserId,
      campaignId,
      copies: copiesN,
      dailyBudget: budget != null ? Number(budget) : undefined,
      namePattern,
      status: cleanStatus,
    });
    await saveIdempotent(idempotencyKey, result);
    res.json(result); // success flag conveys partial failure
  } finally {
    await releaseLock(lockKey);
  }
});
