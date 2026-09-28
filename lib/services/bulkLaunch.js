import { logger } from '../logger.js';
import { duplicateCampaign } from './duplicate.js';

/**
 * Bulk launch (Option 1 — native TikTok scheduling).
 *
 * Given a template campaign and a "plan" (a list of items, each with its own
 * name, destination link, budget and scheduled start time), create every
 * campaign in one go. Each campaign is duplicated from the template so it keeps
 * the creatives / targeting / Spark Ads, but gets its own link + budget, and a
 * native TikTok start time (schedule_start_time on the ad groups).
 *
 * Returns a detailed report. Overall success is true only if EVERY item
 * succeeded with no failures.
 *
 * @param {object} params
 * @param {string} params.advertiserId
 * @param {string} params.templateCampaignId
 * @param {'PAUSE'|'ACTIVE'} [params.status='PAUSE']
 * @param {Array<{name?:string, link?:string, budget?:number, start_time?:string}>} params.items
 */
export async function bulkLaunch({ advertiserId, templateCampaignId, status = 'PAUSE', items }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('The plan is empty: provide at least one campaign item.');
  }
  if (items.length > 100) {
    throw new Error('Too many items: 100 campaigns max per launch.');
  }

  logger.info(
    `Bulk launch: ${items.length} campaign(s) from template ${templateCampaignId} (status ${status}).`
  );

  const report = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] || {};
    const label = item.name || `Campagne ${i + 1}`;
    try {
      const result = await duplicateCampaign({
        advertiserId,
        campaignId: templateCampaignId,
        copies: 1,
        dailyBudget: item.budget != null ? Number(item.budget) : undefined,
        namePattern: item.name || undefined,
        status,
        landingUrl: item.link || undefined,
        scheduleStartTime: item.start_time || undefined,
      });
      const copy = result.copies[0] || {};
      report.push({
        index: i + 1,
        name: label,
        link: item.link || null,
        start_time: item.start_time || null,
        success: result.success,
        campaign_id: copy.campaign_id || null,
        campaign_created: copy.campaign_created || false,
        adgroups_created: copy.adgroups_created || 0,
        ads_created: copy.ads_created || 0,
        spark_ads_created: copy.spark_ads_created || 0,
        failures: copy.failures || [],
      });
    } catch (err) {
      logger.error(`Bulk launch item ${i + 1} (${label}) failed: ${err.message}`, { code: err.code });
      report.push({
        index: i + 1,
        name: label,
        link: item.link || null,
        start_time: item.start_time || null,
        success: false,
        campaign_id: null,
        campaign_created: false,
        adgroups_created: 0,
        ads_created: 0,
        spark_ads_created: 0,
        failures: [{ level: 'campaign', name: label, message: err.message, tiktok_code: err.code ?? null }],
      });
    }
  }

  const created = report.filter((r) => r.campaign_created).length;
  const success = report.every((r) => r.success);
  logger.info(`Bulk launch complete: ${created}/${items.length} campaign(s) created. Success=${success}.`);

  return {
    success,
    requested: items.length,
    created,
    items: report,
  };
}
