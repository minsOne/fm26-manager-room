#!/usr/bin/env python3
"""Installed CLI lifecycle regression. --save uses actual Rust + public FM26 data.
No saved/player data is emitted into test reports. No interactive picker in CI.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request


def eventually(fn, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            result = fn()
            if result:
                return result
        except (OSError, ValueError):
            pass
        time.sleep(.1)
    raise AssertionError("Condition did not become true")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--binary", required=True)
    ap.add_argument("--save")
    args = ap.parse_args()
    binary = str(Path(args.binary).absolute())
    with tempfile.TemporaryDirectory(prefix="mr-lifecycle-") as temporary:
        root = Path(temporary)
        home = root / "Application Support 한글"
        env = dict(os.environ, FM26_MANAGER_ROOM_HOME=str(home))
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        common = ["--port", str(port)]
        def cli(*commands, ok=True):
            result = subprocess.run([binary, *commands], env=env, capture_output=True, text=True, timeout=160)
            assert (result.returncode == 0) == ok, (commands, result.returncode, result.stdout, result.stderr)
            return result.stdout
        def api(path):
            with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=2) as response:
                return json.load(response)
        def selected():
            return json.loads(cli("selection"))
        parser_args = []
        career = root / "Career 한국.fm"
        if args.save:
            shutil.copyfile(args.save, career)
        else:
            # Same validated shape as the existing portable parser fixtures.
            career.write_bytes(b"unchanged input")
            snapshot = {
                "schemaVersion": 2, "source": "rust-native", "saveName": "CLI Test", "dbVersion": "26.0.0+0",
                "gameDate": "2037-07-01", "manager": {"name": "Manager", "club": "Test FC", "clubUid": 123},
                "clubFinance": None, "fixtures": [], "coverage": {},
                "players": [{"id": "1", "name": "테스트", "age": 20, "nationality": "1", "primaryPosition": "GK",
                    "positions": ["GK"], "ca": 120, "pa": 180, "paKnown": True, "value": 1, "wage": 1,
                    "attributes": {}, "hidden": {}, "playingTime": {"agreed": "Squad Player", "recentMinutes": 0,
                    "startsLast5": 0, "minutesLast5": 0, "recentMinutesKnown": False},
                    "fitness": {"condition": 95, "matchSharpness": 90, "fatigue": 0, "fatigueKnown": False,
                    "injuryRisk": 0, "injuryRiskKnown": False}, "contract": {"weeklyWage": 1, "monthsRemaining": 24}}]}
            fixture = root / "payload.json"
            fixture.write_text(json.dumps(snapshot))
            fake = root / "fake-parser"
            # Paths are passed via the environment, not shell interpolation.
            fake.write_text('#!/bin/sh\nif [ "$(wc -c < "$2" | tr -d " ")" -lt 8 ]; then exit 9; fi\ncat "$MR_TEST_PAYLOAD"\n')
            fake.chmod(0o700)
            env["MR_TEST_PAYLOAD"] = str(fixture)
            parser_args = ["--parser", str(fake)]
        initial_hash = digest(career)
        try:
            cli("start", "--no-open", *common, *parser_args, ok=False)
            before = json.loads(cli("doctor", "--json", *common, *parser_args, ok=False))
            assert before["healthy"] is False and before.get("selectionId") is None
            pin = json.loads(cli("select-save", str(career)))
            assert pin["id"] == selected()["id"]
            bad = root / "empty.fm"
            bad.touch()
            cli("select-save", str(bad), ok=False)
            assert selected()["id"] == pin["id"]
            # Refuse a busy port, leave unrelated listener alive.
            with socket.socket() as occupied:
                occupied.bind(("127.0.0.1", port))
                occupied.listen()
                cli("start", "--no-open", *common, *parser_args, ok=False)
                assert occupied.fileno() >= 0
            launch = subprocess.Popen([binary, "start", "--no-open", *common, *parser_args],
                                      env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            eventually(lambda: (home / "service.json").exists())
            cli("start", "--no-open", *common, *parser_args, ok=False)
            out, err = launch.communicate(timeout=160)
            assert launch.returncode == 0, (out, err)
            service = json.loads((home / "service.json").read_text())
            assert api("/api/health")["instanceId"] == service["instanceID"]
            assert api("/api/parser")["selectionId"] == pin["id"]
            assert api("/api/snapshot")["players"]
            cli("start", "--no-open", *common, *parser_args)
            assert json.loads((home / "service.json").read_text()) == service
            cli("select-save", str(career), ok=False)
            cli("unpin-save", ok=False)
            last = api("/api/parser")["lastSuccessAt"]
            (root / "Newer unrelated.fm").write_bytes(b"unrelated neighboring save")
            time.sleep(2)
            assert api("/api/parser")["lastSuccessAt"] == last
            snapshot_hash = digest(home / "snapshot.json")
            report = json.loads(cli("doctor", "--deep", "--json", *common, *parser_args))
            assert report["healthy"] and report["deep"]["passed"] and report["deep"]["players"] > 0
            assert digest(home / "snapshot.json") == snapshot_hash
            # In-place save timestamp update is detected without changing game data.
            os.utime(career, None)
            eventually(lambda: api("/api/parser")["lastSuccessAt"] != last)
            assert digest(career) == initial_hash
            good_snapshot = digest(home / "snapshot.json")
            backup = root / "backup.fm"
            shutil.copyfile(career, backup)
            career.write_bytes(b"bad")
            eventually(lambda: api("/api/parser").get("lastError"), timeout=30)
            assert digest(home / "snapshot.json") == good_snapshot
            assert api("/api/snapshot")["players"]
            cli("doctor", "--json", *common, *parser_args, ok=False)
            cli("stop")
            assert not (home / "service.json").exists()
            cli("start", "--no-open", *common, *parser_args, ok=False)
            assert not (home / "service.json").exists()
            assert digest(home / "snapshot.json") == good_snapshot
            shutil.copyfile(backup, career)
            cli("stop")
            # Forged/stale PID must never terminate another process.
            sleeper = subprocess.Popen(["/bin/sleep", "30"])
            try:
                birth = subprocess.check_output(["/bin/ps", "-ww", "-p", str(sleeper.pid), "-o", "lstart="],
                                                text=True, env=dict(env, LC_ALL="C")).strip()
                forged = dict(service, pid=sleeper.pid, birth=birth)
                (home / "service.json").write_text(json.dumps(forged))
                cli("stop")
                assert sleeper.poll() is None
            finally:
                sleeper.terminate()
                sleeper.wait()
            cli("start", "--no-open", *common, *parser_args)
            cli("stop")
            assert digest(career) == initial_hash
            print("Installed lifecycle passed: select, doctor, background start, duplicate start, pinned watcher, stale snapshot, safe stop, restart; " + ("real public save" if args.save else "synthetic parser"))
        finally:
            cli("stop")


if __name__ == "__main__":
    main()
