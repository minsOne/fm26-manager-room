#!/usr/bin/env python3
"""CI-only real-save Swift -> Rust -> HTTP integration check (not a browser/FM-runtime test)."""
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
import time
import urllib.error
import urllib.request
from pathlib import Path


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def poll(test, timeout: float = 90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            value = test()
            if value:
                return value
        except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError):
            pass
        time.sleep(.2)
    raise RuntimeError('integration_condition_not_reached')


def main() -> int:
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--save',type=Path,required=True)
    p.add_argument('--native-snapshot',type=Path,required=True)
    p.add_argument('--parser',type=Path,required=True)
    p.add_argument('--companion',type=Path,required=True)
    p.add_argument('--report',type=Path,required=True)
    args=p.parse_args()
    if sys.platform != 'darwin' or os.environ.get('GITHUB_ACTIONS') != 'true':
        p.error('run only on an isolated GitHub Actions macOS runner; never use a personal snapshot store')
    args.parser=args.parser.resolve(); args.companion=args.companion.resolve()
    protected={args.save.resolve(),args.native_snapshot.resolve(),args.parser,args.companion}
    if args.report.resolve() in protected:
        p.error('report must not overwrite an input or executable')
    report={'passed':False,'scope':'real_save_swift_rust_loopback_api',
            'browserTested':False,'runningFMTested':False,'userMacTested':False}
    process=None; destination=None; destination_owned=False
    try:
        expected=json.loads(args.native_snapshot.read_text())
        before=digest(args.save)
        destination=Path(subprocess.check_output([str(args.companion),'snapshot-path'],text=True,timeout=10).strip())
        if destination.exists():
            raise RuntimeError('refuse_to_replace_preexisting_snapshot')
        with tempfile.TemporaryDirectory(prefix='fm26-native-integration-',dir=os.environ['RUNNER_TEMP']) as root:
            root=Path(root); saves=root/'saves'; saves.mkdir()
            sample=saves/'public.fm'; shutil.copyfile(args.save,sample)
            with socket.socket() as s:
                s.bind(('127.0.0.1',0)); port=s.getsockname()[1]
            opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
            def get(path):
                with opener.open(f'http://127.0.0.1:{port}{path}',timeout=2) as response:
                    return json.loads(response.read(64*1024*1024))
            started=time.monotonic()
            with (root/'stdout.log').open('wb') as out,(root/'stderr.log').open('wb') as err:
                destination_owned=True
                process=subprocess.Popen([str(args.companion),'serve','--parser',str(args.parser),
                                          '--save',str(sample),'--save-dir',str(saves),'--port',str(port)],
                                         stdin=subprocess.DEVNULL,stdout=out,stderr=err)
                def ready():
                    if process.poll() is not None:
                        raise RuntimeError('companion_exited')
                    state=get('/api/parser')
                    if state.get('lastError'):
                        raise RuntimeError('initial_parser_failed')
                    return state if not state.get('parsing') and state.get('lastSuccessAt') else None
                state=poll(ready)
                actual=get('/api/snapshot')
                if actual != expected:
                    raise RuntimeError('http_snapshot_differs_from_native_output')
                if json.loads(destination.read_text()) != expected:
                    raise RuntimeError('published_file_differs_from_native_output')
                report.update(initialImportAndAPIMs=round((time.monotonic()-started)*1000,2),
                              parserReportedMs=state.get('lastDurationMilliseconds'),
                              players=len(actual['players']),fixtures=len(actual.get('fixtures',[])))
                # Corrupt the explicitly selected file in place. Pinned mode must ignore
                # neighboring saves, retain the last good snapshot, then recover when the
                # same selected path becomes valid again.
                good_bytes=destination.read_bytes()
                good_success=state.get('lastSuccessAt')
                sample.write_bytes(b'This is deliberately not an FM26 save.')
                failed=poll(lambda: get('/api/parser').get('lastError'))
                if not failed or destination.read_bytes()!=good_bytes or get('/api/snapshot')!=expected:
                    raise RuntimeError('failed_import_did_not_preserve_last_good_snapshot')

                shutil.copyfile(args.save,sample)
                def recovered():
                    current=get('/api/parser')
                    return current if (
                        not current.get('parsing')
                        and not current.get('lastError')
                        and current.get('lastSuccessAt')
                        and current.get('lastSuccessAt') != good_success
                    ) else None
                recovered_state=poll(recovered)
                if get('/api/snapshot')!=expected or destination.read_bytes()!=good_bytes:
                    raise RuntimeError('restored_pinned_save_did_not_recover')
                if digest(args.save)!=before or digest(sample)!=before:
                    raise RuntimeError('original_save_changed')
                report.update(
                    passed=True,sourceUnchanged=True,httpEqualsNative=True,
                    invalidSavePreservesSnapshot=True,pinnedSaveRecovery=True,
                    recoveryParserReportedMs=recovered_state.get('lastDurationMilliseconds')
                )
    except Exception as error:
        report.update(errorType=type(error).__name__,reason='integration_failed')
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=5)
        if destination_owned and destination is not None:
            destination.unlink(missing_ok=True)
        args.report.parent.mkdir(parents=True,exist_ok=True)
        args.report.write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2))
    return 0 if report['passed'] else 1

if __name__=='__main__': raise SystemExit(main())
