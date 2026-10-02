#!/usr/bin/env python3
"""CI-only public HTTPS Pages -> local macOS Companion browser check.

This tests the real network boundary. It does not mock or route the localhost
request and it does not claim installed Safari coverage.
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
import time
import urllib.error
import urllib.request
from pathlib import Path


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def poll(check, timeout: float = 90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            value = check()
            if value:
                return value
        except (OSError, urllib.error.URLError, json.JSONDecodeError):
            pass
        time.sleep(0.2)
    raise RuntimeError("condition_not_reached")


def stop(process):
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save", type=Path, required=True)
    parser.add_argument("--parser", type=Path, required=True)
    parser.add_argument("--companion", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--page", default="https://minsone.github.io/fm26-manager-room/")
    args = parser.parse_args()

    if sys.platform != "darwin" or os.environ.get("GITHUB_ACTIONS") != "true":
        parser.error("Run only on an isolated GitHub Actions macOS runner.")

    for key in ("save", "parser", "companion", "report"):
        setattr(args, key, getattr(args, key).resolve())

    report = {
        "passed": False,
        "scope": "public_https_pages_to_loopback_companion",
        "page": args.page,
        "browser": "chromium",
        "mockedBridge": False,
        "installedSafariTested": False,
        "runningFMTested": False,
        "userMacTested": False,
    }
    process = None

    try:
        from playwright.sync_api import sync_playwright

        original_digest = digest(args.save)
        with tempfile.TemporaryDirectory(prefix="fm26-pages-loopback-", dir=os.environ["RUNNER_TEMP"]) as temp:
            root = Path(temp)
            saves = root / "saves"
            saves.mkdir()
            sample = saves / "public.fm"
            shutil.copyfile(args.save, sample)
            snapshot = root / "snapshot.json"

            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            bridge = f"http://127.0.0.1:{port}"

            with (root / "companion.log").open("wb") as log:
                process = subprocess.Popen(
                    [
                        str(args.companion),
                        "serve",
                        "--parser", str(args.parser),
                        "--save", str(sample),
                        "--port", str(port),
                        "--snapshot-file", str(snapshot),
                    ],
                    stdin=subprocess.DEVNULL,
                    stdout=log,
                    stderr=log,
                )

                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

                def parser_ready():
                    if process.poll() is not None:
                        raise RuntimeError("companion_exited")
                    with opener.open(f"{bridge}/api/parser", timeout=2) as response:
                        state = json.loads(response.read())
                    if state.get("lastError"):
                        raise RuntimeError("initial_parser_failed")
                    return state if state.get("lastSuccessAt") and not state.get("parsing") else None

                parser_state = poll(parser_ready)
                report["parserReportedMs"] = parser_state.get("lastDurationMilliseconds")

                with sync_playwright() as playwright:
                    browser = playwright.chromium.launch(headless=True)
                    context = browser.new_context()
                    context.add_init_script(
                        "localStorage.setItem('managerRoom.bridge', " + json.dumps(bridge) + ");"
                    )
                    page = context.new_page()
                    page_errors = []
                    failed_requests = []
                    page.on("pageerror", lambda error: page_errors.append(str(error)))
                    page.on(
                        "requestfailed",
                        lambda request: failed_requests.append(
                            {"url": request.url, "failure": request.failure}
                        ) if request.url.startswith(bridge) else None,
                    )

                    started = time.monotonic()
                    page.goto(args.page + "?loopback-ci=1", wait_until="domcontentloaded", timeout=60000)
                    page.get_by_text("실제 세이브", exact=True).wait_for(timeout=30000)
                    report["pageToRealDataMs"] = round((time.monotonic() - started) * 1000, 2)

                    status_text = page.locator("#syncStatus").inner_text()
                    if "데이터 연결 실패" in status_text or "이전 정상 데이터 유지" in status_text:
                        raise RuntimeError("public_page_did_not_reach_live_loopback")

                    direct = page.evaluate(
                        """async (base) => {
                            const response = await fetch(base + '/api/health', {
                                cache: 'no-store', credentials: 'omit', redirect: 'error'
                            });
                            return {status: response.status, body: await response.json()};
                        }""",
                        bridge,
                    )
                    if direct["status"] != 200 or direct["body"].get("status") != "ok":
                        raise RuntimeError("public_origin_direct_fetch_failed")

                    player_count = page.locator('#content button[data-player]').count()
                    if player_count <= 0:
                        page.locator('nav [data-view="squad"]').click()
                        player_count = page.locator('#content button[data-player]').count()
                    if player_count <= 0:
                        raise RuntimeError("no_players_rendered_from_public_page")

                    report.update(
                        renderedPlayerButtons=player_count,
                        directHealthFetch=True,
                        javascriptErrors=len(page_errors),
                        loopbackRequestFailures=len(failed_requests),
                    )
                    if page_errors or failed_requests:
                        raise RuntimeError("browser_reported_loopback_or_javascript_failure")

                    browser.close()

            if digest(args.save) != original_digest or digest(sample) != original_digest:
                raise RuntimeError("source_save_changed")
            report.update(passed=True, sourceUnchanged=True)

    except Exception as error:
        report["errorType"] = type(error).__name__
        text = str(error)
        report["reason"] = text if text.replace("_", "").isalnum() else "public_loopback_test_failed"
    finally:
        stop(process)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))

    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
