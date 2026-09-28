import { tiktok } from '../tiktokClient.js';

/**
 * Identities available for an ad account. Needed for Spark Ads, where an ad
 * references an identity_id + identity_type + a TikTok post (tt_item / video).
 *
 * Endpoint: GET /open_api/v1.3/identity/get/
 */
export async function listIdentities(advertiserId) {
  const data = await tiktok.get('identity/get', {
    advertiser_id: advertiserId,
  });
  return data?.identity_list || data?.list || [];
}

/**
 * Info about a specific TikTok post owned via an identity. Used to validate
 * that a Spark Ad's source post is still usable before duplicating.
 *
 * Endpoint: GET /open_api/v1.3/identity/video/info/
 * Only works when identity_type is AUTH_CODE, TT_USER or BC_AUTH_TT.
 */
export async function getIdentityVideoInfo(advertiserId, { identityId, identityType, itemId }) {
  const data = await tiktok.get('identity/video/info', {
    advertiser_id: advertiserId,
    identity_id: identityId,
    identity_type: identityType,
    item_id: itemId,
  });
  return data;
}
