// ---------------------------------------------------------------------------
// TikTok Ads Dashboard - frontend logic.
// No API keys here. Everything goes through the backend (/api).
// ---------------------------------------------------------------------------

const API_BASE = window.API_BASE || '';

const state = {
  accountId: null,
  currency: 'EUR',
  campaigns: [],
  dup: { campaignId: null, campaignName: null, copies: 1 },
};

const VIEW_TITLES = {
  overview: "Vue d'ensemble",
  campaigns: 'Campagnes',
  automation: 'Automatisation',
  logs: 'Journal',
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// --- API helper ----------------------------------------------------------
async function api(path, { method = 'GET', body, headers } = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erreur ${res.status}`);
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

function money(n) {
  const sym = state.currency === 'EUR' ? '€' : state.currency + ' ';
  return `${Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${sym}`.trim();
}

// --- Navigation ----------------------------------------------------------
function showView(view) {
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $(`#view-${view}`)?.classList.remove('hidden');
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#view-title').textContent = VIEW_TITLES[view] || '';
  closeSidebar();
}

function openSidebar() { $('#sidebar').classList.add('open'); $('#backdrop')?.classList.add('show'); }
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#backdrop')?.classList.remove('show'); }

// --- Boot ----------------------------------------------------------------
async function boot() {
  injectBackdrop();
  wireStaticHandlers();
  try {
    const health = await api('/health');
    state.currency = health.currency || 'EUR';
    setConn(health.configured);
    if (!health.configured) {
      showBanner(
        "Le backend n'est pas configuré. Ajoutez TIKTOK_ACCESS_TOKEN (et les clés) dans les variables d'environnement Vercel, puis redéployez."
      );
      return;
    }
    await loadAccounts();
  } catch (e) {
    setConn(false);
    showBanner(`Impossible de contacter le backend: ${e.message}`);
  }
  refreshLogs();
}

function injectBackdrop() {
  const bd = el('div', 'backdrop');
  bd.id = 'backdrop';
  bd.addEventListener('click', closeSidebar);
  document.body.appendChild(bd);
}

function setConn(ok) {
  const dot = $('#conn-dot');
  dot.classList.toggle('on', !!ok);
  dot.classList.toggle('off', !ok);
  $('#conn-text').textContent = ok ? 'Connecté' : 'Non configuré';
}

function showBanner(msg) {
  const b = $('#config-banner');
  b.textContent = msg;
  b.classList.remove('hidden');
}

// --- Accounts ------------------------------------------------------------
async function loadAccounts() {
  const sel = $('#account-select');
  try {
    const { accounts } = await api('/accounts');
    sel.innerHTML = '';
    if (!accounts.length) {
      sel.innerHTML = '<option value="">Aucun compte</option>';
      return;
    }
    for (const a of accounts) {
      const o = el('option', null, a.advertiser_name || a.advertiser_id);
      o.value = a.advertiser_id;
      sel.appendChild(o);
    }
    state.accountId = accounts[0].advertiser_id;
    sel.value = state.accountId;
    await onAccountChange();
  } catch (e) {
    sel.innerHTML = '<option value="">Erreur</option>';
    showBanner(`Chargement des comptes impossible: ${e.message}`);
  }
}

async function onAccountChange() {
  state.accountId = $('#account-select').value;
  if (!state.accountId) return;
  await Promise.all([loadLatest(), loadCampaigns(), loadAutomationStatus()]);
}

// --- Latest campaign -----------------------------------------------------
async function loadLatest() {
  const box = $('#latest-campaign');
  box.innerHTML = '<p class="muted">Chargement…</p>';
  try {
    const { campaign } = await api(`/campaigns/latest?advertiser_id=${state.accountId}`);
    if (!campaign) {
      box.innerHTML = '<p class="muted">Aucune campagne trouvée.</p>';
      return;
    }
    box.innerHTML = '';
    box.appendChild(el('div', 'name', campaign.campaign_name));
    const budget = campaign.budget ? `${money(campaign.budget)}/jour` : 'budget: —';
    box.appendChild(
      el('div', 'meta', `${budget} · ${campaign.adgroup_count ?? '?'} Ad Groups · ${campaign.ad_count ?? '?'} Ads`)
    );
    const actions = el('div', 'actions');
    for (const n of [1, 2, 3]) {
      const b = el('button', 'btn sm', `DUPLIQUER ×${n}`);
      b.addEventListener('click', () => openDuplicate(campaign.campaign_id, campaign.campaign_name, n));
      actions.appendChild(b);
    }
    box.appendChild(actions);
  } catch (e) {
    box.innerHTML = `<p class="banner">${e.message}</p>`;
  }
}

// --- Campaigns -----------------------------------------------------------
async function loadCampaigns() {
  const body = $('#campaigns-body');
  const ov = $('#overview-campaigns-body');
  body.innerHTML = '<tr><td colspan="8" class="muted center">Chargement…</td></tr>';
  ov.innerHTML = '<tr><td colspan="5" class="muted center">Chargement…</td></tr>';
  $('#metrics-warning').classList.add('hidden');

  try {
    const data = await api(`/campaigns?advertiser_id=${state.accountId}`);
    state.campaigns = data.campaigns || [];
    state.currency = data.currency || state.currency;
    fillTemplateSelect(state.campaigns);
    updateStats(state.campaigns);

    if (data.metrics_error) {
      const w = $('#metrics-warning');
      w.textContent = `Statistiques indisponibles: ${data.metrics_error}`;
      w.classList.remove('hidden');
    }

    if (!state.campaigns.length) {
      body.innerHTML = '<tr><td colspan="8" class="muted center">Aucune campagne.</td></tr>';
      ov.innerHTML = '<tr><td colspan="5" class="muted center">Aucune campagne.</td></tr>';
      return;
    }

    body.innerHTML = '';
    state.campaigns.forEach((c) => body.appendChild(renderFullRow(c)));

    ov.innerHTML = '';
    state.campaigns.slice(0, 5).forEach((c) => ov.appendChild(renderOverviewRow(c)));
  } catch (e) {
    body.innerHTML = `<tr><td colspan="8" class="banner">${e.message}</td></tr>`;
    ov.innerHTML = `<tr><td colspan="5" class="muted center">—</td></tr>`;
  }
}

function statusCell(c) {
  const on = c.operation_status === 'ENABLE';
  const td = el('td');
  td.appendChild(el('span', `status ${on ? 'on' : 'off'}`, on ? 'ACTIVE' : 'PAUSE'));
  return td;
}
function roasCell(c) {
  const td = el('td');
  const val = c.metrics.roas || 0;
  td.appendChild(el('span', `roas ${val >= 1 ? 'good' : 'bad'}`, val ? val.toFixed(2) : '—'));
  return td;
}
function dupBtn(c, label = 'DUPLIQUER') {
  const b = el('button', 'btn sm', label);
  b.addEventListener('click', () => openDuplicate(c.campaign_id, c.campaign_name, 1));
  return b;
}

function renderFullRow(c) {
  const tr = el('tr');
  tr.appendChild(el('td', null, c.campaign_name));
  tr.appendChild(statusCell(c));
  tr.appendChild(el('td', null, c.budget ? money(c.budget) : '—'));
  tr.appendChild(el('td', null, money(c.metrics.spend)));
  tr.appendChild(el('td', null, String(c.metrics.conversions || 0)));
  tr.appendChild(el('td', null, money(c.metrics.revenue)));
  tr.appendChild(roasCell(c));
  const act = el('td');
  act.appendChild(dupBtn(c));
  tr.appendChild(act);
  return tr;
}

function renderOverviewRow(c) {
  const tr = el('tr');
  tr.appendChild(el('td', null, c.campaign_name));
  tr.appendChild(statusCell(c));
  tr.appendChild(el('td', null, c.budget ? money(c.budget) : '—'));
  tr.appendChild(roasCell(c));
  const act = el('td');
  act.appendChild(dupBtn(c, 'Dupliquer'));
  tr.appendChild(act);
  return tr;
}

function updateStats(campaigns) {
  let spend = 0, revenue = 0, conversions = 0;
  for (const c of campaigns) {
    spend += c.metrics.spend || 0;
    revenue += c.metrics.revenue || 0;
    conversions += c.metrics.conversions || 0;
  }
  const roas = spend > 0 ? revenue / spend : 0;
  $('#stat-spend').textContent = money(spend);
  $('#stat-revenue').textContent = money(revenue);
  $('#stat-conversions').textContent = conversions.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
  $('#stat-roas').textContent = roas ? roas.toFixed(2) : '—';
}

// --- Duplicate modal -----------------------------------------------------
function openDuplicate(campaignId, campaignName, copies) {
  state.dup = { campaignId, campaignName, copies };
  $('#dup-source').textContent = `Source : ${campaignName}`;
  $('#dup-copies').value = copies;
  $('#dup-budget').value = '';
  $('#dup-name').value = '';
  document.querySelector('input[name="dup-status"][value="PAUSE"]').checked = true;
  highlightChip(copies);
  const result = $('#dup-result');
  result.classList.add('hidden');
  result.innerHTML = '';
  const submit = $('#dup-submit');
  submit.disabled = false;
  submit.textContent = 'DUPLIQUER';
  $('#dup-modal').classList.remove('hidden');
}

function closeDuplicate() { $('#dup-modal').classList.add('hidden'); }

function highlightChip(n) {
  $$('#dup-copy-chips .chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.n) === Number(n)));
}

async function submitDuplicate() {
  const submit = $('#dup-submit');
  const copies = Math.max(1, parseInt($('#dup-copies').value, 10) || 1);
  const budget = $('#dup-budget').value ? Number($('#dup-budget').value) : undefined;
  const namePattern = $('#dup-name').value.trim() || undefined;
  const status = document.querySelector('input[name="dup-status"]:checked').value;

  submit.disabled = true;
  submit.textContent = 'Création en cours…';

  const idem = `dup-${state.dup.campaignId}-${copies}-${Date.now()}`;

  try {
    const result = await api(`/campaigns/${state.dup.campaignId}/duplicate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idem },
      body: { advertiser_id: state.accountId, copies, budget, name_pattern: namePattern, status },
    });
    renderDuplicateResult(result);
    await Promise.all([loadCampaigns(), loadLatest(), refreshLogs()]);
  } catch (e) {
    const r = $('#dup-result');
    r.classList.remove('hidden');
    r.innerHTML = `<h4 class="fail">Échec</h4><p>${e.message}</p>`;
  } finally {
    submit.disabled = false;
    submit.textContent = 'DUPLIQUER';
  }
}

function renderDuplicateResult(result) {
  const r = $('#dup-result');
  r.classList.remove('hidden');
  r.innerHTML = '';
  r.appendChild(
    el(
      'h4',
      result.success ? 'ok' : 'fail',
      result.success
        ? `Succès : ${result.created_copies}/${result.requested_copies} campagne(s) créée(s)`
        : `Échec partiel : ${result.created_copies}/${result.requested_copies} campagne(s) créée(s)`
    )
  );

  for (const copy of result.copies) {
    const block = el('div', 'copy-block');
    block.appendChild(
      el('div', copy.success ? 'ok' : 'fail', `Copie #${copy.copy_index} — ${copy.campaign_name || '(sans nom)'}`)
    );
    const ul = el('ul');
    ul.appendChild(el('li', null, `Campagne créée : ${copy.campaign_created ? 'oui' : 'non'}`));
    ul.appendChild(el('li', null, `Ad Groups créés : ${copy.adgroups_created} (échecs : ${copy.adgroups_failed})`));
    ul.appendChild(el('li', null, `Ads créées : ${copy.ads_created} (échecs : ${copy.ads_failed})`));
    ul.appendChild(el('li', null, `Spark Ads créées : ${copy.spark_ads_created} (échecs : ${copy.spark_ads_failed})`));
    block.appendChild(ul);

    if (copy.failures && copy.failures.length) {
      block.appendChild(el('div', 'fail', 'Éléments en échec :'));
      const fl = el('ul');
      for (const f of copy.failures) {
        const code = f.tiktok_code ? ` [code ${f.tiktok_code}]` : '';
        fl.appendChild(el('li', 'fail', `${f.level} · ${f.name} : ${f.message}${code}`));
      }
      block.appendChild(fl);
    }
    r.appendChild(block);
  }
}

// --- Automation ----------------------------------------------------------
function fillTemplateSelect(campaigns) {
  const sel = $('#template-select');
  const current = sel.value;
  sel.innerHTML = '<option value="">sélectionner</option>';
  for (const c of campaigns) {
    const o = el('option', null, c.campaign_name);
    o.value = c.campaign_id;
    sel.appendChild(o);
  }
  if (current) sel.value = current;
}

async function loadAutomationStatus() {
  try {
    const s = await api('/automation?action=status');
    applyAutomationStatus(s);
  } catch {
    /* automation optional */
  }
}

function applyAutomationStatus(s) {
  $('#automation-toggle').checked = !!s.enabled;
  $('#automation-state').textContent = s.enabled ? 'ON' : 'OFF';
  if (s.templateCampaignId) $('#template-select').value = s.templateCampaignId;
  if (s.campaignsPerRun) $('#auto-per-run').value = s.campaignsPerRun;
  if (s.intervalHours) $('#auto-interval').value = s.intervalHours;
  if (s.budgetPerCampaign) $('#auto-budget').value = s.budgetPerCampaign;
  if (s.startHour != null) $('#auto-start').value = s.startHour;
  if (s.endHour != null) $('#auto-end').value = s.endHour;
  if (s.maxPerDay) $('#auto-max').value = s.maxPerDay;
  if (s.status) $('#auto-status').value = s.status;

  const info = $('#automation-info');
  info.textContent = s.enabled
    ? `Actif · ${s.created_today}/${s.maxPerDay} aujourd'hui`
    : 'Inactif';
}

function automationBody() {
  return {
    advertiser_id: state.accountId,
    template_campaign_id: $('#template-select').value,
    campaigns_per_run: Number($('#auto-per-run').value),
    interval_hours: Number($('#auto-interval').value),
    budget_per_campaign: Number($('#auto-budget').value),
    start_hour: Number($('#auto-start').value),
    end_hour: Number($('#auto-end').value),
    max_per_day: Number($('#auto-max').value),
    status: $('#auto-status').value,
  };
}

async function saveAutomation() {
  const btn = $('#automation-save');
  btn.disabled = true;
  try {
    const s = await api('/automation?action=config', { method: 'POST', body: automationBody() });
    applyAutomationStatus(s);
    $('#automation-info').textContent = 'Configuration enregistrée.';
  } catch (e) {
    $('#automation-info').textContent = `Erreur: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
}

async function toggleAutomation(on) {
  try {
    if (on) {
      if (!$('#template-select').value) {
        $('#automation-toggle').checked = false;
        $('#automation-info').textContent = "Choisissez une campagne modèle avant d'activer.";
        return;
      }
      const s = await api('/automation?action=start', { method: 'POST', body: automationBody() });
      applyAutomationStatus(s);
    } else {
      const s = await api('/automation?action=stop', { method: 'POST' });
      applyAutomationStatus(s);
    }
  } catch (e) {
    $('#automation-toggle').checked = !on;
    $('#automation-info').textContent = `Erreur: ${e.message}`;
  }
  refreshLogs();
}

// --- Logs ----------------------------------------------------------------
async function refreshLogs() {
  try {
    const { logs } = await api('/logs?limit=100');
    $('#logs').textContent =
      logs.map((l) => `[${l.ts}] ${l.level.toUpperCase()} ${l.message}`).join('\n') || '—';
  } catch {
    /* ignore */
  }
}

// --- Wiring --------------------------------------------------------------
function wireStaticHandlers() {
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  $('#burger').addEventListener('click', openSidebar);

  $('#account-select').addEventListener('change', onAccountChange);
  $('#refresh-campaigns').addEventListener('click', loadCampaigns);
  $('#refresh-logs').addEventListener('click', refreshLogs);

  $('#dup-close').addEventListener('click', closeDuplicate);
  $('#dup-submit').addEventListener('click', submitDuplicate);
  $('#dup-modal').addEventListener('click', (e) => {
    if (e.target.id === 'dup-modal') closeDuplicate();
  });
  $$('#dup-copy-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const n = Number(chip.dataset.n);
      $('#dup-copies').value = n;
      highlightChip(n);
    });
  });
  $('#dup-copies').addEventListener('input', () => highlightChip($('#dup-copies').value));

  $('#automation-save').addEventListener('click', saveAutomation);
  $('#automation-toggle').addEventListener('change', (e) => toggleAutomation(e.target.checked));
}

boot();
