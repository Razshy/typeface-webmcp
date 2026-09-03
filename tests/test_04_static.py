"""Proof of Typeface — single-folder static mode: `python3 -m http.server` from the app root, one origin."""
import os
import socket
import subprocess
import sys
import time
import urllib.request

from helpers import ABSENT, dom_gate, err_code
from testkit import browser, call, done, errors, new_page, ok, open_page, tools

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def main():
    port = free_port()
    server = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'], cwd=APP,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = 'http://127.0.0.1:%d' % port
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(base + '/kit/mc.js', timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        with browser() as b:
            pg = new_page(b)
            open_page(pg, base=base, timeout=30000)
            pg.wait_for_function("document.getElementById('audit-status').textContent.includes('calls')", timeout=15000)
            ok(pg.evaluate('window.MC.isMulti') is False, 'MC.isMulti is false under a plain static server')
            ok('single-folder' in pg.inner_text('#mode-line'), 'the page says it runs in single-folder mode')
            names = [t['name'] for t in tools(pg)]
            ok('run_audit' in names and 'proof_glyph_hash' in names and 'glyph_hash' in names, 'same-origin proof frame tools are listed next to the top-level ones', names)
            labels = pg.evaluate("[...document.querySelectorAll('#tool-list li')].map(li => li.querySelector('.t-name').textContent + '=' + li.querySelector('.t-orig').textContent)")
            ok('glyph_hash=proof frame (same-origin)' in labels and 'run_audit=top-level' in labels, 'panel labels tools by provenance, not by origin string', labels)
            audit = call(pg, 'run_audit')
            ok(audit['ok'] and 'single-folder' in audit['auditMode'] and audit['callsToProof'] >= 18, 'run_audit works through the same-origin proof frame', audit['auditMode'])
            g = call(pg, 'export_gate')
            d = dom_gate(pg)
            ok(g['blocked'] and d['disabled'] and d['blocked'] == str(len(g['blocked'])), 'gate blocks and mirrors the DOM in static mode', d)
            br = call(pg, 'proof_glyph_hash', {'family': ABSENT})
            ok(br['ok'] and br['bridgedTo'] == 'glyph_hash' and br['kind'] == 'absent' and br['proofWindowIsFrame'] is True, 'bridge relays to the frame (not to itself) in static mode', br)
            ok(err_code(call(pg, 'proof_glyph_hash', {'family': 'a, b'})) == 'invalid_param', 'error envelopes survive the same-origin relay')
            ok(errors(pg) == [], 'no console or page errors in static mode', errors(pg))
    finally:
        server.terminate()
        server.wait(timeout=10)
    done('static')


if __name__ == '__main__':
    main()
