/* Proof of Typeface — main origin.
 * The one-pager editor, the export gate and the agent surface. Every number that decides a
 * verdict is measured by the PROOF origin (a sibling origin in an iframe): this page discovers
 * its tools with getTools({fromOrigins}), executes them with executeTool, and never falls back
 * to local measurement. When the proof origin is unreachable the page says so.
 *
 * Thesis: a tool that reports success is not evidence. document.fonts.check() says "true" for a
 * face that was never installed; the pixels disagree; the export gate listens to the pixels
 * and to a human — never to a single tool. */

import { SEED, ROLE, FRAME_HEIGHT_PX } from '/src/seed.js';
import {
  EXPORT_CHAIN, PROOF_SCHEMAS, SIZE_DEFAULT,
  validateInput, validateFamily, validateText, fail, hashString, isGeneric, round2, exportChain
} from '/proof/engine.js';

const PROOF_ORIGIN = window.MC.origin('proof');
/* Single-folder mode (python3 -m http.server): one origin, the proof frame is same-origin and
 * must be addressed by path — otherwise it would load this very page inside itself. */
const SINGLE_ORIGIN = !window.MC.isMulti || PROOF_ORIGIN === window.location.origin;
const PROOF_URL = SINGLE_ORIGIN ? 'proof/index.html' : PROOF_ORIGIN + '/index.html';
const AUDIT_MODE = SINGLE_ORIGIN ? 'same-origin frame (single-folder static mode)' : 'cross-origin (' + PROOF_ORIGIN + ')';
const WRAP_THRESHOLD_DEFAULT = 10;
const LOG_MAX = 40;
const OUTPUT_MAX = 1500;

const $ = (id) => document.getElementById(id);
const clone = (arr) => arr.map((r) => Object.assign({}, r));

/** The one DOM helper: element with class and text (text always via textContent). */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

const state = {
  runs: clone(SEED),
  verdicts: new Map(),   // runId -> verdict measured by the proof origin
  waivers: new Map(),    // runId -> { signedBy: 'human' | 'agent', status: 'signed' | 'proposed', ... }
  selected: null,
  proofTools: [],
  proofError: null,
  lastAuditAt: null,
  exportedAt: null,
  certificateId: null,
  calls: 0,
  spill: null,
  wrapThresholdPct: WRAP_THRESHOLD_DEFAULT,
  columnPx: 620,
  log: [],
  toolchanges: 0
};

/* Audits touch the document, the verdict map and the DOM; they run one at a time. */
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}

/* ---------------- proof-origin plumbing ---------------- */

async function discoverProof() {
  const tools = SINGLE_ORIGIN
    ? await window.mc.getTools()
    : await window.mc.getTools({ fromOrigins: [PROOF_ORIGIN] });
  state.proofTools = tools.filter((t) => (SINGLE_ORIGIN ? t.window !== window : t.origin === PROOF_ORIGIN));
  return state.proofTools;
}

/** Execute a proof-origin tool by its RegisteredTool (never by a self-reported label). */
async function proofCall(name, input) {
  if (!state.proofTools.length) await discoverProof().catch(() => {});
  const tool = state.proofTools.find((t) => t.name === name);
  if (!tool) {
    return fail('wrong_state', 'The proof origin has not exposed "' + name + '" to this page.', 'Reload the page; the proof iframe at ' + PROOF_ORIGIN + ' must load with allow="tools".');
  }
  let raw;
  try {
    raw = await window.mc.executeTool(tool, input || {});
  } catch (e) {
    return fail('wrong_state', 'The proof origin rejected "' + name + '": ' + (e && e.message ? e.message : String(e)), 'Retry; if it persists reload the page.');
  }
  state.calls += 1;
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { parsed = null; }
  if (!parsed || typeof parsed !== 'object') {
    return fail('wrong_state', 'The proof origin returned a non-JSON result for "' + name + '".', 'Retry the call.');
  }
  /* tool.origin / tool.window are stamped by the browser (or the kit), not by the callee. */
  return Object.assign(parsed, { proofOrigin: tool.origin, proofWindowIsFrame: tool.window !== window });
}

/* ---------------- document ---------------- */

const roleOf = (run) => ROLE[run.role] || ROLE.body;
const trackingPx = (run) => (roleOf(run).trackEm ? round2(roleOf(run).trackEm * roleOf(run).size) : 0);
const measuredText = (run) => (roleOf(run).upper ? run.text.toUpperCase() : run.text);

function applyRunStyle(node, run, family) {
  const r = roleOf(run);
  const fam = family || run.family;
  node.style.fontFamily = isGeneric(fam) ? fam : '"' + fam + '", ' + fam;
  node.style.fontSize = r.size + 'px';
  node.style.lineHeight = String(r.lh);
  node.style.letterSpacing = r.trackEm ? r.trackEm + 'em' : 'normal';
  node.style.textTransform = r.upper ? 'uppercase' : 'none';
}

function runEl(runId) {
  return document.querySelector('#doc span[data-run="' + runId + '"]');
}

function renderDoc() {
  const host = $('doc');
  host.textContent = '';
  for (const run of state.runs) {
    const span = el('span', 'r-' + run.role, run.text);
    span.setAttribute('data-run', run.id);
    span.setAttribute('contenteditable', 'plaintext-only');
    span.setAttribute('spellcheck', 'false');
    span.setAttribute('role', 'textbox');
    span.setAttribute('aria-label', run.role + ' run ' + run.id + ', declared ' + run.family);
    span.title = 'declared: ' + run.family + ' — click to interrogate, type to edit';
    applyRunStyle(span, run);
    host.appendChild(span);
  }
  paintFlags();
}

function flagOf(runId) {
  const v = state.verdicts.get(runId);
  if (!v) return '';
  const w = state.waivers.get(runId);
  if (!blockReasons(v).length) return 'proven';
  return w && w.signedBy === 'human' ? 'waived' : 'flagged';
}

function paintFlags() {
  document.querySelectorAll('#doc span[data-run]').forEach((node) => {
    node.classList.remove('flagged', 'proven', 'waived', 'selected');
    const f = flagOf(node.getAttribute('data-run'));
    if (f) node.classList.add(f);
    if (node.getAttribute('data-run') === state.selected) node.classList.add('selected');
  });
}

function measureColumn() {
  const width = Math.round($('doc').getBoundingClientRect().width);
  state.columnPx = width > 40 ? width : 620;
  return state.columnPx;
}

function runsFor(family) {
  if (!family) return state.runs.slice();
  const f = String(family).trim().toLowerCase();
  return state.runs.filter((r) => r.family.toLowerCase() === f);
}

function findRun(runId) {
  return state.runs.find((r) => r.id === runId) || null;
}

/* ---------------- audit (always via the proof origin) ---------------- */

async function auditRuns(runs, signal) {
  const out = [];
  measureColumn();
  for (const run of runs) {
    if (signal && signal.aborted) return fail('wrong_state', 'The audit was aborted before it finished.', 'Call run_audit again.');
    const size = roleOf(run).size;
    const text = measuredText(run);
    const letterSpacingPx = trackingPx(run);
    const hash = await proofCall('glyph_hash', { text, family: run.family, size, letterSpacingPx });
    if (hash.ok === false) return hash;
    const metrics = await proofCall('wrap_metrics', { text, family: run.family, size, letterSpacingPx, columnPx: state.columnPx });
    if (metrics.ok === false) return metrics;
    const v = {
      runId: run.id,
      role: run.role,
      family: run.family,
      size,
      columnPx: state.columnPx,
      letterSpacingPx,
      kind: hash.kind,
      substituted: hash.substituted,
      present: hash.present,
      aliasOf: hash.aliasOf,
      sameAsGeneric: hash.sameAsGeneric,
      requestedHash: hash.requestedHash,
      hashSerifTail: hash.hashSerifTail,
      hashMonoTail: hash.hashMonoTail,
      absentFallbackHash: hash.absentFallbackHash,
      inkPx: hash.inkPx,
      fontsCheckSays: hash.check ? hash.check.declared : null,
      contradiction: !!(hash.check && hash.check.declared === true && hash.substituted),
      widthPx: metrics.declared.widthPx,
      widthDeltaPct: metrics.widthDeltaPct,
      wrapDeltaPct: metrics.medianRightEdgeDeltaPct,
      lineDelta: metrics.lineDelta,
      lines: metrics.declared.lineCount,
      linesUnderSubstitute: metrics.underSubstitute.lineCount,
      medianRightEdge: metrics.declared.medianRightEdge,
      medianRightEdgeUnderSubstitute: metrics.underSubstitute.medianRightEdge,
      fingerprint: metrics.declared.fingerprint,
      wrapLines: metrics.declared.lines,
      substituteFamily: metrics.substituteFamily,
      substituteChain: metrics.substitute.chain,
      substituteModelledEmbed: metrics.substitute.modelledEmbed,
      proofVerdict: hash.verdict,
      wrapVerdict: metrics.verdict,
      proofOrigin: hash.proofOrigin,
      proofTools: ['glyph_hash', 'wrap_metrics']
    };
    state.verdicts.set(run.id, v);
    out.push(v);
  }
  state.lastAuditAt = new Date().toISOString();
  return out;
}

async function auditAll(family, signal) {
  const rows = await auditRuns(runsFor(family), signal);
  if (!Array.isArray(rows)) { renderAll(); return rows; }
  measureSpill();
  renderAll();
  return rows;
}

/* ---------------- page spill (real DOM overflow) ---------------- */

function measureSpill() {
  const frame = $('spill-frame');
  const clip = frame.querySelector('.spill-clip');
  frame.textContent = '';
  const nodes = state.runs.map((run) => {
    const node = el('span', 'run r-' + run.role, run.text);
    applyRunStyle(node, run);
    frame.appendChild(node);
    return node;
  });
  frame.appendChild(clip);
  const asDeclared = frame.scrollHeight - frame.clientHeight;
  const substituteFaces = {};
  nodes.forEach((node, i) => {
    const run = state.runs[i];
    const v = state.verdicts.get(run.id);
    const sub = v ? v.substituteFamily : exportChain(run.family)[0];
    substituteFaces[run.id] = sub;
    applyRunStyle(node, run, sub);
  });
  const asExported = frame.scrollHeight - frame.clientHeight;
  nodes.forEach((node, i) => applyRunStyle(node, state.runs[i]));
  const spill = {
    frameHeightPx: FRAME_HEIGHT_PX,
    contentHeightPx: frame.scrollHeight,
    spillPx: Math.max(0, Math.round(asDeclared)),
    spillPxUnderExportSubstitutes: Math.max(0, Math.round(asExported)),
    spillPct: Math.min(100, Math.round((Math.max(0, asDeclared) / FRAME_HEIGHT_PX) * 100)),
    substituteFaces,
    measuredBy: 'main DOM: scrollHeight − clientHeight of the fixed-height frame',
    modelled: 'which substitute face each run gets follows EXPORT_CHAIN (modelled order, measured presence)',
    measuredAt: new Date().toISOString()
  };
  state.spill = spill;
  const meter = $('spill-meter');
  meter.classList.toggle('bad', spill.spillPx > 0 || spill.spillPxUnderExportSubstitutes > 0);
  meter.setAttribute('aria-valuenow', String(spill.spillPct));
  meter.firstElementChild.style.width = Math.max(4, spill.spillPct) + '%';
  $('spill-readout').textContent = spill.spillPx + 'px clipped · ' + spill.spillPxUnderExportSubstitutes + 'px under substitute faces';
  $('spill-note').textContent = spill.spillPx === 0 && spill.spillPxUnderExportSubstitutes === 0
    ? 'Nothing overflows the fixed-height frame, as declared or under the substitute faces.'
    : 'The frame clips content the editor never shows you. As declared: ' + spill.spillPx + 'px. Under the substitute faces: ' + spill.spillPxUnderExportSubstitutes + 'px — that is page spill, and it is why the gate exists.';
  return spill;
}

/* ---------------- gate + waivers ---------------- */

function blockReasons(v) {
  const reasons = [];
  if (v.substituted) reasons.push('substituted');
  if (v.present && v.wrapDeltaPct !== null && Math.abs(v.wrapDeltaPct) > state.wrapThresholdPct) reasons.push('wrap-shift');
  return reasons;
}

function gateRow(run, v, reasons, w) {
  const row = {
    runId: run.id, role: run.role, declaredFamily: run.family, blockedBy: reasons,
    kind: v.kind, substituteFamily: v.substituteFamily, requestedHash: v.requestedHash,
    widthDeltaPct: v.widthDeltaPct, wrapDeltaPct: v.wrapDeltaPct, fontsCheckSays: v.fontsCheckSays
  };
  if (w) row.proposal = { signedBy: w.signedBy, status: w.status, reason: w.reason, waiverId: w.waiverId };
  return row;
}

function waiverRow(run, v, reasons, w) {
  return Object.assign(gateRow(run, v, reasons), {
    reason: w.reason, signedBy: w.signedBy, signedAt: w.signedAt, waiverId: w.waiverId,
    proposedBy: w.proposedBy || null
  });
}

function gateState() {
  const blocked = [];
  const waived = [];
  const pendingProposals = [];
  const proven = [];
  for (const run of state.runs) {
    const v = state.verdicts.get(run.id);
    if (!v) continue;
    const reasons = blockReasons(v);
    const w = state.waivers.get(run.id);
    if (!reasons.length) { proven.push(run.id); continue; }
    if (w && w.signedBy === 'human') { waived.push(waiverRow(run, v, reasons, w)); continue; }
    blocked.push(gateRow(run, v, reasons, w));
    if (w) pendingProposals.push({ runId: run.id, reason: w.reason, waiverId: w.waiverId, proposedAt: w.signedAt });
  }
  const unaudited = state.runs.filter((r) => !state.verdicts.has(r.id)).map((r) => r.id);
  const clean = blocked.length === 0 && unaudited.length === 0;
  return {
    blocked, waived, pendingProposals, proven, unaudited, clean, exportEnabled: clean,
    wrapThresholdPct: state.wrapThresholdPct,
    rule: 'a run blocks export when its glyph hash proves substitution, or when a present face shifts its wrap median more than wrapThresholdPct under the substitute face; only a human-signed waiver or a proven family swap clears it',
    auditMode: AUDIT_MODE, proofOrigin: PROOF_ORIGIN, callsToProof: state.calls,
    exported: state.exportedAt ? { at: state.exportedAt, certificateId: state.certificateId } : null
  };
}

function compactGate() {
  const g = gateState();
  return { blocked: g.blocked.map((b) => b.runId), waived: g.waived.length, pending: g.pendingProposals.length, unaudited: g.unaudited.length, exportEnabled: g.exportEnabled };
}

/** Record a waiver. signedBy 'human' comes only from UI handlers; tools can only propose. */
function recordWaiver(runId, reason, signedBy, proposedBy) {
  const run = findRun(runId);
  if (!run) return fail('not_found', 'No run with id "' + runId + '".', 'Ids are r1…r' + state.runs.length + '; see run_list.');
  const v = state.verdicts.get(runId);
  if (!v) return fail('wrong_state', 'Run ' + runId + ' has not been audited yet.', 'Call run_audit first.');
  const reasons = blockReasons(v);
  if (!reasons.length) return fail('rule_violation', 'Run ' + runId + ' is not flagged; there is nothing to waive.', 'Only runs listed in export_gate.blocked can be waived.');
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (!why) return fail('invalid_param', 'A waiver needs a non-empty reason; it is printed on the certificate.', 'Example: "brand accepts the fallback for web only".');
  if (why.length > 240) return fail('invalid_param', 'The reason is longer than 240 characters.', 'Keep it to one sentence.');
  const at = new Date().toISOString();
  const w = {
    runId, reason: why, signedBy, status: signedBy === 'human' ? 'signed' : 'proposed',
    proposedBy: proposedBy || null, signedAt: at, declaredFamily: run.family, blockedBy: reasons,
    requestedHash: v.requestedHash,
    waiverId: hashString([runId, v.requestedHash, why, at, signedBy].join('|'))
  };
  state.waivers.set(runId, w);
  return { ok: true, waiver: w };
}

function humanWaive(runIds, reason) {
  const results = runIds.map((id) => recordWaiver(id, reason, 'human', state.waivers.has(id) ? state.waivers.get(id).signedBy : null));
  renderAll();
  return results;
}

function removeWaiver(runId) {
  if (!state.waivers.has(runId)) return fail('not_found', 'No waiver or proposal is on record for "' + runId + '".', 'See waiver_list.');
  const w = state.waivers.get(runId);
  state.waivers.delete(runId);
  renderAll();
  return { ok: true, removed: { runId, signedBy: w.signedBy, status: w.status, waiverId: w.waiverId }, gate: compactGate() };
}

function exportDocument() {
  const g = gateState();
  if (!g.exportEnabled) {
    const unresolved = g.blocked.map((b) => b.runId + ' (' + b.declaredFamily + ': ' + b.blockedBy.join('+') + ')');
    return Object.assign(
      fail('rule_violation', 'Export is blocked: ' + (g.blocked.length ? unresolved.join(', ') : g.unaudited.length + ' run(s) not audited') + '.',
        g.blocked.length ? 'Swap the family with substitute_safe, or call waiver_propose and have a person countersign it in the Export gate panel.' : 'Call run_audit first.'),
      { blocked: g.blocked.map((b) => b.runId), pending: g.pendingProposals.map((p) => p.runId), unaudited: g.unaudited }
    );
  }
  state.exportedAt = new Date().toISOString();
  state.certificateId = 'pot-' + hashString([state.exportedAt, state.calls, ...g.waived.map((w) => w.waiverId)].join('|'));
  renderGate();
  renderStats();
  return {
    ok: true, exportedAt: state.exportedAt, certificateId: state.certificateId,
    waived: g.waived.map((w) => ({ runId: w.runId, family: w.declaredFamily, reason: w.reason, signedBy: w.signedBy, waiverId: w.waiverId })),
    faces: [...new Set(state.runs.map((r) => r.family))],
    proofCalls: state.calls,
    simulated: 'certificate stamp only — no PDF is produced'
  };
}

/* ---------------- editing (human and agent share these) ---------------- */

async function editRun(runId, patch) {
  const run = findRun(runId);
  if (!run) return fail('not_found', 'No run with id "' + runId + '".', 'Ids are r1…r' + state.runs.length + '; see run_list.');
  const changes = {};
  if (patch.text !== undefined) {
    const bad = validateText(patch.text);
    if (bad) return bad;
    changes.text = patch.text.trim();
  }
  if (patch.family !== undefined) {
    const bad = validateFamily(patch.family);
    if (bad) return bad;
    changes.family = patch.family.trim();
  }
  if (!Object.keys(changes).length) return fail('invalid_param', 'Nothing to change: pass text and/or family.', 'Example: {"runId":"r6","family":"Verdana"}.');
  const before = { text: run.text, family: run.family };
  const hadWaiver = state.waivers.has(run.id);
  Object.assign(run, changes);
  state.waivers.delete(run.id);
  const node = runEl(run.id);
  if (node) {
    if (node.textContent !== run.text) node.textContent = run.text;
    applyRunStyle(node, run);
    node.title = 'declared: ' + run.family + ' — click to interrogate, type to edit';
  }
  const rows = await auditRuns([run]);
  measureSpill();
  renderAll();
  if (!Array.isArray(rows)) return rows;
  const v = rows[0];
  return {
    ok: true, runId: run.id, before, after: { text: run.text, family: run.family },
    verdict: { kind: v.kind, substituted: v.substituted, wrapDeltaPct: v.wrapDeltaPct, lines: v.lines, proofOrigin: v.proofOrigin },
    waiverCleared: hadWaiver,
    gate: compactGate()
  };
}

async function substituteFamily(oldFamily, newFamily, runIds, allowKnownSubstitute) {
  const affected = runsFor(oldFamily).filter((r) => !runIds || runIds.includes(r.id));
  if (!affected.length) {
    return Object.assign(fail('not_found', 'No run declares "' + oldFamily + '"' + (runIds ? ' among ' + runIds.join(', ') : '') + '.', 'Declared families: ' + [...new Set(state.runs.map((r) => r.family))].join(', ') + '.'));
  }
  if (isGeneric(newFamily) && !allowKnownSubstitute) {
    return fail('rule_violation', '"' + newFamily + '" is a generic keyword, not a face; swapping to it hides the substitution instead of fixing it.', 'Name an installed face (e.g. "Georgia"), or pass allowKnownSubstitute=true to accept a generic on purpose.');
  }
  const gateBefore = compactGate();
  const probes = [];
  for (const r of affected) {
    const p = await proofCall('glyph_hash', { text: measuredText(r), family: newFamily, size: roleOf(r).size, letterSpacingPx: trackingPx(r) });
    if (p.ok === false) return p;
    probes.push({ runId: r.id, kind: p.kind, substituted: p.substituted, hash: p.requestedHash });
  }
  const unsafe = probes.filter((p) => p.substituted);
  if (unsafe.length && !allowKnownSubstitute) {
    return Object.assign(
      fail('rule_violation', '"' + newFamily + '" is itself ' + unsafe[0].kind + ' on this host (' + unsafe.length + ' of ' + probes.length + ' runs); that is not a safe substitute.', 'Pick a face that glyph_hash reports as own-outlines, or pass allowKnownSubstitute=true.'),
      { probes, proofOrigin: PROOF_ORIGIN }
    );
  }
  const before = affected.map((r) => { const v = state.verdicts.get(r.id); return { runId: r.id, family: r.family, kind: v ? v.kind : 'not-audited', wrapDeltaPct: v ? v.wrapDeltaPct : null }; });
  const waiversCleared = affected.map((r) => r.id).filter((id) => state.waivers.has(id));
  for (const r of affected) {
    r.family = newFamily;
    state.waivers.delete(r.id);
    const node = runEl(r.id);
    if (node) { applyRunStyle(node, r); node.title = 'declared: ' + r.family + ' — click to interrogate, type to edit'; }
  }
  const rows = await auditRuns(affected);
  measureSpill();
  renderAll();
  if (!Array.isArray(rows)) return rows;
  return {
    ok: true, oldFamily, newFamily, changedRuns: affected.map((r) => r.id),
    before, after: rows.map((v) => ({ runId: v.runId, family: v.family, kind: v.kind, wrapDeltaPct: v.wrapDeltaPct, lines: v.lines })),
    waiversCleared, gateBefore, gateAfter: compactGate(), proofOrigin: PROOF_ORIGIN,
    verdict: rows.every((v) => !blockReasons(v).length) ? 'every changed run now clears the gate' : 'some changed runs still block the gate'
  };
}

async function resetDocument() {
  state.runs = clone(SEED);
  state.waivers.clear();
  state.verdicts.clear();
  state.exportedAt = null;
  state.certificateId = null;
  state.selected = null;
  closeModal();
  renderDoc();
  const rows = await auditAll();
  return Array.isArray(rows) ? { ok: true, runs: state.runs.length, gate: compactGate() } : rows;
}

/* ---------------- rendering ---------------- */

function fmtPct(n) {
  return n === null || n === undefined ? '—' : (n > 0 ? '+' : '') + n + '%';
}

function renderBadge() {
  const badge = $('binding-badge');
  badge.textContent = window.MC.native ? 'WebMCP: native document.modelContext' : 'WebMCP: kit shim (spec-shaped)';
  badge.title = window.MC.native
    ? 'This browser ships WebMCP; window.mc is document.modelContext.'
    : 'No native document.modelContext; kit/mc.js provides the same surface. Chrome 149+ with chrome://flags/#enable-webmcp-testing runs it natively.';
  badge.classList.toggle('native', window.MC.native);
  $('mode-line').textContent = (SINGLE_ORIGIN ? 'single-folder mode: proof frame is same-origin' : 'multi-origin: proof origin ' + PROOF_ORIGIN);
}

function renderStats() {
  const g = gateState();
  $('stat-runs').textContent = state.runs.length;
  $('stat-flagged').textContent = g.blocked.length;
  $('stat-waived').textContent = g.waived.length;
  $('stat-spill').textContent = state.spill ? state.spill.spillPx + 'px' : '—';
  $('audit-status').textContent = state.proofError
    ? 'proof origin offline — ' + state.proofError
    : state.lastAuditAt
      ? state.lastAuditAt.replace('T', ' ').slice(0, 19) + ' · ' + state.calls + ' calls · ' + AUDIT_MODE
      : 'not yet audited';
}

function renderTable() {
  const t = $('audit-table');
  t.textContent = '';
  const head = el('tr');
  for (const h of ['run', 'declared', 'installed?', 'fonts.check', 'glyph hash', 'Δwidth', 'Δwrap', 'lines', 'verdict']) head.appendChild(el('th', null, h));
  t.appendChild(head);
  for (const run of state.runs) {
    const v = state.verdicts.get(run.id);
    const tr = el('tr');
    tr.setAttribute('data-row', run.id);
    const idBtn = el('button', 'link mono', run.id);
    idBtn.type = 'button';
    idBtn.setAttribute('aria-label', 'inspect run ' + run.id);
    idBtn.addEventListener('click', () => selectRun(run.id));
    tr.appendChild(el('td')).appendChild(idBtn);
    tr.appendChild(el('td', null, run.family));
    if (!v) {
      const td = el('td', 'hint', 'not audited');
      td.colSpan = 7;
      tr.appendChild(td);
      t.appendChild(tr);
      continue;
    }
    tr.appendChild(el('td', 'v', v.present ? (v.kind === 'aliased' ? 'alias of ' + v.aliasOf : 'yes') : 'no — fallback'));
    const check = el('td', 'v', v.fontsCheckSays === true ? 'true' : String(v.fontsCheckSays));
    if (v.contradiction) check.appendChild(el('b', 'bad', ' contradicted'));
    tr.appendChild(check);
    const hash = el('td', 'v', v.requestedHash);
    if (v.substituted) hash.appendChild(el('b', 'bad', ' ≠ own'));
    tr.appendChild(hash);
    tr.appendChild(el('td', 'v', fmtPct(v.widthDeltaPct)));
    const wrap = el('td', 'v', fmtPct(v.wrapDeltaPct));
    if (blockReasons(v).includes('wrap-shift')) wrap.appendChild(el('b', 'bad', ' > ' + state.wrapThresholdPct + '%'));
    tr.appendChild(wrap);
    tr.appendChild(el('td', 'v', v.lines + '→' + v.linesUnderSubstitute));
    const f = flagOf(run.id);
    const verdict = el('td');
    verdict.appendChild(f === 'waived' ? el('span', 'brass-tag', 'waived') : f === 'flagged' ? el('span', 'stamp', blockReasons(v).join(' + ')) : el('span', 'wax small-wax', 'proven'));
    tr.appendChild(verdict);
    t.appendChild(tr);
  }
}

function selectRun(runId) {
  state.selected = runId;
  paintFlags();
  renderDrawer();
}

function drawerRow(table, k, val, bad) {
  const tr = el('tr');
  tr.appendChild(el('td', null, k));
  const td = el('td', 'v' + (bad ? ' bad' : ''), val);
  tr.appendChild(td);
  table.appendChild(tr);
}

function renderDrawer() {
  const body = $('drawer-body');
  const run = findRun(state.selected);
  if (!run) {
    $('drawer-id').textContent = 'no run selected';
    body.textContent = '';
    body.appendChild(el('p', 'drawer-empty', 'Click a run in the document to compare what it declares with what the renderer actually drew.'));
    return;
  }
  $('drawer-id').textContent = run.id + ' · ' + run.role;
  body.textContent = '';
  const v = state.verdicts.get(run.id);
  if (!v) { body.appendChild(el('p', 'drawer-empty', 'Not audited yet — press Re-audit.')); return; }
  const w = state.waivers.get(run.id);
  const reasons = blockReasons(v);
  const badge = el('div', 'badge-row');
  if (w && w.signedBy === 'human' && reasons.length) badge.appendChild(el('span', 'brass-tag', 'waived by a person — ' + w.reason));
  else if (reasons.length) badge.appendChild(el('span', 'stamp', reasons.join(' + ') + ' — the face you asked for ≠ the face you will get'));
  else badge.appendChild(el('span', 'wax', 'PROVEN'));
  if (w && w.signedBy === 'agent') badge.appendChild(el('span', 'hint', ' waiver proposed by an agent (' + w.reason + ') — awaiting your countersignature in the Export gate.'));
  body.appendChild(badge);

  const table = el('table', 'scrutiny');
  const th = el('tr');
  th.appendChild(el('th', null, 'question'));
  th.appendChild(el('th', 'right', 'answer'));
  table.appendChild(th);
  drawerRow(table, 'declared family', run.family);
  drawerRow(table, 'document.fonts.check', v.fontsCheckSays === true ? 'true (answers a different question)' : String(v.fontsCheckSays));
  drawerRow(table, 'installed here (two-tails test)', v.present ? (v.kind === 'aliased' ? 'alias of ' + v.aliasOf : 'yes — own outlines') : 'no — browser fallback', v.substituted);
  drawerRow(table, 'measured by', 'proof origin @ ' + v.proofOrigin);
  drawerRow(table, 'glyph hash, serif tail', v.hashSerifTail);
  drawerRow(table, 'glyph hash, monospace tail', v.hashMonoTail, v.hashSerifTail !== v.hashMonoTail);
  drawerRow(table, 'draws exactly like generic', v.sameAsGeneric || 'no generic keyword');
  drawerRow(table, 'ink pixels rasterised', String(v.inkPx));
  drawerRow(table, 'measureText width', v.widthPx + 'px at ' + v.size + 'px' + (v.letterSpacingPx ? ', tracking ' + v.letterSpacingPx + 'px' : ''));
  drawerRow(table, 'substitute face (modelled chain)', v.substituteFamily + (v.substituteModelledEmbed !== v.substituteFamily ? ' (pipeline would try ' + v.substituteModelledEmbed + ' first; absent here)' : ''));
  drawerRow(table, 'width under substitute', fmtPct(v.widthDeltaPct));
  drawerRow(table, 'median right edge', v.medianRightEdge + 'px → ' + v.medianRightEdgeUnderSubstitute + 'px');
  drawerRow(table, 'wrap fingerprint delta', fmtPct(v.wrapDeltaPct) + ' (gate threshold ' + state.wrapThresholdPct + '%)', reasons.includes('wrap-shift'));
  drawerRow(table, 'lines at ' + v.columnPx + 'px column', v.lines + ' → ' + v.linesUnderSubstitute);
  drawerRow(table, 'wrap fingerprint', v.fingerprint);
  body.appendChild(table);

  const lines = el('div', 'wrap-lines');
  (v.wrapLines || []).forEach((l, i) => lines.appendChild(el('div', 'wl', 'L' + (i + 1) + ' right edge ' + l.rightEdge + 'px · ' + l.text)));
  body.appendChild(lines);
  body.appendChild(el('p', 'hint', v.proofVerdict));
  body.appendChild(el('p', 'hint', 'Greedy word-wrap measured at the rendered column width (' + v.columnPx + 'px) with the role’s size, case and tracking; the page justifies its lines, so compare line counts, not right edges.'));

  const editor = el('div', 'family-editor');
  const label = el('label', 'kicker', 'Declared family');
  label.htmlFor = 'family-input';
  const input = el('input');
  input.id = 'family-input';
  input.type = 'text';
  input.value = run.family;
  input.setAttribute('list', 'family-options');
  const apply = el('button', 'small', 'Apply family');
  apply.type = 'button';
  apply.addEventListener('click', () => {
    serial(() => editRun(run.id, { family: input.value })).then((r) => { if (r.ok === false) showError(r.error.message); }).catch(showError);
  });
  editor.append(label, input, apply);
  body.appendChild(editor);

  const btns = el('div', 'btn-row');
  const waive = el('button', 'small', w && w.signedBy === 'agent' ? 'Countersign waiver' : 'Waive this run');
  waive.type = 'button';
  waive.id = 'btn-waive';
  waive.disabled = !reasons.length || (w && w.signedBy === 'human');
  waive.addEventListener('click', () => openModal([run.id], waive));
  const revoke = el('button', 'ghost small', w ? (w.signedBy === 'human' ? 'Revoke waiver' : 'Reject proposal') : 'Revoke waiver');
  revoke.type = 'button';
  revoke.id = 'btn-unwaive';
  revoke.disabled = !w;
  revoke.addEventListener('click', () => removeWaiver(run.id));
  btns.append(waive, revoke);
  body.appendChild(btns);
}

function renderGate() {
  const g = gateState();
  $('gate-blocked').textContent = g.blocked.length;
  $('gate-blocked').className = 'gate-count ' + (g.blocked.length ? 'bad' : 'good');
  $('gate-waived').textContent = g.waived.length;
  $('gate-pending').textContent = g.pendingProposals.length;
  const btn = $('btn-export');
  btn.disabled = !g.exportEnabled;
  btn.classList.toggle('locked', !g.exportEnabled);
  btn.textContent = g.exportEnabled ? 'Export' : 'Export (' + (g.blocked.length || g.unaudited.length) + ')';
  const seal = $('gate-seal');
  seal.textContent = '';
  if (state.exportedAt) seal.appendChild(el('span', 'wax', 'ISSUED'));
  else if (g.exportEnabled) seal.appendChild(el('span', 'wax', 'READY'));
  $('gate-note').textContent = g.unaudited.length
    ? g.unaudited.length + ' run(s) not yet audited (' + g.unaudited.join(', ') + ') — press Re-audit.'
    : g.blocked.length
      ? 'Blocked: ' + g.blocked.map((b) => b.runId + ' (' + b.declaredFamily + ': ' + b.blockedBy.join('+') + ')').join(', ') + '. Swap the family, or sign a waiver yourself — an agent can only propose one.'
      : g.waived.length
        ? 'Cleared by ' + g.waived.length + ' human waiver(s); the reasons travel on the certificate.'
        : 'Every run draws its own outlines and wraps within ' + state.wrapThresholdPct + '%. Nothing to waive.';
  $('btn-waive-all').disabled = !g.blocked.length;
  $('threshold').value = String(state.wrapThresholdPct);
  const list = $('waiver-list');
  list.textContent = '';
  for (const p of g.pendingProposals) {
    const li = el('li', 'pending');
    li.appendChild(el('span', null, p.runId + ' — proposed by agent: ' + p.reason));
    const actions = el('span', 'btn-row');
    const sign = el('button', 'small', 'Countersign');
    sign.type = 'button';
    sign.addEventListener('click', () => openModal([p.runId], sign));
    const reject = el('button', 'ghost small', 'Reject');
    reject.type = 'button';
    reject.addEventListener('click', () => removeWaiver(p.runId));
    actions.append(sign, reject);
    li.appendChild(actions);
    list.appendChild(li);
  }
  for (const w of g.waived) {
    const li = el('li');
    li.appendChild(el('span', null, w.runId + ' ' + w.declaredFamily + ' — ' + w.reason + (w.proposedBy ? ' (proposed by agent, countersigned)' : '')));
    li.appendChild(el('span', 'mono', w.waiverId));
    list.appendChild(li);
  }
}

function paramSummary(schema) {
  const props = (schema && schema.properties) || {};
  const req = new Set((schema && schema.required) || []);
  return Object.entries(props).map(([k, p]) => k + (req.has(k) ? '*' : '') + ':' + (p.enum ? p.enum.join('|') : p.type)).join(' ') || 'no parameters';
}

async function renderToolList() {
  let tools = [];
  try {
    tools = SINGLE_ORIGIN ? await window.mc.getTools() : await window.mc.getTools({ fromOrigins: [PROOF_ORIGIN] });
  } catch (e) { tools = []; }
  const list = $('tool-list');
  list.textContent = '';
  let top = 0;
  for (const t of tools) {
    const fromFrame = t.window !== window;
    if (!fromFrame) top += 1;
    const li = el('li');
    const head = el('div', 'tool-head');
    head.appendChild(el('span', 't-name', t.name));
    head.appendChild(el('span', 't-orig ' + (fromFrame ? 'proof' : ''), fromFrame ? (SINGLE_ORIGIN ? 'proof frame (same-origin)' : 'proof origin') : 'top-level'));
    if (t.annotations && t.annotations.readOnlyHint) head.appendChild(el('span', 'chip', 'read-only'));
    if (t.annotations && t.annotations.untrustedContentHint) head.appendChild(el('span', 'chip', 'untrusted content'));
    li.appendChild(head);
    if (t.title) li.appendChild(el('div', 't-title', t.title));
    li.appendChild(el('div', 't-desc', t.description));
    li.appendChild(el('div', 't-params', paramSummary(t.inputSchema)));
    list.appendChild(li);
  }
  $('tool-count').textContent = tools.length + ' visible · ' + top + ' top-level · toolchange ×' + state.toolchanges;
  renderAgentSelect(tools.map((t) => t.name));
}

let toolListTimer = null;
function scheduleToolList() {
  clearTimeout(toolListTimer);
  toolListTimer = setTimeout(() => { renderToolList().catch(() => {}); }, 60);
}

function renderAgentSelect(names) {
  const sel = $('agent-tool');
  const current = sel.value;
  sel.textContent = '';
  for (const n of names) sel.appendChild(el('option', null, n));
  if (names.includes(current)) sel.value = current;
}

function pushLog(entry) {
  state.log.unshift(entry);
  if (state.log.length > LOG_MAX) state.log.length = LOG_MAX;
  const list = $('agent-log');
  list.textContent = '';
  for (const e of state.log) {
    const li = el('li', e.ok ? 'ok' : 'err');
    const head = el('div', 'log-head');
    head.appendChild(el('span', 't-name', e.name));
    head.appendChild(el('span', 'chip', e.ok ? 'ok' : 'error'));
    head.appendChild(el('span', 'mono', e.ms + ' ms'));
    li.appendChild(head);
    li.appendChild(el('div', 'log-io', 'in ' + JSON.stringify(e.input)));
    const out = JSON.stringify(e.output);
    li.appendChild(el('div', 'log-io', 'out ' + (out.length > 240 ? out.slice(0, 240) + '…' : out)));
    list.appendChild(li);
  }
}

function renderAll() {
  paintFlags();
  renderStats();
  renderTable();
  renderGate();
  renderDrawer();
}

function showError(e) {
  const msg = e && e.message ? e.message : String(e);
  $('audit-status').textContent = 'error: ' + msg;
}

/* ---------------- waiver modal (the only place a human signature is made) ---------------- */

let modalRuns = [];
let modalOpener = null;

function openModal(runIds, opener) {
  modalRuns = runIds.slice();
  modalOpener = opener || null;
  const first = findRun(runIds[0]);
  const v = first ? state.verdicts.get(first.id) : null;
  const existing = first ? state.waivers.get(first.id) : null;
  $('modal-title').textContent = existing && existing.signedBy === 'agent' ? 'Countersign an agent’s proposal' : 'Waive a substitution';
  $('modal-run').textContent = runIds.length > 1
    ? runIds.length + ' flagged runs (' + runIds.join(', ') + '). One reason will be signed for all of them.'
    : first.id + ' declares "' + first.family + '"; the proof origin measured ' + (v ? v.kind + ' (hash ' + v.requestedHash + ', wrap ' + fmtPct(v.wrapDeltaPct) + ')' : '—') + '. Signing says: I accept this as a person.';
  $('waiver-reason').value = existing ? existing.reason : '';
  $('modal').hidden = false;
  $('waiver-reason').focus();
}

function closeModal() {
  if ($('modal').hidden) return;
  $('modal').hidden = true;
  modalRuns = [];
  if (modalOpener && document.contains(modalOpener)) modalOpener.focus();
  modalOpener = null;
}

/* ---------------- tools ---------------- */

const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false };
const RUN_ID = { type: 'string', description: 'Run id from run_list, e.g. "r7".', maxLength: 8 };
const FAMILY = { type: 'string', description: 'A single CSS font family name, e.g. "Georgia".', maxLength: 64 };

/** Wrap execute: validate the input shape, never throw, and log every invocation in the panel. */
function tool(def) {
  const exec = def.execute;
  const schema = def.inputSchema || NO_ARGS;
  return Object.assign({}, def, {
    inputSchema: schema,
    execute: async (input, opts) => {
      const t0 = performance.now();
      const args = input && typeof input === 'object' && !Array.isArray(input) ? input : (input === undefined || input === null ? {} : input);
      let out;
      const bad = validateInput(schema, args);
      if (bad) out = bad;
      else {
        try { out = await exec(args, opts || {}); } catch (e) {
          console.warn('tool failed:', def.name, e);
          out = fail('wrong_state', 'The tool hit an unexpected condition: ' + (e && e.message ? e.message : String(e)), 'Retry; reload the page if it persists.');
        }
      }
      if (out === undefined) out = { ok: true };
      pushLog({ name: def.name, input: args, ok: !(out && out.ok === false), ms: Math.round(performance.now() - t0), output: out });
      return out;
    }
  });
}

const concise = (v) => {
  const row = {
    runId: v.runId, family: v.family, kind: v.kind, blockedBy: blockReasons(v),
    widthDeltaPct: v.widthDeltaPct, wrapDeltaPct: v.wrapDeltaPct, lines: v.lines + '→' + v.linesUnderSubstitute
  };
  if (state.waivers.has(v.runId)) row.waiver = state.waivers.get(v.runId).signedBy;
  return row;
};

function bridge(localName, remoteName, title, description) {
  const schema = PROOF_SCHEMAS[remoteName];
  return {
    name: localName,
    title,
    description: description + ' Relays to "' + remoteName + '" registered by the proof origin (an iframe served from ' + PROOF_ORIGIN + ') through getTools({fromOrigins}) and executeTool; the result carries proofOrigin. Read-only measurement.',
    inputSchema: schema,
    annotations: { readOnlyHint: true },
    execute: async (input) => {
      const r = await proofCall(remoteName, input);
      return r.ok === false ? r : Object.assign({ bridgedTo: remoteName }, r);
    }
  };
}

const TOOLS = [
  {
    name: 'doc_get',
    title: 'Get document',
    description: 'Return the one-pager: {runs:[{id, role, family, text}], columnPx, frameHeightPx, wrapThresholdPct, auditMode}. Text is the document author’s. Read-only.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async () => ({
      ok: true, runs: state.runs.map((r) => ({ id: r.id, role: r.role, family: r.family, text: r.text })),
      columnPx: state.columnPx, frameHeightPx: FRAME_HEIGHT_PX, wrapThresholdPct: state.wrapThresholdPct, auditMode: AUDIT_MODE
    })
  },
  {
    name: 'run_list',
    title: 'List runs with verdicts',
    description: 'Every run with its cached verdict: [{runId, family, kind (own-outlines|absent|aliased|not-audited), blockedBy[], widthDeltaPct, wrapDeltaPct, lines, waiver?}]. Optional family filter. Read-only; run_audit refreshes the verdicts, run_explain gives the full evidence.',
    inputSchema: { type: 'object', properties: { family: Object.assign({}, FAMILY, { description: 'Only runs declaring this family, e.g. "Georgia". Default: all runs.' }) }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async (input) => {
      const runs = runsFor(input.family);
      if (!runs.length) return fail('empty_result', 'No run declares "' + input.family + '".', 'Declared families: ' + [...new Set(state.runs.map((r) => r.family))].join(', ') + '.');
      const rows = runs.map((run) => {
        const v = state.verdicts.get(run.id);
        return v ? concise(v) : { runId: run.id, family: run.family, kind: 'not-audited', blockedBy: [] };
      });
      return { ok: true, count: rows.length, wrapThresholdPct: state.wrapThresholdPct, measuredBy: PROOF_ORIGIN, runs: rows };
    }
  },
  {
    name: 'run_audit',
    title: 'Audit runs via the proof origin',
    description: 'Re-measure every run (or one family) by calling glyph_hash and wrap_metrics on the proof origin, update the verdict table, flags and export gate, and return the verdicts. format "concise" (default, one line per run) or "detailed" (hashes, chains, per-line edges; large). Changes gate state.',
    inputSchema: {
      type: 'object',
      properties: {
        family: Object.assign({}, FAMILY, { description: 'Restrict the audit to runs declaring this family, e.g. "Georgia". Default: all runs.' }),
        format: { type: 'string', enum: ['concise', 'detailed'], description: 'Output size: "concise" (default) or "detailed".' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    execute: (input, opts) => serial(async () => {
      const runs = runsFor(input.family);
      if (!runs.length) return fail('empty_result', 'No run declares "' + input.family + '".', 'Declared families: ' + [...new Set(state.runs.map((r) => r.family))].join(', ') + '.');
      const rows = await auditAll(input.family, opts.signal);
      if (!Array.isArray(rows)) return rows;
      const g = compactGate();
      return {
        ok: true, auditMode: AUDIT_MODE, proofOrigin: PROOF_ORIGIN, proofToolsUsed: ['glyph_hash', 'wrap_metrics'],
        columnPx: state.columnPx, auditedAt: state.lastAuditAt, callsToProof: state.calls, gate: g,
        runs: input.format === 'detailed' ? rows : rows.map(concise)
      };
    })
  },
  {
    name: 'run_explain',
    title: 'Explain one run',
    description: 'The full cached verdict for one run: declared vs installed (two-tails hashes), alias/fallback kind, fonts.check contradiction, width and wrap deltas under the substitute face, per-line right edges, waiver state, and a one-sentence reading. Read-only; needs a prior run_audit.',
    inputSchema: { type: 'object', properties: { runId: RUN_ID }, required: ['runId'], additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async (input) => {
      const run = findRun(input.runId);
      if (!run) return fail('not_found', 'No run with id "' + input.runId + '".', 'Ids are r1…r' + state.runs.length + '; see run_list.');
      const v = state.verdicts.get(run.id);
      if (!v) return fail('wrong_state', 'Run ' + run.id + ' has not been audited yet.', 'Call run_audit first.');
      const reasons = blockReasons(v);
      return {
        ok: true, runId: run.id, declared: run.family, blockedBy: reasons, verdict: v,
        waiver: state.waivers.get(run.id) || null,
        reads: v.kind === 'absent'
          ? 'document.fonts.check says "' + run.family + '" is fine, but the browser draws different pixels under a serif and a monospace tail — the name was ignored and a fallback face is on the page.'
          : v.kind === 'aliased'
            ? '"' + run.family + '" resolves to the installed face "' + v.aliasOf + '" — the name on the page is not the face on the page.'
            : reasons.includes('wrap-shift')
              ? '"' + run.family + '" is installed here, but under its export substitute (' + v.substituteFamily + ') the wrap median shifts ' + fmtPct(v.wrapDeltaPct) + ', beyond the ' + state.wrapThresholdPct + '% threshold.'
              : '"' + run.family + '" draws its own outlines (' + v.requestedHash + ' under both tails) and wraps within threshold; nothing to fix.'
      };
    }
  },
  {
    name: 'family_report',
    title: 'Try a candidate family',
    description: 'What a candidate family would do to the document: whether it is installed here (glyph_hash), and for each run (or the given runIds) the line count and width delta versus the run’s current face, measured by the proof origin. Returns {family, present, kind, runs:[…]}. Changes nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        family: Object.assign({}, FAMILY, { description: 'Candidate family to try, e.g. "Palatino".' }),
        runIds: { type: 'array', items: { type: 'string' }, description: 'Runs to report on, e.g. ["r3","r8"]. Default: all runs.' }
      },
      required: ['family'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true },
    execute: async (input) => {
      const bad = validateFamily(input.family);
      if (bad) return bad;
      const family = input.family.trim();
      const runs = input.runIds ? state.runs.filter((r) => input.runIds.includes(r.id)) : state.runs;
      if (!runs.length) return fail('not_found', 'None of the runIds exist.', 'Ids are r1…r' + state.runs.length + '; see run_list.');
      measureColumn();
      const probe = await proofCall('glyph_hash', { family, size: SIZE_DEFAULT });
      if (probe.ok === false) return probe;
      const rows = [];
      for (const run of runs) {
        const args = { text: measuredText(run), size: roleOf(run).size, letterSpacingPx: trackingPx(run), columnPx: state.columnPx };
        const now = await proofCall('wrap_metrics', Object.assign({ family: run.family }, args));
        if (now.ok === false) return now;
        const next = await proofCall('wrap_metrics', Object.assign({ family }, args));
        if (next.ok === false) return next;
        rows.push({
          runId: run.id, currentFamily: run.family, linesNow: now.declared.lineCount, linesWithCandidate: next.declared.lineCount,
          widthDeltaPct: round2(((next.declared.widthPx - now.declared.widthPx) / (now.declared.widthPx || 1)) * 100)
        });
      }
      return { ok: true, family, present: probe.present, kind: probe.kind, proofOrigin: probe.proofOrigin, columnPx: state.columnPx, runs: rows };
    }
  },
  {
    name: 'substitute_safe',
    title: 'Swap a family and re-audit',
    description: 'Replace oldFamily with newFamily on every run declaring it (or only runIds), after the proof origin proves newFamily draws its own outlines here; then re-audit those runs and refresh the gate. Refuses generic keywords and absent/aliased faces unless allowKnownSubstitute=true. Drops waivers on the changed runs. Returns {before, after, gateBefore, gateAfter}.',
    inputSchema: {
      type: 'object',
      properties: {
        oldFamily: Object.assign({}, FAMILY, { description: 'Declared family to replace, e.g. "Poppins".' }),
        newFamily: Object.assign({}, FAMILY, { description: 'Family to set instead, e.g. "Palatino".' }),
        runIds: { type: 'array', items: { type: 'string' }, description: 'Restrict the swap to these runs, e.g. ["r7"]. Default: every run declaring oldFamily.' },
        allowKnownSubstitute: { type: 'boolean', description: 'true to accept a face the proof origin reports as absent/aliased/generic. Default false.' }
      },
      required: ['oldFamily', 'newFamily'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    execute: (input) => serial(async () => {
      const a = validateFamily(input.oldFamily, 'oldFamily');
      if (a) return a;
      const b = validateFamily(input.newFamily, 'newFamily');
      if (b) return b;
      return substituteFamily(input.oldFamily.trim(), input.newFamily.trim(), input.runIds || null, input.allowKnownSubstitute === true);
    })
  },
  {
    name: 'doc_edit',
    title: 'Edit a run',
    description: 'Change one run’s text and/or declared family, then re-audit that run through the proof origin and refresh the gate. Any waiver on the run is dropped because its evidence changed. Returns {before, after, verdict, gate}.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: RUN_ID,
        text: { type: 'string', description: 'New text for the run, e.g. "Order the specimen book". Omit to keep.', maxLength: 2000 },
        family: Object.assign({}, FAMILY, { description: 'New declared family, e.g. "Georgia". Omit to keep.' })
      },
      required: ['runId'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: (input) => serial(() => editRun(input.runId, { text: input.text, family: input.family }))
  },
  {
    name: 'waiver_propose',
    title: 'Propose a waiver (needs a human)',
    description: 'Propose that a flagged run’s substitution is acceptable, with a reason. The proposal is recorded as signedBy "agent" and shown in the Export gate panel; it changes nothing until a person countersigns it there. Returns {status:"proposed", waiver, gate}. Only runs in export_gate.blocked can be proposed.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: RUN_ID,
        reason: { type: 'string', description: 'Why the substitution is acceptable; printed on the certificate. E.g. "web-only, fallback approved by brand".', maxLength: 240 }
      },
      required: ['runId', 'reason'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input) => {
      const existing = state.waivers.get(input.runId);
      if (existing && existing.signedBy === 'human') return fail('wrong_state', 'Run ' + input.runId + ' already carries a human-signed waiver.', 'Nothing to do; see waiver_list.');
      const r = recordWaiver(input.runId, input.reason, 'agent');
      if (r.ok === false) return r;
      renderAll();
      return { ok: true, status: 'proposed', requiresHuman: true, waiver: r.waiver, gate: compactGate(), next: 'A person must countersign in the Export gate panel; the gate is unchanged until then.' };
    }
  },
  {
    name: 'waiver_remove',
    title: 'Remove a waiver or proposal',
    description: 'Delete the waiver or pending proposal on a run; a flagged run blocks the export gate again. Returns {removed, gate}.',
    inputSchema: { type: 'object', properties: { runId: RUN_ID }, required: ['runId'], additionalProperties: false },
    annotations: { readOnlyHint: false },
    execute: async (input) => removeWaiver(input.runId)
  },
  {
    name: 'waiver_list',
    title: 'List waivers and proposals',
    description: 'Every waiver on record with signedBy (human|agent), status (signed|proposed), reason, waiverId, and whether it currently clears the gate (effective). Read-only.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async () => {
      const g = gateState();
      const effective = new Set(g.waived.map((w) => w.runId));
      const waivers = [...state.waivers.values()].map((w) => Object.assign({}, w, { effective: effective.has(w.runId) }));
      return { ok: true, count: waivers.length, effective: effective.size, pending: g.pendingProposals.length, waivers };
    }
  },
  {
    name: 'export_gate',
    title: 'Export gate status',
    description: 'The gate exactly as the Export button sees it: {blocked:[{runId, declaredFamily, blockedBy, …}], waived, pendingProposals, unaudited, exportEnabled, wrapThresholdPct, rule}. The threshold is set by a person in the panel. Read-only.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
    execute: async () => Object.assign({ ok: true }, gateState())
  },
  {
    name: 'export_document',
    title: 'Export (gate-checked)',
    description: 'Run the gate and, only when it is clean, stamp a certificate id (no PDF is produced — simulated export). Returns {certificateId, waived, faces} on success, or {ok:false, error:{code:"rule_violation"}, blocked, pending} and changes nothing when runs are unresolved.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: false },
    execute: async () => exportDocument()
  },
  {
    name: 'page_spill',
    title: 'Page spill (fixed-height frame)',
    description: 'Real DOM overflow of the one-pager inside a fixed-height frame, measured at the last audit: {spillPx, spillPct, contentHeightPx, spillPxUnderExportSubstitutes, substituteFaces}. Which substitute face applies per run is modelled. Read-only; run_audit refreshes it.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
    execute: async () => (state.spill ? Object.assign({ ok: true }, state.spill) : fail('wrong_state', 'The spill frame has not been measured yet.', 'Call run_audit first.'))
  },
  {
    name: 'reset_document',
    title: 'Reset to the seed',
    description: 'Restore the seeded one-pager, drop every waiver, proposal and certificate, and re-audit through the proof origin. Cannot be undone. Returns {runs, gate}.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: false },
    execute: () => serial(resetDocument)
  },
  bridge('proof_glyph_hash', 'glyph_hash', 'Proof: glyph hash', 'Two-tails pixel test for one family: is the face installed, or does the browser draw the fallback tail? Returns {present, substituted, kind, hashSerifTail, hashMonoTail, inkPx, widthPx, check}.'),
  bridge('proof_wrap_metrics', 'wrap_metrics', 'Proof: wrap fingerprint', 'Greedy word-wrap metrics for text in a family at columnPx, and again under the first installed face of its export chain: line counts, median right edges, widthDeltaPct, medianRightEdgeDeltaPct.'),
  bridge('proof_compare_faces', 'compare_faces', 'Proof: compare two faces', 'Rasterise the same text in two families and report whether the pixels are identical, whether each is installed, and the width delta.'),
  bridge('proof_font_check', 'font_check', 'Proof: fonts.check vs pixels', 'Compare document.fonts.check() with the pixel test for one family; contradiction=true when check() says true for a face the pixels prove absent or aliased.'),
  bridge('proof_export_preview', 'export_preview', 'Proof: export face preview', 'Which face an export pipeline would embed for a family: the modelled chain, which of its faces are installed here, and the measured raster/width change.')
].map(tool);

/* ---------------- human UI wiring (once, at boot) ---------------- */

function wireHumanUi() {
  const doc = $('doc');
  doc.addEventListener('focusin', (ev) => {
    const node = ev.target.closest('span[data-run]');
    if (node && node.getAttribute('data-run') !== state.selected) selectRun(node.getAttribute('data-run'));
  });
  doc.addEventListener('click', (ev) => {
    const node = ev.target.closest('span[data-run]');
    if (node) selectRun(node.getAttribute('data-run'));
  });
  doc.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.closest('span[data-run]')) { ev.preventDefault(); ev.target.blur(); }
  });
  doc.addEventListener('focusout', (ev) => {
    const node = ev.target.closest('span[data-run]');
    if (!node) return;
    const run = findRun(node.getAttribute('data-run'));
    const text = node.textContent.trim();
    if (!run || text === run.text) { if (run) node.textContent = run.text; return; }
    if (!text) { node.textContent = run.text; return; }
    serial(() => editRun(run.id, { text })).then((r) => { if (r.ok === false) showError(r.error.message); }).catch(showError);
  });

  $('btn-audit').addEventListener('click', () => serial(() => auditAll()).catch(showError));
  $('btn-reset').addEventListener('click', () => serial(resetDocument).catch(showError));
  $('btn-export').addEventListener('click', () => { const r = exportDocument(); if (r.ok === false) showError(r.error.message); });
  $('btn-waive-all').addEventListener('click', (ev) => {
    const g = gateState();
    if (g.blocked.length) openModal(g.blocked.map((b) => b.runId), ev.currentTarget);
  });
  $('threshold').addEventListener('change', () => {
    const n = Number($('threshold').value);
    state.wrapThresholdPct = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : WRAP_THRESHOLD_DEFAULT;
    renderAll();
  });
  $('modal-cancel').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (ev) => { if (ev.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeModal(); });
  $('waiver-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const runIds = modalRuns.slice();
    const reason = $('waiver-reason').value.trim();
    if (!runIds.length || !reason) return;
    closeModal();
    const results = humanWaive(runIds, reason);
    const failed = results.find((r) => r.ok === false);
    if (failed) showError(failed.error.message);
  });
  $('proof-toggle').addEventListener('click', () => {
    const min = $('proof-frame').classList.toggle('minimised');
    $('proof-toggle').setAttribute('aria-expanded', String(!min));
  });

  $('agent-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = $('agent-tool').value;
    let input = {};
    try { input = JSON.parse($('agent-input').value || '{}'); } catch (e) { $('agent-out').textContent = 'invalid JSON: ' + e.message; return; }
    $('agent-out').textContent = 'running ' + name + ' …';
    try {
      const r = await window.__agent.call(name, input);
      let parsed = r;
      try { parsed = typeof r === 'string' ? JSON.parse(r) : r; } catch (e) { parsed = r; }
      $('agent-out').textContent = JSON.stringify(parsed, null, 2);
      $('agent-out').classList.remove('flash');
      void $('agent-out').offsetWidth;
      $('agent-out').classList.add('flash');
    } catch (e) {
      $('agent-out').textContent = 'ERROR ' + (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e));
    }
  });
  const presets = {
    run_audit: {},
    export_gate: {},
    substitute_safe: { oldFamily: 'Poppins', newFamily: 'Palatino' },
    waiver_propose: { runId: 'r8', reason: 'web-only build; fallback approved by brand' },
    proof_glyph_hash: { family: 'Arial', text: 'Handgloves 2026', size: 26 },
    proof_compare_faces: { familyA: 'Helvetica', familyB: 'Arial', text: 'Handgloves 2026', size: 26 }
  };
  document.querySelectorAll('[data-preset]').forEach((b) => {
    b.addEventListener('click', () => {
      const name = b.getAttribute('data-preset');
      $('agent-tool').value = name;
      $('agent-input').value = JSON.stringify(presets[name] || {}, null, 2);
    });
  });

  /* declarative tool: doc_find (a <form toolname> in the document card; the human submits too) */
  $('find-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const query = $('find-q').value.trim();
    const q = query.toLowerCase();
    const hits = q ? state.runs.filter((r) => r.text.toLowerCase().includes(q)).map((r) => r.id) : [];
    $('find-out').textContent = hits.length ? 'matched ' + hits.join(', ') : 'no run matches “' + query + '”';
    if (hits.length) selectRun(hits[0]);
    if (ev.agentInvoked) ev.respondWith({ ok: true, query, matches: hits, selected: hits[0] || null });
  });

  window.addEventListener('mc-toolchange', () => { state.toolchanges += 1; scheduleToolList(); });
  const datalist = $('family-options');
  for (const f of [...new Set([...Object.keys(EXPORT_CHAIN), 'Palatino', 'Baskerville', 'Optima', 'Futura', 'Avenir', 'Trebuchet MS', 'Courier New', 'DejaVu Serif', 'Liberation Mono'])]) datalist.appendChild(el('option', null, f));
}

/* ---------------- boot ---------------- */

async function embedProof() {
  const frame = $('proof-frame');
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  frame.src = PROOF_URL;
  await loaded;
  await window.MC.whenChild(frame);
}

async function boot() {
  window.addEventListener('unhandledrejection', (ev) => { showError(ev.reason); ev.preventDefault(); });
  renderBadge();
  renderDoc();
  wireHumanUi();
  renderAll();
  const ac = new AbortController();
  window.addEventListener('pagehide', () => ac.abort(), { once: true });
  for (const t of TOOLS) await window.mc.registerTool(t, { signal: ac.signal });
  try {
    await embedProof();
    await discoverProof();
    const exposed = state.proofTools.map((t) => t.name);
    for (const need of Object.keys(PROOF_SCHEMAS)) {
      if (!exposed.includes(need)) throw new Error('proof origin did not expose "' + need + '" (allow="tools"?)');
    }
    const rows = await serial(() => auditAll());
    if (!Array.isArray(rows)) throw new Error(rows.error.message);
  } catch (e) {
    state.proofError = e && e.message ? e.message : String(e);
    renderAll();
  }
  await renderToolList();
  window.MC.ready();
}

window.addEventListener('load', () => { boot().catch(showError); });
