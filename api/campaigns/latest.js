import { getLatestCampaign } from '../../lib/services/campaigns.js';
import { getCampaignMetrics } from '../../lib/services/reporting.js';
import { config } from '../../lib/config.js';
import { handler, requireConfigured, getAdvertiserId, enrichCampaign } from '../../lib/http.js';

export default handler(['GET'], async (req, res) => {
  if (!requireConfigured(res)) return;
  const advertiserId = getAdvertiserId(req, res);
  if (!advertiserId) return;

  const latest = await getLatestCampaign(advertiserId);
  if (!latest) return res.json({ campaign: null });

  const metrics = await getCampaignMetrics(advertiserId);
  res.json({
    campaign: enrichCampaign(latest, metrics.map[latest.campaign_id]),
    currency: config.currency,
  });
});
