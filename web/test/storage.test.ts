import { test } from "node:test";
import assert from "node:assert/strict";
import { dismissStorageWarning, getStorageStatus, readLS, removeLS, writeLS } from "../lib/ui/storage";

// The module keeps its state for the life of the process, like a page load; these
// tests run in order and build on each other the way a session would.

test("without a storage object (the server) the helpers are quiet: null, false, nothing recorded", () => {
  assert.equal(typeof localStorage, "undefined");
  assert.equal(readLS("radian.x"), null);
  assert.equal(writeLS("radian.x", "1"), false);
  assert.equal(removeLS("radian.x"), false);
  assert.deepEqual(getStorageStatus(), { failed: false, keys: [] });
});

// A browser that refuses every access: a private window, a full quota, storage disabled.
const refusing = {
  getItem() {
    throw new DOMException("denied", "SecurityError");
  },
  setItem() {
    throw new DOMException("quota", "QuotaExceededError");
  },
  removeItem() {
    throw new DOMException("denied", "SecurityError");
  },
};

test("a refused write returns false and is recorded under its key; a refused read is just null", () => {
  Object.defineProperty(globalThis, "localStorage", { value: refusing, configurable: true, writable: true });
  assert.equal(readLS("radian.draft.v1"), null);
  assert.deepEqual(getStorageStatus(), { failed: false, keys: [] }, "reads do not raise the warning");
  assert.equal(writeLS("radian.draft.v1", "{}"), false);
  assert.deepEqual(getStorageStatus(), { failed: true, keys: ["radian.draft.v1"] });
  assert.equal(writeLS("radian.draft.v1", "{}"), false);
  assert.deepEqual(getStorageStatus().keys, ["radian.draft.v1"], "the same key again is recorded once");
});

test("dismissal hides the warning until the next failure of a new key", () => {
  const before = getStorageStatus();
  dismissStorageWarning();
  const after = getStorageStatus();
  assert.notEqual(after, before, "the snapshot changes identity so subscribers re-render");
  assert.equal(after.failed, false);
  assert.deepEqual(after.keys, ["radian.draft.v1"], "the keys stay on record");

  writeLS("radian.draft.v1", "{}");
  assert.equal(getStorageStatus().failed, false, "the same writer failing again is not news");

  assert.equal(removeLS("radian.hideAmounts"), false);
  assert.deepEqual(getStorageStatus(), { failed: true, keys: ["radian.draft.v1", "radian.hideAmounts"] });

  dismissStorageWarning();
  dismissStorageWarning();
  assert.equal(getStorageStatus().failed, false, "a second dismissal is a no-op");
});

test("a working storage object writes and reads through, and records nothing", () => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    configurable: true,
    writable: true,
  });
  const keysBefore = getStorageStatus().keys;
  assert.equal(writeLS("radian.lang", "zh"), true);
  assert.equal(readLS("radian.lang"), "zh");
  assert.equal(removeLS("radian.lang"), true);
  assert.equal(readLS("radian.lang"), null);
  assert.deepEqual(getStorageStatus().keys, keysBefore);
});
