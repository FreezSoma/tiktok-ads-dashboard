import { tiktok } from '../tiktokClient.js';

/**
 * Ads under a campaign / ad group.
 * Endpoint: GET /open_api/v1.3/ad/get/
 */
export async function listAds(advertiserId, { campaignId, adgroupIds, adIds } = {}) {
  const filtering = {};
  if (campaignId) filtering.campaign_ids = [campaignId];
  if (adgroupIds?.length) filtering.adgroup_ids = adgroupIds;
  if (adIds?.length) filtering.ad_ids = adIds;

  const all = [];
  let page = 1;
  const pageSize = 100;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const data = await tiktok.get('ad/get', {
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

/**
 * Create ads under an ad group.
 * Endpoint: POST /open_api/v1.3/ad/create/
 * The body carries adgroup_id + a "creatives" array.
 */
export async function createAds(advertiserId, adgroupId, creatives) {
  const data = await tiktok.post('ad/create', {
    advertiser_id: advertiserId,
    adgroup_id: adgroupId,
    creatives,
  });
  return data?.ad_ids || [];
}

/**
 * Update ad status (ENABLE / DISABLE).
 * Endpoint: POST /open_api/v1.3/ad/status/update/
 */
export async function updateAdStatus(advertiserId, adIds, status) {
  return tiktok.post('ad/status/update', {
    advertiser_id: advertiserId,
    ad_ids: adIds,
    operation_status: status,
  });
}

/**
 * A creative is a Spark Ad when it references an existing TikTok post via an
 * identity. TikTok exposes this through tiktok_item_id / tt_item_id and the
 * identity fields on the ad object.
 */
export function isSparkAd(ad) {
  return Boolean(
    ad.identity_id ||
      ad.tiktok_item_id ||
      ad.tt_item_id ||
      ad.item_id ||
      ad.ad_format === 'SINGLE_VIDEO' && (ad.identity_type || ad.identity_id)
  );
}
