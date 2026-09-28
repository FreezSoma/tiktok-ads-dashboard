import { listCampaigns } from '../../lib/services/campaigns.js';
import { getCampaignMetrics } from '../../lib/services/reporting.js';
import { config } from '../../lib/config.js';
import { handler, requireConfigured, getAdvertiserId, enrichCampaign } from '../../lib/http.js';

export default handler(['GET'], async (req, res) => {
  if (!requireConfigured(res)) return;
  const advertiserId = getAdvertiserId(req, res);
  if (!advertiserId) return;

  const [campaigns, metrics] = await Promise.all([
    listCampaigns(advertiserId),
    getCampaignMetrics(advertiserId, {
      startDate: req.query?.start_date,
      endDate: req.query?.end_date,
    }),
  ]);

  const merged = campaigns.map((c) => enrichCampaign(c, metrics.map[c.campaign_id]));
  res.json({
    campaigns: merged,
    metrics_error: metrics.__error || null,
    currency: config.currency,
  });
});
