import test from "node:test";
import assert from "node:assert/strict";
import {initialBridge, DEFAULT_BRIDGE} from "../engine/snapshotSession.js";

test("launch bridge selects custom loopback port over stale saved settings", () => {
  assert.equal(initialBridge("?bridge=http%3A%2F%2F127.0.0.1%3A18765", "http://localhost:8765"), "http://127.0.0.1:18765");
});
test("untrusted URL/storage never selects remote hosts or credentials", () => {
  for (const value of ["https://example.com", "http://127.0.0.1.evil.test", "http://user:pass@localhost:8765", "http://localhost:8765/api", "http://localhost:8765/?x=1"]) {
    assert.equal(initialBridge(`?bridge=${encodeURIComponent(value)}`, value), DEFAULT_BRIDGE);
  }
  assert.equal(initialBridge("?bridge=bad", "http://localhost:18765"), "http://localhost:18765");
});
