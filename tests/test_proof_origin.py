"""Proof of Typeface — origin isolation, the proof engine, and the cross-origin audit path.

Self-executing Playwright script (harness convention): reads BASE_URL / ORIGINS_JSON,
asserts, prints PROOF-ORIGIN-SUITE OK.
"""
import json
import os

from playwright.sync_api import sync_playwright

BASE = os.environ['BASE_URL']
ORIG = json.loads(os.environ['ORIGINS_JSON'])
PROOF = ORIG['proof']

CALL = """([name, input]) => window.__agent.call(name, input || {}).then(r => typeof r === 'string' ? JSON.parse(r) : r)"""
TOOLS = """(origins) => window.__agent.tools(origins && origins.length ? origins : undefined).then(ts => ts.map(t => [t.name, t.origin]))"""

FAMILY_PROBE = """(fams) => Promise.all(fams.map(f => window.__agent.call('proof_glyph_hash', {family: f, text: 'Handgloves 2026', size: 26})
  .then(r => JSON.parse(r)).then(r => ({family: f, identical: r.identical, hash: r.requestedHash, serif: r.serifStandinHash}))))"""


def call(pg, name, inp=None):
    return pg.evaluate(CALL, [name, inp or {}])


def proof_frame(pg):
    for f in pg.frames:
        if f.url and f.url.startswith(PROOF):
            return f
    return None


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        pg.on('console', lambda m: errors.append('console-error: ' + m.text) if m.type == 'error' else None)

        pg.goto(BASE + '/index.html')
        pg.wait_for_function('window.__appReady === true', timeout=25000)
        pg.wait_for_function("window.__typeface && window.__typeface.proofReady === true", timeout=25000)

        # 1. proof origin is genuinely a different origin from main
        assert PROOF != BASE, (PROOF, BASE)

        # 2. proof tools invisible WITHOUT fromOrigins (default cross-origin = invisible)
        plain = pg.evaluate(TOOLS, None)
        names_plain = [n for n, _ in plain]
        assert 'proof_glyph_hash' not in names_plain, names_plain
        assert 'proof_metrics' not in names_plain, names_plain
        assert 'run_audit' in names_plain and 'export_gate' in names_plain, names_plain

        # 3. ...and VISIBLE with fromOrigins:[proof]
        withproof = pg.evaluate(TOOLS, [PROOF])
        by_origin = dict(withproof)
        for tool in ('proof_glyph_hash', 'proof_metrics', 'proof_compare', 'proof_font_check', 'proof_export_preview'):
            assert tool in by_origin, (tool, sorted(by_origin))
            # 4. every proof tool is labelled with the proof origin
            assert by_origin[tool] == PROOF, (tool, by_origin[tool], PROOF)

        # 5. decoy (same origin as proof, no exposedTo) must never be visible to main
        assert 'decoy_proof' not in by_origin, sorted(by_origin)
        assert pg.evaluate('window.__decoyVisible') is False

        # 6. decoy IS visible from inside the proof frame's own realm
        kid = proof_frame(pg)
        assert kid is not None, 'proof iframe not found'
        kidvis = kid.evaluate("window.__agent.tools().then(ts => ts.map(t => t.name))")
        assert 'decoy_proof' in kidvis, kidvis
        assert 'proof_glyph_hash' in kidvis, kidvis

        # 7. duplicate registration rejects, both on main and inside the proof origin
        dup_main = pg.evaluate("window.mc.registerTool({name:'run_audit',description:'dup',inputSchema:{type:'object'},execute:async()=>'y'}).then(()=>'accepted', e => 'rejected:' + e.name)")
        assert dup_main.startswith('rejected:'), dup_main
        dup_child = kid.evaluate("window.mc.registerTool({name:'proof_metrics',description:'dup',inputSchema:{type:'object'},execute:async()=>'y'}).then(()=>'accepted', e => 'rejected:' + e.name)")
        assert dup_child.startswith('rejected:'), dup_child

        # 8. proof_glyph_hash: identical only when the pixels really are a generic face.
        #    Distinct real faces must differ from every stand-in; absent faces must be identical.
        probes = pg.evaluate(FAMILY_PROBE, ['Baskerville', 'Didot', 'Palatino', 'Poppins', 'Frutiger', 'Garamond', 'Menlo', 'Impact'])
        distinct = [x for x in probes if not x['identical']]
        collapsed = [x for x in probes if x['identical']]
        assert distinct, probes
        assert collapsed, probes
        hashes = {x['hash'] for x in probes}
        assert len(hashes) >= 3, probes
        # absent families all collapse onto ONE face, and that face is the generic serif
        collapsed_hashes = {x['hash'] for x in collapsed}
        assert len(collapsed_hashes) == 1, (collapsed, collapsed_hashes)
        assert all(x['hash'] == x['serif'] for x in collapsed), collapsed
        for x in distinct:
            assert x['hash'] != x['serif'], x

        # 9. proof_glyph_hash returns the contract shape demanded by the spec
        g = call(pg, 'proof_glyph_hash', {'text': 'Quiet rivers run deep', 'family': 'Poppins', 'size': 26})
        for key in ('requestedHash', 'fallbackHash', 'identical', 'inkPx', 'widthPx'):
            assert key in g, key
        assert g['identical'] is True, g
        assert isinstance(g['inkPx'], int) and g['inkPx'] > 0, g
        assert g['widthPx'] > 0, g
        assert g['requestedHash'] == g['serifStandinHash'], g
        assert g['originLabel'] == 'proof', g['originLabel']
        assert g['origin'] == PROOF, (g['origin'], PROOF)
        # all four stand-in hashes are computed; serif / mono / sans-keyword are distinct faces
        assert set(g['standinHashes']) == {'serif', 'sansArial', 'monospace', 'sansKeyword'}, g['standinHashes']
        assert len({g['serifStandinHash'], g['monoStandinHash'], g['sansKeywordStandinHash']}) == 3, g

        # 10. proof_metrics: wrap fingerprint = lines + median right edge (the audit mechanic)
        m = call(pg, 'proof_metrics', {'text': 'Pack my box with five dozen liquor jugs, then ask the printer which face it packed, because the widths are neither.',
                                       'family': 'Verdana', 'size': 16, 'widthPxColumn': 300})
        assert m['originLabel'] == 'proof' and m['origin'] == PROOF, m
        assert m['declared']['lineCount'] >= 2, m['declared']
        assert len(m['declared']['lines']) == m['declared']['lineCount']
        right_edges = [l['rightEdge'] for l in m['declared']['lines']]
        assert all(re_edge <= 300 + 1e-6 or i == 0 for i, re_edge in enumerate(right_edges)), right_edges
        assert m['declared']['medianRightEdge'] > 0
        assert len(m['declared']['fingerprint']) == 8, m['declared']['fingerprint']
        assert m['widthPx'] > 0
        # narrower column => more lines, and the fingerprint changes
        narrow = call(pg, 'proof_metrics', {'text': 'Pack my box with five dozen liquor jugs, then ask the printer which face it packed.',
                                            'family': 'Verdana', 'size': 16, 'widthPxColumn': 140})
        assert narrow['declared']['lineCount'] > m['declared']['lineCount'], (narrow, m)
        assert narrow['declared']['fingerprint'] != m['declared']['fingerprint']

        # 11. proof_font_check catches the lie: check() claims a face that pixels disprove
        lie = call(pg, 'proof_font_check', {'family': 'Poppins', 'size': 26})
        assert lie['fontsCheck']['declared'] is True, lie
        assert lie['matchesGeneric'] is True, lie
        assert lie['lie'] is True, lie
        assert lie['verdict'].startswith('proof:lie'), lie['verdict']
        truth = call(pg, 'proof_font_check', {'family': distinct[0]['family'], 'size': 26})
        assert truth['lie'] is False, truth
        assert truth['verdict'] == 'proof:no-contradiction', truth['verdict']

        # 12. proof_compare proves two names resolve to one face (and vice versa)
        same = call(pg, 'proof_compare', {'familyA': collapsed[0]['family'], 'familyB': 'serif', 'size': 26})
        assert same['identical'] is True, same
        assert same['verdict'].startswith('proof:indistinguishable'), same['verdict']
        diff = call(pg, 'proof_compare', {'familyA': distinct[0]['family'], 'familyB': distinct[-1]['family'], 'size': 26})
        assert diff['identical'] is False, diff
        assert diff['verdict'].startswith('proof:distinguishable'), diff['verdict']

        # 13. proof_export_preview names the face an export pipeline would embed
        e = call(pg, 'proof_export_preview', {'family': 'Arial', 'text': 'Quiet rivers run deep', 'size': 26})
        assert e['embeddedFamily'] == 'Liberation Sans', e
        assert e['verdict'].startswith('proof:export would embed'), e['verdict']
        assert 'modelledBy' in e and 'modelled' in e['modelledBy'], e['modelledBy']

        # 14. run_audit really crosses origins: origin labels on the tool objects AND proof:
        #     prefixed verdict strings inside the results
        audit = call(pg, 'run_audit', {})
        assert audit['auditMode'] == 'cross-origin', audit['auditMode']
        assert audit['proofOrigin'] == PROOF, audit['proofOrigin']
        assert audit['proofToolsUsed'] == ['proof_glyph_hash', 'proof_metrics']
        assert len(audit['runs']) >= 8, len(audit['runs'])
        for r in audit['runs']:
            assert r['proofOriginLabel'] == 'proof', r
            assert r['proofOrigin'] == PROOF, r['runId']
            assert r['proofVerdict'].startswith('proof:'), r['proofVerdict']
            assert len(r['proofToolCalls']) == 2, r['proofToolCalls']
        # proof origin logged the calls in its own realm -> they were not faked locally
        logged = kid.evaluate("window.__calls.filter(c => c.tool === 'proof_glyph_hash').length")
        assert logged >= len(audit['runs']), (logged, len(audit['runs']))
        assert pg.evaluate('window.__typeface.calls') >= 2 * len(audit['runs'])

        # 15. the audit flags exactly the runs whose name the renderer ignored
        flagged = [r for r in audit['runs'] if r['identical']]
        assert len(flagged) >= 2, [r['family'] for r in audit['runs']]
        for r in flagged:
            assert r['hashVerdict'] == 'substituted', r
            assert r['fallbackHash'] and r['standinFamily'], r
            assert r['fontsCheckSays'] is True, r  # fonts.check said "installed" -> a lie
            assert r['lies'] is True, r
            # the flag condition is literally hash equality against one of the stand-in faces
            assert r['requestedHash'] in set(r['standinHashes'].values()), r
        for r in audit['runs']:
            if not r['identical']:
                assert r['hashVerdict'] == 'own-outlines', r
                assert r['fallbackHash'] is None, r
                assert set(r['standinHashes']) == {'serif', 'sansArial', 'monospace', 'sansKeyword'}, r
                own = {k: h for k, h in r['standinHashes'].items() if k != 'sansArial'}
                assert r['requestedHash'] not in set(own.values()), (r['runId'], r['family'])

        # 16. same declared family, different text => different hashes; same text+family => stable hash
        a = call(pg, 'proof_glyph_hash', {'family': 'Georgia', 'text': 'Quiet rivers run deep', 'size': 26})
        btxt = call(pg, 'proof_glyph_hash', {'family': 'Georgia', 'text': 'Quick jigs vex the waltzing band', 'size': 26})
        again = call(pg, 'proof_glyph_hash', {'family': 'Georgia', 'text': 'Quiet rivers run deep', 'size': 26})
        assert a['requestedHash'] == again['requestedHash'], (a, again)
        assert a['requestedHash'] != btxt['requestedHash'], (a, btxt)
        # the Georgia-vs-generic-serif relation is exactly the flag condition, host-independently
        georgia_flagged = a['identical']
        assert georgia_flagged == (a['requestedHash'] == a['serifStandinHash']), a

        # 17. run_audit with a family filter only audits that family
        limited = call(pg, 'run_audit', {'family': 'Georgia'})
        assert len(limited['runs']) >= 1
        assert {r['family'] for r in limited['runs']} == {'Georgia'}, limited['runs']

        # 18. zero console / page errors across the whole suite
        assert not errors, errors
        b.close()
        print('PROOF-ORIGIN-SUITE OK')


if __name__ == '__main__':
    main()
