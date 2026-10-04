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
        career_env=dict(os.environ,FM26_MANAGER_ROOM_HOME=str(root/kind/'home'))
        subprocess.run([str(args.companion),'select-save',str(sample),'--new-career'],env=career_env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        with (root / kind / 'companion.log').open('wb') as log:
            started = time.monotonic()
            child = subprocess.Popen([
                str(args.companion), 'serve', '--parser', str(args.parser),
                '--save', str(sample), '--save-dir', str(saves), '--port', str(port),
                '--snapshot-file', str(destination),
            ], env=career_env, stdin=subprocess.DEVNULL, stdout=log, stderr=log)
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
                let checked = 0, datedRecords = 0, historyPlayerId = null;
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
                    const matches = source.playingTime.matches;
                    if (!Array.isArray(matches) || p.matchHistory.records.length!==matches.length) throw new Error('dated_history_count');
                    if (p.matchHistory.complete || p.matchHistory.minutesVerified) throw new Error('dated_history_overclaim');
                    for (let i=0; i<matches.length; i++) {
                        const a=matches[i],b=p.matchHistory.records[i];
                        if(a.date!==b.date || a.opponentTeamId!==b.opponentTeamId || a.competitionId!==b.competitionId
                           || b.minutes!==(a.minutesKnown && Number.isInteger(a.minutes) && a.minutes<=130?a.minutes:null)) throw new Error('dated_history_conversion');
                        datedRecords++;
                    }
                    if(matches.length && !historyPlayerId) historyPlayerId=p.id;
                }
                if(!datedRecords || !historyPlayerId) throw new Error('no_real_dated_history');
                return {players: normalized.players.length, namedFields: checked,datedRecords,historyPlayerId};
            }''', base)
            result['browserConvertedPlayers'] = conversion['players']
            result['browserNamedFieldChecks'] = conversion['namedFields']
            result['browserDatedRecordsChecked'] = conversion['datedRecords']
            for view in ['manager','squad','matchday','tactics','training','development','medical',
                         'recruitment','transfers','contracts','economy','reports','coach','settings']:
                page.locator(f'nav [data-view="{view}"]').click()
                text = page.locator('#content').inner_text()
                if any(word in text for word in ['NaN', 'undefined', 'Infinity']):
                    raise RuntimeError('invalid_room_render')
            result['roomsVisited'] = 14
            # Actual native snapshot -> normalized calendar -> unique review plans.
            rotation = page.evaluate('''async (base) => {
                const {normalizeRealSnapshot} = await import('./engine/realSnapshot.js');
                const {rotationReview} = await import('./engine/realRotation.js');
                const {historyWindow} = await import('./engine/realHistory.js');
                const raw = await (await fetch(base + '/api/snapshot')).json();
                const s = normalizeRealSnapshot(raw);
                const original = JSON.stringify(s);
                const plan = rotationReview(s, {mode:'balanced'});
                if (!plan.plans.length || plan.plans.length > 5) throw new Error('rotation_calendar');
                for (const p of plan.plans) {
                    const ids = p.review.lineup.filter(r=>r.player).map(r=>r.player.id);
                    if (new Set(ids).size !== ids.length) throw new Error('rotation_duplicate_player');
                    if (p.readyForFinalDecision || p.medicalMinuteCap !== null) throw new Error('rotation_unknown_promoted');
                    if (p.review.bench.players.some(r=>ids.includes(r.player.id))) throw new Error('rotation_bench_collision');
                    for(const item of p.observedWorkloads){
                        const window=historyWindow(item.player,s.gameDate,p.fixture.date);
                        if(window.status!=='review') continue;
                        const cutoff=Date.parse(p.fixture.date+'T00:00:00Z')-13*86400000;
                        const rows=item.player.matchHistory.records.filter(r=>Date.parse(r.date+'T00:00:00Z')>=cutoff && r.date<=p.fixture.date && r.date<=s.gameDate && r.minutes!==null);
                        const expected=rows.length?rows.reduce((n,r)=>n+r.minutes,0):null;
                        if(item.window.minutes!==expected || item.window.complete || item.window.minutesVerified) throw new Error('dated_rotation_window');
                    }
                }
                for (const row of plan.players) {
                    if (row.observedMinutes !== s.players.find(p=>p.id===row.player.id).minutes) throw new Error('rotation_observed_minutes');
                    if (row.plannedMinutes !== row.plannedStarts*90) throw new Error('rotation_reservation');
                }
                if (JSON.stringify(s)!==original) throw new Error('rotation_mutated_source');
                const selectedId = plan.plans.at(-1).fixture.id;
                if (rotationReview(s,{fixtureId:selectedId}).plans[0].fixture.id!==selectedId) throw new Error('rotation_selection');
                const {matchdayReview} = await import('./engine/realMatchday.js');
                const baseReview = matchdayReview(s,'4-2-3-1');
                const {bestVerifiedRoles} = await import('./engine/realRoleFit.js');
                const startingIds = new Set(baseReview.lineup.filter(r=>r.player).map(r=>r.player.id));
                const replacementFor = row => s.players.find(p=>!startingIds.has(p.id)
                    && p.availability?.injuryFree!==false && p.availability?.eligible!==false
                    && bestVerifiedRoles(p,row.slot.position,1)[0]?.score!=null);
                const locked = baseReview.lineup.find(r=>r.player && replacementFor(r));
                if (!locked) throw new Error('no_real_lock_candidate');
                const directives = new Map([[selectedId,{lockedStarters:{[locked.slot.id]:locked.player.id}}]]);
                const constrained = rotationReview(s,{fixtureId:selectedId,formation:'4-2-3-1',constraintsByFixture:directives});
                if (constrained.plans[0].review.lineup.find(r=>r.slot.id===locked.slot.id).player?.id!==locked.player.id) throw new Error('real_lock_ignored');
                directives.set(selectedId,{lockedStarters:{[locked.slot.id]:locked.player.id},restIds:[locked.player.id]});
                const conflict = rotationReview(s,{fixtureId:selectedId,formation:'4-2-3-1',constraintsByFixture:directives});
                if (conflict.status!=='conflict' || conflict.plans.length!==1 || conflict.plans[0].review.selectedCount!==0) throw new Error('real_conflict_not_gated');
                if (conflict.players.some(r=>r.plannedMinutes!==0)) throw new Error('real_conflict_reserved_minutes');
                const replacement = replacementFor(locked);
                directives.set(selectedId,{lockedStarters:{[locked.slot.id]:locked.player.id},minuteCaps:{[locked.player.id]:60},substitutions:{[locked.slot.id]:{minute:60,playerId:replacement.id}}});
                const timed = rotationReview(s,{fixtureId:selectedId,formation:'4-2-3-1',constraintsByFixture:directives});
                const timedReview = timed.plans[0].review;
                const change = timedReview.minutePlan.changes.find(c=>c.slot.id===locked.slot.id);
                if(timed.status!=='review' || !change || change.minute!==60 || change.incoming.id!==replacement.id) throw new Error('real_minute_plan');
                if(timed.players.find(p=>p.player.id===locked.player.id).reservations[0].minutes!==60 || timed.players.find(p=>p.player.id===replacement.id).reservations[0].minutes!==30) throw new Error('real_minute_reservations');
                if(!timedReview.bench.players.some(p=>p.player.id===replacement.id && p.plannedSubstitute)) throw new Error('real_sub_missing_bench');
                if(timedReview.readyForFinalDecision || change.incoming.fatigue!==s.players.find(p=>p.id===replacement.id).fatigue) throw new Error('real_minutes_promoted_unknown');
                if (JSON.stringify(s)!==original) throw new Error('directives_mutated_source');
                return {plans:plan.plans.length, selectedId,lockSlot:locked.slot.id,lockPlayerId:locked.player.id,subPlayerId:replacement.id};
            }''', base)
            result['realRotationPlans'] = rotation['plans']
            page.locator('nav [data-view="matchday"]').click()
            page.locator('#fixtureSelect').select_option(rotation['selectedId'])
            page.locator('#rotationModeSelect').select_option('protect')
            if page.locator('#fixtureSelect').input_value() != rotation['selectedId'] or page.locator('#rotationModeSelect').input_value() != 'protect':
                raise RuntimeError('rotation_controls_not_applied')
            page.get_by_role('heading', name='향후 최대 5경기 로테이션 · 계획 시나리오', exact=True).wait_for()
            result['realRotationSelectionChecked'] = True
            player = next(p for p in expected['players'] if p['id']==conversion['historyPlayerId'])
            page.locator('nav [data-view="tactics"]').click()
            page.locator('#formationSelect').select_option('4-2-3-1')
            page.locator(f'button[data-player="{player["id"]}"]').first.click()
            page.locator('#searchInput').fill(player['id'])
            if page.locator('#selectedPlayer h2').first.inner_text() != player['name']:
                raise RuntimeError('selected_player_name_mismatch')
            if '날짜별 경기 기록' not in page.locator('#selectedPlayer').inner_text() or '전체 출전량은 미확인' not in page.locator('#selectedPlayer').inner_text():
                raise RuntimeError('real_history_detail_missing')
            result['realDatedHistoryUIAndWindowsChecked'] = True
            page.locator('nav [data-view="matchday"]').click()
            page.locator(f'#lock-{rotation["lockSlot"]}').select_option(rotation['lockPlayerId'])
            page.locator('details[data-rest-controls] summary').click()
            page.locator(f'input[data-rest-player="{rotation["lockPlayerId"]}"]').check()
            page.get_by_role('heading', name='선택 충돌 · 배치 보류', exact=True).wait_for()
            page.locator(f'input[data-rest-player="{rotation["lockPlayerId"]}"]').uncheck()
            if page.get_by_role('heading', name='선택 충돌 · 배치 보류', exact=True).count():
                raise RuntimeError('real_conflict_not_resolved')
            result['realManagerConstraintsChecked'] = True
            page.locator('details[data-minute-controls] summary').click()
            cap=page.locator(f'input[data-minute-cap-player="{rotation["lockPlayerId"]}"]')
            cap.fill('60');cap.dispatch_event('change')
            page.locator(f'#sub-player-{rotation["lockSlot"]}').select_option(rotation['subPlayerId'])
            minute=page.locator(f'#sub-minute-{rotation["lockSlot"]}')
            minute.fill('60');minute.dispatch_event('change')
            if page.get_by_role('heading',name='선택 충돌 · 배치 보류',exact=True).count() or page.get_by_role('heading',name='교체 계획 보류',exact=True).count():
                raise RuntimeError('real_minute_ui_failed')
            minute.fill('70');minute.dispatch_event('change')
            page.get_by_role('heading',name='선택 충돌 · 배치 보류',exact=True).wait_for()
            minute.fill('60');minute.dispatch_event('change')
            result['realMinutePlansChecked'] = True
            for field in ('benchLimit','substitutionLimit'):
                rule=page.locator(f'input[data-match-rule="{field}"]')
                rule.fill('0');rule.dispatch_event('change')
                page.get_by_role('heading',name='선택 충돌 · 배치 보류',exact=True).wait_for()
                rule.fill('1');rule.dispatch_event('change')
                if page.get_by_role('heading',name='선택 충돌 · 배치 보류',exact=True).count():
                    raise RuntimeError('manual_rule_conflict_not_resolved')
            result['manualRuleLimitsChecked'] = True
            page.locator('nav [data-view="tactics"]').click()
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
            page.locator('nav [data-view="matchday"]').click()
            if page.locator('#fixtureSelect').input_value() != rotation['selectedId'] or page.locator('#rotationModeSelect').input_value() != 'protect':
                raise RuntimeError('rotation_state_lost_on_reimport')
            result['rotationReimportPreservesSelection'] = True
            if page.locator(f'#lock-{rotation["lockSlot"]}').input_value() != rotation['lockPlayerId']:
                raise RuntimeError('real_lock_lost_on_reimport')
            result['managerConstraintsReimportPreserved'] = True
            if page.locator(f'input[data-minute-cap-player="{rotation["lockPlayerId"]}"]').input_value()!='60' or page.locator(f'#sub-minute-{rotation["lockSlot"]}').input_value()!='60' or page.locator(f'#sub-player-{rotation["lockSlot"]}').input_value()!=rotation['subPlayerId']:
                raise RuntimeError('real_minutes_lost_on_reimport')
            result['minutePlansReimportPreserved'] = True
            if any(page.locator(f'input[data-match-rule="{field}"]').input_value()!='1' for field in ('benchLimit','substitutionLimit')):
                raise RuntimeError('manual_rules_lost_on_reimport')
            result['manualRulesReimportPreserved'] = True
            page.locator('nav [data-view="tactics"]').click()
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
            page.locator('nav [data-view="development"]').click()
            if '현재 관측 구간 1일' not in page.locator('#content').inner_text():
                raise RuntimeError('same_day_reimports_created_growth')
            page.reload();page.get_by_text('실제 세이브',exact=True).wait_for()
            page.locator('nav [data-view="development"]').click()
            if '현재 관측 구간 1일' not in page.locator('#content').inner_text():
                raise RuntimeError('local_observations_not_persisted')
            page.locator('nav [data-view="settings"]').click()
            page.locator('[data-new-observations]').click()
            if '현재 구간 1일' not in page.locator('#content').inner_text():
                raise RuntimeError('new_observation_baseline_failed')
            result['careerObservationsPersistedWithoutFalseGrowth'] = True

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
