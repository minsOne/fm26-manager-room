#!/usr/bin/env python3
"""Isolated CI: real .fm -> hardened Swift/Rust -> real HTTP -> browser.
No mocked Bridge, rewritten snapshot, public screenshot, or game writer is used.
Only sanitized counts/booleans/timings leave the private temporary directory.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def wait_for(check, label: str, timeout: float = 90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            result = check()
            if result:
                return result
        except (OSError, json.JSONDecodeError):
            pass
        time.sleep(.15)
    raise RuntimeError(label)

def stop(child):
    if child is None or child.poll() is not None:
        return
    child.terminate()
    try:
        child.wait(timeout=10)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=5)

def rewrite_same_file(destination: Path, source: Path | None = None):
    """Deliberate test mutation ONLY of the private copy; original fixture stays read-only."""
    before = destination.stat()
    with destination.open('r+b') as target:
        target.seek(0)
        if source:
            with source.open('rb') as original:
                shutil.copyfileobj(original, target)
        else:
            target.write(b'Deliberately invalid FM file for failure-retention test.')
        target.truncate()
        target.flush()
        os.fsync(target.fileno())
    mtime = max(time.time_ns(), before.st_mtime_ns + 2_000_000_000)
    os.utime(destination, ns=(mtime, mtime))
    if destination.stat().st_ino != before.st_ino:
        raise RuntimeError('test_did_not_preserve_input_inode')

def run_browser(kind, playwright, args, root, expected, original_digest):
    saves = root / kind / 'saves'
    saves.mkdir(parents=True)
    sample = saves / 'public.fm'
    shutil.copyfile(args.save, sample)
    destination = root / kind / 'snapshot.json'
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def get(path):
        with opener.open(base + path, timeout=3) as response:
            return json.loads(response.read(64 * 1024 * 1024))
    child = browser = None
    result = {'engine': kind, 'passed': False}
    console_error_count = []
    try:
        with (root / kind / 'companion.log').open('wb') as log:
            started = time.monotonic()
            child = subprocess.Popen([
                str(args.companion), 'serve', '--parser', str(args.parser),
                '--save', str(sample), '--save-dir', str(saves), '--port', str(port),
                '--snapshot-file', str(destination),
            ], stdin=subprocess.DEVNULL, stdout=log, stderr=log)
            def initial_ready():
                if child.poll() is not None:
                    raise RuntimeError('companion_exited')
                state = get('/api/parser')
                if state.get('lastError'):
                    raise RuntimeError('initial_parse_failed')
                return state if state.get('lastSuccessAt') and not state.get('parsing') else None
            initial = wait_for(initial_ready, 'initial_import_timeout')
            api = get('/api/snapshot')
            if api != expected or json.loads(destination.read_text()) != expected:
                raise RuntimeError('http_or_file_differs_from_native')
            result['initialImportAndAPIMs'] = round((time.monotonic() - started) * 1000, 2)
            result['parserReportedMs'] = initial.get('lastDurationMilliseconds')
            result['players'] = len(api['players'])
            result['fixtures'] = len(api.get('fixtures', []))
            browser = getattr(playwright, kind).launch(headless=True)
            context = browser.new_context(viewport={'width': 1440, 'height': 1000})
            context.add_init_script('localStorage.setItem("managerRoom.bridge", ' + json.dumps(base) + ');')
            page = context.new_page()
            page.on('pageerror', lambda _error: console_error_count.append(True))
            render_started = time.monotonic()
            page.goto('http://127.0.0.1:8080/index.html', wait_until='domcontentloaded')
            page.get_by_text('실제 세이브', exact=True).wait_for(timeout=30000)
            result['pageLoadAndInitialRenderMs'] = round((time.monotonic() - render_started) * 1000, 2)
            # The separate fmsave audit checks source semantics. This checks UI conversion.
            conversion = page.evaluate('''async (base) => {
                const {normalizeRealSnapshot} = await import('./engine/realSnapshot.js');
                const raw = await (await fetch(base + '/api/snapshot')).json();
                const normalized = normalizeRealSnapshot(raw);
                let checked = 0;
                for (const source of raw.players) {
                    const p = normalized.players.find(p => p.id === source.id);
                    if (!p || p.name !== source.name || p.ca !== source.ca) throw new Error('identity_parity');
                    if (p.pa !== (source.paKnown ? source.pa : null)) throw new Error('pa_parity');
                    for (const [name,value] of Object.entries(source.attributes)) {
                        if (p.attributes[name] !== value) throw new Error('attribute_parity');
                        checked++;
                    }
                    for (const [name,value] of Object.entries(source.hidden)) {
                        if (p.hidden[name] !== value) throw new Error('hidden_parity');
                        checked++;
                    }
                    if (p.fatigue !== null || p.injuryRisk !== null) throw new Error('unknown_promoted');
                }
                return {players: normalized.players.length, namedFields: checked};
            }''', base)
            result['browserConvertedPlayers'] = conversion['players']
            result['browserNamedFieldChecks'] = conversion['namedFields']
            for view in ['manager','squad','matchday','tactics','training','development','medical',
                         'recruitment','transfers','contracts','economy','reports','coach','settings']:
                page.locator(f'nav [data-view="{view}"]').click()
                text = page.locator('#content').inner_text()
                if any(word in text for word in ['NaN', 'undefined', 'Infinity']):
                    raise RuntimeError('invalid_room_render')
            result['roomsVisited'] = 14
            player = expected['players'][0]
            page.locator('nav [data-view="tactics"]').click()
            page.locator('#formationSelect').select_option('4-2-3-1')
            page.locator(f'button[data-player="{player["id"]}"]').first.click()
            page.locator('#searchInput').fill(player['id'])
            if page.locator('#selectedPlayer h2').first.inner_text() != player['name']:
                raise RuntimeError('selected_player_name_mismatch')
            good_bytes = destination.read_bytes()
            old_success = get('/api/parser')['lastSuccessAt']
            # Real filesystem change: existing inode rewritten, not a mocked new snapshot.
            rewrite_same_file(sample, args.save)
            def updated():
                state = get('/api/parser')
                return state if not state.get('parsing') and not state.get('lastError') and state.get('lastSuccessAt') != old_success else None
            wait_for(updated, 'watcher_did_not_reimport_same_file')
            page.locator('#refreshButton').click()
            page.wait_for_function('!document.querySelector("#refreshButton").disabled')
            if page.locator('#formationSelect').input_value() != '4-2-3-1' or page.locator('#searchInput').input_value() != player['id'] or page.locator('nav [aria-current="page"]').get_attribute('data-view') != 'tactics' or page.locator('#selectedPlayer h2').first.inner_text() != player['name']:
                raise RuntimeError('selection_lost_on_reimport')
            result['inPlaceReimportPreservesSelection'] = True
            # Corrupt only the private same file; the real parser must fail.
            rewrite_same_file(sample)
            wait_for(lambda: get('/api/parser').get('lastError'), 'invalid_import_not_reported')
            # No manual refresh: visible-tab polling must surface the failure.
            page.get_by_text('이전 정상 데이터 유지', exact=True).wait_for(timeout=30000)
            if destination.read_bytes() != good_bytes or get('/api/snapshot') != expected:
                raise RuntimeError('failure_replaced_last_good')
            if page.locator('#selectedPlayer h2').first.inner_text() != player['name']:
                raise RuntimeError('failure_lost_selected_player')
            result['automaticPollingShowsRealParserFailure'] = True
            result['invalidImportPreservesLastGood'] = True
            prior_success = get('/api/parser')['lastSuccessAt']
            rewrite_same_file(sample, args.save)
            def repaired():
                state = get('/api/parser')
                return state if state.get('lastSuccessAt') != prior_success and not state.get('parsing') and not state.get('lastError') else None
            wait_for(repaired, 'repair_not_imported')
            page.get_by_text('실제 세이브', exact=True).wait_for(timeout=30000)
            if page.locator('#formationSelect').input_value() != '4-2-3-1':
                raise RuntimeError('recovery_lost_formation')
            result['watcherAndBrowserRecover'] = True
            page.locator('nav [data-view="medical"]').click()
            if '판단 보류' not in page.locator('#content').inner_text():
                raise RuntimeError('unknown_medical_data_not_gated')
            page.locator('nav [data-view="manager"]').click()
            page.set_viewport_size({'width': 390, 'height': 844})
            if not page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'):
                raise RuntimeError('mobile_page_overflow')
            result['mobileLayoutChecked'] = True
            stop(child)
            page.get_by_text('이전 정상 데이터 유지', exact=True).wait_for(timeout=30000)
            if '데모' in page.locator('#syncStatus').inner_text():
                raise RuntimeError('disconnect_switched_to_demo')
            if digest(args.save) != original_digest or digest(sample) != original_digest:
                raise RuntimeError('protected_source_changed')
            if console_error_count:
                raise RuntimeError('javascript_exception')
            result.update(passed=True, sourceUnchanged=True, httpEqualsNative=True,
                          disconnectPreservesLastGood=True, javascriptErrors=0)
    finally:
        if browser:
            browser.close()
        stop(child)
    return result

def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--save', type=Path, required=True)
    cli.add_argument('--native-snapshot', type=Path, required=True)
    cli.add_argument('--parser', type=Path, required=True)
    cli.add_argument('--companion', type=Path, required=True)
    cli.add_argument('--report', type=Path, required=True)
    args = cli.parse_args()
    if sys.platform != 'darwin' or os.environ.get('GITHUB_ACTIONS') != 'true':
        cli.error('Run only on an isolated macOS GitHub Actions runner.')
    for key in ['save','native_snapshot','parser','companion','report']:
        setattr(args, key, getattr(args, key).resolve())
    if args.report in [args.save,args.native_snapshot,args.parser,args.companion]:
        cli.error('Report must not overwrite an input.')
    report = {'passed':False, 'scope':'real_save_hardened_companion_browser', 'engines':[],
              'mockedBridge':False, 'runningFMTested':False, 'SafariTested':False, 'userMacTested':False}
    server = None
    try:
        from playwright.sync_api import sync_playwright
        expected = json.loads(args.native_snapshot.read_text())
        if not expected.get('players') or not expected.get('fixtures'):
            raise RuntimeError('empty_real_fixture_not_a_valid_test')
        before = digest(args.save)
        server = ThreadingHTTPServer(('127.0.0.1',8080),partial(QuietHandler,directory=str(ROOT/'apps/web')))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        with tempfile.TemporaryDirectory(prefix='fm26-e2e-',dir=os.environ['RUNNER_TEMP']) as tmp:
            with sync_playwright() as playwright:
                for kind in ['chromium','webkit']:
                    report['activeEngine'] = kind
                    report['engines'].append(run_browser(kind,playwright,args,Path(tmp),expected,before))
        report.pop('activeEngine',None)
        report['passed'] = all(row['passed'] for row in report['engines']) and len(report['engines']) == 2
    except Exception as error:
        report['errorType'] = type(error).__name__
        report['reason'] = str(error) if isinstance(error, RuntimeError) and str(error).replace('_','').isalnum() else 'integration_failed'
    finally:
        if server:
            server.shutdown()
            server.server_close()
        args.report.parent.mkdir(parents=True,exist_ok=True)
        args.report.write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2))
    return 0 if report['passed'] else 1

if __name__ == '__main__':
    raise SystemExit(main())
