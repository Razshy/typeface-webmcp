"""Proof of Typeface — the product loop: audit -> gate -> agent proposes, human signs -> swap/edit -> export."""
from helpers import ABSENT, PROOF, boot, dom_gate, err_code, present_family
from testkit import browser, call, done, errors, new_page, ok


def blocked_ids(pg):
    return [b['runId'] for b in call(pg, 'export_gate')['blocked']]


def main():
    with browser() as b:
        pg = new_page(b)
        boot(pg)

        # --- verdicts and the gate mirror the DOM ------------------------------------------------------------
        rl = call(pg, 'run_list')
        ok(rl['ok'] and rl['count'] == 9 and rl['measuredBy'] == PROOF, 'run_list: nine runs measured by the proof origin', rl)
        rows = {r['runId']: r for r in rl['runs']}
        absent = [r for r in rows.values() if r['kind'] == 'absent']
        ok(any(r['runId'] in ('r7', 'r8') for r in absent), 'the seeded absent faces (Poppins/Frutiger) are flagged as absent', [r['family'] for r in absent])
        thr = rl['wrapThresholdPct']
        expect = sorted(r['runId'] for r in rows.values() if r['kind'] != 'own-outlines' or (r['kind'] == 'own-outlines' and r['wrapDeltaPct'] is not None and abs(r['wrapDeltaPct']) > thr))
        g = call(pg, 'export_gate')
        ok(sorted(b['runId'] for b in g['blocked']) == expect and g['exportEnabled'] is False and g['unaudited'] == [], 'gate blocks exactly the substituted or over-threshold runs', (expect, [b['runId'] for b in g['blocked']]))
        ok(all(r['blockedBy'] == next(b['blockedBy'] for b in g['blocked'] if b['runId'] == r['runId']) for r in rows.values() if r['runId'] in expect), 'run_list.blockedBy agrees with export_gate')
        d = dom_gate(pg)
        ok(d['disabled'] and d['locked'] and d['label'] == 'Export (%d)' % len(expect) and d['blocked'] == str(len(expect)) and d['statFlagged'] == str(len(expect)), 'Export button, gate count and masthead mirror the blocked set', d)
        ok(sorted(d['flaggedSpans']) == expect and d['rows'] == 9, 'flagged runs are underlined in the document before any agent acts', d['flaggedSpans'])
        spill = call(pg, 'page_spill')
        dom_spill = pg.evaluate("(() => { const f = document.getElementById('spill-frame'); return f.scrollHeight - f.clientHeight; })()")
        ok(spill['spillPx'] == dom_spill and spill['spillPx'] > 0 and pg.inner_text('#stat-spill') == '%dpx' % spill['spillPx'], 'page_spill equals live DOM overflow of the fixed frame', (spill['spillPx'], dom_spill))
        ok(pg.evaluate("document.getElementById('spill-meter').getAttribute('aria-valuenow')") == str(spill['spillPct']), 'spill meter exposes its value to assistive tech')
        ex = call(pg, 'run_explain', {'runId': expect[0]})
        ok(ex['ok'] and ex['verdict']['proofOrigin'] == PROOF and ex['blockedBy'] and ex['reads'], 'run_explain gives the full proof-origin evidence for a blocked run', ex['reads'])
        ok(err_code(call(pg, 'run_explain', {'runId': 'r99'})) == 'not_found', 'run_explain unknown id -> not_found')
        ok(err_code(call(pg, 'export_document')) == 'rule_violation' and pg.inner_text('#gate-seal') == '', 'export_document refuses while blocked and stamps nothing')

        # --- an agent can only PROPOSE a waiver; a person must sign ---------------------------------------
        first = expect[0]
        prop = call(pg, 'waiver_propose', {'runId': first, 'reason': 'agent says fine'})
        ok(prop['ok'] and prop['status'] == 'proposed' and prop['waiver']['signedBy'] == 'agent' and prop['requiresHuman'], 'waiver_propose records an agent proposal', prop)
        d = dom_gate(pg)
        ok(first in blocked_ids(pg) and d['disabled'] and d['pending'] == '1' and d['waived'] == '0' and first in d['flaggedSpans'], 'the proposal changes nothing on the gate: still blocked, shown as pending', d)
        ok(err_code(call(pg, 'export_document')) == 'rule_violation', 'export still refused after an agent proposal')
        proven = next(r['runId'] for r in rows.values() if r['runId'] not in expect)
        ok(err_code(call(pg, 'waiver_propose', {'runId': proven, 'reason': 'x'})) == 'rule_violation', 'a proven run cannot be waived')
        ok(err_code(call(pg, 'waiver_propose', {'runId': first, 'reason': '   '})) == 'invalid_param', 'a blank reason is refused')
        ok(err_code(call(pg, 'waiver_propose', {'runId': 'nope', 'reason': 'x'})) == 'not_found', 'unknown run -> not_found')
        wl = call(pg, 'waiver_list')
        ok(wl['count'] == 1 and wl['effective'] == 0 and wl['pending'] == 1 and wl['waivers'][0]['effective'] is False, 'waiver_list shows the proposal as not effective', wl)
        pg.click('#waiver-list li.pending button:has-text("Countersign")')
        pg.wait_for_selector('#modal:not([hidden])', timeout=5000)
        ok(pg.input_value('#waiver-reason') == 'agent says fine' and 'Countersign' in pg.inner_text('#modal-title'), 'countersign opens the modal prefilled with the agent\'s reason')
        pg.fill('#waiver-reason', 'checked side by side; acceptable for web')
        pg.click('#waiver-confirm')
        pg.wait_for_selector('#modal', state='hidden', timeout=5000)
        g = call(pg, 'export_gate')
        w = next(x for x in g['waived'] if x['runId'] == first)
        ok(first not in [b['runId'] for b in g['blocked']] and w['signedBy'] == 'human' and w['proposedBy'] == 'agent' and w['reason'] == 'checked side by side; acceptable for web', 'a person countersigned: the waiver is human-signed and clears that run', w)
        d = dom_gate(pg)
        ok(d['waived'] == '1' and d['pending'] == '0' and d['statWaived'] == '1' and first in d['waivedSpans'], 'DOM shows one human waiver and no pending proposal', d)
        rem = call(pg, 'waiver_remove', {'runId': first})
        ok(rem['ok'] and first in blocked_ids(pg) and dom_gate(pg)['disabled'], 'waiver_remove re-blocks the run', rem)
        ok(err_code(call(pg, 'waiver_remove', {'runId': first})) == 'not_found', 'removing twice -> not_found')

        # --- the human path with no agent: click a run, read the drawer, waive, export ---------------------
        pg.click('#doc span[data-run="%s"]' % first)
        pg.wait_for_selector('#drawer-id:has-text("%s")' % first, timeout=5000)
        drawer = pg.inner_text('#drawer-body')
        ok(rows[first]['family'] in drawer and 'declared family' in drawer and 'document.fonts.check' in drawer and 'two-tails' in drawer, 'truth drawer shows declared family, fonts.check and the pixel test', drawer[:300])
        pg.click('#btn-waive')
        pg.wait_for_selector('#modal:not([hidden])', timeout=5000)
        ok(rows[first]['family'] in pg.inner_text('#modal-run'), 'modal names the run and its declared family')
        pg.keyboard.press('Escape')
        pg.wait_for_selector('#modal', state='hidden', timeout=5000)
        ok(pg.evaluate("document.activeElement && document.activeElement.id") == 'btn-waive', 'Escape closes the modal and returns focus to the opener')
        pg.click('#btn-waive-all')
        pg.wait_for_selector('#modal:not([hidden])', timeout=5000)
        pg.fill('#waiver-reason', 'reviewed on the proof sheet')
        pg.click('#waiver-confirm')
        pg.wait_for_function("!document.getElementById('btn-export').disabled", timeout=10000)
        d = dom_gate(pg)
        ok(d['label'] == 'Export' and d['seal'] == 'READY' and d['waived'] == str(len(expect)), 'waiving every blocked run as a person unlocks Export', d)
        pg.click('#btn-export')
        pg.wait_for_selector('#gate-seal:has-text("ISSUED")', timeout=5000)
        g = call(pg, 'export_gate')
        ok(g['exported'] and g['exported']['certificateId'].startswith('pot-'), 'clicking Export stamps a certificate the gate reports', g['exported'])
        ex = call(pg, 'export_document')
        ok(ex['ok'] and ex['certificateId'].startswith('pot-') and len(ex['waived']) == len(expect) and 'no PDF' in ex['simulated'], 'export_document succeeds once clean and says it is a stamp, not a PDF', ex)

        # --- the threshold belongs to the human ---------------------------------------------------------
        pg.fill('#threshold', '3')
        pg.dispatch_event('#threshold', 'change')
        g3 = call(pg, 'export_gate')
        expect3 = sorted(r['runId'] for r in rows.values() if r['kind'] != 'own-outlines' or (r['wrapDeltaPct'] is not None and abs(r['wrapDeltaPct']) > 3))
        shifted = [b['runId'] for b in g3['blocked'] if 'wrap-shift' in b['blockedBy']]
        ok(g3['wrapThresholdPct'] == 3 and sorted(b['runId'] for b in g3['blocked']) == sorted(set(expect3) - set(w['runId'] for w in g3['waived'])), 'lowering the threshold in the panel blocks over-threshold installed faces', (expect3, [b['runId'] for b in g3['blocked']]))
        ok(shifted and all(rows[r]['kind'] == 'own-outlines' for r in shifted), 'wrap-shift blocks only faces that are really installed (measured consequence)', shifted)
        ok(dom_gate(pg)['disabled'], 'Export locks again when the human tightens the contract')
        pg.fill('#threshold', '10')
        pg.dispatch_event('#threshold', 'change')
        ok(call(pg, 'export_gate')['wrapThresholdPct'] == 10, 'threshold restored')

        # --- substitute_safe: refuses unsafe targets, changes DOM + state + gate --------------------------------
        target = rows[first]['family']
        ok(err_code(call(pg, 'substitute_safe', {'oldFamily': target, 'newFamily': 'serif'})) == 'rule_violation', 'a bare generic keyword is refused as a substitute')
        refused = call(pg, 'substitute_safe', {'oldFamily': target, 'newFamily': ABSENT})
        ok(err_code(refused) == 'rule_violation' and refused['probes'][0]['kind'] == 'absent', 'an absent face is refused with the proof origin\'s probe', refused)
        ok(err_code(call(pg, 'substitute_safe', {'oldFamily': ABSENT, 'newFamily': 'Georgia'})) == 'not_found', 'unknown oldFamily -> not_found')
        safe = present_family(pg)
        sub = call(pg, 'substitute_safe', {'oldFamily': target, 'newFamily': safe})
        ok(sub['ok'] and sub['changedRuns'] and all(a['kind'] == 'own-outlines' for a in sub['after']) and sub['waiversCleared'] == sub['changedRuns'], 'swap to an installed face re-audits and drops the waivers on changed runs', sub)
        ok(target not in pg.evaluate("[...document.querySelectorAll('#audit-table [data-row] td:nth-child(2)')].map(td => td.textContent)") and safe in pg.evaluate("document.querySelector('#doc span[data-run=\"%s\"]').style.fontFamily" % first), 'the audit table and the document span now show the new family')
        ok(sub['gateBefore']['waived'] > sub['gateAfter']['waived'] and first not in blocked_ids(pg), 'the swapped run neither blocks nor needs its old waiver')

        # --- doc_edit and the human editor share one path --------------------------------------------------
        de = call(pg, 'doc_edit', {'runId': 'r6', 'text': 'Sphinx of black quartz, judge my vow; quick jigs vex the waltzing band.'})
        ok(de['ok'] and de['after']['text'].startswith('Sphinx of black quartz, judge my vow;') and de['verdict']['proofOrigin'] == PROOF, 'doc_edit changes text and re-audits via the proof origin', de)
        ok(pg.inner_text('#doc span[data-run="r6"]').startswith('Sphinx of black quartz, judge my vow;'), 'the edited text is on the page')
        ok(err_code(call(pg, 'doc_edit', {'runId': 'r6'})) == 'invalid_param', 'doc_edit with nothing to change -> invalid_param')
        ok(err_code(call(pg, 'doc_edit', {'runId': 'r6', 'family': 'a, b'})) == 'invalid_param', 'doc_edit refuses a family list')
        pg.click('#doc span[data-run="r9"]')
        pg.keyboard.press('Meta+A' if pg.evaluate('navigator.platform').startswith('Mac') else 'Control+A')
        pg.keyboard.type('Set in the faces it names · proofs on request')
        pg.keyboard.press('Enter')
        pg.wait_for_function("document.getElementById('agent-log').textContent.length >= 0 && window.__agent.call('doc_get', {}).then(r => JSON.parse(r).runs.find(x => x.id === 'r9').text === 'Set in the faces it names · proofs on request')", timeout=10000)
        ok(True, 'typing into a run and pressing Enter commits the text through the same edit path')
        pg.click('#doc span[data-run="r6"]')
        pg.wait_for_selector('#family-input', timeout=5000)
        pg.fill('#family-input', safe)
        pg.click('#drawer-body button:has-text("Apply family")')
        pg.wait_for_function("window.__agent.call('doc_get', {}).then(r => JSON.parse(r).runs.find(x => x.id === 'r6').family === '%s')" % safe, timeout=10000)
        ok(True, 'the drawer family picker changes the declared family for a person')

        # --- declarative form + reset -----------------------------------------------------------------------
        found = call(pg, 'doc_find', {'query': 'quartz'})
        ok(found['ok'] and 'r6' in found['matches'] and pg.input_value('#find-q') == 'quartz' and 'r6' in pg.inner_text('#find-out'), 'declarative doc_find fills the form, answers via respondWith and selects the hit', found)
        pg.fill('#find-q', 'vixens')
        pg.click('#find-form button[type=submit]')
        pg.wait_for_selector('#drawer-id:has-text("r8")', timeout=5000)
        ok('r8' in pg.inner_text('#find-out'), 'a person submitting the same form gets the same behaviour')
        rs = call(pg, 'reset_document')
        ok(rs['ok'] and rs['gate']['waived'] == 0 and blocked_ids(pg) == expect and dom_gate(pg)['disabled'] and pg.inner_text('#gate-seal') == '', 'reset_document restores the seed, drops waivers and certificate, re-blocks the gate', rs)
        ok(errors(pg) == [], 'no console or page errors', errors(pg))
    done('gate')


if __name__ == '__main__':
    main()
