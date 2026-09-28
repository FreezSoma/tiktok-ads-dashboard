import { logger } from '../logger.js';
import { duplicateCampaign } from './duplicate.js';
import { acquireLock, releaseLock } from './locks.js';
import { getJSON, setJSON, pushCapped, listRange } from '../store.js';

/**
 * Stateless automation for serverless (Vercel).
 *
 * There is no long-running process. Instead:
 *  - The config lives in the store (Redis) under CONFIG_KEY.
 *  - A Vercel Cron hits /api/cron/tick on a schedule; that calls runTickOnce().
 *  - Each tick checks the time window, daily cap and last-run interval, and if
 *    due, duplicates the template campaign once.
 *
 * New campaigns are created PAUSE by default unless status is explicitly ACTIVE.
 */

const CONFIG_KEY = 'tt:automation:config';
const STATE_KEY = 'tt:automation:state';
const HISTORY_KEY = 'tt:automation:history';

const DEFAULT_CONFIG = {
  enabled: false,
  advertiserId: null,
  templateCampaignId: null,
  campaignsPerRun: 3,
  budgetPerCampaign: 50,
  intervalHours: 1,
  startHour: 9,
  endHour: 21,
  maxPerDay: 30,
  status: 'PAUSE',
  namePattern: '',
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function readConfig() {
  const c = await getJSON(CONFIG_KEY);
  return { ...DEFAULT_CONFIG, ...(c || {}) };
}

async function readState() {
  const s = await getJSON(STATE_KEY);
  const base = { day: todayKey(), createdToday: 0, lastRunAt: null };
  const state = { ...base, ...(s || {}) };
  if (state.day !== todayKey()) {
    state.day = todayKey();
    state.createdToday = 0;
  }
  return state;
}

function sanitize(patch = {}) {
  const out = {};
  if (patch.advertiserId != null) out.advertiserId = String(patch.advertiserId);
  if (patch.templateCampaignId != null) out.templateCampaignId = String(patch.templateCampaignId);
  if (patch.campaignsPerRun != null) out.campaignsPerRun = clampInt(patch.campaignsPerRun, 1, 100);
  if (patch.budgetPerCampaign != null) out.budgetPerCampaign = Math.max(1, Number(patch.budgetPerCampaign));
  if (patch.intervalHours != null) out.intervalHours = clampNum(patch.intervalHours, 0.25, 24);
  if (patch.startHour != null) out.startHour = clampInt(patch.startHour, 0, 23);
  if (patch.endHour != null) out.endHour = clampInt(patch.endHour, 0, 24);
  if (patch.maxPerDay != null) out.maxPerDay = clampInt(patch.maxPerDay, 1, 1000);
  if (patch.status != null) out.status = patch.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSE';
  if (patch.namePattern != null) out.namePattern = String(patch.namePattern);
  return out;
}

function withinWindow(config, date = new Date()) {
  const hour = date.getHours();
  const { startHour, endHour } = config;
  if (startHour <= endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour; // window crossing midnight
}

export async function getStatus() {
  const config = await readConfig();
  const state = await readState();
  const history = await listRange(HISTORY_KEY, 20);
  return {
    ...config,
    created_today: state.createdToday,
    day: state.day,
    last_run_at: state.lastRunAt,
    history,
  };
}

export async function updateConfig(patch) {
  const current = await readConfig();
  const next = { ...current, ...sanitize(patch) };
  await setJSON(CONFIG_KEY, next);
  logger.info('Automation config updated.', { config: next });
  return getStatus();
}

export async function start(patch) {
  if (patch) await updateConfig(patch);
  const config = await readConfig();
  if (!config.advertiserId || !config.templateCampaignId) {
    throw new Error('Cannot start automation: advertiserId and templateCampaignId are required.');
  }
  config.enabled = true;
  await setJSON(CONFIG_KEY, config);
  logger.info('Automation enabled.', { config });
  return getStatus();
}

export async function stop() {
  const config = await readConfig();
  config.enabled = false;
  await setJSON(CONFIG_KEY, config);
  logger.info('Automation disabled.');
  return getStatus();
}

/**
 * Called by the cron endpoint. Runs at most one duplication batch if due.
 * Returns a small report of what happened this tick.
 */
export async function runTickOnce() {
  const config = await readConfig();

  if (!config.enabled) return skip('disabled');
  if (!config.advertiserId || !config.templateCampaignId) return skip('not_configured');

  const now = new Date();
  if (!withinWindow(config, now)) return skip('outside_window');

  const state = await readState();
  if (state.createdToday >= config.maxPerDay) return skip('daily_max_reached');

  // Interval guard: enough time since last run?
  if (state.lastRunAt) {
    const elapsedMs = now.getTime() - new Date(state.lastRunAt).getTime();
    const intervalMs = config.intervalHours * 60 * 60 * 1000;
    if (elapsedMs < intervalMs) return skip('interval_not_elapsed');
  }

  // Concurrency lock so two overlapping cron invocations don't double-run.
  const lockKey = `automation:${config.advertiserId}:${config.templateCampaignId}`;
  const got = await acquireLock(lockKey);
  if (!got) return skip('locked');

  const remaining = config.maxPerDay - state.createdToday;
  const copies = Math.min(config.campaignsPerRun, remaining);

  try {
    logger.info(`Automation tick: duplicating template ${config.templateCampaignId} x${copies} (status ${config.status}).`);
    const result = await duplicateCampaign({
      advertiserId: config.advertiserId,
      campaignId: config.templateCampaignId,
      copies,
      dailyBudget: config.budgetPerCampaign,
      namePattern: config.namePattern || undefined,
      status: config.status, // PAUSE unless ACTIVE
    });

    state.createdToday += result.created_copies;
    state.lastRunAt = now.toISOString();
    await setJSON(STATE_KEY, state);

    const entry = {
      at: state.lastRunAt,
      requested: copies,
      created: result.created_copies,
      success: result.success,
      failures: result.copies.flatMap((c) => c.failures),
    };
    await pushCapped(HISTORY_KEY, entry, 50);

    logger.info(`Automation tick complete: created ${result.created_copies}/${copies}. Total today: ${state.createdToday}.`);
    return { ran: true, created: result.created_copies, requested: copies, success: result.success };
  } catch (err) {
    await pushCapped(
      HISTORY_KEY,
      {
        at: now.toISOString(),
        requested: copies,
        created: 0,
        success: false,
        failures: [{ level: 'campaign', message: err.message, tiktok_code: err.code ?? null }],
      },
      50
    );
    logger.error(`Automation tick failed: ${err.message}`, { code: err.code });
    return { ran: true, created: 0, requested: copies, success: false, error: err.message };
  } finally {
    await releaseLock(lockKey);
  }
}

function skip(reason) {
  return { ran: false, skipped: reason };
}

function clampInt(v, min, max) {
  return Math.min(max, Math.max(min, Math.round(Number(v))));
}
function clampNum(v, min, max) {
  return Math.min(max, Math.max(min, Number(v)));
}
