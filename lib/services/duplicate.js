import { logger } from '../logger.js';
import { TikTokApiError } from '../tiktokClient.js';
import { getCampaign, createCampaign } from './campaigns.js';
import { listAdGroups, createAdGroup } from './adgroups.js';
import { listAds, createAds, isSparkAd } from './ads.js';
import { getIdentityVideoInfo } from './identities.js';

/**
 * Deep-duplicate a campaign: Campaign -> Ad Groups -> Ads (incl. Spark Ads).
 *
 * TikTok has no single "duplicate" endpoint, so we read the full structure and
 * recreate it with the official create endpoints, carrying over targeting,
 * placements, optimization, pixel/conversion event and budget settings.
 *
 * Never silently converts a Spark Ad into a regular ad. If a Spark Ad's source
 * post/identity can't be reused, that ad is reported as FAILED with the reason.
 *
 * Returns a structured result so the dashboard can show exactly what was
 * created and what failed. NEVER reports overall success on partial failure.
 */

// Fields we copy from the source ad group. We deliberately whitelist known
// official fields rather than blindly spreading the whole object (some read-only
// fields would be rejected by adgroup/create).
const ADGROUP_COPY_FIELDS = [
  'promotion_type',
  'placement_type',
  'placements',
  'comment_disabled',
  'video_download_disabled',
  'promotion_website_type',
  'pixel_id',
  'optimization_event',
  'secondary_optimization_event',
  'creative_material_mode',
  'app_id',
  'optimization_goal',
  'bid_type',
  'bid_price',
  'conversion_bid_price',
  'billing_event',
  'pacing',
  'budget_mode',
  'schedule_type',
  'schedule_start_time',
  'schedule_end_time',
  'dayparting',
  'gender',
  'age_groups',
  'languages',
  'location_ids',
  'interest_category_ids',
  'interest_keyword_ids',
  'operating_systems',
  'network_types',
  'device_price_ranges',
  'audience_ids',
  'excluded_audience_ids',
  'targeting_expansion',
  'is_hfss',
  'frequency',
  'frequency_schedule',
  'brand_safety_type',
  'brand_safety_partner',
  'category_id',
];

const AD_COPY_FIELDS = [
  'ad_name',
  'ad_format',
  'ad_text',
  'call_to_action',
  'call_to_action_id',
  'landing_page_url',
  'display_name',
  'app_name',
  'impression_tracking_url',
  'click_tracking_url',
  'playable_url',
  'card_id',
  'video_id',
  'image_ids',
  'music_id',
  'avatar_icon_web_uri',
  // Spark Ads / identity fields:
  'identity_id',
  'identity_type',
  'identity_authorized_bc_id',
  'tiktok_item_id',
  'tt_item_id',
  'item_id',
  'promotional_use',
  'dark_post_status',
];

function pick(source, fields) {
  const out = {};
  for (const f of fields) {
    if (source[f] !== undefined && source[f] !== null) out[f] = source[f];
  }
  return out;
}

/**
 * @param {object} params
 * @param {string} params.advertiserId
 * @param {string} params.campaignId       source campaign id
 * @param {number} params.copies            how many copies to make
 * @param {number} [params.dailyBudget]     override daily budget for new campaigns
 * @param {string} [params.namePattern]     e.g. "My Campaign - Copy {n}"; {n} replaced
 * @param {'PAUSE'|'ACTIVE'} params.status  default PAUSE
 */
export async function duplicateCampaign({
  advertiserId,
  campaignId,
  copies = 1,
  dailyBudget,
  namePattern,
  status = 'PAUSE',
}) {
  const source = await getCampaign(advertiserId, campaignId);
  if (!source) {
    throw new TikTokApiError(`Source campaign ${campaignId} not found.`, { code: 'NOT_FOUND' });
  }

  // Read the full source structure once.
  const sourceAdGroups = await listAdGroups(advertiserId, { campaignId });
  const sourceAds = await listAds(advertiserId, { campaignId });
  const adsByAdGroup = groupBy(sourceAds, 'adgroup_id');

  const results = [];
  for (let i = 1; i <= copies; i += 1) {
    const copyResult = await duplicateOnce({
      advertiserId,
      source,
      sourceAdGroups,
      adsByAdGroup,
      copyIndex: i,
      totalCopies: copies,
      dailyBudget,
      namePattern,
      status,
    });
    results.push(copyResult);
  }

  const allOk = results.every((r) => r.success);
  return {
    success: allOk,
    requested_copies: copies,
    created_copies: results.filter((r) => r.campaign_created).length,
    copies: results,
  };
}

async function duplicateOnce({
  advertiserId,
  source,
  sourceAdGroups,
  adsByAdGroup,
  copyIndex,
  totalCopies,
  dailyBudget,
  namePattern,
  status,
}) {
  const summary = {
    copy_index: copyIndex,
    success: false,
    campaign_created: false,
    campaign_id: null,
    campaign_name: null,
    adgroups_created: 0,
    adgroups_failed: 0,
    ads_created: 0,
    ads_failed: 0,
    spark_ads_created: 0,
    spark_ads_failed: 0,
    failures: [], // { level, name, message, tiktok_code }
  };

  const operationStatus = status === 'ACTIVE' ? 'ENABLE' : 'DISABLE';

  // --- 1. Campaign ---
  const campaignName = buildName(namePattern, source.campaign_name, copyIndex, totalCopies);
  summary.campaign_name = campaignName;

  const campaignBody = {
    campaign_name: campaignName,
    objective_type: source.objective_type,
    budget_mode: source.budget_mode,
    operation_status: operationStatus,
  };
  // Budget: override if provided, else copy source budget.
  if (dailyBudget != null && source.budget_mode && source.budget_mode !== 'BUDGET_MODE_INFINITE') {
    campaignBody.budget = dailyBudget;
  } else if (source.budget != null) {
    campaignBody.budget = source.budget;
  }
  if (source.app_promotion_type) campaignBody.app_promotion_type = source.app_promotion_type;
  if (source.special_industries) campaignBody.special_industries = source.special_industries;

  let newCampaignId;
  try {
    newCampaignId = await createCampaign(advertiserId, campaignBody);
    summary.campaign_created = true;
    summary.campaign_id = newCampaignId;
    logger.info(`Created campaign copy "${campaignName}" (${newCampaignId})`);
  } catch (err) {
    summary.failures.push(failure('campaign', campaignName, err));
    logger.error(`Failed to create campaign copy "${campaignName}": ${err.message}`, {
      code: err.code,
    });
    return summary; // Can't continue without a campaign.
  }

  // --- 2. Ad groups + ads ---
  for (const srcAdGroup of sourceAdGroups) {
    const adgroupBody = pick(srcAdGroup, ADGROUP_COPY_FIELDS);
    adgroupBody.campaign_id = newCampaignId;
    adgroupBody.adgroup_name = srcAdGroup.adgroup_name;
    adgroupBody.operation_status = operationStatus;

    // Budget override at ad group level when the campaign is not CBO.
    if (
      dailyBudget != null &&
      srcAdGroup.budget_mode &&
      srcAdGroup.budget_mode !== 'BUDGET_MODE_INFINITE'
    ) {
      adgroupBody.budget = dailyBudget;
    } else if (srcAdGroup.budget != null) {
      adgroupBody.budget = srcAdGroup.budget;
    }

    let newAdGroupId;
    try {
      newAdGroupId = await createAdGroup(advertiserId, adgroupBody);
      summary.adgroups_created += 1;
      logger.info(`  Created ad group "${srcAdGroup.adgroup_name}" (${newAdGroupId})`);
    } catch (err) {
      summary.adgroups_failed += 1;
      summary.failures.push(failure('adgroup', srcAdGroup.adgroup_name, err));
      logger.error(`  Failed ad group "${srcAdGroup.adgroup_name}": ${err.message}`, { code: err.code });
      continue; // Skip ads for a failed ad group.
    }

    // --- 3. Ads (rebuild creatives, keeping Spark Ads as Spark Ads) ---
    const srcAds = adsByAdGroup[srcAdGroup.adgroup_id] || [];
    const creatives = [];
    for (const srcAd of srcAds) {
      const spark = isSparkAd(srcAd);
      try {
        if (spark) {
          // Validate the Spark Ad source post is still usable. If not, we FAIL
          // this ad explicitly instead of converting it to a normal ad.
          await assertSparkReusable(advertiserId, srcAd);
        }
        creatives.push({ ...pick(srcAd, AD_COPY_FIELDS), __spark: spark, __name: srcAd.ad_name });
      } catch (err) {
        if (spark) summary.spark_ads_failed += 1;
        summary.ads_failed += 1;
        summary.failures.push(
          failure('spark_ad', srcAd.ad_name, err, {
            reason: 'Spark Ad source could not be reused; not converting to a normal ad.',
          })
        );
        logger.error(`    Spark Ad "${srcAd.ad_name}" cannot be duplicated: ${err.message}`, {
          code: err.code,
        });
      }
    }

    if (!creatives.length) continue;

    // Create ads in one call per ad group. Strip our internal markers first.
    const cleanCreatives = creatives.map(({ __spark, __name, ...c }) => c);
    try {
      const newAdIds = await createAds(advertiserId, newAdGroupId, cleanCreatives);
      summary.ads_created += newAdIds.length;
      summary.spark_ads_created += creatives.filter((c) => c.__spark).length;
      logger.info(`    Created ${newAdIds.length} ad(s) under ad group ${newAdGroupId}`);
    } catch (err) {
      // The whole batch failed; attribute the failure to each creative.
      for (const c of creatives) {
        summary.ads_failed += 1;
        if (c.__spark) summary.spark_ads_failed += 1;
        summary.failures.push(failure(c.__spark ? 'spark_ad' : 'ad', c.__name, err));
      }
      logger.error(`    Failed to create ads under ad group ${newAdGroupId}: ${err.message}`, {
        code: err.code,
      });
    }
  }

  // Success only if the campaign was created AND nothing failed.
  summary.success = summary.campaign_created && summary.failures.length === 0;
  return summary;
}

async function assertSparkReusable(advertiserId, ad) {
  const identityId = ad.identity_id;
  const identityType = ad.identity_type;
  const itemId = ad.tiktok_item_id || ad.tt_item_id || ad.item_id;

  if (!identityId || !identityType) {
    throw new TikTokApiError(
      'Spark Ad is missing identity information (identity_id / identity_type).',
      { code: 'SPARK_NO_IDENTITY' }
    );
  }
  // identity/video/info only supports these identity types.
  if (!['AUTH_CODE', 'TT_USER', 'BC_AUTH_TT'].includes(identityType)) {
    // We keep the identity but cannot pre-validate the post; let create decide.
    return;
  }
  if (!itemId) return; // Nothing to validate against.

  // Throws TikTokApiError if the post is no longer accessible.
  await getIdentityVideoInfo(advertiserId, { identityId, identityType, itemId });
}

function buildName(pattern, baseName, index, total) {
  if (pattern && pattern.trim()) {
    return pattern
      .replaceAll('{n}', String(index))
      .replaceAll('{total}', String(total))
      .trim();
  }
  const suffix = total > 1 ? ` - Copy ${index}` : ' - Copy';
  return `${baseName}${suffix}`;
}

function failure(level, name, err, extra = {}) {
  return {
    level, // campaign | adgroup | ad | spark_ad
    name: name || '(unnamed)',
    message: err?.message || 'Unknown error',
    tiktok_code: err?.code ?? null,
    request_id: err?.requestId ?? null,
    ...extra,
  };
}

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key];
    (acc[k] ||= []).push(item);
    return acc;
  }, {});
}
