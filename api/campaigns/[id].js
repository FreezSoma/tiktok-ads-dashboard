import { getCampaign } from '../../lib/services/campaigns.js';
import { listAdGroups } from '../../lib/services/adgroups.js';
import { listAds } from '../../lib/services/ads.js';
import { getCampaignMetrics } from '../../lib/services/reporting.js';
import { config } from '../../lib/config.js';
import { handler, requireConfigured, getAdvertiserId, enrichCampaign } from '../../lib/http.js';

export default handler(['GET'], async (req, res) => {
  if (!requireConfigured(res)) return;
  const advertiserId = getAdvertiserId(req, res);
  if (!advertiserId) return;

  const id = req.query.id;
  const campaign = await getCampaign(advertiserId, id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });

  const [adgroups, ads, metrics] = await Promise.all([
    listAdGroups(advertiserId, { campaignId: id }),
    listAds(advertiserId, { campaignId: id }),
    getCampaignMetrics(advertiserId),
  ]);

  res.json({
    campaign: enrichCampaign(campaign, metrics.map[campaign.campaign_id]),
    adgroups,
    ads,
    currency: config.currency,
  });
});
