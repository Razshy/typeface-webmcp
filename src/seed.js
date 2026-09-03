/* Seed document: a marketing one-pager whose runs deliberately mix installed faces (controls)
 * with faces that are absent on every ordinary host. Absent faces rasterise as the browser's
 * fallback — the two-tails test in proof/engine.js catches exactly that. Helvetica is a control
 * on macOS and an alias (fontconfig → Liberation/Nimbus Sans) on most Linux images, so the
 * flagged set is host-dependent by design; the tests assert the rule, not the list. */

export const FRAME_HEIGHT_PX = 470;

/* One source of truth for typographic roles: the DOM renders at these sizes (inline styles) and
 * the proof origin measures at these sizes, so a drawer number and a pixel on the page agree. */
export const ROLE = {
  eyebrow: { size: 12, lh: 1.8, trackEm: 0.18, upper: true },
  headline: { size: 42, lh: 1.04 },
  deck: { size: 17, lh: 1.55 },
  subhead: { size: 21, lh: 1.25 },
  body: { size: 15.5, lh: 1.62 },
  quote: { size: 19, lh: 1.45 },
  cta: { size: 15, lh: 1.6 },
  body2: { size: 15, lh: 1.6 },
  footer: { size: 12.5, lh: 1.6 }
};

export const SEED = [
  { id: 'r1', role: 'eyebrow', family: 'system-ui', text: 'Ostendo Type Foundry — spring specimen, size 12 through 96' },
  { id: 'r2', role: 'headline', family: 'Arial', text: 'Quiet rivers run deep; quick jigs vex the waltzing band' },
  { id: 'r3', role: 'deck', family: 'Georgia', text: 'We set every specimen by hand, then measured what the machine actually drew. Five boxing wizards jump quickly, and the sphinx of black quartz judged our vow twice before it agreed.' },
  { id: 'r4', role: 'subhead', family: 'Helvetica', text: 'Six families, one paragraph, and the box that fits them all' },
  { id: 'r5', role: 'body', family: 'Times New Roman', text: 'Pack my box with five dozen liquor jugs, then ask the printer which face it packed. The answer is rarely the answer: the fox is brown, the dog is lazy, and the widths are neither.' },
  { id: 'r6', role: 'quote', family: 'Verdana', text: 'Sphinx of black quartz, judge my vow — the quick brown fox jumps over five lazy dogs.' },
  { id: 'r7', role: 'cta', family: 'Poppins', text: 'Order the specimen book — waltzing nymphs jinx quick bronze fads' },
  { id: 'r8', role: 'body2', family: 'Frutiger', text: 'Bright vixens jump; dozy fowl quack. Our colophon lists every face we claim, every face we ship, and every face the renderer quietly swaps in when the claim outruns the font folder.' },
  { id: 'r9', role: 'footer', family: 'system-ui', text: 'Set in the faces it names · Ostendo, 2026 · proofs on request' }
];
