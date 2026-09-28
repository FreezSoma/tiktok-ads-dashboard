import { tiktok } from '../tiktokClient.js';

/**
 * Ad groups under a campaign (or account).
 * Endpoint: GET /open_api/v1.3/adgroup/get/
 */
export async function listAdGroups(advertiserId, { campaignId, adgroupIds } = {}) {
  const filtering = {};
  if (campaignId) filtering.campaign_ids = [campaignId];
  if (adgroupIds?.length) filtering.adgroup_ids = adgroupIds;

  const all = [];
  let page = 1;
  const pageSize = 100;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const data = await tiktok.get('adgroup/get', {
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
 * Create an ad group.
 * Endpoint: POST /open_api/v1.3/adgroup/create/
 */
export async function createAdGroup(advertiserId, adgroupBody) {
  const data = await tiktok.post('adgroup/create', {
    advertiser_id: advertiserId,
    ...adgroupBody,
  });
  return data?.adgroup_id;
}

/**
 * Update ad group status (ENABLE / DISABLE).
 * Endpoint: POST /open_api/v1.3/adgroup/status/update/
 */
export async function updateAdGroupStatus(advertiserId, adgroupIds, status) {
  return tiktok.post('adgroup/status/update', {
    advertiser_id: advertiserId,
    adgroup_ids: adgroupIds,
    operation_status: status, // ENABLE | DISABLE
  });
}
