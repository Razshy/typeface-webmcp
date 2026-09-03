/* Seed document: a marketing one-pager whose runs deliberately exercise both kinds of lie.
 * Faces that exist here (Arial, Georgia, Times New Roman, Verdana, system-ui) are controls.
 * Faces that do not exist (Helvetica collapses to the generic sans keyword, Poppins to the
 * generic serif) rasterise identical to a stand-in — that is the flag condition. */

export const COLUMN_PX = 460;
export const FRAME_HEIGHT_PX = 470;

export const SEED = [
  {
    id: 'r1',
    role: 'eyebrow',
    family: 'system-ui',
    text: 'Ostendo Type Foundry — spring specimen, size 12 through 96'
  },
  {
    id: 'r2',
    role: 'headline',
    family: 'Arial',
    text: 'Quiet rivers run deep; quick jigs vex the waltzing band'
  },
  {
    id: 'r3',
    role: 'deck',
    family: 'Georgia',
    text: 'We set every specimen by hand, then measured what the machine actually drew. Five boxing wizards jump quickly, and the sphinx of black quartz judged our vow twice before it agreed.'
  },
  {
    id: 'r4',
    role: 'subhead',
    family: 'Helvetica',
    text: 'Six families, one paragraph, and the box that fits them all'
  },
  {
    id: 'r5',
    role: 'body',
    family: 'Times New Roman',
    text: 'Pack my box with five dozen liquor jugs, then ask the printer which face it packed. The answer is rarely the answer: the fox is brown, the dog is lazy, and the widths are neither.'
  },
  {
    id: 'r6',
    role: 'quote',
    family: 'Verdana',
    text: 'Sphinx of black quartz, judge my vow — the quick brown fox jumps over five lazy dogs.'
  },
  {
    id: 'r7',
    role: 'cta',
    family: 'Poppins',
    text: 'Order the specimen book — waltzing nymphs jinx quick bronze fads'
  },
  {
    id: 'r8',
    role: 'body2',
    family: 'Georgia',
    text: 'Bright vixens jump; dozy fowl quack. Our colophon lists every face we claim, every face we ship, and every face the renderer quietly swaps in when the claim outruns the font folder.'
  },
  {
    id: 'r9',
    role: 'footer',
    family: 'system-ui',
    text: 'Set in the faces it names · Ostendo, 2026 · proofs on request'
  }
];
