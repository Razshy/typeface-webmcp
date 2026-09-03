"""Proof of Typeface — the product loop: audit -> substitute/waive -> export gate -> human path.

Self-executing Playwright script (harness convention): reads BASE_URL / ORIGINS_JSON.
"""
import json
import os

from playwright.sync_api import sync_playwright

BASE = os.environ['BASE_URL']
ORIG = json.loads(os.environ['ORIGINS_JSON'])
PROOF = ORIG['proof']

CALL = """([name, input]) => window.__agent.call(name, input || {}).then(r => typeof r === 'string' ? JSON.parse(r) : r)"""

# Faces are host-dependent: ask the proof origin which candidate families actually rasterise to
# their own outlines on THIS machine, and which collapse to a generic face. The test then drives
# substitute_safe with those, so the loop is proven rather than assumed.
CANDIDATES = ['Baskerville', 'Didot', 'Palatino', 'Copperplate', 'Optima', 'Futura', 'Gill Sans',
              'Avenir', 'American Typewriter', 'Trebuchet MS', 'Menlo', 'Impact', 'Chalkboard',
              'Papyrus', 'Rockwell', 'Cambria', 'Constantia', 'Corbel', 'Consolas', 'Calibri',
              'Courier Prime', 'Iowan Old Style', 'Charter', 'Noto Serif', 'Liberation Serif']
CLASSIFY = """(fams) => Promise.all(fams.map(f => window.__agent.call('proof_glyph_hash', {family: f, text: 'Quiet rivers run deep', size: 26})
  .then(r => JSON.parse(r)).then(r => ({family: f, identical: r.identical}))))"""


def call(pg, name, inp=None):
    return pg.evaluate(CALL, [name, inp or {}])


def dom_gate(pg):
    return pg.evaluate("""() => {
      const btn = document.getElementById('btn-export');
      return {disabled: btn.disabled, label: btn.textContent.trim(), locked: btn.classList.contains('locked'),
              blocked: document.getElementById('gate-blocked').textContent.trim(),
              waived: document.getElementById('gate-waived').textContent.trim(),
              rows: [...document.querySelectorAll('#audit-table [data-row]')].length};
    }""")


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        pg.on('console', lambda m: errors.append('console-error: ' + m.text) if m.type == 'error' else None)

        # toolchange must be observable around dynamic registration
        pg.add_init_script("window.__tc=0; window.addEventListener('mc-toolchange', ()=>window.__tc++);")
        pg.goto(BASE + '/index.html')
        pg.wait_for_function('window.__appReady === true', timeout=25000)

        assert pg.evaluate('window.__tc') >= 1, 'no mc-toolchange observed during registration'

        # ---------- the seed document itself ----------
        doc = call(pg, 'doc_get', {})
        runs = doc['runs']
        assert len(runs) >= 9, len(runs)
        families = {r['family'] for r in runs}
        for want in ('Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Verdana', 'Poppins', 'system-ui'):
            assert want in families, (want, sorted(families))
        assert doc['columnPx'] > 200 and doc['frameHeightPx'] > 200, doc

        # ---------- run_list shape ----------
        rl = call(pg, 'run_list', {})
        assert rl['measuredBy'] == PROOF, rl['measuredBy']
        assert len(rl['runs']) == len(runs)
        for r in rl['runs']:
            for key in ('declared', 'measuredCheck', 'hashVerdict', 'widthDeltaPct', 'wrapDeltaPct'):
                assert key in r, (r['id'], key)
            assert r['hashVerdict'] in ('substituted', 'own-outlines'), r
            assert r['measuredCheck'] is True, r  # fonts.check claims everything is installed

        # ---------- >=2 runs flagged, with the equality/non-equality signature ----------
        audit = call(pg, 'run_audit', {})
        flagged = [r for r in audit['runs'] if r['identical']]
        clean = [r for r in audit['runs'] if not r['identical']]
        assert len(flagged) >= 2, [r['family'] for r in audit['runs']]
        assert len(clean) >= 3, [r['family'] for r in audit['runs']]
        # the flagged runs are identical to a generic stand-in and different from a distinct serif
        for f in flagged:
            assert f['requestedHash'] in set(f['standinHashes'].values()), f
            distinct_serifs = [c for c in clean if c['hashVerdict'] == 'own-outlines']
            for c in distinct_serifs:
                assert f['requestedHash'] != c['requestedHash'], (f['family'], c['family'])
        # a control family that is really installed never equals the stand-in it would fall to
        for c in clean:
            assert c['requestedHash'] != c['serifStandinHash'], c['family']
        # Poppins (absent everywhere) must be among the flags: it can only be a fallback
        poppins = [r for r in audit['runs'] if r['family'] == 'Poppins']
        assert poppins and all(r['identical'] for r in poppins), poppins
        assert all(r['standinFamily'] for r in poppins)

        # ---------- width deltas are sane numbers, not noise ----------
        deltas = [abs(r['widthDeltaPct']) for r in audit['runs'] if r['widthDeltaPct'] not in (None, 0)]
        assert len(deltas) >= 4, deltas
        for d in deltas:
            assert 0.05 <= d <= 50, d
        # at least one run re-wraps under the export substitute (the 20%-early-wrap failure mode)
        rewoven = [r for r in audit['runs'] if r['lines'] != r['linesUnderSubstitute']]
        assert rewoven, [r['family'] for r in audit['runs']]
        assert any(abs(r['wrapDeltaPct']) > 3 for r in audit['runs']), [r['wrapDeltaPct'] for r in audit['runs']]

        # ---------- page spill meter is real DOM overflow ----------
        spill = call(pg, 'page_spill', {})
        assert spill['spillPx'] > 0, spill  # the seeded one-pager is meant to spill
        assert spill['contentHeightPx'] > spill['frameHeightPx'], spill
        assert 0 < spill['spillPct'] <= 100, spill
        assert 'main DOM' in spill['measuredBy'], spill['measuredBy']
        assert pg.evaluate("document.getElementById('stat-spill').textContent").endswith('px')

        # ---------- gate starts blocked, DOM mirrors it ----------
        g0 = call(pg, 'export_gate', {})
        assert g0['clean'] is False and g0['exportEnabled'] is False, g0
        assert len(g0['blocked']) == len(flagged), (g0['blocked'], flagged)
        assert g0['waived'] == []
        assert g0['proofOrigin'] == PROOF and g0['auditMode'] == 'proof-origin', g0
        d0 = dom_gate(pg)
        assert d0['disabled'] is True and d0['locked'] is True, d0
        assert d0['label'].startswith('Export ('), d0
        assert d0['rows'] == len(runs), d0

        # ---------- metrics_report proxies the proof origin ----------
        mr = call(pg, 'metrics_report', {'family': 'Georgia', 'widthPxColumn': 380})
        assert mr['measuredBy'] == PROOF, mr
        assert mr['proxiedTools'] == ['proof_metrics', 'proof_glyph_hash'], mr
        assert len(mr['reports']) >= 2, mr
        for rep in mr['reports']:
            assert rep['proofVerdict'].startswith('proof:'), rep
            assert rep['glyphVerdict'].startswith('proof:'), rep
            assert rep['proofOrigin'] == PROOF, rep
            assert rep['widthPx'] > 0 and rep['lineCount'] >= 1, rep

        # ---------- explain_diff / proof_verdicts ----------
        first_flag = flagged[0]['runId']
        ed = call(pg, 'explain_diff', {'runId': first_flag})
        assert ed['proofOrigin'] == PROOF, ed['proofOrigin']
        assert ed['verdict'].startswith('proof:'), ed['verdict']
        assert 'byte-identical' in ed['reads'], ed['reads']
        assert call(pg, 'explain_diff', {'runId': 'nope'})['error'].startswith('no such run')
        pv = call(pg, 'proof_verdicts', {})
        assert pv['verdict'].startswith('proof:'), pv['verdict']
        assert len(pv['lies']) >= 2, pv['lies']
        assert all(c['originLabel'] == 'proof' for c in pv['fontChecks'])

        # ---------- substitute_safe changes the audit table AND the gate ----------
        classes = pg.evaluate(CLASSIFY, CANDIDATES)
        safe = [c['family'] for c in classes if not c['identical']]
        bad = [c['family'] for c in classes if c['identical']]
        assert safe, classes
        target = flagged[0]['family']
        still_flagged = [f for f in flagged if f['family'] != target]
        gate_expect_blocked = len(still_flagged)

        refused = call(pg, 'substitute_safe', {'oldFamily': target, 'newFamily': bad[0]}) if bad else {'ok': True}
        if bad:
            assert refused['ok'] is False and 'refusing' in refused['refusal'], refused

        before_table = [r['declared'] for r in call(pg, 'run_list', {})['runs']]
        sub = call(pg, 'substitute_safe', {'oldFamily': target, 'newFamily': safe[0]})
        assert sub['ok'] is True, sub
        assert sub['before'] and sub['after'], sub
        assert all(x['family'] == target for x in sub['before']), sub['before']
        assert all(x['family'] == safe[0] for x in sub['after']), sub['after']
        assert all(not x['identical'] for x in sub['after']), sub['after']
        assert sub['verdict'] == 'now rasterises to own outlines', sub['verdict']
        assert sub['gateBefore']['blocked'] == len(flagged), sub['gateBefore']
        assert sub['gateAfter']['blocked'] == gate_expect_blocked, sub['gateAfter']
        after_table = [r['declared'] for r in call(pg, 'run_list', {})['runs']]
        assert before_table != after_table, (before_table, after_table)
        assert safe[0] in after_table and target not in after_table, after_table
        # the visible table changed too
        cell_families = pg.evaluate("[...document.querySelectorAll('#audit-table [data-row] td:nth-child(2)')].map(td => td.textContent)")
        assert target not in cell_families, cell_families
        assert safe[0] in cell_families, cell_families
        d1 = dom_gate(pg)
        assert int(d1['blocked']) == gate_expect_blocked, d1

        # ---------- waiver flow: blocked -> waived -> unblocked ----------
        g2 = call(pg, 'export_gate', {})
        assert len(g2['blocked']) == gate_expect_blocked and g2['clean'] is False, g2
        for row in g2['blocked']:
            w = call(pg, 'waiver_add', {'runId': row['runId'], 'reason': 'brand accepts the fallback for screen-only use'})
            assert w['ok'] is True, w
            assert w['waiver']['reason'] == 'brand accepts the fallback for screen-only use', w
            assert w['waiver']['signedBy'] == 'human', w['waiver']

        g3 = call(pg, 'export_gate', {})
        assert g3['blocked'] == [], g3['blocked']
        assert g3['clean'] is True and g3['exportEnabled'] is True, g3
        assert len(g3['waived']) == gate_expect_blocked, g3['waived']
        for w in g3['waived']:
            assert w['reason'] and w['waiverHash'] and w['signedAt'], w
            assert w['verdict'].startswith('proof:'), w
        d2 = dom_gate(pg)
        assert d2['disabled'] is False and d2['locked'] is False, d2
        assert d2['label'] == 'Export', d2

        # waivers persist in the list (and survive a re-audit)
        wl = call(pg, 'waiver_list', {})
        assert wl['count'] == gate_expect_blocked, wl
        assert wl['waivers'][0]['declaredFamily'], wl['waivers'][0]
        call(pg, 'run_audit', {})
        assert call(pg, 'waiver_list', {})['count'] == gate_expect_blocked
        assert call(pg, 'export_gate', {})['exportEnabled'] is True
        assert pg.evaluate("[...document.querySelectorAll('#waiver-list li')].length") == gate_expect_blocked

        # export now succeeds and stamps the certificate
        ex = call(pg, 'export_document', {})
        assert ex['ok'] is True, ex
        assert ex['certificate'].startswith('proof-of-typeface/'), ex
        assert 'ISSUED' in pg.evaluate("document.getElementById('gate-seal').textContent")
        assert call(pg, 'export_document', {})['ok'] is True

        # revoking a waiver re-blocks the gate, DOM included
        rev = call(pg, 'waiver_remove', {'runId': g3['waived'][0]['runId']})
        assert rev['ok'] is True and rev['gate']['blocked'] == 1, rev
        assert dom_gate(pg)['disabled'] is True
        assert call(pg, 'waiver_remove', {'runId': 'r1'}).get('ok') is False
        assert call(pg, 'waiver_add', {'runId': 'nosuch', 'reason': 'x'}).get('ok') is False

        # doc_edit re-audits the edited run through the proof origin
        de = call(pg, 'doc_edit', {'runId': 'r6', 'family': safe[0], 'text': 'Sphinx of black quartz, judge my vow; quick jigs vex the waltzing band.'})
        assert de['ok'] is True, de
        assert de['verdict']['proofOriginLabel'] == 'proof', de['verdict']
        assert de['verdict']['family'] == safe[0], de['verdict']
        assert pg.evaluate("document.querySelector('span[data-run=\"r6\"]').style.fontFamily").find(safe[0]) != -1

        # ---------- human path: click a run -> drawer -> waiver modal -> export enabled ----------
        call(pg, 'reset_document', {})
        assert call(pg, 'export_gate', {})['exportEnabled'] is False
        assert dom_gate(pg)['disabled'] is True
        assert call(pg, 'waiver_list', {})['count'] == 0

        # flags are painted in the DOM before any agent call
        painted = pg.evaluate("[...document.querySelectorAll('span[data-run].flagged')].map(e => e.getAttribute('data-run'))")
        assert len(painted) >= 2, painted

        flagged_span = pg.locator('span[data-run].flagged').first
        flagged_id = flagged_span.get_attribute('data-run')
        flagged_span.click()
        pg.wait_for_selector('#drawer-id:has-text("' + flagged_id + '")', timeout=5000)
        drawer = pg.inner_text('#drawer-body')
        declared = call(pg, 'doc_get', {})['runs']
        declared_family = next(r['family'] for r in declared if r['id'] == flagged_id)
        assert declared_family in drawer, (declared_family, drawer[:400])
        assert 'declared family' in drawer.lower()
        assert 'substituted' in drawer.lower()
        assert 'document.fonts.check' in drawer

        # waive through the modal
        pg.click('#btn-waive')
        pg.wait_for_selector('#modal:not([hidden])', timeout=5000)
        modal_text = pg.inner_text('#modal-run')
        assert declared_family in modal_text, modal_text
        pg.fill('#waiver-reason', 'checked side by side; acceptable for web')
        pg.click('#waiver-confirm')
        pg.wait_for_selector('#modal', state='hidden', timeout=5000)
        wl2 = call(pg, 'waiver_list', {})
        assert wl2['count'] == 1, wl2
        assert wl2['waivers'][0]['reason'] == 'checked side by side; acceptable for web', wl2
        assert wl2['waivers'][0]['runId'] == flagged_id, wl2

        # remaining flags: waive them via the gate button, then Export is clickable for real
        assert call(pg, 'export_gate', {})['exportEnabled'] is False
        pg.click('#btn-waive-all')
        pg.wait_for_function("!document.getElementById('btn-export').disabled", timeout=10000)
        assert pg.evaluate("document.getElementById('btn-export').textContent.trim()") == 'Export'
        pg.click('#btn-export')
        pg.wait_for_selector('#gate-seal:has-text("ISSUED")', timeout=5000)

        # declarative form tool fills the DOM and reports matches
        decl = pg.evaluate("window.__agent.call('doc_find', {query:'quartz'}).then(r => typeof r === 'string' ? r : JSON.stringify(r))")
        assert 'doc_find:' in decl and 'run' in decl, decl
        assert pg.input_value('#find-q') == 'quartz'
        assert pg.inner_text('#find-out') != ''

        # agent panel is wired through window.__agent (same path tests use)
        pg.select_option('#agent-tool', 'run_audit')
        pg.fill('#agent-input', '{}')
        pg.click('#btn-agent-run')
        pg.wait_for_function("document.getElementById('agent-out').textContent.includes('cross-origin')", timeout=15000)

        # proof iframe is the live proof origin, showing a certificate
        kid = next((f for f in pg.frames if f.url and f.url.startswith(PROOF)), None)
        assert kid is not None
        assert 'PROOF' in kid.inner_text('#cert')
        assert kid.evaluate('window.__calls.length') > 0

        assert not errors, errors
        b.close()
        print('PRODUCT-LOOP-SUITE OK')


if __name__ == '__main__':
    main()
