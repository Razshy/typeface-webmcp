/* proof/engine.js — the measurement core shared by the proof origin and the main editor.
 *
 * Everything here is REAL measurement: offscreen canvas rasterisation + measureText in this
 * browser. Nothing is modelled. The one modelled input is EXPORT_STACK (which face an export
 * pipeline would substitute for a declared family) — it is labelled as a model in the UI.
 *
 * Detection principle, and the reason it works: a family the browser does not have is rendered
 * by a fallback face, so its pixel hash is byte-identical to the hash of a generic stand-in
 * ('serif', 'sans-serif' via Arial, 'monospace'), while a family that is genuinely installed
 * rasterises to its own outlines and therefore to its own hash. `document.fonts.check` cannot
 * tell these apart — it answers true for both. */

export const GENERIC_STANDINS = [
  { key: 'serif', family: 'serif', label: 'generic serif' },
  { key: 'sans', family: 'Arial', label: 'generic sans (Arial stand-in)' },
  { key: 'mono', family: 'monospace', label: 'generic monospace' },
  { key: 'sansGeneric', family: 'sans-serif', label: 'generic sans-serif keyword' }
];

/* Modelled: what an export/print pipeline embeds when it cannot find the declared face.
 * These names are deliberately foreign to the current browser — measuring them here is the
 * point: they fall back too, which is how a PDF launders six families into one. */
export const EXPORT_STACK = {
  'Arial': 'Liberation Sans',
  'Helvetica': 'Nimbus Sans',
  'Helvetica Neue': 'Nimbus Sans',
  'Georgia': 'Liberation Serif',
  'Times New Roman': 'Tinos',
  'Verdana': 'DejaVu Sans',
  'Poppins': 'DejaVu Sans',
  'Frutiger': 'Nimbus Sans',
  'Baskerville': 'Liberation Serif',
  'system-ui': 'Roboto'
};

export function exportSubstitute(family) {
  return Object.prototype.hasOwnProperty.call(EXPORT_STACK, family)
    ? EXPORT_STACK[family]
    : 'serif';
}

/* Quoted-then-bare so both multi-word real names ("Times New Roman") and generic keywords
 * (serif) resolve the way CSS would resolve them in layout. */
export function fontString(family, size) {
  return size + 'px "' + family + '", ' + family;
}

let scratch = null;
function ctxFor(family, size) {
  if (!scratch) {
    scratch = document.createElement('canvas');
    scratch.width = 4;
    scratch.height = 4;
  }
  const g = scratch.getContext('2d', { willReadFrequently: true });
  g.font = fontString(family, size);
  return g;
}

/**
 * Rasterise `text` in `family` and hash the pixels.
 * Returns { hash, inkPx, widthPx, ascent, descent }.
 */
export function glyphRaster(family, size, text) {
  const g0 = ctxFor(family, size);
  g0.textBaseline = 'alphabetic';
  const m = g0.measureText(text);
  const pad = Math.ceil(size * 0.6) + 6;
  const w = Math.max(8, Math.ceil(m.width) + pad * 2);
  const h = Math.max(8, Math.ceil(size * 2.2) + pad);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.textBaseline = 'alphabetic';
  g.font = fontString(family, size);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#000000';
  const base = Math.ceil(size * 1.35) + 2;
  g.fillText(text, pad, base);
  const px = g.getImageData(0, 0, w, h).data;
  let ink = 0;
  let h32 = 0x811c9dc5 >>> 0;
  for (let i = 0; i < px.length; i++) {
    const v = px[i];
    if (v < 240) ink++;
    h32 ^= v;
    h32 = Math.imul(h32, 0x01000193) >>> 0;
  }
  const a = m.actualBoundingBoxAscent;
  const d = m.actualBoundingBoxDescent;
  return {
    hash: hex8(h32),
    inkPx: ink,
    widthPx: round2(m.width),
    ascent: Number.isFinite(a) ? round2(a) : null,
    descent: Number.isFinite(d) ? round2(d) : null
  };
}

/** The three stand-in hashes a face is compared against, plus the stand-in it collapsed to. */
export function standins(text, size) {
  const out = {};
  for (const s of GENERIC_STANDINS) out[s.key] = glyphRaster(s.family, size, text);
  return out;
}

/**
 * Glyph-hash verdict for one (text, family) pair.
 * `identical` is true when the declared family rasterises identically to a generic stand-in,
 * i.e. the browser ignored the name. `fallbackHash` names which stand-in it matched.
 */
export function hashVerdict(text, family, size) {
  const req = glyphRaster(family, size, text);
  const st = standins(text, size);
  const isGenericItself = GENERIC_STANDINS.some((s) => s.family.toLowerCase() === String(family).toLowerCase());
  let matched = null;
  for (const s of GENERIC_STANDINS) if (st[s.key].hash === req.hash) { matched = s; break; }
  const identical = !!matched && !isGenericItself;
  return {
    requestedHash: req.hash,
    sansStandinHash: st.sans.hash,
    serifStandinHash: st.serif.hash,
    monoStandinHash: st.mono.hash,
    sansKeywordStandinHash: st.sansGeneric.hash,
    standinHashes: {
      serif: st.serif.hash,
      sansArial: st.sans.hash,
      monospace: st.mono.hash,
      sansKeyword: st.sansGeneric.hash
    },
    requestedFamily: family,
    requestedInkPx: req.inkPx,
    requestedWidthPx: req.widthPx,
    inkPx: req.inkPx,
    widthPx: req.widthPx,
    fallbackHash: identical ? matched.label : null,
    fallbackFamily: identical ? matched.family : null,
    identical,
    declaredIsGeneric: isGenericItself,
    resolvedTo: identical ? matched.label : 'declared face (own outlines)'
  };
}

/**
 * Greedy word wrap at `columnPx`, the same mechanic our container audit used for wrap
 * fingerprints: per-line right edge plus the median right edge of the column.
 */
export function wrapFingerprint(text, family, size, columnPx) {
  const g = ctxFor(family, size);
  g.textBaseline = 'alphabetic';
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = [];
  for (const word of words) {
    const trial = cur.concat([word]).join(' ');
    const w = round2(g.measureText(trial).width);
    if (cur.length && w > columnPx) {
      lines.push({ text: cur.join(' '), rightEdge: round2(g.measureText(cur.join(' ')).width) });
      cur = [word];
    } else {
      cur.push(word);
    }
  }
  if (cur.length) lines.push({ text: cur.join(' '), rightEdge: round2(g.measureText(cur.join(' ')).width) });
  const edges = lines.map((l) => l.rightEdge).sort((a, b) => a - b);
  const median = edges.length ? (edges.length % 2 ? edges[(edges.length - 1) / 2]
    : round2((edges[edges.length / 2 - 1] + edges[edges.length / 2]) / 2)) : 0;
  let h32 = 0x811c9dc5 >>> 0;
  const sig = lines.map((l) => l.rightEdge.toFixed(2)).join(',');
  for (let i = 0; i < sig.length; i++) { h32 ^= sig.charCodeAt(i); h32 = Math.imul(h32, 0x01000193) >>> 0; }
  return {
    widthPx: round2(g.measureText(words.join(' ')).width),
    lines,
    lineCount: lines.length,
    medianRightEdge: median,
    fingerprint: hex8(h32)
  };
}

/** Signed percent change from `base` to `next` (null when base is 0). */
export function pctDelta(base, next) {
  if (!base) return null;
  return round2(((next - base) / base) * 100);
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function hex8(n) {
  return ('0000000' + (n >>> 0).toString(16)).slice(-8);
}

/** The lie this whole app exists to catch: check() answers true for absent families too. */
export function fontCheck(family, size) {
  const spec = (size || 16) + 'px ' + family;
  try {
    return { spec, declared: !!document.fonts.check(spec), withFallback: !!document.fonts.check(spec + ', monospace') };
  } catch (e) {
    return { spec, declared: null, withFallback: null, error: String(e) };
  }
}

/**
 * Full verdict for one run: does the declared face differ from what rendered, and what would
 * the export pipeline do to it. `originLabel` tags which origin's engine produced it.
 */
export function runVerdict(run, size, columnPx, originLabel) {
  const text = run.text;
  const family = run.family;
  const sub = exportSubstitute(family);
  const hv = hashVerdict(text, family, size);
  const ex = hashVerdict(text, sub, size);
  const wf = wrapFingerprint(text, family, size, columnPx);
  const wfx = wrapFingerprint(text, sub, size, columnPx);
  const widthDeltaPct = pctDelta(hv.widthPx, ex.widthPx);
  const wrapDeltaPct = pctDelta(wf.medianRightEdge, wfx.medianRightEdge);
  return Object.assign({}, hv, {
    originLabel,
    text,
    declaredFamily: family,
    exportSubstitute: sub,
    fontCheck: fontCheck(family, size),
    exportHash: ex.requestedHash,
    exportIdenticalToGeneric: ex.identical,
    substituteCollapsesToGeneric: ex.identical,
    widthPx: wf.widthPx,
    widthDeltaPct,
    wrap: wf,
    wrapUnderExport: wfx,
    wrapDeltaPct,
    lineDelta: wfx.lineCount - wf.lineCount,
    sameRasterUnderExport: ex.requestedHash === hv.requestedHash
  });
}
