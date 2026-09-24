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

test("treasury ledger rows dedupe by (txHash, logIndex) and survive a snapshot round-trip", () => {
  const row = { txHash: "0xFF", logIndex: 3, block: "9", ts: 9000, kind: "flush" as const, usdcIn: "10", radianBurned: "5", toStakers: "4" };
  assert.equal(store.addFlywheel(row), true);
  assert.equal(store.addFlywheel({ ...row, txHash: "0xff" }), false, "same event, case-insensitive hash");
  assert.equal(store.addFlywheel({ ...row, logIndex: 4, kind: "claim", amount: "1" }), true);
  assert.ok(store.hasFlywheelTx("0xff"));
  store.save();
  const fresh = new (Object.getPrototypeOf(store).constructor)();
  fresh.load();
  assert.equal(fresh.flywheel.length, 2);
  assert.equal(fresh.addFlywheel(row), false, "index rebuilt on load");
});

test("templates attach to known launches and auths persist across a snapshot", () => {
  assert.equal(store.setTemplate("0xnope", { kind: "pof", vault: "0xV" as never, pofRouter: "0xR" as never }), false);
  assert.equal(store.setTemplate("0xt0ken", { kind: "wall", treasury: "0xTR" as never, staking: "0xST" as never }), true);
  assert.equal(store.launches.get("0xt0ken")?.template?.kind, "wall");
  store.auths.set("0xauth", {
    authId: "0xauth", user: "0xU" as never, token: "0xT0KEN" as never,
    auth: { user: "0xU" as never, token: "0xT0KEN" as never, perBuyMax: "1", maxGasPrice: "1", totalCount: 2, minInterval: 60, deadline: 9999999999, nonce: "0" },
    signature: "0x00", createdAt: 1, count: 1, lastAt: 5, status: "active",
  });
  store.rescansDone.add("1-2");
  store.save();
  const fresh = new (Object.getPrototypeOf(store).constructor)();
  fresh.load();
  assert.equal(fresh.launches.get("0xt0ken")?.template?.kind, "wall");
  assert.equal(fresh.auths.get("0xauth")?.count, 1);
  assert.ok(fresh.rescansDone.has("1-2"));
});

test("wall entries and creator logos persist across a snapshot, keyed by lower-cased token", () => {
  store.wall.set("0xt0ken", [{ address: "0xAbC" as never, text: "diamond hands", time: 5000, balance: "10" }]);
  store.logos.set("0xt0ken", "https://img.example/abc.png");
  store.save();
  const fresh = new (Object.getPrototypeOf(store).constructor)();
  fresh.load();
  assert.deepEqual(fresh.wall.get("0xt0ken"), [{ address: "0xAbC", text: "diamond hands", time: 5000, balance: "10" }]);
  assert.equal(fresh.logos.get("0xt0ken"), "https://img.example/abc.png");
});

test("holder balances follow Transfer events once per event, and the index reset keeps signed data", () => {
  const T = "0xT0KEN";
  assert.equal(store.hasBalances(T), false);
  assert.ok(store.applyTransfer(T, "0x0000000000000000000000000000000000000000", "0xCURVE", 1000n, "0xh1:0"));
  assert.ok(store.applyTransfer(T, "0xCURVE", "0xAlice", 600n, "0xh2:0"));
  assert.ok(store.applyTransfer(T, "0xCURVE", "0xBob", 400n, "0xh2:1"));
  assert.equal(store.applyTransfer(T, "0xCURVE", "0xBob", 400n, "0xh2:1"), false, "same event applied once");
  assert.ok(store.applyTransfer(T, "0xBob", "0xAlice", 400n, "0xh3:0"));
  const ex = new Set(["0xcurve"]);
  assert.equal(store.holderCount(T, ex), 1, "bob is at zero, the curve is excluded");
  store.profiles.set("0xalice", { name: "Alice", bio: "", x: "alice", updatedAt: 1 });
  store.save();
  const fresh = new (Object.getPrototypeOf(store).constructor)();
  fresh.load();
  assert.equal(fresh.holderCount(T, ex), 1);
  assert.equal(fresh.applyTransfer(T, "0xBob", "0xAlice", 400n, "0xh3:0"), false, "transfer keys survive the snapshot");
  assert.equal(fresh.profiles.get("0xalice")?.name, "Alice");
  fresh.resetIndex();
  assert.equal(fresh.launches.size, 0);
  assert.equal(fresh.trades.length, 0);
  assert.equal(fresh.hasBalances(T), false);
  assert.equal(fresh.profiles.get("0xalice")?.name, "Alice", "profiles survive a reset");
  assert.ok(fresh.wall.get("0xt0ken")?.length, "wall survives a reset");
});
