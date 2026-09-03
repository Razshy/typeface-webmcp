"""Shared helpers for the Proof of Typeface tests (on top of kit/testkit.py)."""
from testkit import ORIGINS, call, frame, ok, open_page

PROOF = ORIGINS.get('proof', '')
PROOF_TOOLS = ['glyph_hash', 'wrap_metrics', 'compare_faces', 'font_check', 'export_preview']
BRIDGES = ['proof_' + n for n in PROOF_TOOLS]
MAIN_TOOLS = ['doc_get', 'run_list', 'run_audit', 'run_explain', 'family_report', 'substitute_safe', 'doc_edit',
              'waiver_propose', 'waiver_remove', 'waiver_list', 'export_gate', 'export_document', 'page_spill',
              'reset_document']
ABSENT = 'zz-no-such-face-test-1'
# Faces at least one of which is installed on any macOS / Windows / Linux-with-fonts host.
PRESENT_CANDIDATES = ['Georgia', 'Verdana', 'Times New Roman', 'Arial', 'Helvetica', 'Palatino', 'DejaVu Serif',
                      'Liberation Serif', 'Noto Serif', 'Courier New', 'Menlo', 'Consolas']


def boot(pg):
    """Open the main page and wait until the boot audit has run (tools + proof origin ready)."""
    open_page(pg, timeout=30000)
    pg.wait_for_function("document.getElementById('audit-status').textContent.includes('calls')", timeout=15000)
    return pg


def proof_frame(pg):
    return frame(pg, 'proof')


def dom_gate(pg):
    return pg.evaluate("""() => {
      const btn = document.getElementById('btn-export');
      return {disabled: btn.disabled, label: btn.textContent.trim(), locked: btn.classList.contains('locked'),
              blocked: document.getElementById('gate-blocked').textContent.trim(),
              waived: document.getElementById('gate-waived').textContent.trim(),
              pending: document.getElementById('gate-pending').textContent.trim(),
              statFlagged: document.getElementById('stat-flagged').textContent.trim(),
              statWaived: document.getElementById('stat-waived').textContent.trim(),
              seal: document.getElementById('gate-seal').textContent.trim(),
              flaggedSpans: [...document.querySelectorAll('#doc span[data-run].flagged')].map(e => e.dataset.run),
              waivedSpans: [...document.querySelectorAll('#doc span[data-run].waived')].map(e => e.dataset.run),
              rows: document.querySelectorAll('#audit-table [data-row]').length};
    }""")


def err_code(res):
    """The error code of a structured failure envelope, or None."""
    return res.get('error', {}).get('code') if isinstance(res, dict) and res.get('ok') is False else None


def present_family(pg):
    """A family that the proof origin proves is installed on this host."""
    for fam in PRESENT_CANDIDATES:
        r = call(pg, 'proof_glyph_hash', {'family': fam})
        if r.get('ok') and r.get('kind') == 'own-outlines':
            return fam
    ok(False, 'no installed candidate face found on this host', PRESENT_CANDIDATES)
    return None
