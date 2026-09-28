import { tiktok } from '../tiktokClient.js';
import { listAdGroups } from './adgroups.js';
import { listAds } from './ads.js';

/**
 * Campaigns for an ad account.
 * Endpoint: GET /open_api/v1.3/campaign/get/
 */
export async function listCampaigns(advertiserId, { campaignIds } = {}) {
  const filtering = {};
  if (campaignIds?.length) filtering.campaign_ids = campaignIds;

  const all = [];
  let page = 1;
  const pageSize = 100;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const data = await tiktok.get('campaign/get', {
      advertiser_id: advertiserId,
      filtering: Object.keys(filtering).length ? filtering : undefined,
      page,
      page_size: pageSize,
    });
    const list = data?.list || [];
    all.push(...list);
    const totalPage = data?.page_info?.total_page || 1;
    if (page >= totalPage || list.length === 0) break;
    page += 1;
  }
  return all;
}

export async function getCampaign(advertiserId, campaignId) {
  const list = await listCampaigns(advertiserId, { campaignIds: [campaignId] });
  return list[0] || null;
}

/**
 * The most recently created campaign (by create_time), enriched with ad group
 * and ad counts. Used for the "Dernière campagne" section.
 */
export async function getLatestCampaign(advertiserId) {
  const campaigns = await listCampaigns(advertiserId);
  if (!campaigns.length) return null;

  campaigns.sort((a, b) => {
    const ta = new Date(a.create_time || 0).getTime();
    const tb = new Date(b.create_time || 0).getTime();
    return tb - ta;
  });
  const latest = campaigns[0];

  const [adgroups, ads] = await Promise.all([
    listAdGroups(advertiserId, { campaignId: latest.campaign_id }),
    listAds(advertiserId, { campaignId: latest.campaign_id }),
  ]);

  return {
    ...latest,
    adgroup_count: adgroups.length,
    ad_count: ads.length,
  };
}

/**
 * Create a campaign.
 * Endpoint: POST /open_api/v1.3/campaign/create/
 */
export async function createCampaign(advertiserId, campaignBody) {
  const data = await tiktok.post('campaign/create', {
    advertiser_id: advertiserId,
    ...campaignBody,
  });
  return data?.campaign_id;
}

/**
 * Update campaign status (ENABLE / DISABLE).
 * Endpoint: POST /open_api/v1.3/campaign/status/update/
 */
export async function updateCampaignStatus(advertiserId, campaignIds, status) {
  return tiktok.post('campaign/status/update', {
    advertiser_id: advertiserId,
    campaign_ids: campaignIds,
    operation_status: status, // ENABLE | DISABLE
  });
}
