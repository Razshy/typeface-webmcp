# Proof of Typeface

**know what your text actually wears** — a pre-export lie detector for fonts: declared face vs the pixels that rendered, the wrap and page-spill consequences, and an export gate that clears only on evidence or a human signature.

## Why WebMCP fits

`document.fonts.check('16px Poppins')` answers `true` on a machine that has never seen Poppins, because it answers a different question ("is an unloaded @font-face needed?"). Every tool in a real export pipeline reports success the same way — the container audit this app is built on had 299 installed faces, none called Arial, and every step said fine while Arial became Liberation Sans and Georgia wrapped 20% early. That is exactly what a WebMCP `execute()` return does to a model today: a string that says it worked. So this app splits the work across two parties that cannot vouch for each other. The **main origin** owns the document and the gate. A separate **proof origin** (an iframe on another port, `allow="tools"`) owns every measurement: it rasterises the text twice, under a serif and a monospace fallback tail, and hashes the pixels — identical hashes prove the face is installed, different hashes prove the browser ignored the name. Main discovers those tools with `getTools({fromOrigins})`, executes them by `RegisteredTool`, and stamps results with the browser-reported origin, never with a label the callee wrote about itself. The gate then believes nobody alone: not `fonts.check`, not the agent's `waiver_propose`, not even a single tool's `ok:true` — only the pixels plus a person.

## What people and agents can do together

1. **Audit and fix in one turn.** Type into ChatGPT: *"Audit this one-pager, tell me which runs are not set in the face they claim, and swap the absent faces for an installed serif that keeps the line count."* The agent calls `run_audit`, reads `blockedBy`, tries candidates with `family_report`, then `substitute_safe` — the document, the audit table and the gate count change on screen as it works.
2. **Propose, human signs.** *"Run 6 is Verdana and shifts 13% under its export substitute; propose a waiver saying we only ship this page on the web."* The agent calls `waiver_propose`; the Export gate panel shows *proposed by agent* with a Countersign button. Nothing unlocks until you click it and sign as a person.
3. **Interrogate the evidence.** *"Prove whether Helvetica and Arial are the same face here, and whether fonts.check is contradicted for Frutiger."* The agent calls `proof_compare_faces` and `proof_font_check`; the proof lab in the corner prints its own certificate for each answer.

## Better UX

While the agent works, the human sees: every run underlined red (blocking), brass (waived by a person) or green (proven); the audit table refilling with hashes and deltas that all came back from the proof origin; the Export button locked with a live count and a note naming each blocking run; agent proposals queued in the gate panel with Countersign / Reject; the invocation log listing each tool call with its input, output and elapsed time; and the proof lab iframe stamping PROVEN / SUBSTITUTED on a certificate. The human can also click any run to open the truth drawer, type directly into the document (each run is `contenteditable`), pick a family from the drawer, and set the wrap-shift threshold — a control no tool can move.

## How we implemented WebMCP

| name | what | readOnly | origin | visible in ChatGPT's browser | API |
|---|---|---|---|---|---|
| `doc_get` | document snapshot: runs, column width, threshold | yes | main | yes | imperative |
| `run_list` | cached verdict per run (`kind`, `blockedBy`, deltas) | yes | main | yes | imperative |
| `run_audit` | re-measure runs through the proof origin; refreshes flags and gate | no | main | yes | imperative |
| `run_explain` | full evidence for one run + one-sentence reading | yes | main | yes | imperative |
| `family_report` | what a candidate family would do to each run | yes | main | yes | imperative |
| `substitute_safe` | swap a family after the proof origin proves the new one is installed | no | main | yes | imperative |
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
| `doc_find` | find runs by substring, select the first hit | — | main | no | declarative `<form toolname>` |
| `glyph_hash` | two-tails raster + FNV-1a hash, `kind` own-outlines/absent/aliased | yes | proof (exposedTo main) | no (via bridge) | imperative |
| `wrap_metrics` | greedy word-wrap fingerprint, declared vs substitute | yes | proof (exposedTo main) | no (via bridge) | imperative |
| `compare_faces` | same text in two families: identical pixels? | yes | proof (exposedTo main) | no (via bridge) | imperative |
| `font_check` | `document.fonts.check` vs the pixels | yes | proof (exposedTo main) | no (via bridge) | imperative |
| `export_preview` | modelled export chain, measured presence and delta | yes | proof (exposedTo main) | no (via bridge) | imperative |
| `decoy_unexposed` | registered on proof without `exposedTo`; must stay invisible to main | yes | proof (not exposed) | no | imperative |

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

The proof origin registers with `exposedTo` (`proof/index.html`):

```js
    await window.mc.registerTool(Object.assign({ annotations: { readOnlyHint: true } }, t), { exposedTo: [MAIN], signal: ac.signal });
```

Main reads and executes them (`src/main.js`), using the browser-stamped `origin`/`window` of the `RegisteredTool` rather than any self-report:

```js
  const tools = SINGLE_ORIGIN
    ? await window.mc.getTools()
    : await window.mc.getTools({ fromOrigins: [PROOF_ORIGIN] });
  state.proofTools = tools.filter((t) => (SINGLE_ORIGIN ? t.window !== window : t.origin === PROOF_ORIGIN));
```

```js
    raw = await window.mc.executeTool(tool, input || {});
```

Each `proof_*` bridge is built by `bridge(localName, remoteName, …)`: it shares the proof tool's schema (both read `PROOF_SCHEMAS` from `proof/engine.js`), relays through `proofCall`, and returns the proof origin's payload plus `bridgedTo` and `proofOrigin`. `run_audit` also honours `execute(input, { signal })` and stops between runs when the signal aborts.

## Try it

- **Multi-origin (the real demo):** from the yard root, `python3 kit/serve.py --app apps/typeface` prints `{main, proof}` URLs; open `main`. Chrome 149+ with `chrome://flags/#enable-webmcp-testing` runs it natively (DevTools → Application → WebMCP shows 21 top-level tools, and the proof origin's 6 in the frame); any other browser gets the same surface through the kit shim.
- **Single folder (static hosting):** `cd apps/typeface && python3 -m http.server 8080`, open `http://localhost:8080/`. One origin; the proof frame is same-origin and the page says *single-folder mode*. `python3 bundle.py typeface` writes `dist/typeface/` for any static host.
- **ChatGPT's desktop browser:** open the page and try the three prompts above; the Site tools list shows the 20 imperative top-level tools.
- **No agent at hand:** the *Simulate agent* panel runs any tool through `window.__agent.call` (preset buttons for `run_audit`, `waiver_propose`, `substitute_safe`, `proof_glyph_hash`, …) and the invocation log shows what happened.

What to expect on the seed: Poppins (r7) and Frutiger (r8) are absent on ordinary hosts and block as *substituted*; Verdana (r6) is installed but shifts its wrap median ≈13% under its export substitute and blocks as *wrap-shift* at the default 10% threshold; Helvetica is a control on macOS and an alias on most Linux images.

## Real vs simulated

Real: two-tails glyph rasterisation and FNV-1a hashes, `measureText` wrap fingerprints at the rendered column width (with the role's case and tracking), `document.fonts.check` answers, DOM overflow of the fixed-height frame, cross-origin discovery/execution, the human signature path. Modelled (badged "modelled chain" in the spill card and drawer, and named `modelled` in every proof payload): the **order** of faces an export pipeline would try (`EXPORT_CHAIN`); which of them is present here, and every consequence, is measured. Simulated (badged next to the Export button): export writes no PDF — it stamps a certificate id.

## Limitations

- ChatGPT's browser discovers only top-level tools: the six proof-origin tools and the declarative `doc_find` form are invisible there. The five `proof_*` bridges cover the proof tools; `doc_find` has no bridge (it is a demonstration of the declarative API, Chrome-only today).
- Native Chrome keeps only `readOnlyHint` and `untrustedContentHint`; side effects are stated in each description instead.
- Detection is per host: a face installed on the judge's machine is *own-outlines* there even if it is absent in production. The aliasing check (`kind: aliased`) only knows the faces in `EXPORT_CHAIN`.
- Canvas wrap is greedy word-wrap; the page justifies lines, so compare line counts, not right edges (the drawer says so).

## Tests

4 files under `tests/` (`test_01_surface.py`, `test_02_proof.py`, `test_03_gate.py`, `test_04_static.py`), 122 executed checks in shim mode and 122 in native mode. Run from the yard root: `python3 kit/harness.py --app apps/typeface --mode both`, or `python3 gate.py typeface`.

## License

MIT — see `LICENSE`.
