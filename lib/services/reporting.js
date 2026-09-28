import { tiktok } from '../tiktokClient.js';

/**
 * Integrated reporting for campaigns.
 * Endpoint: GET /open_api/v1.3/report/integrated/get/
 *
 * We pull lifetime-ish metrics per campaign: spend, conversions and the
 * total conversion value (revenue), then derive ROAS = revenue / spend.
 *
 * TikTok metric names used (all official Marketing API metrics):
 *   spend                       -> amount spent
 *   conversion                  -> total conversions (pixel/app events)
 *   total_complete_payment_rate / total_onsite_shopping_value differ by setup,
 *   so we request "total_purchase_value" style metrics and fall back safely.
 */

const METRICS = [
  'campaign_name',
  'spend',
  'conversion',
  'total_purchase',
  'total_purchase_value',
  'complete_payment',
  'total_complete_payment_rate',
];

function toNumber(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Returns a map keyed by campaign_id with { spend, conversions, revenue, roas }.
 * @param {string} advertiserId
 * @param {object} opts { startDate, endDate } as 'YYYY-MM-DD'. Defaults to last 30 days.
 */
export async function getCampaignMetrics(advertiserId, { startDate, endDate } = {}) {
  const end = endDate || isoDate(new Date());
  const start = startDate || isoDate(daysAgo(30));

  let data;
  try {
    data = await tiktok.get('report/integrated/get', {
      advertiser_id: advertiserId,
      report_type: 'BASIC',
      data_level: 'AUCTION_CAMPAIGN',
      dimensions: ['campaign_id'],
      metrics: METRICS,
      start_date: start,
      end_date: end,
      page: 1,
      page_size: 1000,
    });
  } catch (err) {
    // Reporting can fail independently (e.g. metric not available for the
    // account type). We degrade gracefully so the campaign list still loads.
    return { __error: err.message, map: {} };
  }

  const list = data?.list || [];
  const map = {};
  for (const row of list) {
    const id = row.dimensions?.campaign_id;
    if (!id) continue;
    const m = row.metrics || {};

    const spend = toNumber(m.spend);
    const conversions = toNumber(m.conversion) || toNumber(m.total_purchase) || toNumber(m.complete_payment);
    const revenue = toNumber(m.total_purchase_value);
    const roas = spend > 0 ? revenue / spend : 0;

    map[id] = {
      spend,
      conversions,
      revenue,
      roas,
    };
  }
  return { map };
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
