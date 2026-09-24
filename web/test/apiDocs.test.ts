import { test } from "node:test";
import assert from "node:assert/strict";
import { ENDPOINTS, apiDocs, blockText, cacheLabel } from "../lib/content/apiDocs";
import { NETWORKS } from "../lib/networks";

const nets = Object.values(NETWORKS);

// The two languages are built from the same definitions, so they must be parallel: the same
// section ids in the same order, the same block kinds, identical code, tables of the same shape,
// and no empty prose on either side — on every network, since addresses and base URLs are filled in.
test("developer docs: both languages complete and parallel on every network", () => {
  for (const net of nets) {
    const en = apiDocs("en", net);
    const zh = apiDocs("zh", net);
    assert.ok(en.length >= 5, `${net.key}: sections`);
    assert.deepEqual(
      en.map((s) => s.id),
      zh.map((s) => s.id),
    );
    en.forEach((s, i) => {
      const z = zh[i];
      assert.ok(s.title.length > 1 && z.title.length > 0, `${net.key} ${s.id}: title`);
      assert.deepEqual(
        s.blocks.map((b) => b.kind),
        z.blocks.map((b) => b.kind),
        `${net.key} ${s.id}: block kinds`,
      );
      s.blocks.forEach((b, j) => {
        const zb = z.blocks[j];
        assert.ok(blockText(b).length > 10, `${net.key} en ${s.id}#${j + 1}: empty`);
        assert.ok(blockText(zb).length > 4, `${net.key} zh ${s.id}#${j + 1}: empty`);
        if (b.kind === "code" && zb.kind === "code") assert.equal(b.code, zb.code, `${s.id}#${j + 1}: code differs by language`);
        if (b.kind === "table" && zb.kind === "table") {
          assert.equal(b.head.length, zb.head.length, `${s.id}#${j + 1}: columns`);
          assert.equal(b.rows.length, zb.rows.length, `${s.id}#${j + 1}: rows`);
          for (const r of [...b.rows, ...zb.rows]) assert.equal(r.length, b.head.length, `${s.id}#${j + 1}: ragged row`);
        }
      });
    });
  }
});

test("the API table is the endpoint list: every endpoint once, in order, with method, cache and limits", () => {
  const api = apiDocs("en", NETWORKS.testnet).find((s) => s.id === "api");
  assert.ok(api, "api section");
  const table = api.blocks.find((b) => b.kind === "table");
  assert.ok(table && table.kind === "table", "api table");
  assert.equal(table.rows.length, ENDPOINTS.length);
  ENDPOINTS.forEach((e, i) => {
    assert.equal(table.rows[i][0], e.method);
    assert.equal(table.rows[i][1], e.path);
    assert.equal(table.rows[i][3], cacheLabel(e.cache, "en"));
    assert.ok(e.returns.en.length > 5 && e.returns.zh.length > 2, `${e.path}: returns`);
    assert.ok(e.limits.en.length > 0 && e.limits.zh.length > 0, `${e.path}: limits`);
  });
  assert.equal(new Set(ENDPOINTS.map((e) => `${e.method} ${e.path}`)).size, ENDPOINTS.length, "duplicate endpoint");
});

test("addresses come from the network config with a three-word fingerprint beside each live one", () => {
  const net = NETWORKS.robinhood;
  const addr = apiDocs("en", net).find((s) => s.id === "addresses");
  assert.ok(addr, "addresses section");
  const table = addr.blocks.find((b) => b.kind === "table");
  assert.ok(table && table.kind === "table");
  const factory = table.rows.find((r) => r[0] === "LaunchFactory");
  assert.ok(factory);
  assert.equal(factory[1], net.contracts.factory);
  assert.match(factory[2], /^[a-z]+-[a-z]+-[a-z]+$/);
  for (const r of table.rows) if (/^0x[0-9a-fA-F]{40}$/.test(r[1])) assert.match(r[2], /^[a-z]+-[a-z]+-[a-z]+$/, `${r[0]}: fingerprint`);
});
