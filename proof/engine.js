/* proof/engine.js — the measurement core, served to both origins.
 *
 * Everything here is REAL measurement: offscreen-canvas rasterisation + measureText in this
 * browser. The one modelled input is EXPORT_CHAIN (which faces an export pipeline tries when
 * it cannot find the declared family); it is badged "modelled" wherever it is shown.
 *
 * Detection principle (the two-tails test). A font string is `"<family>", <tail>`. When the
 * family is installed the tail never matters, so the pixels are identical under a serif tail
 * and under a monospace tail. When the family is absent the browser silently uses the tail,
 * so the two rasters differ. That is host-independent and needs no list of "known" faces.
 * A second, weaker signal is aliasing: the family is "present" only because the platform
 * maps its name onto a different installed face (fontconfig: Arial -> Liberation Sans); it is
 * caught when the raster equals that of a differently-named face from the export chain.
 * `document.fonts.check` cannot tell any of these apart: it answers true for absent faces. */

export const GENERIC_KEYWORDS = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif',
  'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong'
]);

/* Modelled: the faces an export/print pipeline tries, in order, when the declared family is
 * not embedded. The first face that is really installed here is the one whose consequences
 * (width, wrap, spill) get measured, so every delta shown is a measured number. */
export const EXPORT_CHAIN = {
  'Arial': ['Liberation Sans', 'Helvetica', 'sans-serif'],
  'Helvetica': ['Nimbus Sans', 'Arial', 'sans-serif'],
  'Helvetica Neue': ['Nimbus Sans', 'Helvetica', 'sans-serif'],
  'Georgia': ['Liberation Serif', 'Times New Roman', 'serif'],
  'Times New Roman': ['Tinos', 'Liberation Serif', 'serif'],
  'Verdana': ['DejaVu Sans', 'Helvetica', 'Arial', 'sans-serif'],
  'Poppins': ['DejaVu Sans', 'Helvetica', 'Arial', 'sans-serif'],
  'Frutiger': ['Nimbus Sans', 'Helvetica', 'Arial', 'sans-serif'],
  'Segoe UI': ['DejaVu Sans', 'Helvetica', 'Arial', 'sans-serif'],
  'Baskerville': ['Liberation Serif', 'Times New Roman', 'serif'],
  'system-ui': ['Roboto', 'DejaVu Sans', 'Helvetica', 'sans-serif']
};
const DEFAULT_CHAIN = ['Liberation Serif', 'Times New Roman', 'serif'];

export const SIZE_MIN = 4;
export const SIZE_MAX = 200;
export const TEXT_MAX = 2000;
export const ABSENT_TOKEN = 'zz-no-such-face-7f3a9c';
export const SAMPLE_TEXT = 'Handgloves 2026';
export const SIZE_DEFAULT = 26;
export const COLUMN_DEFAULT = 420;

/* The five proof-origin tool schemas, shared with the main origin's bridge tools so the two
 * surfaces cannot drift apart. */
const P = {
  text: { type: 'string', description: 'Text to rasterise or wrap, e.g. "Handgloves 2026". Default "' + SAMPLE_TEXT + '".', maxLength: TEXT_MAX },
  family: { type: 'string', description: 'ONE declared CSS font family, e.g. "Georgia" (no fallback lists).', maxLength: 64 },
  size: { type: 'number', description: 'Font size in CSS px, ' + SIZE_MIN + '-' + SIZE_MAX + ', e.g. 26. Default ' + SIZE_DEFAULT + '.', minimum: SIZE_MIN, maximum: SIZE_MAX },
  letterSpacingPx: { type: 'number', description: 'Tracking in CSS px applied before measuring, e.g. 2.16. Default 0.', minimum: 0, maximum: 50 },
  columnPx: { type: 'number', description: 'Column width in CSS px to wrap against, e.g. 620. Default ' + COLUMN_DEFAULT + '.', minimum: 40, maximum: 4000 }
};
export const PROOF_SCHEMAS = {
  glyph_hash: { type: 'object', properties: { text: P.text, family: P.family, size: P.size, letterSpacingPx: P.letterSpacingPx }, required: ['family'], additionalProperties: false },
  wrap_metrics: { type: 'object', properties: { text: P.text, family: P.family, size: P.size, letterSpacingPx: P.letterSpacingPx, columnPx: P.columnPx }, required: ['family'], additionalProperties: false },
  compare_faces: { type: 'object', properties: { text: P.text, familyA: Object.assign({}, P.family, { description: 'First family, e.g. "Helvetica".' }), familyB: Object.assign({}, P.family, { description: 'Second family, e.g. "Arial".' }), size: P.size }, required: ['familyA', 'familyB'], additionalProperties: false },
  font_check: { type: 'object', properties: { family: P.family, size: P.size }, required: ['family'], additionalProperties: false },
  export_preview: { type: 'object', properties: { text: P.text, family: P.family, size: P.size }, required: ['family'], additionalProperties: false }
};

/* ---------------- input validation (shared by both origins) ---------------- */

export function fail(code, message, hint) {
  return { ok: false, error: { code, message, hint } };
}

/** Validate `input` against a flat object schema; returns a fail() envelope or null. */
export function validateInput(schema, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return fail('invalid_param', 'Input must be a JSON object.', 'Pass an object such as {}.');
  }
  const props = schema.properties || {};
  for (const key of Object.keys(input)) {
    if (!props[key]) return fail('invalid_param', 'Unknown parameter "' + key + '".', 'Allowed: ' + (Object.keys(props).join(', ') || 'none') + '.');
  }
  for (const key of schema.required || []) {
    if (input[key] === undefined || input[key] === null || input[key] === '') {
      return fail('invalid_param', 'Missing required parameter "' + key + '".', props[key] && props[key].description);
    }
  }
  for (const [key, spec] of Object.entries(props)) {
    const v = input[key];
    if (v === undefined) continue;
    const bad = (why) => fail('invalid_param', 'Parameter "' + key + '" ' + why + '.', spec.description);
    if (spec.type === 'string' && typeof v !== 'string') return bad('must be a string');
    if ((spec.type === 'number' || spec.type === 'integer') && (typeof v !== 'number' || !Number.isFinite(v))) return bad('must be a finite number');
    if (spec.type === 'integer' && !Number.isInteger(v)) return bad('must be an integer');
    if (spec.type === 'boolean' && typeof v !== 'boolean') return bad('must be true or false');
    if (spec.type === 'array' && !Array.isArray(v)) return bad('must be an array');
    if (spec.enum && !spec.enum.includes(v)) return bad('must be one of ' + spec.enum.join(' | '));
    if (spec.minimum !== undefined && v < spec.minimum) return bad('must be >= ' + spec.minimum);
    if (spec.maximum !== undefined && v > spec.maximum) return bad('must be <= ' + spec.maximum);
    if (spec.maxLength !== undefined && typeof v === 'string' && v.length > spec.maxLength) return bad('must be at most ' + spec.maxLength + ' characters');
    if (spec.type === 'array' && spec.items && spec.items.type === 'string' && v.some((x) => typeof x !== 'string')) return bad('must contain only strings');
  }
  return null;
}

/** A single CSS family name: no commas (lists launder verdicts), quotes or control characters. */
export function validateFamily(family, key = 'family') {
  const f = typeof family === 'string' ? family.trim() : '';
  if (!f) return fail('invalid_param', 'Parameter "' + key + '" must be a non-empty font family name.', 'Example: "Georgia".');
  if (f.length > 64) return fail('invalid_param', 'Parameter "' + key + '" is too long (max 64 characters).', 'Example: "Georgia".');
  if (/[,;"'{}<>\\\n\r\t]/.test(f)) return fail('invalid_param', 'Parameter "' + key + '" must be ONE family name without commas, quotes or brackets.', 'Pass a single face such as "Times New Roman", not a fallback list.');
  return null;
}

export function validateText(text) {
  const t = typeof text === 'string' ? text : '';
  if (!t.trim()) return fail('invalid_param', 'Parameter "text" must contain visible characters.', 'Example: "Handgloves 2026".');
  if (t.length > TEXT_MAX) return fail('invalid_param', 'Parameter "text" is longer than ' + TEXT_MAX + ' characters.', 'Send one paragraph at a time.');
  return null;
}

export function validateSize(size) {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < SIZE_MIN || size > SIZE_MAX) {
    return fail('invalid_param', 'Parameter "size" must be a number between ' + SIZE_MIN + ' and ' + SIZE_MAX + ' (CSS px).', 'Example: 26.');
  }
  return null;
}

/* ---------------- raster + hash ---------------- */

export function isGeneric(family) {
  return GENERIC_KEYWORDS.has(String(family).trim().toLowerCase());
}

/** `size px "Family", tail` — generic keywords are written bare so CSS treats them as keywords. */
export function fontString(family, size, tail = 'serif') {
  const fam = String(family).trim();
  return size + 'px ' + (isGeneric(fam) ? fam.toLowerCase() : '"' + fam + '", ' + tail);
}

function context(font, letterSpacingPx) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 4;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.font = font;
  g.textBaseline = 'alphabetic';
  if ('letterSpacing' in g) g.letterSpacing = (letterSpacingPx || 0) + 'px';
  return g;
}

function fnv1a(bytes) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function fnv1aString(s) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function hex8(n) {
  return ('0000000' + (n >>> 0).toString(16)).slice(-8);
}

export function hashString(s) {
  return hex8(fnv1aString(String(s)));
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Rasterise `text` with `font` and hash the pixels.
 * Returns { hash, inkPx, widthPx, ascent, descent }.
 */
export function rasterFont(font, size, text, letterSpacingPx = 0) {
  const probe = context(font, letterSpacingPx);
  const m = probe.measureText(text);
  const pad = Math.ceil(size * 0.6) + 6;
  const w = Math.min(8192, Math.max(8, Math.ceil(m.width) + pad * 2));
  const h = Math.max(8, Math.ceil(size * 2.2) + pad);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.font = font;
  g.textBaseline = 'alphabetic';
  if ('letterSpacing' in g) g.letterSpacing = (letterSpacingPx || 0) + 'px';
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#000000';
  g.fillText(text, pad, Math.ceil(size * 1.35) + 2);
  const px = g.getImageData(0, 0, w, h).data;
  let ink = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] < 240) ink++;
  return {
    hash: hex8(fnv1a(px)),
    inkPx: ink,
    widthPx: round2(m.width),
    ascent: Number.isFinite(m.actualBoundingBoxAscent) ? round2(m.actualBoundingBoxAscent) : null,
    descent: Number.isFinite(m.actualBoundingBoxDescent) ? round2(m.actualBoundingBoxDescent) : null
  };
}

export function glyphRaster(family, size, text, letterSpacingPx = 0) {
  return rasterFont(fontString(family, size), size, text, letterSpacingPx);
}

/**
 * The two-tails test: is `family` really installed here?
 * Generic keywords are present by definition (the browser always resolves them).
 */
export function presence(family, size, text) {
  if (isGeneric(family)) {
    const r = rasterFont(fontString(family, size), size, text);
    return { present: true, generic: true, hash: r.hash, hashSerifTail: r.hash, hashMonoTail: r.hash, raster: r };
  }
  const a = rasterFont(fontString(family, size, 'serif'), size, text);
  const b = rasterFont(fontString(family, size, 'monospace'), size, text);
  return { present: a.hash === b.hash, generic: false, hash: a.hash, hashSerifTail: a.hash, hashMonoTail: b.hash, raster: a };
}

/** Which generic keyword (if any) draws exactly these pixels — informational, never a flag. */
export function sameAsGeneric(hash, size, text) {
  for (const key of ['sans-serif', 'serif', 'monospace']) {
    if (rasterFont(fontString(key, size), size, text).hash === hash) return key;
  }
  return null;
}

export function exportChain(family) {
  const fam = String(family).trim();
  const key = Object.keys(EXPORT_CHAIN).find((k) => k.toLowerCase() === fam.toLowerCase());
  return key ? EXPORT_CHAIN[key].slice() : DEFAULT_CHAIN.slice();
}

/**
 * Walk the (modelled) export chain and return the first face that is really installed here.
 * Returns { chain, modelledEmbed, measuredAs, probed:[{family, present}] }.
 */
export function exportSubstitute(family, size, text = 'Handgloves 2026') {
  const chain = exportChain(family).filter((f) => f.toLowerCase() !== String(family).trim().toLowerCase());
  const probed = [];
  let measuredAs = chain[chain.length - 1];
  for (const face of chain) {
    const p = presence(face, size, text);
    probed.push({ family: face, present: p.present });
    if (p.present) { measuredAs = face; break; }
  }
  return { chain, modelledEmbed: chain[0], measuredAs, probed, modelled: 'EXPORT_CHAIN (modelled pipeline order, measured presence and consequences)' };
}

/**
 * Glyph-hash verdict for one (text, family) pair.
 * kind: 'own-outlines' | 'absent' | 'aliased'. `substituted` is true for the last two.
 */
export function hashVerdict(text, family, size, letterSpacingPx = 0) {
  const fam = String(family).trim();
  const p = presence(fam, size, text);
  const req = letterSpacingPx ? glyphRaster(fam, size, text, letterSpacingPx) : p.raster;
  const absent = rasterFont(fontString(ABSENT_TOKEN, size, 'serif'), size, text);
  let kind = p.present ? 'own-outlines' : 'absent';
  let aliasOf = null;
  if (p.present && !p.generic) {
    for (const face of exportChain(fam)) {
      if (face.toLowerCase() === fam.toLowerCase() || isGeneric(face)) continue;
      const q = presence(face, size, text);
      if (q.present && q.hash === p.hash) { aliasOf = face; kind = 'aliased'; break; }
    }
  }
  const substituted = kind !== 'own-outlines';
  const generic = sameAsGeneric(p.hash, size, text);
  return {
    requestedFamily: fam,
    requestedHash: req.hash,
    hashSerifTail: p.hashSerifTail,
    hashMonoTail: p.hashMonoTail,
    absentFallbackHash: absent.hash,
    present: p.present,
    substituted,
    kind,
    aliasOf,
    sameAsGeneric: generic,
    inkPx: req.inkPx,
    widthPx: req.widthPx,
    resolvedTo: kind === 'absent'
      ? 'browser fallback (the name was ignored)'
      : kind === 'aliased' ? 'installed face "' + aliasOf + '" under the declared name' : 'declared face (own outlines)',
    verdict: kind === 'absent'
      ? 'proof:substituted — "' + fam + '" is not installed; the serif and monospace tails draw different pixels'
      : kind === 'aliased'
        ? 'proof:substituted — "' + fam + '" draws the same pixels as installed face "' + aliasOf + '"'
        : 'proof:own-outlines — "' + fam + '" draws its own pixels regardless of fallback tail'
  };
}

/**
 * Greedy word wrap at `columnPx`, the mechanic our container audit used for wrap
 * fingerprints: per-line right edge plus the median right edge of the column.
 */
export function wrapFingerprint(text, family, size, columnPx, letterSpacingPx = 0) {
  const g = context(fontString(family, size), letterSpacingPx);
  const width = (s) => round2(g.measureText(s).width);
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = [];
  for (const word of words) {
    if (cur.length && width(cur.concat([word]).join(' ')) > columnPx) {
      lines.push({ text: cur.join(' '), rightEdge: width(cur.join(' ')) });
      cur = [word];
    } else {
      cur.push(word);
    }
  }
  if (cur.length) lines.push({ text: cur.join(' '), rightEdge: width(cur.join(' ')) });
  const edges = lines.map((l) => l.rightEdge).sort((a, b) => a - b);
  const n = edges.length;
  const median = !n ? 0 : n % 2 ? edges[(n - 1) / 2] : round2((edges[n / 2 - 1] + edges[n / 2]) / 2);
  return {
    widthPx: width(words.join(' ')),
    lines,
    lineCount: lines.length,
    medianRightEdge: median,
    fingerprint: hashString(lines.map((l) => l.rightEdge.toFixed(2)).join(','))
  };
}

/** Signed percent change from `base` to `next` (null when base is 0). */
export function pctDelta(base, next) {
  if (!base) return null;
  return round2(((next - base) / base) * 100);
}

/** What document.fonts.check answers — it says true for absent families too (spec-conformant). */
export function fontCheck(family, size) {
  const spec = size + 'px ' + (isGeneric(family) ? family : '"' + family + '"');
  try {
    return { spec, declared: !!document.fonts.check(spec), answers: 'whether an unloaded @font-face is needed — never whether the face is installed' };
  } catch (e) {
    return { spec, declared: null, error: String(e) };
  }
}
