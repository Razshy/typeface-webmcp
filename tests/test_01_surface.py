"""Proof of Typeface — the WebMCP surface: inventory, schemas, cross-origin visibility, toolchange, panel."""
import re

from helpers import BRIDGES, MAIN_TOOLS, PROOF, PROOF_TOOLS, boot, err_code, proof_frame
from testkit import MODE, browser, call, call_error, done, errors, new_page, ok, tools

NAME_RE = re.compile(r'^[A-Za-z0-9_-]{1,30}$')


def check_schema(t):
    schema = t['inputSchema']
    assert schema and schema.get('type') == 'object', (t['name'], schema)
    assert schema.get('additionalProperties') is False, (t['name'], 'additionalProperties')
    for k, p in schema.get('properties', {}).items():
        assert p.get('type') and p.get('description') and len(p['description']) <= 150, (t['name'], k, p)
    for k in schema.get('required', []):
        assert k in schema.get('properties', {}), (t['name'], k)
    assert 0 < len(t['description']) <= 500, (t['name'], len(t['description']))
    assert NAME_RE.match(t['name']), t['name']
    ann = t['annotations']
    assert ann is not None and set(ann) <= {'readOnlyHint', 'untrustedContentHint'}, (t['name'], ann)


def main():
    with browser() as b:
        pg = new_page(b)
        boot(pg)
        ok(pg.evaluate('window.MC.native') == (MODE == 'native'), 'MC.native reports the mode: ' + MODE)
        ok(pg.evaluate('window.MC.isMulti') is True, 'MC.isMulti under the multi-origin server')
        badge = pg.text_content('#binding-badge')
        ok(('native' in badge) == (MODE == 'native') and badge.startswith('WebMCP:'), 'binding badge names the mode', badge)

        # --- inventory ----------------------------------------------------------------------
        top = tools(pg)
        names = [t['name'] for t in top]
        ok(all(n in names for n in MAIN_TOOLS + BRIDGES + ['doc_find']), 'all 19 imperative tools + the declarative form are top-level', names)
        ok(not any(n in names for n in PROOF_TOOLS + ['decoy_unexposed']), 'proof-origin tools invisible without fromOrigins', names)
        ok(all(t['origin'] == pg.evaluate('location.origin') for t in top), 'top-level tools carry the main origin')
        both = tools(pg, [PROOF])
        proof = {t['name']: t for t in both if t['origin'] == PROOF}
        ok(sorted(proof) == sorted(PROOF_TOOLS), 'fromOrigins:[proof] lists exactly the five exposed proof tools', sorted(proof))
        ok('decoy_unexposed' not in [t['name'] for t in both], 'unexposed decoy stays hidden even with fromOrigins')
        for t in top + list(proof.values()):
            if t['name'] != 'doc_find':
                check_schema(t)
        ok(True, 'every imperative tool: object schema, additionalProperties:false, typed+described params, spec-only annotations, name <= 30')
        read_only = {t['name'] for t in top if t['annotations'] and t['annotations']['readOnlyHint']}
        ok({'doc_get', 'run_list', 'run_explain', 'export_gate', 'page_spill', 'waiver_list', 'family_report', *BRIDGES} <= read_only, 'read tools carry readOnlyHint:true', read_only)
        ok(not ({'run_audit', 'substitute_safe', 'doc_edit', 'waiver_propose', 'waiver_remove', 'export_document', 'reset_document'} & read_only), 'mutating tools carry readOnlyHint:false')
        untrusted = {t['name'] for t in top if t['annotations'] and t['annotations']['untrustedContentHint']}
        ok({'doc_get', 'doc_edit', 'waiver_propose', 'waiver_list'} <= untrusted, 'tools echoing author/agent text carry untrustedContentHint', untrusted)
        ok(all(proof[n]['annotations'] == {'readOnlyHint': True, 'untrustedContentHint': False} for n in PROOF_TOOLS), 'proof tools are read-only measurements')
        for n in BRIDGES:
            t = next(x for x in top if x['name'] == n)
            remote = n[len('proof_'):]
            ok(t['inputSchema'] == proof[remote]['inputSchema'] and remote in t['description'] and PROOF in t['description'], 'bridge %s shares %s\'s schema and names the proof origin' % (n, remote))
        find = next(t for t in top if t['name'] == 'doc_find')
        ok(find['inputSchema']['properties']['query']['type'] == 'string' and find['inputSchema']['required'] == ['query'], 'declarative doc_find synthesises a schema from the form', find['inputSchema'])

        # --- registration rules ---------------------------------------------------------------
        dup = pg.evaluate("window.mc.registerTool({name:'run_audit',description:'dup',inputSchema:{type:'object'},execute:async()=>'y'}).then(()=>'accepted', e => e.name)")
        ok(dup == 'InvalidStateError', 'duplicate name rejected on main', dup)
        kid = proof_frame(pg)
        dup_child = kid.evaluate("window.mc.registerTool({name:'glyph_hash',description:'dup',inputSchema:{type:'object'},execute:async()=>'y'}).then(()=>'accepted', e => e.name)")
        ok(dup_child == 'InvalidStateError', 'duplicate name rejected inside the proof origin', dup_child)
        bad = call(pg, 'doc_get', {'bogus': 1})
        ok(err_code(bad) == 'invalid_param' and 'bogus' in bad['error']['message'] and bad['error']['hint'], 'unknown parameter -> invalid_param envelope with hint', bad)
        ok(err_code(call(pg, 'run_explain', {})) == 'invalid_param', 'missing required parameter -> invalid_param')
        ok(err_code(call(pg, 'run_explain', {'runId': 42})) == 'invalid_param', 'wrong type -> invalid_param')
        ok(err_code(call(pg, 'run_audit', {'format': 'huge'})) == 'invalid_param', 'enum violation -> invalid_param')
        blocked = call_error(pg, 'decoy_unexposed')
        ok(blocked and blocked['name'] == 'UnknownError', 'executing the unexposed decoy from main rejects', blocked)
        ok('decoy_unexposed' in kid.evaluate("window.__agent.tools().then(ts => ts.map(t => t.name))"), 'decoy visible inside its own realm')

        # --- toolchange + agent panel --------------------------------------------------------------
        count_before = pg.inner_text('#tool-count')
        tc_before = int(re.search(r'toolchange ×(\d+)', count_before).group(1))
        pg.evaluate("window.__lateCtl = new AbortController(); window.mc.registerTool({name:'late_probe',description:'late',inputSchema:{type:'object',properties:{},additionalProperties:false},execute:async()=>'late'}, {signal: window.__lateCtl.signal})")
        pg.wait_for_function("document.getElementById('tool-count').textContent.includes('toolchange ×%d')" % (tc_before + 1), timeout=5000)
        ok('late_probe' in pg.inner_text('#tool-list') and pg.evaluate("[...document.querySelectorAll('#agent-tool option')].some(o => o.value === 'late_probe')"), 'a late registration appears in the panel list and the run-tool select after toolchange')
        pg.evaluate('window.__lateCtl.abort()')
        pg.wait_for_function("!document.getElementById('tool-list').textContent.includes('late_probe')", timeout=5000)
        ok('late_probe' not in [t['name'] for t in tools(pg)], 'aborting the signal unregisters the tool and the panel drops it')
        listed = pg.evaluate("[...document.querySelectorAll('#tool-list .t-orig')].map(e => e.textContent)")
        ok(listed.count('proof origin') == 5 and listed.count('top-level') == len(names), 'panel labels 5 proof-origin tools and every top-level tool', listed)
        pg.select_option('#agent-tool', 'proof_font_check')
        pg.fill('#agent-input', '{"family": "zz-no-such-face-panel"}')
        pg.click('#btn-agent-run')
        pg.wait_for_function("document.getElementById('agent-out').textContent.includes('contradiction')", timeout=15000)
        ok('"contradiction": true' in pg.inner_text('#agent-out'), 'run-tool control executes through window.__agent and shows the result')
        log = pg.inner_text('#agent-log')
        ok('proof_font_check' in log and 'zz-no-such-face-panel' in log, 'invocation log records the call with its input', log[:200])
        ok(errors(pg) == [], 'no console or page errors', errors(pg))
    done('surface')


if __name__ == '__main__':
    main()
