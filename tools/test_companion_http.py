#!/usr/bin/env python3
"""macOS-only socket smoke test; no FM process or real save is needed."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", type=Path, required=True)
    args = parser.parse_args()
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix="mr-http-") as tmp:
        with (Path(tmp) / "server.log").open("wb") as log:
            child = subprocess.Popen([
                str(args.binary.resolve()), "serve", "--port", str(port), "--no-watch", "--parser", "/missing/fm26-parser"
            ], stdout=log, stderr=log)
            try:
                deadline = time.monotonic() + 10
                while True:
                    if child.poll() is not None:
                        raise RuntimeError("Companion exited: " + (Path(tmp) / "server.log").read_text(errors="replace"))
                    try:
                        with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                            break
                    except OSError:
                        if time.monotonic() > deadline:
                            raise TimeoutError("Companion did not bind loopback")
                        time.sleep(0.05)

                def request(extra: str = "", *, host: str | None = None, split: bool = False, method: str = "GET") -> tuple[str, dict[str, str], bytes]:
                    wire = f"{method} /api/health HTTP/1.1\r\nHost: {host or f'127.0.0.1:{port}'}\r\n{extra}\r\n".encode()
                    with socket.create_connection(("127.0.0.1", port), timeout=3) as conn:
                        if split:
                            conn.sendall(wire[:12]); time.sleep(0.05); conn.sendall(wire[12:])
                        else:
                            conn.sendall(wire)
                        data = bytearray()
                        while block := conn.recv(65536):
                            data.extend(block)
                    header, body = bytes(data).split(b"\r\n\r\n", 1)
                    lines = header.decode().split("\r\n")
                    headers = dict(line.split(": ", 1) for line in lines[1:])
                    assert int(headers["Content-Length"]) == len(body)
                    return lines[0], headers, body

                status, headers, body = request("Origin: https://minsone.github.io\r\n", split=True)
                assert "200" in status and json.loads(body)["status"] == "ok"
                assert headers["Access-Control-Allow-Origin"] == "https://minsone.github.io"
                assert json.loads(body)["lastParseDurationMs"] is None

                pna_status, pna_headers, pna_body = request(
                    "Origin: https://minsone.github.io\r\n"
                    "Access-Control-Request-Method: GET\r\n"
                    "Access-Control-Request-Private-Network: true\r\n",
                    method="OPTIONS",
                )
                assert "204" in pna_status and pna_body == b""
                assert pna_headers["Access-Control-Allow-Origin"] == "https://minsone.github.io"
                assert pna_headers["Access-Control-Allow-Private-Network"] == "true"
                assert request("Origin: https://evil.example\r\n")[0].startswith("HTTP/1.1 403")
                assert request(host=f"attacker.example:{port}")[0].startswith("HTTP/1.1 403")
                assert request(method="POST")[0].startswith("HTTP/1.1 405")
                assert request("Origin: null\r\n")[0].startswith("HTTP/1.1 403")
                print("PASS HTTP fragmented headers, exact CORS/PNA, JSON nulls, hostile origin/Host and write rejection")
            finally:
                child.terminate()
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    child.kill(); child.wait()


if __name__ == "__main__":
    main()
