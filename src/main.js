/* Proof of Typeface — main origin.
 * The document editor, the gate, and the agent surface. Every number that decides a verdict
 * is measured by the PROOF origin (separate origin, separate port): this page asks for tools
 * with getTools({fromOrigins}), executes them by name, and refuses to fall back to local
 * measurement. If the proof origin is unreachable the page says so instead of lying. */

import { SEED, COLUMN_PX, FRAME_HEIGHT_PX } from '/src/seed.js';
import { exportSubstitute, EXPORT_STACK } from '/proof/engine.js';

const PROOF_ORIGIN = window.MC.origin('proof');
const SELF_ORIGIN = window.__MC_SELF || window.location.origin;
/* Static-host fallback (one server, no injected origins): the proof frame is then same-origin and
 * must be addressed by PATH, otherwise it would reload this very page inside itself. */
const SINGLE_ORIGIN = !window.MC.isMulti || PROOF_ORIGIN === SELF_ORIGIN;
const PROOF_URL = SINGLE_ORIGIN ? 'proof/index.html' : PROOF_ORIGIN + '/index.html';

/* Sizes are declared once and used twice: the DOM renders at these sizes and the proof origin
 * measures at these sizes, so a drawer number and a pixel on the page are the same number. */
const ROLE = {
  eyebrow: { size: 12, lh: 1.8, track: '.18em', upper: true },
  headline: { size: 42, lh: 1.04 },
  deck: { size: 17, lh: 1.55 },
  subhead: { size: 21, lh: 1.25 },
  body: { size: 15.5, lh: 1.62 },
  quote: { size: 19, lh: 1.45 },
  cta: { size: 15, lh: 1.6 },
  body2: { size: 15, lh: 1.6 },
  footer: { size: 12.5, lh: 1.6 }
};
const $ = (id) => document.getElementById(id);
const clone = (arr) => arr.map((r) => Object.assign({}, r));

const state = {
  runs: clone(SEED),
  verdicts: new Map(),
  waivers: new Map(),
  selected: null,
  proofTools: [],
  proofReady: false,
  proofError: null,
  lastAuditAt: null,
  exportedAt: null,
  calls: 0
};
window.__typeface = state;
window.__toolNames = [];

/* ---------------- proof-origin plumbing ---------------- */

let proofRouteCached = false;
/* Static-host fallback: opened behind one server there is only one origin, so the proof frame is
 * same-origin and getTools({fromOrigins:[self]}) would return nothing for it. Read its registry
 * directly instead; mc.executeTool already falls through to same-origin child registries. */
state.singleOrigin = SINGLE_ORIGIN;

async function discoverProof() {
  if (SINGLE_ORIGIN) {
    const frame = $('proof-frame');
    let reg = null;
    try { reg = frame && frame.contentWindow && frame.contentWindow.__mcRegistry; } catch (e) { reg = null; }
    state.proofTools = reg
      ? [...reg.keys()].filter((name) => name !== 'decoy_proof').map((name) => ({
          name, origin: PROOF_ORIGIN, title: reg.get(name).def.title || '',
          description: reg.get(name).def.description || ''
        }))
      : [];
    proofRouteCached = state.proofTools.length > 0;
    return state.proofTools;
  }
  const tools = await window.mc.getTools({ fromOrigins: [PROOF_ORIGIN] });
  state.proofTools = tools.filter((t) => t.origin === PROOF_ORIGIN);
  proofRouteCached = state.proofTools.length > 0;
  return state.proofTools;
}

async function ensureProof() {
  if (!proofRouteCached) await discoverProof();
  if (!proofRouteCached) throw new Error('proof origin not reachable at ' + PROOF_ORIGIN);
}

/* Cross-origin execute by NAME (the kit caches the route from the last getTools). Results
 * arrive as JSON strings; a tool that answered from the wrong origin is rejected outright. */
async function proofCall(name, input) {
  await ensureProof();
  const wanted = state.proofTools.find((t) => t.name === name);
  if (!wanted) throw new Error('proof tool not exposed to main: ' + name);
  const raw = await window.mc.executeTool(name, input || {});
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed || parsed.originLabel !== 'proof') {
    throw new Error('refusing non-proof payload for ' + name);
  }
  state.calls += 1;
  return parsed;
}

/* ---------------- document ---------------- */

function roleStyle(run) {
  const r = ROLE[run.role] || ROLE.body;
  let s = 'font-family:"' + run.family + '", ' + run.family + ';font-size:' + r.size + 'px;line-height:' + r.lh + ';';
  if (r.track) s += 'letter-spacing:' + r.track + ';';
  if (r.upper) s += 'text-transform:uppercase;';
  return s;
}

function renderDoc() {
  const host = $('doc');
  host.textContent = '';
  for (const run of state.runs) {
    const span = document.createElement('span');
    span.setAttribute('data-run', run.id);
    span.className = 'r-' + run.role;
    span.style.cssText = roleStyle(run);
    span.textContent = run.text;
    span.title = 'declared: ' + run.family;
    host.appendChild(span);
  }
  paintFlags();
}

function flagOf(runId) {
  const v = state.verdicts.get(runId);
  if (!v) return '';
  if (state.waivers.has(runId)) return 'waived';
  return v.identical ? 'flagged' : 'proven';
}

function paintFlags() {
  document.querySelectorAll('span[data-run]').forEach((el) => {
    el.classList.remove('flagged', 'proven', 'waived', 'selected');
    const f = flagOf(el.getAttribute('data-run'));
    if (f) el.classList.add(f);
    if (el.getAttribute('data-run') === state.selected) el.classList.add('selected');
  });
}

/* ---------------- audit (always via the proof origin) ---------------- */

function runsFor(family) {
  const list = family ? state.runs.filter((r) => r.family.toLowerCase() === String(family).toLowerCase()) : state.runs;
  return list;
}

async function auditRuns(runs) {
  const out = [];
  for (const run of runs) {
    const size = (ROLE[run.role] || ROLE.body).size;
    const hash = await proofCall('proof_glyph_hash', { text: run.text, family: run.family, size });
    const metrics = await proofCall('proof_metrics', {
      text: run.text, family: run.family, size, widthPxColumn: COLUMN_PX
    });
    const v = {
      runId: run.id,
      role: run.role,
      family: run.family,
      size,
      text: run.text,
      hashVerdict: hash.identical ? 'substituted' : 'own-outlines',
      identical: hash.identical,
      requestedHash: hash.requestedHash,
      fallbackHash: hash.fallbackHash,
      standinFamily: hash.fallbackFamily,
      sansStandinHash: hash.sansStandinHash,
      serifStandinHash: hash.serifStandinHash,
      monoStandinHash: hash.monoStandinHash,
      sansKeywordStandinHash: hash.sansKeywordStandinHash,
      standinHashes: hash.standinHashes,
      inkPx: hash.inkPx,
      proofVerdict: hash.verdict,
      fontsCheckSays: hash.check ? hash.check.declared : null,
      lies: hash.check ? hash.check.declared === true && hash.identical === true : null,
      widthPx: metrics.widthPx,
      widthDeltaPct: metrics.widthDeltaPct,
      wrapDeltaPct: metrics.medianRightEdgeDeltaPct,
      lineDelta: metrics.lineDelta,
      medianRightEdge: metrics.declared.medianRightEdge,
      medianRightEdgeUnderSubstitute: metrics.underSubstitute.medianRightEdge,
      fingerprint: metrics.declared.fingerprint,
      lines: metrics.declared.lineCount,
      linesUnderSubstitute: metrics.underSubstitute.lineCount,
      wrapLines: metrics.declared.lines,
      substituteFamily: metrics.substituteFamily,
      proofOrigin: hash.origin,
      proofOriginLabel: hash.originLabel,
      proofToolCalls: ['proof_glyph_hash', 'proof_metrics']
    };
    state.verdicts.set(run.id, v);
    out.push(v);
  }
  state.lastAuditAt = new Date().toISOString();
  return out;
}

async function auditAll(family) {
  const rows = await auditRuns(runsFor(family));
  await measureSpill();
  renderAll();
  return rows;
}

/* ---------------- page spill (real DOM overflow) ---------------- */

async function measureSpill() {
  const frame = $('spill-frame');
  const clip = frame.querySelector('.spill-clip');
  frame.textContent = '';
  for (const run of state.runs) {
    const el = document.createElement('span');
    el.className = 'run r-' + run.role;
    el.style.cssText = roleStyle(run);
    el.textContent = run.text;
    frame.appendChild(el);
  }
  frame.appendChild(clip);
  const asDeclared = frame.scrollHeight - frame.clientHeight;
  frame.querySelectorAll('span.run').forEach((el, i) => {
    const sub = exportSubstitute(state.runs[i].family);
    el.style.fontFamily = '"' + sub + '", ' + sub;
  });
  const asExported = frame.scrollHeight - frame.clientHeight;
  frame.querySelectorAll('span.run').forEach((el, i) => {
    el.style.fontFamily = undefined;
    el.style.cssText = roleStyle(state.runs[i]);
  });
  const spill = {
    frameHeightPx: FRAME_HEIGHT_PX,
    contentHeightPx: frame.scrollHeight,
    spillPx: Math.max(0, Math.round(asDeclared)),
    spillPxUnderExportSubstitutes: Math.max(0, Math.round(asExported)),
    spillPct: Math.min(100, Math.round((Math.max(0, asDeclared) / FRAME_HEIGHT_PX) * 100)),
    columnPx: COLUMN_PX,
    measuredBy: 'main DOM (scrollHeight − clientHeight of the fixed frame)',
    exportStackModelled: EXPORT_STACK
  };
  state.spill = spill;
  const meter = $('spill-meter');
  meter.classList.toggle('bad', spill.spillPx > 0 || spill.spillPxUnderExportSubstitutes > 0);
  meter.firstElementChild.style.width = Math.max(4, spill.spillPct) + '%';
  $('spill-readout').textContent = spill.spillPx + 'px clipped · ' + spill.spillPxUnderExportSubstitutes + 'px under export faces';
  $('spill-note').textContent = spill.spillPx === 0 && spill.spillPxUnderExportSubstitutes === 0
    ? 'Nothing overflows the fixed-height frame as declared or as the export pipeline would substitute.'
    : 'The frame clips content the editor never shows you. As declared: ' + spill.spillPx + 'px. Under the export substitute faces: ' + spill.spillPxUnderExportSubstitutes + 'px — that is page spill, and it is why the gate exists.';
  return spill;
}

/* ---------------- gate ---------------- */

function gateState() {
  const blocked = [];
  const waived = [];
  for (const run of state.runs) {
    const v = state.verdicts.get(run.id);
    if (!v) continue;
    if (!v.identical) continue;
    if (state.waivers.has(run.id)) waived.push(waiverRow(run, v));
    else blocked.push(gateRow(run, v));
  }
  const unaudited = state.runs.filter((r) => !state.verdicts.has(r.id)).map((r) => r.id);
  const clean = blocked.length === 0 && unaudited.length === 0;
  return { blocked, waived, unaudited, clean, exportEnabled: clean, proofOrigin: PROOF_ORIGIN, auditMode: 'proof-origin', gateRule: 'identical-to-generic glyph hash must be proven different or human-waived', callsToProof: state.calls };
}

function gateRow(run, v) {
  return {
    runId: run.id, role: run.role, declaredFamily: run.family,
    standin: v.standinFamily, requestedHash: v.requestedHash,
    widthDeltaPct: v.widthDeltaPct, wrapDeltaPct: v.wrapDeltaPct,
    fontsCheckSays: v.fontsCheckSays, verdict: v.proofVerdict
  };
}

function waiverRow(run, v) {
  const w = state.waivers.get(run.id);
  return Object.assign(gateRow(run, v), {
    reason: w.reason, signedBy: w.signedBy, signedAt: w.signedAt, waiverHash: w.hash
  });
}

function addWaiver(runId, reason) {
  const run = state.runs.find((r) => r.id === runId);
  if (!run) return { ok: false, error: 'no such run: ' + runId };
  const v = state.verdicts.get(runId);
  if (!v) return { ok: false, error: 'run not audited yet: ' + runId };
  const hash = (v.requestedHash + ':' + runId).slice(0, 16);
  state.waivers.set(runId, {
    runId, reason: String(reason || 'no reason given'), declaredFamily: run.family,
    standin: v.standinFamily, requestedHash: v.requestedHash,
    signedBy: 'human', signedAt: new Date().toISOString(), hash
  });
  return { ok: true };
}

/* ---------------- rendering: stats, table, drawer, gate ---------------- */

function renderStats() {
  const vs = [...state.verdicts.values()];
  const flagged = vs.filter((v) => v.identical && !state.waivers.has(v.runId)).length;
  const waived = state.waivers.size;
  $('stat-runs').textContent = state.runs.length;
  $('stat-flagged').textContent = flagged;
  $('stat-waived').textContent = waived;
  $('stat-spill').textContent = state.spill ? state.spill.spillPx + 'px' : '—';
  $('audit-status').textContent = state.proofReady
    ? state.lastAuditAt + ' · ' + state.calls + ' calls → ' + PROOF_ORIGIN
    : 'proof origin offline — verdicts unavailable';
}

function renderTable() {
  const t = $('audit-table');
  const head = ['run', 'declared', 'fonts.check', 'glyph hash', 'Δwidth %', 'Δwrap %', 'verdict'];
  let html = '<tr>' + head.map((h) => '<th>' + h + '</th>').join('') + '</tr>';
  for (const run of state.runs) {
    const v = state.verdicts.get(run.id);
    if (!v) {
      html += '<tr><td>' + run.id + '</td><td>' + run.family + '</td><td colspan="5" class="hint">not audited</td></tr>';
      continue;
    }
    const w = state.waivers.has(run.id);
    const verdict = w ? '<span class="brass-tag">waived</span>' : v.identical
      ? '<span class="stamp">substituted</span>'
      : '<span class="wax" style="padding:2px 8px;min-width:0;border-radius:2px">proven</span>';
    html += '<tr data-row="' + run.id + '">' +
      '<td class="mono">' + run.id + '</td>' +
      '<td>' + run.family + '</td>' +
      '<td class="v">' + (v.fontsCheckSays === true ? 'true' : String(v.fontsCheckSays)) + (v.lies ? ' <b style="color:var(--stamp)">lie</b>' : '') + '</td>' +
      '<td class="v">' + v.requestedHash + (v.identical ? ' <b>= generic</b>' : '') + '</td>' +
      '<td class="v">' + fmt(v.widthDeltaPct) + '</td>' +
      '<td class="v">' + fmt(v.wrapDeltaPct) + '</td>' +
      '<td>' + verdict + '</td></tr>';
  }
  t.innerHTML = html;
  t.querySelectorAll('[data-row]').forEach((tr) => {
    tr.addEventListener('click', () => selectRun(tr.getAttribute('data-row')));
  });
}

function fmt(n) {
  return n === null || n === undefined ? '—' : (n > 0 ? '+' : '') + n + '%';
}

function selectRun(runId) {
  state.selected = runId;
  paintFlags();
  renderDrawer();
}

function renderDrawer() {
  const run = state.runs.find((r) => r.id === state.selected);
  const body = $('drawer-body');
  if (!run) return;
  const v = state.verdicts.get(run.id);
  $('drawer-id').textContent = run.id + ' · ' + run.role;
  if (!v) {
    body.innerHTML = '<p class="drawer-empty">Auditing…</p>';
    return;
  }
  const w = state.waivers.get(run.id);
  const badge = w
    ? '<span class="brass-tag">waived — ' + escapeHtml(w.reason) + '</span>'
    : v.identical
      ? '<span class="stamp">substituted — the face you asked for ≠ the face you got</span>'
      : '<span class="wax">PROVEN</span>';
  const lines = (v.wrapLines || []).map((l, i) =>
    '<div class="wl">L' + (i + 1) + ' right edge ' + l.rightEdge + 'px · ' + l.text + '</div>').join('');
  body.innerHTML =
    '<div style="margin-bottom:10px">' + badge + '</div>' +
    '<table class="scrutiny">' +
    '<tr><th>question</th><th style="text-align:right">answer</th></tr>' +
    row('declared family', run.family) +
    row('document.fonts.check', v.fontsCheckSays === true ? 'true (claims installed)' : String(v.fontsCheckSays)) +
    row('measured with proof origin', v.proofOriginLabel + ' @ ' + v.proofOrigin) +
    row('glyph hash (declared)', v.requestedHash) +
    row('glyph hash (generic sans)', v.sansStandinHash) +
    row('glyph hash (generic serif)', v.serifStandinHash) +
    row('identical to a generic face', v.identical ? '<b style="color:var(--stamp)">yes — ' + v.fallbackHash + '</b>' : 'no — own outlines') +
    row('ink pixels rasterised', String(v.inkPx)) +
    row('measureText width', v.widthPx + 'px') +
    row('width under export substitute', fmt(v.widthDeltaPct)) +
    row('median right edge (declared)', v.medianRightEdge + 'px') +
    row('median right edge (substitute)', v.medianRightEdgeUnderSubstitute + 'px') +
    row('wrap fingerprint delta', fmt(v.wrapDeltaPct)) +
    row('lines declared → substitute', v.lines + ' → ' + v.linesUnderSubstitute) +
    row('wrap fingerprint', v.fingerprint) +
    '</table>' +
    '<div class="wrap-lines">' + lines + '</div>' +
    '<p class="hint" style="margin-top:10px">' + escapeHtml(v.proofVerdict) + '</p>' +
    '<div class="btn-row" style="margin-top:10px">' +
    '<button class="small" id="btn-waive" ' + (w || !v.identical ? 'disabled' : '') + '>Waive this run</button>' +
    '<button class="ghost small" id="btn-unwaive" ' + (w ? '' : 'disabled') + '>Revoke waiver</button>' +
    '</div>';
  const bw = $('btn-waive');
  if (bw) bw.addEventListener('click', () => openModal(run.id));
  const bu = $('btn-unwaive');
  if (bu) bu.addEventListener('click', async () => {
    await window.__agent.call('waiver_remove', { runId: run.id });
  });
}

function row(k, val) {
  return '<tr><td>' + k + '</td><td class="v">' + val + '</td></tr>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderGate() {
  const g = gateState();
  $('gate-blocked').textContent = g.blocked.length;
  $('gate-blocked').className = 'gate-count ' + (g.blocked.length ? 'bad' : 'good');
  $('gate-waived').textContent = g.waived.length;
  const btn = $('btn-export');
  btn.disabled = !g.exportEnabled;
  btn.classList.toggle('locked', !g.exportEnabled);
  btn.textContent = g.exportEnabled ? 'Export' : 'Export (' + g.blocked.length + ')';
  $('gate-seal').innerHTML = g.exportEnabled && !state.exportedAt
    ? '<span class="wax">READY</span>'
    : state.exportedAt ? '<span class="wax">ISSUED</span>' : '';
  $('gate-note').textContent = g.blocked.length
    ? 'Blocked: ' + g.blocked.map((b) => b.runId + ' (' + b.declaredFamily + ')').join(', ') + ' — glyph hash identical to a generic face. Prove a different face or waive each one.'
    : g.waived.length
      ? 'Cleared by human waiver (' + g.waived.length + '). The gate keeps the reason on the certificate.'
      : 'Every run rasterises to its own outlines. Nothing to waive.';
  const list = $('waiver-list');
  list.innerHTML = g.waived.map((w) =>
    '<li><span><b>' + w.runId + '</b> ' + escapeHtml(w.declaredFamily) + ' — ' + escapeHtml(w.reason) + '</span>' +
    '<span class="mono">' + w.waiverHash + '</span></li>').join('');
  state.gate = g;
}

function renderAgent() {
  const sel = $('agent-tool');
  const names = [...(window.__toolNames || [])].sort();
  const current = sel.value;
  sel.innerHTML = names.map((n) => '<option>' + n + '</option>').join('');
  if (names.includes(current)) sel.value = current;
}

async function renderToolList() {
  let tools = [];
  try {
    if (SINGLE_ORIGIN) {
      const local = await window.mc.getTools();
      const frame = $('proof-frame');
      let reg = null;
      try { reg = frame && frame.contentWindow && frame.contentWindow.__mcRegistry; } catch (e) { reg = null; }
      const proofNames = reg ? new Set([...reg.keys()]) : new Set();
      const names = new Set(local.map((t) => t.name));
      tools = local.slice();
      proofNames.forEach((n) => { if (!names.has(n)) tools.push({ name: n, origin: PROOF_ORIGIN }); });
    } else {
      tools = await window.mc.getTools({ fromOrigins: [PROOF_ORIGIN] });
    }
  } catch (e) { tools = []; }
  $('tool-count').textContent = tools.length + ' visible' + (window.MC.isMulti ? '' : ' (single-origin fallback)');
  $('tool-list').innerHTML = tools.map((t) => {
    const isProof = t.origin === PROOF_ORIGIN;
    return '<li><span class="t-name">' + t.name + '</span>' +
      '<span class="t-orig ' + (isProof ? 'proof' : '') + '">' + (isProof ? 'proof origin' : 'main') + '</span></li>';
  }).join('');
  window.__toolNames = tools.map((t) => t.name);
  renderAgent();
}

function renderAll() {
  paintFlags();
  renderStats();
  renderTable();
  renderGate();
  renderDrawer();
}

/* ---------------- waiver modal ---------------- */

let modalRun = null;

function openModal(runId) {
  modalRun = runId;
  const run = state.runs.find((r) => r.id === runId);
  const v = state.verdicts.get(runId);
  $('modal-run').innerHTML = '<b>' + runId + '</b> declares <b>' + run.family + '</b>; proof origin measured glyph hash ' +
    (v ? v.requestedHash : '?') + ', identical to ' + (v ? v.fallbackHash : '?') + '. A waiver says: I accept this substitution.';
  $('waiver-reason').value = '';
  $('modal').hidden = false;
  $('waiver-reason').focus();
}

function closeModal() { $('modal').hidden = true; modalRun = null; }

/* ---------------- tools ---------------- */

const TOOLS = [
  {
    name: 'doc_get',
    title: 'Get document',
    description: 'Return the seeded marketing one-pager as {runs:[{id,role,family,text,waived}], columnPx, frameHeightPx}. Read-only.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: async () => ({
      runs: state.runs.map((r) => Object.assign({}, r, { waived: state.waivers.has(r.id) })),
      columnPx: COLUMN_PX, frameHeightPx: FRAME_HEIGHT_PX, proofOrigin: PROOF_ORIGIN
    })
  },
  {
    name: 'run_list',
    title: 'List runs with verdicts',
    description: 'Every run with its audit verdict: [{id, role, declared, measuredCheck, hashVerdict, widthDeltaPct, wrapDeltaPct}]. Uses cached proof-origin results; call run_audit first if never audited.',
    inputSchema: { type: 'object', properties: { family: { type: 'string', description: 'Only runs declaring this family.' } } },
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: async (input) => {
      const rows = runsFor(input && input.family).map((run) => {
        const v = state.verdicts.get(run.id);
        return {
          id: run.id, role: run.role, declared: run.family,
          measuredCheck: v ? v.fontsCheckSays : null,
          hashVerdict: v ? v.hashVerdict : 'not-audited',
          identicalToGeneric: v ? v.identical : null,
          standin: v ? v.standinFamily : null,
          widthDeltaPct: v ? v.widthDeltaPct : null,
          wrapDeltaPct: v ? v.wrapDeltaPct : null,
          waived: state.waivers.has(run.id),
          proofVerdict: v ? v.proofVerdict : null
        };
      });
      return { runs: rows, count: rows.length, measuredBy: PROOF_ORIGIN };
    }
  },
  {
    name: 'run_audit',
    title: 'Audit runs via proof origin',
    description: 'Full truth table. For each run, asks the PROOF ORIGIN for proof_glyph_hash and proof_metrics (cross-origin), so every hash/width/wrap number carries originLabel "proof". Optional {family} restricts the audit to one family.',
    inputSchema: { type: 'object', properties: { family: { type: 'string', description: "Restrict to runs declaring this family, e.g. 'Georgia'." } } },
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: async (input) => {
      const rows = await auditAll(input && input.family);
      return {
        auditMode: SINGLE_ORIGIN ? 'same-origin (static-host fallback, one server)' : 'cross-origin',
        proofOrigin: PROOF_ORIGIN,
        proofToolsUsed: ['proof_glyph_hash', 'proof_metrics'],
        auditedAt: state.lastAuditAt,
        runs: rows,
        substituted: rows.filter((r) => r.identical).map((r) => r.runId),
        columnPx: COLUMN_PX
      };
    }
  },
  {
    name: 'explain_diff',
    title: 'Explain one run',
    description: 'Deep verdict for one run: declared vs measured family, the exact generic stand-in it collapses to, hash equality, width delta, wrap-fingerprint delta and per-line right edges. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { runId: { type: 'string', description: 'Run id from run_list, e.g. "r4".' } },
      required: ['runId']
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: async (input) => {
      const run = state.runs.find((r) => r.id === input.runId);
      if (!run) return { error: 'no such run: ' + input.runId };
      const v = state.verdicts.get(run.id) || (await auditRuns([run]))[0];
      const hash = await proofCall('proof_glyph_hash', { text: run.text, family: run.exportProbeFamily || run.family, size: v.size });
      return {
        runId: run.id, declared: run.family, verdict: v.proofVerdict,
        proofOrigin: PROOF_ORIGIN, glyph: v, fontsCheckProbe: hash,
        waiver: state.waivers.get(run.id) || null,
        reads: v.identical
          ? 'document.fonts.check says ' + run.family + ' is available, but its pixels are byte-identical to ' + v.fallbackHash + ' — the name was ignored.'
          : run.family + ' rasterises to its own outlines (' + v.requestedHash + '); no substitution detected.'
      };
    }
  },
  {
    name: 'substitute_safe',
    title: 'Swap families and re-audit',
    description: 'Replace every run declaring oldFamily with newFamily, then re-audit through the proof origin and return {before, after, gateBefore, gateAfter}. Refuses a swap whose new family is itself generic-identical unless allowKnownSubstitute=true.',
    inputSchema: {
      type: 'object',
      properties: {
        oldFamily: { type: 'string', description: 'Declared family to replace.' },
        newFamily: { type: 'string', description: 'Family to use instead.' },
        allowKnownSubstitute: { type: 'boolean', description: 'Permit a swap that is still identical to a generic face.' }
      },
      required: ['oldFamily', 'newFamily']
    },
    annotations: { readOnlyHint: false },
    execute: async (input) => {
      const oldF = String(input.oldFamily), newF = String(input.newFamily);
      const affected = runsFor(oldF);
      if (!affected.length) return { ok: false, error: 'no runs declare ' + oldF, families: [...new Set(state.runs.map((r) => r.family))] };
      const gateBefore = gateState();
      const before = affected.map((r) => Object.assign({}, state.verdicts.get(r.id))).filter(Boolean);
      const probe = await proofCall('proof_glyph_hash', {
        text: affected[0].text, family: newF, size: (ROLE[affected[0].role] || ROLE.body).size
      });
      if (probe.identical && !input.allowKnownSubstitute) {
        return {
          ok: false, refusal: 'refusing: ' + newF + ' rasterises identical to ' + probe.fallbackHash + ' — that is not a safe substitute',
          probe, gateBefore: { blocked: gateBefore.blocked.length }
        };
      }
      for (const r of affected) r.family = newF;
      state.waivers.forEach((w, id) => {
        if (affected.some((r) => r.id === id)) state.waivers.delete(id);
      });
      renderDoc();
      const after = await auditRuns(affected);
      await measureSpill();
      renderAll();
      const gateAfter = gateState();
      return {
        ok: true, oldFamily: oldF, newFamily: newF, changedRuns: affected.map((r) => r.id),
        before, after, waiversCleared: affected.map((r) => r.id).filter((id) => !state.waivers.has(id)),
        gateBefore: { blocked: gateBefore.blocked.length, waived: gateBefore.waived.length },
        gateAfter: { blocked: gateAfter.blocked.length, waived: gateAfter.waived.length },
        verdict: probe.identical ? 'still identical to a generic face' : 'now rasterises to own outlines'
      };
    }
  },
  {
    name: 'waiver_add',
    title: 'Human waiver',
    description: 'Record a human verdict that a substitution is acceptable, with a reason. Waived runs stop blocking the export gate. This is the ONLY way a flagged run clears the gate besides a real family swap.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run to waive.' },
        reason: { type: 'string', description: 'Why the substitution is acceptable. Kept on the certificate.' }
      },
      required: ['runId', 'reason']
    },
    annotations: { readOnlyHint: false },
    execute: async (input) => {
      const res = addWaiver(input.runId, input.reason);
      if (!res.ok) return res;
      renderAll();
      return { ok: true, waiver: state.waivers.get(input.runId), gate: compactGate() };
    }
  },
  {
    name: 'waiver_remove',
    title: 'Revoke waiver',
    description: 'Remove a human waiver; the run blocks the export gate again.',
    inputSchema: { type: 'object', properties: { runId: { type: 'string', description: 'Run whose waiver to revoke.' } }, required: ['runId'] },
    annotations: { readOnlyHint: false },
    execute: async (input) => {
      if (!state.waivers.has(input.runId)) return { ok: false, error: 'no waiver for ' + input.runId };
      state.waivers.delete(input.runId);
      renderAll();
      return { ok: true, gate: compactGate() };
    }
  },
  {
    name: 'waiver_list',
    title: 'List waivers',
    description: 'All human waivers on record with reasons, timestamps and waiver hashes. Read-only.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: async () => ({
      waivers: [...state.waivers.values()],
      count: state.waivers.size
    })
  },
  {
    name: 'export_gate',
    title: 'Export gate status',
    description: 'The product loop: {blocked:[runs with unresolved declared≠got diffs], waived:[...], clean, exportEnabled}. The Export button in the DOM mirrors this exactly.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: async () => gateState()
  },
  {
    name: 'metrics_report',
    title: 'Metrics report for a family',
    description: 'Proxy the proof origin: proof_metrics + proof_glyph_hash for one family across every run that declares it (or a sample of runs if none do). Returns width, wrap fingerprint and hash verdicts.',
    inputSchema: {
      type: 'object',
      properties: {
        family: { type: 'string', description: 'Family to measure.' },
        widthPxColumn: { type: 'number', description: 'Column width for the wrap fingerprint. Default ' + COLUMN_PX + '.' }
      },
      required: ['family']
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: async (input) => {
      const family = String(input.family);
      const columnPx = Number(input.widthPxColumn || COLUMN_PX);
      let runs = runsFor(family);
      let usedSample = false;
      if (!runs.length) { runs = state.runs.slice(0, 2); usedSample = true; }
      const reports = [];
      for (const run of runs) {
        const size = (ROLE[run.role] || ROLE.body).size;
        const m = await proofCall('proof_metrics', { text: run.text, family, size, widthPxColumn: columnPx });
        const h = await proofCall('proof_glyph_hash', { text: run.text, family, size });
        reports.push({
          runId: run.id, family, size, columnPx,
          widthPx: m.widthPx, lineCount: m.declared.lineCount,
          medianRightEdge: m.declared.medianRightEdge, fingerprint: m.declared.fingerprint,
          widthDeltaPct: m.widthDeltaPct, medianRightEdgeDeltaPct: m.medianRightEdgeDeltaPct,
          substituteFamily: m.substituteFamily,
          requestedHash: h.requestedHash, identical: h.identical, fallbackHash: h.fallbackHash,
          proofVerdict: m.verdict, glyphVerdict: h.verdict, proofOrigin: m.origin
        });
      }
      return {
        family, measuredBy: PROOF_ORIGIN, proxiedTools: ['proof_metrics', 'proof_glyph_hash'],
        usedSampleOfOtherRuns: usedSample, reports
      };
    }
  },
  {
    name: 'page_spill',
    title: 'Page spill risk',
    description: 'Re-render the whole document inside the fixed-height frame and measure real DOM overflow, as declared and as the modelled export pipeline would substitute. Returns spillPx / spillPct / contentHeightPx. Read-only.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: async () => measureSpill().then(() => state.spill)
  },
  {
    name: 'doc_edit',
    title: 'Edit a run',
    description: 'Change a run’s text and/or declared family, then re-audit that run through the proof origin. Returns the fresh verdict.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run to edit.' },
        text: { type: 'string', description: 'New text (omit to keep).' },
        family: { type: 'string', description: 'New declared family (omit to keep).' }
      },
      required: ['runId']
    },
    annotations: { readOnlyHint: false },
    execute: async (input) => {
      const run = state.runs.find((r) => r.id === input.runId);
      if (!run) return { ok: false, error: 'no such run: ' + input.runId };
      if (typeof input.text === 'string' && input.text.trim()) run.text = input.text;
      if (typeof input.family === 'string' && input.family.trim()) run.family = input.family;
      state.waivers.delete(run.id);
      renderDoc();
      const v = (await auditRuns([run]))[0];
      await measureSpill();
      renderAll();
      return { ok: true, run: Object.assign({}, run), verdict: v, gate: compactGate() };
    }
  },
  {
    name: 'proof_verdicts',
    title: 'Collect proof-origin verdicts',
    description: 'Aggregate the proof origin for the whole document: proof_font_check per declared family, proof_compare for suspicious pairs, proof_export_preview per family. Everything in the result is prefixed proof:',
    inputSchema: { type: 'object', properties: { size: { type: 'number', description: 'Raster size for the checks. Default 26.' } } },
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: async (input) => {
      const size = Number(input && input.size) || 26;
      const families = [...new Set(state.runs.map((r) => r.family))];
      const checks = [];
      for (const family of families) {
        checks.push(await proofCall('proof_font_check', { family, size }));
      }
      const pairs = [];
      for (const a of families.slice(0, 3)) {
        pairs.push(await proofCall('proof_compare', { familyA: a, familyB: 'serif', size }));
      }
      const previews = [];
      for (const family of families) previews.push(await proofCall('proof_export_preview', { family, size }));
      return {
        measuredBy: PROOF_ORIGIN, size,
        fontChecks: checks,
        comparisons: pairs,
        exportPreviews: previews,
        lies: checks.filter((c) => c.lie).map((c) => c.family),
        verdict: checks.some((c) => c.lie) ? 'proof:fonts.check lies for ' + checks.filter((c) => c.lie).length + ' of ' + families.length + ' declared families' : 'proof:no contradictions found'
      };
    }
  },
  {
    name: 'reset_document',
    title: 'Reset to seed',
    description: 'Restore the seeded one-pager and drop all waivers, then re-audit. Returns the fresh gate state.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false },
    execute: async () => {
      state.runs = clone(SEED);
      state.waivers.clear();
      state.verdicts.clear();
      state.exportedAt = null;
      state.selected = null;
      renderDoc();
      await auditAll();
      closeModal();
      return { ok: true, runs: state.runs.length, gate: compactGate() };
    }
  },
  {
    name: 'export_document',
    title: 'Export (gate-checked)',
    description: 'Run the gate and, only if clean, "export": stamp the certificate with an issue hash. Returns {ok:false, blocked:[…]} and changes nothing when the gate is not clean.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false },
    execute: async () => {
      const g = gateState();
      if (!g.exportEnabled) {
        return { ok: false, error: 'export blocked', blocked: g.blocked, waived: g.waived };
      }
      state.exportedAt = new Date().toISOString();
      renderGate();
      return {
        ok: true, exportedAt: state.exportedAt,
        certificate: 'proof-of-typeface/' + g.waived.length + 'waived/' + state.calls + 'proofcalls',
        waived: g.waived, facesExported: [...new Set(state.runs.map((r) => r.family))]
      };
    }
  }
];

function compactGate() {
  const g = state.gate || gateState();
  return { blocked: g.blocked.length, waived: g.waived.length, clean: g.clean, exportEnabled: g.exportEnabled };
}

/* ---------------- boot ---------------- */

window.addEventListener('mc-toolchange', () => { renderToolList(); });

$('doc').addEventListener('click', (ev) => {
  const el = ev.target.closest('span[data-run]');
  if (el) selectRun(el.getAttribute('data-run'));
});

$('btn-audit').addEventListener('click', () => auditAll().catch(showError));
$('btn-reset').addEventListener('click', () => window.__agent.call('reset_document', {}).catch(showError));
$('btn-export').addEventListener('click', () => window.__agent.call('export_document', {}).catch(showError));
$('btn-waive-all').addEventListener('click', async () => {
  for (const b of (state.gate ? state.gate.blocked : [])) {
    await window.__agent.call('waiver_add', { runId: b.runId, reason: 'bulk waiver from the gate panel' });
  }
});
$('modal-cancel').addEventListener('click', closeModal);
$('modal').addEventListener('click', (ev) => { if (ev.target === $('modal')) closeModal(); });
$('waiver-confirm').addEventListener('click', async () => {
  const runId = modalRun;
  if (!runId) return closeModal();
  const reason = $('waiver-reason').value.trim() || 'accepted by eye, no reason given';
  closeModal();
  await window.__agent.call('waiver_add', { runId, reason }).catch(showError);
});
$('proof-toggle').addEventListener('click', () => $('proof-frame').classList.toggle('minimised'));

$('btn-agent-run').addEventListener('click', async () => {
  const name = $('agent-tool').value;
  let input = {};
  try { input = JSON.parse($('agent-input').value || '{}'); } catch (e) { $('agent-out').textContent = 'invalid JSON: ' + e.message; return; }
  $('agent-out').textContent = 'running ' + name + ' …';
  try {
    const r = await window.__agent.call(name, input);
    const parsed = typeof r === 'string' ? JSON.parse(r) : r;
    $('agent-out').textContent = JSON.stringify(parsed, null, 2);
    $('agent-out').classList.remove('flash');
    void $('agent-out').offsetWidth;
    $('agent-out').classList.add('flash');
  } catch (e) {
    $('agent-out').textContent = 'ERROR ' + String(e);
  }
});
document.querySelectorAll('[data-preset]').forEach((b) => {
  b.addEventListener('click', () => {
    const name = b.getAttribute('data-preset');
    $('agent-tool').value = name;
    $('agent-input').value = name === 'substitute_safe'
      ? JSON.stringify({ oldFamily: 'Helvetica', newFamily: 'Baskerville' }, null, 2)
      : name === 'metrics_report' ? JSON.stringify({ family: 'Georgia' }, null, 2) : '{}';
  });
});

/* declarative tool: doc_find (the form in the document card) */
window.MCdeclarative((values) => {
  const q = String(values.query || '').toLowerCase();
  const hits = state.runs.filter((r) => r.text.toLowerCase().includes(q)).map((r) => r.id);
  $('find-out').textContent = hits.length ? 'matched ' + hits.join(', ') : 'no run matches “' + values.query + '”';
  if (hits.length) {
    renderDoc();
    selectRun(hits[0]);
  }
  return 'doc_find: ' + (hits.length ? hits.length + ' run(s) matched: ' + hits.join(', ') : 'no matches for ' + values.query);
});

function showError(e) {
  state.error = String(e);
  $('audit-status').textContent = 'error: ' + state.error;
}

async function embedProof() {
  const frame = $('proof-frame');
  const loaded = new Promise((r) => frame.addEventListener('load', r, { once: true }));
  frame.src = PROOF_URL;
  await loaded;
  await window.MCwhenChild(frame);
  state.proofReady = true;
}

async function boot() {
  const ac = new AbortController();
  for (const t of TOOLS) await window.mc.registerTool(t, { signal: ac.signal });
  renderDoc();
  try {
    await embedProof();
    await discoverProof();
    const exposed = state.proofTools.map((t) => t.name);
    if (!exposed.includes('proof_glyph_hash') || !exposed.includes('proof_metrics')) {
      throw new Error('proof origin did not expose its tools to main');
    }
    await auditAll();
    window.__proofToolsExposed = exposed;
    window.__decoyVisible = exposed.includes('decoy_proof');
  } catch (e) {
    state.proofError = String(e);
    showError(e);
    renderAll();
  }
  await renderToolList();
  renderAgent();
  window.__appReady = true;
}

window.addEventListener('load', () => { boot().catch(showError); });
