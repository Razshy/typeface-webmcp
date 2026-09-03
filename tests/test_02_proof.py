"""Proof of Typeface — the proof origin: two-tails detection, degenerate input, bridges really relay."""
from helpers import ABSENT, PRESENT_CANDIDATES, PROOF, boot, err_code, present_family, proof_frame
from testkit import browser, call, done, errors, new_page, ok, tools


def main():
    with browser() as b:
        pg = new_page(b)
        boot(pg)
        kid = proof_frame(pg)
        tools(pg, [PROOF])  # discover the proof tools so direct calls by name reach the frame

        # --- detection soundness -------------------------------------------------------------------
        absent = call(pg, 'glyph_hash', {'family': ABSENT})
        ok(absent['ok'] and absent['kind'] == 'absent' and absent['substituted'] and not absent['present'], 'a family that cannot exist is reported absent', absent)
        ok(absent['hashSerifTail'] != absent['hashMonoTail'], 'absent face: serif and monospace tails draw different pixels', absent)
        ok(absent['origin'] == PROOF and absent['originLabel'] == 'proof', 'direct proof result is labelled by the proof origin')
        fam = present_family(pg)
        present = call(pg, 'glyph_hash', {'family': fam})
        ok(present['kind'] == 'own-outlines' and present['hashSerifTail'] == present['hashMonoTail'], 'installed face %s draws identical pixels under both tails' % fam, present)
        probes = {f: call(pg, 'glyph_hash', {'family': f}) for f in PRESENT_CANDIDATES + [ABSENT, 'Poppins', 'Frutiger']}
        consistent = all(r['ok'] and r['substituted'] == (r['kind'] != 'own-outlines') and r['present'] == (r['hashSerifTail'] == r['hashMonoTail']) for r in probes.values())
        ok(consistent, 'for every probed family: substituted iff kind != own-outlines, present iff the two tails agree', {f: r['kind'] for f, r in probes.items()})
        sans = call(pg, 'glyph_hash', {'family': 'sans-serif'})
        ok(sans['ok'] and sans['present'] and not sans['substituted'], 'generic keyword sans-serif is present by definition', sans)
        generic_same = [f for f, r in probes.items() if r['ok'] and r['sameAsGeneric'] and r['kind'] == 'own-outlines']
        ok(all(probes[f]['substituted'] is False for f in generic_same), 'an installed face that IS the platform generic is not flagged (no false positive)', generic_same)
        cmp = call(pg, 'compare_faces', {'familyA': fam, 'familyB': ABSENT})
        ok(cmp['ok'] and cmp['identical'] is False and cmp['a']['present'] and not cmp['b']['present'], 'compare_faces: installed vs absent differ', cmp)
        same = call(pg, 'compare_faces', {'familyA': ABSENT, 'familyB': ABSENT + '-b'})
        ok(same['identical'] is True and same['verdict'].startswith('proof:indistinguishable'), 'two absent names collapse onto one fallback face', same)
        chk = call(pg, 'font_check', {'family': ABSENT})
        ok(chk['checkSaysAvailable'] is True and chk['contradiction'] is True, 'document.fonts.check answers true for an absent face and the pixels contradict it', chk)
        chk_ok = call(pg, 'font_check', {'family': fam})
        ok(chk_ok['contradiction'] is False and chk_ok['present'] is True, 'no contradiction for an installed face', chk_ok)

        # --- wrap metrics + export preview --------------------------------------------------------------
        text = 'Pack my box with five dozen liquor jugs, then ask the printer which face it packed, because the widths are neither.'
        wide = call(pg, 'wrap_metrics', {'text': text, 'family': fam, 'size': 16, 'columnPx': 300})
        narrow = call(pg, 'wrap_metrics', {'text': text, 'family': fam, 'size': 16, 'columnPx': 140})
        ok(wide['ok'] and narrow['declared']['lineCount'] > wide['declared']['lineCount'] >= 2, 'narrower column -> more lines', (wide['declared']['lineCount'], narrow['declared']['lineCount']))
        ok(all(l['rightEdge'] <= 300 for l in wide['declared']['lines'][1:]) and wide['declared']['medianRightEdge'] > 0, 'every wrapped line fits the column; median right edge reported')
        ok(narrow['declared']['fingerprint'] != wide['declared']['fingerprint'] and len(wide['declared']['fingerprint']) == 8, 'wrap fingerprint changes with the column')
        tracked = call(pg, 'wrap_metrics', {'text': text, 'family': fam, 'size': 16, 'columnPx': 300, 'letterSpacingPx': 3})
        ok(tracked['declared']['widthPx'] > wide['declared']['widthPx'], 'letterSpacingPx widens the measured line', (tracked['declared']['widthPx'], wide['declared']['widthPx']))
        ok(wide['substituteFamily'] in wide['substitute']['chain'] and wide['declaredPresent'] is True, 'substitute face is taken from the export chain')
        prev = call(pg, 'export_preview', {'family': 'Verdana'})
        ok(prev['ok'] and prev['modelledEmbed'] == prev['chain'][0] and prev['measuredAs'] in prev['chain'] and 'modelled' in prev['modelled'], 'export_preview: modelled chain, measured face', prev)
        first_present = next((p['family'] for p in prev['probed'] if p['present']), prev['chain'][-1])
        ok(prev['measuredAs'] == first_present, 'measuredAs is the first installed face of the chain', prev['probed'])

        # --- degenerate input -> structured errors, never throws --------------------------------------------
        cases = {
            'size 0': ({'family': fam, 'size': 0}, 'invalid_param'),
            'size string': ({'family': fam, 'size': 'abc'}, 'invalid_param'),
            'empty text': ({'family': fam, 'text': ''}, 'invalid_param'),
            'blank text': ({'family': fam, 'text': '   '}, 'invalid_param'),
            'missing family': ({}, 'invalid_param'),
            'family list': ({'family': 'Poppins, Georgia'}, 'invalid_param'),
            'quoted family': ({'family': 'Georgia"'}, 'invalid_param'),
            'unknown key': ({'family': fam, 'bogus': 1}, 'invalid_param'),
            'zero ink': ({'family': fam, 'text': '​'}, 'empty_result'),
        }
        got = {k: err_code(call(pg, 'glyph_hash', inp)) for k, (inp, _) in cases.items()}
        ok(all(got[k] == want for k, (_, want) in cases.items()), 'glyph_hash rejects degenerate input with structured codes', got)
        ok(err_code(call(pg, 'wrap_metrics', {'family': fam, 'columnPx': -10})) == 'invalid_param', 'wrap_metrics rejects a negative column')
        ok(err_code(call(pg, 'compare_faces', {'familyA': fam})) == 'invalid_param', 'compare_faces requires both families')
        ok(all(r['error']['hint'] for r in [call(pg, 'glyph_hash', {}), call(pg, 'font_check', {'family': ''})]), 'every error envelope carries a corrective hint')

        # --- bridges really relay to the proof origin ------------------------------------------------------
        calls_before = kid.evaluate('window.__calls.length')
        direct = call(pg, 'glyph_hash', {'family': fam, 'text': 'Quiet rivers run deep', 'size': 26})
        bridged = call(pg, 'proof_glyph_hash', {'family': fam, 'text': 'Quiet rivers run deep', 'size': 26})
        ok(bridged['bridgedTo'] == 'glyph_hash' and bridged['proofOrigin'] == PROOF and bridged['hashSerifTail'] == direct['hashSerifTail'], 'proof_glyph_hash bridge returns the proof origin\'s own hash and labels the origin', bridged)
        for name, inp in [('proof_wrap_metrics', {'family': fam, 'columnPx': 300}), ('proof_compare_faces', {'familyA': fam, 'familyB': ABSENT}), ('proof_font_check', {'family': ABSENT}), ('proof_export_preview', {'family': fam})]:
            r = call(pg, name, inp)
            ok(r['ok'] and r['bridgedTo'] == name[len('proof_'):] and r['proofOrigin'] == PROOF and r['verdict'].startswith('proof:'), name + ' relays and labels the origin', r.get('verdict'))
        ok(kid.evaluate('window.__calls.length') >= calls_before + 6, 'the proof frame logged the bridged calls in its own realm', kid.evaluate('window.__calls.length') - calls_before)
        ok(err_code(call(pg, 'proof_glyph_hash', {'family': ''})) == 'invalid_param', 'bridge passes the proof origin\'s error envelope through')
        ok('PROOF' in kid.inner_text('#cert') and kid.inner_text('#cert-stamp') in ('PROVEN', 'SUBSTITUTED'), 'the proof origin renders a live certificate for the last face it measured')
        ok(errors(pg) == [], 'no console or page errors', errors(pg))
    done('proof')


if __name__ == '__main__':
    main()
