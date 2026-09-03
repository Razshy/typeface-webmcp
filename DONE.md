# DONE — Proof of Typeface

Status: **complete on kit v2.** `python3 gate.py typeface` → PASS; `python3 kit/harness.py --app apps/typeface --mode both` → ALL PASS (4 files, 122 checks in shim mode, 122 in native Chrome with `--enable-features=WebMCPTesting`). `python3 bundle.py typeface` output loads under a plain `python3 -m http.server` with `window.MC.isMulti === false` and zero console errors.

## Surface

21 top-level tools on main (20 imperative incl. 5 `proof_*` bridges + the declarative `doc_find` form) and 6 on the proof origin (5 exposed to main with `exposedTo`, 1 unexposed decoy). Every imperative tool: `additionalProperties:false`, typed and described params, enums for closed sets, spec-only annotations, error envelopes `{ok:false, error:{code, message, hint}}` — no handler throws (a wrapper catches and converts the unexpected). ChatGPT's browser sees the 20 imperative top-level tools; Chrome+flag also sees the proof frame's tools.

## Real (measured)

- **Two-tails detection.** A family is rendered under a serif and a monospace fallback tail; identical rasters prove it is installed, different rasters prove the name was ignored. No list of "known" faces, no host assumptions; generic keywords are present by definition. `kind: aliased` when a "present" face draws the same pixels as a differently-named installed face from the export chain (fontconfig-style aliasing, e.g. Arial → Liberation Sans on Linux).
- **`document.fonts.check`** is called for real and reported as `contradiction` when it says true for a face the pixels prove absent/aliased — described as answering a different question, not as a browser bug.
- **Wrap fingerprint**: greedy `measureText` word-wrap at the rendered `#doc` width, with the role's size, uppercase and tracking (canvas `letterSpacing`).
- **Page spill**: `scrollHeight − clientHeight` of the fixed-height frame, as declared and under substitute faces.
- **Cross-origin**: proof tools discovered with `getTools({fromOrigins})`, executed by `RegisteredTool`; results are stamped with the browser-reported `tool.origin`/`tool.window`, never with the callee's `originLabel`.
- **Human signature**: waivers are signed as `human` only by the modal (drawer, bulk button, or Countersign on an agent proposal). `waiver_propose` records `signedBy:'agent'`, which never clears the gate. The wrap-shift threshold is a panel input with no tool to set it.

## Modelled / simulated (badged in the UI)

- **`EXPORT_CHAIN`** — the *order* of faces an export pipeline tries for a declared family is modelled; which of them is installed here is measured, and only the first installed face is used for deltas and spill. Badge: "substitute faces: modelled chain" on the spill card; the drawer names the modelled first choice when it is absent; every proof payload carries `modelled`.
- **Export** stamps a certificate id; no PDF is written. Badge: "export: certificate stamp only" next to the Export button; `export_document` returns `simulated`.

## Seed behaviour (this macOS host)

Blocked at boot: r7 Poppins and r8 Frutiger (absent → `substituted`), r6 Verdana (installed, wrap median −13% under Helvetica → `wrap-shift` at the 10% default threshold). Controls: system-ui ×2, Arial, Georgia, Helvetica, Times New Roman. On Linux images Helvetica typically becomes `aliased`. Tests assert the rule (blocked = substituted ∪ over-threshold installed faces) against the DOM, not a fixed list.

## Review triage (phase-1 report, 19 findings)

Fixed: T1 false positives (two-tails test replaces keyword equality), T2 Arial unflaggable (no hard-coded stand-ins; aliasing check), T3 vacuous tests (rewritten on testkit, rule-based), T4 forgeable human waivers (propose → countersign), T5 innerHTML XSS (all rendering via `el()`/`textContent`), T6 waiver on proven runs / empty reason (refused; counts derived from one `gateState`), T7 static-mode labels (provenance by `tool.window`), T8 unbadged simulations (badges added), T9 README run instructions, T10 PLAN deviations (contenteditable runs, drawer family picker, human threshold with wrap-shift blocking, `runIds` range on `substitute_safe`), T11 drawer numbers (rendered column width + role transforms, labelled), T12 degenerate proof input (validated; `empty_result` on zero ink), T13 substitute loopholes (generic keywords refused, every affected run probed, `waiversCleared` snapshotted), T14 self-reported origin guard (browser-stamped origin), T15 gate note for unaudited runs, T16 annotations (readOnly only on true reads), T17 dead code/CSS (engine rewritten, ROLE single source, controller aborted on pagehide, tool list debounced), T18 accessibility (labels, focus-visible, Escape + focus return, `role=meter`, keyboard-editable runs, reduced motion), T19 conditional asserts (unconditional refusal with a guaranteed-absent face; static-mode test; degenerate-input test).

## Tests

`tests/test_01_surface.py` (33) inventory, schema hygiene, annotations, bridges share schemas, duplicate-name rejection main + child, error envelopes, decoy invisibility, toolchange → panel, run-tool control + log. `tests/test_02_proof.py` (31) two-tails soundness, no false positive for platform-generic faces, compare/font_check/wrap/export_preview, nine degenerate inputs, bridges really relay (child-realm call log). `tests/test_03_gate.py` (49) gate ⇔ DOM, spill ⇔ DOM, agent proposal does not unlock, human countersign/modal/bulk/Export clicks, threshold input, substitute_safe refusals and DOM change, doc_edit, typing into a run, drawer family picker, declarative form (agent and human), reset. `tests/test_04_static.py` (9) plain `http.server` single-folder mode.
