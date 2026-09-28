import { config, isConfigured } from './config.js';
import { logger } from './logger.js';
import { TikTokApiError } from './tiktokClient.js';

// Shared helpers for Vercel serverless handlers.

export function applyCors(req, res) {
  const origin = req.headers.origin;
  const allowed = config.corsOrigin;
  if (allowed.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
}

export function methodGuard(req, res, allowed) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }
  if (!allowed.includes(req.method)) {
    res.status(405).json({ error: `Method ${req.method} not allowed.` });
    return false;
  }
  return true;
}

export function requireConfigured(res) {
  if (!isConfigured()) {
    res.status(400).json({
      error: 'TikTok is not configured. Set TIKTOK_ACCESS_TOKEN in your environment.',
      code: 'NOT_CONFIGURED',
    });
    return false;
  }
  return true;
}

export function getAdvertiserId(req, res) {
  const advertiserId =
    req.query?.advertiser_id || req.body?.advertiser_id || req.body?.advertiserId;
  if (!advertiserId) {
    res.status(400).json({ error: 'advertiser_id is required.', code: 'MISSING_ADVERTISER' });
    return null;
  }
  return String(advertiserId);
}

// Vercel parses JSON bodies automatically for most content types, but guard
// against string bodies just in case.
export function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

// Wrap a handler with CORS + centralized error handling.
export function handler(allowedMethods, fn) {
  return async (req, res) => {
    applyCors(req, res);
    if (!methodGuard(req, res, allowedMethods)) return;
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof TikTokApiError) {
        logger.error(`TikTok API error on ${req.url}: ${err.message}`, {
          code: err.code,
          requestId: err.requestId,
        });
        return res.status(502).json({
          error: err.message,
          code: err.code,
          request_id: err.requestId,
          source: 'tiktok',
        });
      }
      logger.error(`Unhandled error on ${req.url}: ${err.message}`);
      return res.status(500).json({ error: err.message || 'Internal server error.' });
    }
  };
}

export function enrichCampaign(campaign, metrics) {
  const m = metrics || { spend: 0, conversions: 0, revenue: 0, roas: 0 };
  return {
    campaign_id: campaign.campaign_id,
    campaign_name: campaign.campaign_name,
    operation_status: campaign.operation_status,
    secondary_status: campaign.secondary_status,
    objective_type: campaign.objective_type,
    budget: campaign.budget,
    budget_mode: campaign.budget_mode,
    create_time: campaign.create_time,
    adgroup_count: campaign.adgroup_count,
    ad_count: campaign.ad_count,
    metrics: {
      spend: round2(m.spend),
      conversions: round2(m.conversions),
      revenue: round2(m.revenue),
      roas: round2(m.roas),
    },
  };
}

export function mapAutomationBody(body = {}) {
  return {
    advertiserId: body.advertiser_id ?? body.advertiserId,
    templateCampaignId: body.template_campaign_id ?? body.templateCampaignId,
    campaignsPerRun: body.campaigns_per_run ?? body.campaignsPerRun,
    budgetPerCampaign: body.budget_per_campaign ?? body.budgetPerCampaign,
    intervalHours: body.interval_hours ?? body.intervalHours,
    startHour: body.start_hour ?? body.startHour,
    endHour: body.end_hour ?? body.endHour,
    maxPerDay: body.max_per_day ?? body.maxPerDay,
    status: body.status,
    namePattern: body.name_pattern ?? body.namePattern,
  };
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
