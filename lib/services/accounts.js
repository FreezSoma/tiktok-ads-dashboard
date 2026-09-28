import { tiktok } from '../tiktokClient.js';
import { config } from '../config.js';

/**
 * Ad accounts (advertisers) the current access token can manage.
 * Endpoint: GET /open_api/v1.3/oauth2/advertiser/get/
 * Requires app_id + secret as query params alongside the token header.
 */
export async function listAccounts() {
  const data = await tiktok.get('oauth2/advertiser/get', {
    app_id: config.tiktok.appId,
    secret: config.tiktok.appSecret,
  });

  const list = data?.list || [];
  return list.map((a) => ({
    advertiser_id: a.advertiser_id,
    advertiser_name: a.advertiser_name,
  }));
}
