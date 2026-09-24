import { test } from "node:test";
import assert from "node:assert/strict";
import { activeNav, routeNameOf, MORE_NAME } from "../lib/routes";

test("route names come from the table, never from Object.prototype", () => {
  assert.equal(routeNameOf("/constructor"), "explore");
  assert.equal(routeNameOf("/__proto__"), "explore");
  assert.equal(routeNameOf("/toString"), "explore");
  assert.equal(routeNameOf("/token/0xabc"), "token");
  assert.equal(routeNameOf("/docs"), "learn");
  assert.equal(routeNameOf("/api-docs"), "apiDocs");
  assert.equal(routeNameOf("/"), "home");
});

test("secondary routes light their top-level item", () => {
  assert.equal(activeNav("/token/0xabc"), "explore");
  assert.equal(activeNav("/profile/0xabc"), "explore");
  assert.equal(routeNameOf("/tx/0xabc"), "tx");
  assert.equal(activeNav("/tx/0xabc"), "portfolio");
  assert.equal(activeNav("/privacy"), MORE_NAME);
  assert.equal(activeNav("/risk"), MORE_NAME);
  assert.equal(activeNav("/create"), MORE_NAME);
  assert.equal(activeNav("/api-docs"), MORE_NAME);
});
