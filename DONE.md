# DONE — Proof of Typeface

Status: **complete.** `python3 kit/harness.py --app apps/typeface` → `SUMMARY: ALL PASS` (2 test files, 186 `assert` statements). Single-origin static-host fallback verified separately against a plain `python3 -m http.server`.

## What is real (measured, not modelled)

- **Glyph hashing.** Text is rasterised to an offscreen canvas at the run's real pixel size and the pixels are hashed (FNV-1a over the RGBA buffer). Real faces get their own hash; a family the browser does not have rasterises byte-identically to a generic stand-in, which is the substitution signature. Four stand-ins are computed per verdict: `serif`, `sans-serif`, `monospace`, and Arial-as-generic-sans.
- **`document.fonts.check` as the lie.** Measured live on this Chromium: it returns `true` for every family probed, including `Poppins`/`Frutiger`/`Segoe UI`, which are not installed. `proof_font_check` returns `lie: true` exactly when check() claims a face that the pixels disprove.
- **Wrap fingerprint.** Greedy word-wrap in canvas `measureText` at a column width, returning per-line right edges and the median right edge (the audit's mechanic), under the declared face and under the export substitute, with width/median deltas and a line-count delta.
- **Page spill.** Real DOM: the whole document is rendered into the fixed-height frame and `scrollHeight − clientHeight` is measured, once as declared and once with the export substitute faces applied. The seeded one-pager spills 112px here (85px under export faces).
- **Cross-origin.** The proof origin is a separate port (`{"main":".","proof":"proof"}`). Main discovers with `getTools({fromOrigins:[proof]})`, executes by name, and rejects any payload whose `originLabel !== 'proof'`. The proof iframe logs every call in its own realm, so tests verify the work actually happened over there.
- **The gate.** Export is disabled with a live blocked count until every identical-to-generic run is swapped for a face with its own outlines or human-waived with a reason. DOM `disabled` attribute and `export_gate` are the same state.

## What is simulated (badged in the UI and in tool output)

- **`EXPORT_STACK`** — which face an export/print pipeline would embed for a declared family (Arial→Liberation Sans, Georgia→Liberation Serif, …) is a *modelled* pipeline table, labelled `modelledBy: "EXPORT_STACK (modelled pipeline, measured consequences)"` in `proof_export_preview` and shown as `exportStackModelled` on the spill card. The consequences (hash, width, wrap, spill) are measured, but which face a given PDF pipeline picks is host-specific and is assumed here — mirroring the container audit where Liberation Sans stood in for Arial.
- **Export itself** is a certificate stamp (issue hash), not a PDF.
- No webfonts are downloaded: `Poppins` is genuinely absent, which is why it falls back. That is the point, not a shortcut.

## Seeded document behaviour (macOS host)

9 runs, 7 distinct families. Flagged: `r4` Helvetica (identical to the `sans-serif` keyword face) and `r7` Poppins (identical to the generic `serif` face) — `fonts.check` says `true` for both, so both are `lie: true`. Controls proven to own outlines: Arial, Georgia ×2, Times New Roman, Verdana, system-ui ×2. On a Linux/DejaVu image the exact set shifts (Arial may collapse to Liberation Sans, as in the audit) but the flag condition — requested hash ∈ stand-in hashes — is asserted generically, and the tests pick substitute families empirically by asking the proof origin rather than hard-coding them.

## Tests (`tests/test_*.py`, self-executing, BASE_URL/ORIGINS_JSON)

`test_proof_origin.py` (76 asserts) — origins differ; proof tools invisible without `fromOrigins` and visible with it; every proof tool carries `origin: proof`; `decoy_proof` never visible to main but visible inside the proof frame; duplicate-name rejection on main *and* in the child; distinct faces differ, absent faces collapse onto one shared fallback hash equal to `serif`; hash-verdict contract keys; deterministic and text-sensitive hashing; wrap fingerprint (line count grows with a narrower column, fingerprint changes); `proof_font_check` lie detection; `proof_compare` identical/distinguishable both ways; `proof_export_preview` names the embedded face; `run_audit` labelled `cross-origin` with `proof:` verdict strings and proof-origin call counts logged in the child's own realm; flag/unflag conditions asserted as hash (non-)equality; family filter.

`test_product_loop.py` (110 asserts) — seed shape and families; `run_list` contract keys with `measuredBy` = proof origin; ≥2 flagged and ≥3 clean with equality-vs-control checks; Poppins must be flagged; width deltas within 0.05..50; at least one run re-wraps under export substitutes; spill meter > 0 and consistent with frame height; gate starts blocked and mirrors the DOM (`disabled`, `locked`, `Export (n)` label, table row count); `metrics_report` proxies both proof tools; `explain_diff`/`proof_verdicts`; `substitute_safe` refuses an unsafe target, then changes the audit table *and* the visible DOM cells *and* gate counts before/after; waiver flow blocked→waived→unblocked including DOM `disabled` attr, waiver persistence across a re-audit, export success, revocation re-blocking; `doc_edit`; then the human path with no agent: click a flagged span → truth drawer shows declared family + `document.fonts.check` → waive through the modal with a reason → Export becomes clickable → click Export → ISSUED seal; declarative `doc_find` fills the form and reports matches; agent panel runs `run_audit` through `window.__agent`; proof iframe shows a live certificate; zero console/page errors.

## Layout

`index.html` (main), `src/main.js` (editor, gate, 15 imperative tools), `src/seed.js`, `proof/index.html` (proof origin, 5 exposed tools + decoy + stamp certificate), `proof/engine.js` (shared measurement core).
