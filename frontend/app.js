// ---------------------------------------------------------------------------
// TikTok Ads Dashboard - frontend logic.
// No API keys here. Everything goes through the backend.
// ---------------------------------------------------------------------------

// The backend serves this file, so same-origin. Override if you host the
// frontend separately (e.g. Vite dev server) by setting window.API_BASE.
const API_BASE = window.API_BASE || '';

const state = {
  accountId: null,
  currency: 'EUR',
  campaigns: [],
  dup: { campaignId: null, campaignName: null, copies: 1 },
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// --- API helpers ---------------------------------------------------------
async function api(path, { method = 'GET', body, headers } = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || `Erreur ${res.status}`;
    const err = new Error(msg);
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

// --- Boot ----------------------------------------------------------------
async function boot() {
  wireStaticHandlers();
  try {
    const health = await api('/health');
    state.currency = health.currency || 'EUR';
    if (!health.configured) {
      showBanner(
        'Le backend n’est pas configuré. Renseignez TIKTOK_ACCESS_TOKEN dans backend/.env puis redémarrez.'
      );
      return;
    }
    await loadAccounts();
  } catch (e) {
    showBanner(`Impossible de contacter le backend: ${e.message}`);
  }
  refreshLogs();
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
      el(
        'div',
        'meta',
        `${budget} · ${campaign.adgroup_count ?? '?'} Ad Groups · ${campaign.ad_count ?? '?'} Ads`
      )
    );
    const actions = el('div', 'actions');
    for (const n of [1, 2, 3]) {
      const b = el('button', 'btn btn-accent btn-sm', `DUPLIQUER ×${n}`);
      b.addEventListener('click', () => openDuplicate(campaign.campaign_id, campaign.campaign_name, n));
      actions.appendChild(b);
    }
    box.appendChild(actions);
  } catch (e) {
    box.innerHTML = `<p class="banner">${e.message}</p>`;
  }
}

// --- Campaigns table -----------------------------------------------------
async function loadCampaigns() {
  const body = $('#campaigns-body');
  body.innerHTML = '<tr><td colspan="8" class="muted center">Chargement…</td></tr>';
  $('#metrics-warning').classList.add('hidden');
  try {
    const data = await api(`/campaigns?advertiser_id=${state.accountId}`);
    state.campaigns = data.campaigns || [];
    state.currency = data.currency || state.currency;
    fillTemplateSelect(state.campaigns);

    if (data.metrics_error) {
      const w = $('#metrics-warning');
      w.textContent = `Statistiques indisponibles: ${data.metrics_error}`;
      w.classList.remove('hidden');
    }

    if (!state.campaigns.length) {
      body.innerHTML = '<tr><td colspan="8" class="muted center">Aucune campagne.</td></tr>';
      return;
    }

    body.innerHTML = '';
    for (const c of state.campaigns) {
      body.appendChild(renderCampaignRow(c));
    }
  } catch (e) {
    body.innerHTML = `<tr><td colspan="8" class="banner">${e.message}</td></tr>`;
  }
}

function renderCampaignRow(c) {
  const tr = el('tr');
  tr.appendChild(el('td', null, c.campaign_name));

  const on = c.operation_status === 'ENABLE';
  const st = el('td');
  st.appendChild(el('span', `status ${on ? 'on' : 'off'}`, on ? 'ACTIVE' : 'PAUSE'));
  tr.appendChild(st);

  tr.appendChild(el('td', null, c.budget ? money(c.budget) : '—'));
  tr.appendChild(el('td', null, money(c.metrics.spend)));
  tr.appendChild(el('td', null, String(c.metrics.conversions || 0)));
  tr.appendChild(el('td', null, money(c.metrics.revenue)));

  const roas = el('td');
  const val = c.metrics.roas || 0;
  roas.appendChild(el('span', `roas ${val >= 1 ? 'good' : 'bad'}`, val ? val.toFixed(2) : '—'));
  tr.appendChild(roas);

  const act = el('td');
  const dup = el('button', 'btn btn-accent btn-sm', 'DUPLIQUER');
  dup.addEventListener('click', () => openDuplicate(c.campaign_id, c.campaign_name, 1));
  act.appendChild(dup);
  tr.appendChild(act);
  return tr;
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

function closeDuplicate() {
  $('#dup-modal').classList.add('hidden');
}

function highlightChip(n) {
  document.querySelectorAll('#dup-copy-chips .chip').forEach((c) => {
    c.classList.toggle('active', Number(c.dataset.n) === Number(n));
  });
}

async function submitDuplicate() {
  const submit = $('#dup-submit');
  const copies = Math.max(1, parseInt($('#dup-copies').value, 10) || 1);
  const budget = $('#dup-budget').value ? Number($('#dup-budget').value) : undefined;
  const namePattern = $('#dup-name').value.trim() || undefined;
  const status = document.querySelector('input[name="dup-status"]:checked').value;

  // Disable button + show "Création en cours..." to prevent double clicks.
  submit.disabled = true;
  submit.textContent = 'Création en cours…';

  // Idempotency key ties this click to a single server-side operation.
  const idem = `dup-${state.dup.campaignId}-${copies}-${Date.now()}`;

  try {
    const result = await api(`/campaigns/${state.dup.campaignId}/duplicate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idem },
      body: {
        advertiser_id: state.accountId,
        copies,
        budget,
        name_pattern: namePattern,
        status,
      },
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

  const header = el(
    'h4',
    result.success ? 'ok' : 'fail',
    result.success
      ? `Succès : ${result.created_copies}/${result.requested_copies} campagne(s) créée(s)`
      : `Échec partiel : ${result.created_copies}/${result.requested_copies} campagne(s) créée(s)`
  );
  r.appendChild(header);

  for (const copy of result.copies) {
    const block = el('div', 'copy-block');
    block.appendChild(
      el(
        'div',
        copy.success ? 'ok' : 'fail',
        `Copie #${copy.copy_index} — ${copy.campaign_name || '(sans nom)'}`
      )
    );
    const ul = el('ul');
    ul.appendChild(el('li', null, `Campagne créée : ${copy.campaign_created ? 'oui' : 'non'}`));
    ul.appendChild(el('li', null, `Ad Groups créés : ${copy.adgroups_created} (échecs : ${copy.adgroups_failed})`));
    ul.appendChild(el('li', null, `Ads créées : ${copy.ads_created} (échecs : ${copy.ads_failed})`));
    ul.appendChild(
      el('li', null, `Spark Ads créées : ${copy.spark_ads_created} (échecs : ${copy.spark_ads_failed})`)
    );
    block.appendChild(ul);

    if (copy.failures && copy.failures.length) {
      const fh = el('div', 'fail', 'Éléments en échec :');
      block.appendChild(fh);
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
    /* automation is optional; ignore */
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
  if (s.enabled) {
    const next = s.next_run_at ? new Date(s.next_run_at).toLocaleTimeString('fr-FR') : '—';
    info.textContent = `Actif · ${s.created_today}/${s.maxPerDay} aujourd’hui · prochain lancement ~ ${next}`;
  } else {
    info.textContent = 'Inactif';
  }
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
        $('#automation-info').textContent = 'Choisissez une campagne modèle avant d’activer.';
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
    $('#logs').textContent = logs
      .map((l) => `[${l.ts}] ${l.level.toUpperCase()} ${l.message}`)
      .join('\n') || '—';
  } catch {
    /* ignore */
  }
}

// --- Wiring --------------------------------------------------------------
function wireStaticHandlers() {
  $('#account-select').addEventListener('change', onAccountChange);
  $('#refresh-campaigns').addEventListener('click', loadCampaigns);
  $('#refresh-logs').addEventListener('click', refreshLogs);

  $('#dup-close').addEventListener('click', closeDuplicate);
  $('#dup-submit').addEventListener('click', submitDuplicate);
  $('#dup-modal').addEventListener('click', (e) => {
    if (e.target.id === 'dup-modal') closeDuplicate();
  });
  document.querySelectorAll('#dup-copy-chips .chip').forEach((chip) => {
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
