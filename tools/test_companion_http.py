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

                def request(extra: str = "", *, host: str | None = None, split: bool = False, method: str = "GET", path: str = "/api/health", payload: bytes = b"") -> tuple[str, dict[str, str], bytes]:
                    wire = f"{method} {path} HTTP/1.1\r\nHost: {host or f'127.0.0.1:{port}'}\r\n{extra}\r\n".encode()
                    with socket.create_connection(("127.0.0.1", port), timeout=3) as conn:
                        if split:
                            conn.sendall(wire[:12]); time.sleep(0.05); conn.sendall(wire[12:])
                        else:
                            conn.sendall(wire)
                        if payload:
                            conn.sendall(payload[:1]); time.sleep(0.02); conn.sendall(payload[1:])
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
                _, _, body = request("Origin: https://minsone.github.io\r\n", path="/api/actions")
                capabilities = json.loads(body)
                assert capabilities["version"] == 1 and capabilities["coachSend"] is False
                token = capabilities["token"]
                status, headers, _ = request("Origin: https://minsone.github.io\r\nAccess-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: content-type, x-manager-room-token\r\nAccess-Control-Request-Private-Network: true\r\n", method="OPTIONS", path="/api/actions")
                assert "204" in status and "POST" in headers["Access-Control-Allow-Methods"]
                assert headers["Access-Control-Allow-Private-Network"] == "true"
                post_headers = f"Origin: https://minsone.github.io\r\nContent-Type: application/json\r\nContent-Length: 2\r\nX-Manager-Room-Token: {token}\r\n"
                assert "409" in request(post_headers, method="POST", path="/api/actions", payload=b"{}", split=True)[0]
                assert "403" in request(post_headers.replace(token, "invalid"), method="POST", path="/api/actions")[0]
                assert "403" in request(post_headers.replace("https://minsone.github.io", "https://evil.example"), method="POST", path="/api/actions")[0]
                assert "400" in request(post_headers.replace("Content-Length: 2", "Content-Length: 8193"), method="POST", path="/api/actions")[0]
                assert "400" in request(post_headers.replace("application/json", "text/plain"), method="POST", path="/api/actions")[0]
                callback_path="/auth/callback?state=invalid&code=private-callback-code"
                status, callback_headers, callback_body=request(path=callback_path)
                assert "400" in status and b"private-callback-code" not in callback_body
                assert callback_headers['Cache-Control']=='no-store' and callback_headers['Referrer-Policy']=='no-referrer'
                assert "Access-Control-Allow-Origin" not in callback_headers
                assert "403" in request("Origin: https://minsone.github.io\r\n",path=callback_path)[0]
                assert "403" in request(path=callback_path,host=f"localhost:{port}")[0]
                print("PASS HTTP fragmented headers/body, exact CORS/PNA, token-protected bounded JSON actions, hostile origin/Host and game-write rejection")
            finally:
                child.terminate()
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    child.kill(); child.wait()


if __name__ == "__main__":
    main()
