# Proof of Typeface

**know what your text actually wears** — a pre-export lie detector for fonts: declared face vs the pixels that rendered, the wrap and page-spill consequences, and an export gate that clears only on evidence or a human signature.

**Live:** <https://razshy.github.io/typeface-webmcp/> — no login, no setup. That deployment is the **single-folder** build: one origin, the proof surface is a same-origin sub-folder frame, and the page says so (`window.MC.isMulti === false`, every payload carries `auditMode: "same-origin frame (single-folder static mode)"`). Served with `python3 kit/serve.py --app apps/typeface` the same code runs across two real origins. Both are described below wherever the behaviour differs.

## Why WebMCP fits

`document.fonts.check('16px Poppins')` answers `true` on a machine that has never seen Poppins, because it answers a different question ("is an unloaded @font-face needed?"). Every tool in a real export pipeline reports success the same way — the container audit this app is built on had 299 installed faces, none called Arial, and every step said fine while Arial became Liberation Sans and Georgia wrapped 20% early. That is exactly what a WebMCP `execute()` return does to a model today: a string that says it worked. So this app splits the work across two parties that cannot vouch for each other. The **main document** owns the text and the gate. A separate **proof surface** — an iframe carrying `allow="tools"` — owns every measurement: it rasterises the text twice, under a serif and a monospace fallback tail, and hashes the pixels — identical hashes prove the face is installed, different hashes prove the browser ignored the name. Main discovers those tools as `RegisteredTool`s, executes them with `executeTool`, and stamps results with the browser-reported origin, never with a label the callee wrote about itself. Hosted, this runs single-folder, so the proof surface is a same-origin frame that main finds with plain `getTools()` and tells apart by `tool.window !== window`; served with `kit/serve.py` the two are separate origins, main uses `getTools({fromOrigins:[PROOF_ORIGIN]})` and the `exposedTo` boundary is real. The measurement is the same either way — only the boundary changes. The gate then believes nobody alone: not `fonts.check`, not the agent's `waiver_propose`, not even a single tool's `ok:true` — only the pixels plus a person.

## What people and agents can do together

1. **Audit and fix in one turn.** Type into ChatGPT: *"Audit this one-pager, tell me which runs are not set in the face they claim, and swap the absent faces for an installed serif that keeps the line count."* The agent calls `run_audit`, reads `blockedBy`, tries candidates with `family_report`, then `substitute_safe` — the document, the audit table and the gate count change on screen as it works.
2. **Propose, human signs.** *"Run 6 is Verdana and shifts 13% under its export substitute; propose a waiver saying we only ship this page on the web."* The agent calls `waiver_propose`; the Export gate panel shows *proposed by agent* with a Countersign button. Nothing unlocks until you click it and sign as a person.
3. **Interrogate the evidence.** *"Prove whether Helvetica and Arial are the same face here, and whether fonts.check is contradicted for Frutiger."* The agent calls `proof_compare_faces` and `proof_font_check`; the proof lab in the corner prints its own certificate for each answer.

## Better UX

While the agent works, the human sees: every run underlined red (blocking), brass (waived by a person) or green (proven); the audit table refilling with hashes and deltas that all came back from the proof surface; the Export button locked with a live count and a note naming each blocking run; agent proposals queued in the gate panel with Countersign / Reject; the invocation log listing each tool call with its input, output and elapsed time; and the proof lab iframe stamping PROVEN / SUBSTITUTED on a certificate. The human can also click any run to open the truth drawer, type directly into the document (each run is `contenteditable`), pick a family from the drawer, and set the wrap-shift threshold — a control no tool can move.

## How we implemented WebMCP

| name | what | readOnly | origin | visible in ChatGPT's browser | API |
|---|---|---|---|---|---|
| `doc_get` | document snapshot: runs, column width, threshold | yes | main | yes | imperative |
| `run_list` | cached verdict per run (`kind`, `blockedBy`, deltas) | yes | main | yes | imperative |
| `run_audit` | re-measure runs through the proof surface; refreshes flags and gate | no | main | yes | imperative |
| `run_explain` | full evidence for one run + one-sentence reading | yes | main | yes | imperative |
| `family_report` | what a candidate family would do to each run | yes | main | yes | imperative |
| `substitute_safe` | swap a family (`oldFamily`, `newFamily`, optional `runIds`) after the proof surface proves the new one draws its own outlines | no | main | yes | imperative |
| `doc_edit` | change a run's text/family, re-audit it | no | main | yes | imperative |
| `waiver_propose` | record an agent proposal; a person must countersign | no | main | yes | imperative |
| `waiver_remove` | drop a waiver or proposal | no | main | yes | imperative |
| `waiver_list` | waivers with `signedBy`, `status`, `effective` | yes | main | yes | imperative |
| `export_gate` | the gate exactly as the Export button sees it | yes | main | yes | imperative |
| `export_document` | stamp a certificate id if the gate is clean (simulated export) | no | main | yes | imperative |
| `page_spill` | real DOM overflow of the fixed-height frame | yes | main | yes | imperative |
| `reset_document` | restore the seed, drop waivers | no | main | yes | imperative |
| `proof_glyph_hash` | bridge → proof `glyph_hash` | yes | main | yes | imperative |
| `proof_wrap_metrics` | bridge → proof `wrap_metrics` | yes | main | yes | imperative |
| `proof_compare_faces` | bridge → proof `compare_faces` | yes | main | yes | imperative |
| `proof_font_check` | bridge → proof `font_check` | yes | main | yes | imperative |
| `proof_export_preview` | bridge → proof `export_preview` | yes | main | yes | imperative |
| `doc_find` | find runs by substring, select the first hit | — | main | no — declarative form, Chrome-only | declarative `<form toolname>` |
| `glyph_hash` | two-tails raster + FNV-1a hash, `kind` own-outlines/absent/aliased | yes | proof frame (`exposedTo` main) | no — in an iframe; use `proof_glyph_hash` | imperative |
| `wrap_metrics` | greedy word-wrap fingerprint, declared vs substitute | yes | proof frame (`exposedTo` main) | no — in an iframe; use `proof_wrap_metrics` | imperative |
| `compare_faces` | same text in two families: identical pixels? | yes | proof frame (`exposedTo` main) | no — in an iframe; use `proof_compare_faces` | imperative |
| `font_check` | `document.fonts.check` vs the pixels | yes | proof frame (`exposedTo` main) | no — in an iframe; use `proof_font_check` | imperative |
| `export_preview` | modelled export chain, measured presence and delta | yes | proof frame (`exposedTo` main) | no — in an iframe; use `proof_export_preview` | imperative |
| `decoy_unexposed` | registered on the proof surface with no `exposedTo` | yes | proof frame (not exposed) | no — in an iframe | imperative |

**Counts, and what each reader actually sees.** 20 tools are registered on the top-level document — 19 imperative plus the declarative `doc_find` form — and 6 more inside the proof frame, 26 in all. On the live site the badge reads *“26 visible · 20 top-level”*, because a same-origin frame's tools are listed by `getTools()` too. ChatGPT's browser sees **19**: it does not discover tools inside an iframe at all, and does not read the declarative form. That is why the five `proof_*` bridges exist — they are top-level tools that relay to the proof surface and share its schemas.

**The decoy, honestly.** `decoy_unexposed` is registered without `exposedTo` to demonstrate that the boundary is enforced by the browser, not by the page. That demonstration only lands when the two are genuinely separate origins: served with `kit/serve.py`, main cannot list or execute it, and `tests/test_01_surface.py` asserts exactly that. On the hosted single-folder build the frame is same-origin, so `decoy_unexposed` **is** listed and does return `{ok:true, decoy:true}` if you call it — same-origin frames have no such boundary to enforce. The tool is harmless either way; it reports nothing but its own name.

`window.mc` is `document.modelContext` when the browser has WebMCP, else a spec-shaped shim (kit/mc.js). Registration in `src/main.js` (every definition goes through `tool()`, which validates input against the schema, returns error envelopes instead of throwing, and logs the call in the panel):

```js
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
```

```js
  const ac = new AbortController();
  window.addEventListener('pagehide', () => ac.abort(), { once: true });
  for (const t of TOOLS) await window.mc.registerTool(t, { signal: ac.signal });
```

The proof surface registers with `exposedTo` in both modes (`proof/index.html`) — the call is unconditional, but it only draws a real line when main is a different origin:

```js
    await window.mc.registerTool(Object.assign({ annotations: { readOnlyHint: true } }, t), { exposedTo: [MAIN], signal: ac.signal });
```

Main reads and executes them (`src/main.js`), using the browser-stamped `origin`/`window` of the `RegisteredTool` rather than any self-report. `SINGLE_ORIGIN` is true on the hosted build and false under `kit/serve.py`, and it is the only thing that changes; the `fromOrigins` branch is the one the two-port setup runs:

```js
  const tools = SINGLE_ORIGIN
    ? await window.mc.getTools()
    : await window.mc.getTools({ fromOrigins: [PROOF_ORIGIN] });
  state.proofTools = tools.filter((t) => (SINGLE_ORIGIN ? t.window !== window : t.origin === PROOF_ORIGIN));
```

```js
    raw = await window.mc.executeTool(tool, input || {});
```

Each `proof_*` bridge is built by `bridge(localName, remoteName, …)`: it shares the proof tool's schema (both read `PROOF_SCHEMAS` from `proof/engine.js`), relays through `proofCall`, and returns the proof surface's payload plus `bridgedTo` and `proofOrigin` (which on the hosted build reads `https://razshy.github.io`, identical to main, exactly as it should). `run_audit` also honours `execute(input, { signal })` and stops between runs when the signal aborts.

## Try it

- **The hosted build (what a judge opens):** <https://razshy.github.io/typeface-webmcp/>. This is single-folder mode — one origin, the proof frame same-origin, `window.MC.isMulti === false`, and the mode line under the tool list says *single-folder mode: proof frame is same-origin*. Chrome 149+ with `chrome://flags/#enable-webmcp-testing` runs it natively; the badge reads *“WebMCP: native document.modelContext · 26 visible · 20 top-level”*. Reproduce it locally with `cd apps/typeface && python3 -m http.server 8080`, or `python3 bundle.py typeface` for `dist/typeface/` on any static host.
- **Two origins (where the boundary is real):** from the yard root, `python3 kit/serve.py --app apps/typeface` prints `{main, proof}` URLs; open `main`. Now `isMulti` is true, `auditMode` reads `cross-origin (…)`, main discovers the proof tools with `getTools({fromOrigins})`, and `decoy_unexposed` is invisible and unexecutable from main. DevTools → Application → WebMCP shows the 20 top-level tools and the proof origin's 6 in the frame; any other browser gets the same surface through the kit shim.
- **ChatGPT's desktop browser:** open the live page and try the three prompts above; the Site tools list shows the 19 imperative top-level tools (it reads neither the iframe's tools nor the declarative form).
- **No agent at hand:** the *Simulate agent* panel runs any tool through `window.__agent.call` (preset buttons for `run_audit`, `waiver_propose`, `substitute_safe`, `proof_glyph_hash`, …) and the invocation log shows what happened.

What to expect on the seed: Poppins (r7) and Frutiger (r8) are absent on ordinary hosts and block as *substituted*; Verdana (r6) is installed but shifts its wrap median ≈13% under its export substitute and blocks as *wrap-shift* at the default 10% threshold; Helvetica is a control on macOS and an alias on most Linux images.

## Real vs simulated

Real: two-tails glyph rasterisation and FNV-1a hashes, `measureText` wrap fingerprints at the rendered column width (with the role's case and tracking), `document.fonts.check` answers, DOM overflow of the fixed-height frame, discovery and execution of the proof surface's tools as browser-issued `RegisteredTool`s (genuinely cross-origin under `kit/serve.py`; a same-origin frame on the hosted build), the human signature path. Modelled (badged "modelled chain" in the spill card and drawer, and named `modelled` in every proof payload): the **order** of faces an export pipeline would try (`EXPORT_CHAIN`); which of them is present here, and every consequence, is measured. Simulated (badged next to the Export button): export writes no PDF — it stamps a certificate id.

## Limitations

- **The hosted deployment is single-folder, not two-origin.** GitHub Pages serves one origin, so the proof surface is a sub-folder frame: `window.MC.isMulti === false`, `auditMode` reads `same-origin frame (single-folder static mode)` and `proofOrigin` equals main. The same discovery/execution code path runs, and every measurement is unchanged, but the trust boundary is only genuinely enforced by the browser when the app is served with `python3 kit/serve.py --app apps/typeface`. The visible consequence is `decoy_unexposed`: callable on the live site, invisible to main on the two-port setup.
- ChatGPT's browser discovers only top-level tools, and it does not look inside iframes: the six proof-frame tools and the declarative `doc_find` form are invisible there whether or not the frame is a separate origin. The five `proof_*` bridges cover the proof tools; `doc_find` has no bridge (it is a demonstration of the declarative API, Chrome-only today).
- Native Chrome keeps only `readOnlyHint` and `untrustedContentHint`; side effects are stated in each description instead.
- Detection is per host: a face installed on the judge's machine is *own-outlines* there even if it is absent in production. The aliasing check (`kind: aliased`) only knows the faces in `EXPORT_CHAIN`.
- Canvas wrap is greedy word-wrap; the page justifies lines, so compare line counts, not right edges (the drawer says so).

## Tests

4 files under `tests/` (`test_01_surface.py`, `test_02_proof.py`, `test_03_gate.py`, `test_04_static.py`), 122 executed checks in shim mode and 122 in native mode. Run from the yard root: `python3 kit/harness.py --app apps/typeface --mode both`, or `python3 gate.py typeface`.

## License

MIT — see `LICENSE`.
