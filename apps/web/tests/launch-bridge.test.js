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

import {statusHTML} from "../previewView.js";
test("connected status shows backend pin and sync without inventing missing metadata", () => {
  const html = statusHTML({status:"current",parser:{selectionMode:"pinned",selectedSavePath:"/save/Career <x>.fm",lastSuccessAt:"2026-10-03T16:00:00Z"}});
  assert.match(html, /Connected/);
  assert.match(html, /Pinned Save: Career &lt;x&gt;.fm/);
  assert.match(html, /Last Sync: 2026-10-03T16:00:00Z/);
  const unknown = statusHTML({status:"stale",parser:{selectionMode:"latest-directory"}});
  assert.match(unknown, /Connection needs review/);
  assert.match(unknown, /Pinned Save: <span class="unknown">미확인/);
});
