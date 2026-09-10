import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The store reads its config from env at import time, so set it before importing.
const dir = mkdtempSync(join(tmpdir(), "radian-store-"));
process.env.SNAPSHOT_PATH = join(dir, "snap.json");
process.env.MAX_TRADES = "3";
const { store } = await import("../src/store.js");
type Trade = (typeof store.trades)[number];

const base = {
  block: "1", ts: 1000, token: "0xT0KEN" as never, curve: "0xCURVE" as never,
  side: "buy" as const, trader: "0xAbC" as never, quote: "1", tokens: "2",
};

test("a legacy row (no logIndex) is upgraded in place by the same event, never duplicated", () => {
  const legacy: Trade = { ...base, txHash: "0xAA" };
  const event: Trade = { ...base, txHash: "0xaa", logIndex: 7, block: "2", ts: 2000 };
  const second: Trade = { ...base, txHash: "0xaa", logIndex: 9 };
  store.addTrade(legacy);
  store.addTrade(event); // upgrades the legacy row
  store.addTrade(second); // a different event in the same tx
  store.addTrade(event); // re-add ignored
  store.addTrade({ ...legacy }); // legacy re-add ignored (event row covers it)
  assert.equal(store.trades.length, 2);
  assert.deepEqual(store.trades.map((t) => t.logIndex), [7, 9]);
  assert.equal(store.trades[0].ts, 2000, "upgraded row takes the event's block/ts");
});

test("eviction drops the oldest by time once MAX_TRADES is exceeded", () => {
  store.addTrade({ ...base, txHash: "0xbb", logIndex: 1, ts: 500 }); // oldest → evicted
  store.addTrade({ ...base, txHash: "0xcc", logIndex: 1, ts: 3000 });
  assert.equal(store.trades.length, 3);
  assert.ok(!store.trades.some((t) => t.txHash === "0xbb"), "oldest-by-time row evicted");
  // an evicted row can be re-added (its key was released)
  store.addTrade({ ...base, txHash: "0xbb", logIndex: 1, ts: 4000 });
  assert.equal(store.trades.length, 3);
});

test("snapshot round-trips atomically and falls back to .bak when the live file is torn", () => {
  store.checkpoint = 123n;
  store.backfillFrom = 100n;
  store.backfillCursor = 50n;
  store.upsertLaunch({ token: "0xT0KEN" as never, curve: "0xCURVE" as never, deployer: "0xD" as never, graduationThreshold: "1" });
  store.save();
  const path = process.env.SNAPSHOT_PATH!;
  assert.ok(existsSync(path));
  assert.ok(!existsSync(path + ".tmp"), "tmp file renamed away");
  store.save(); // second save rotates the previous good copy to .bak
  assert.ok(existsSync(path + ".bak"));
  const good = readFileSync(path, "utf8");
  writeFileSync(path, good.slice(0, 20)); // torn write
  const fresh = new (Object.getPrototypeOf(store).constructor)();
  fresh.load();
  assert.equal(fresh.checkpoint, 123n, "loaded from .bak");
  assert.equal(fresh.backfillCursor, 50n);
  assert.equal(fresh.launches.size, 1);
  assert.equal(fresh.trades.length, store.trades.length);
  assert.ok(fresh.hasCurve("0xcurve"), "curve index rebuilt case-insensitively");
});
