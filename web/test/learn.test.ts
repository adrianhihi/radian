import { test } from "node:test";
import assert from "node:assert/strict";
import { LEARN, fillText, learnDoc, learnVars, type LearnVar } from "../lib/content/learn";
import { PROTOCOL } from "../lib/protocol";
import { DICT, type TKey } from "../lib/i18n/dict";
import { setLang, t } from "../lib/i18n";
import { SYMBOL_MAX } from "../lib/draft";
import { POF_BOUNDS } from "../lib/templates";
import { EXECUTOR_FEE_BPS } from "../lib/executor";

// The Learn copy states every fee, share, length and duration as a {placeholder} that
// learnDoc()/learnVars() fill from lib/protocol.ts. These tests hold the contract from
// both ends: nothing typed into the copy, nothing left unfilled, nothing provided and unused.

const LANGS = ["en", "zh"] as const;
/** Placeholders the page fills at runtime (the search box), not protocol numbers. */
const RUNTIME = new Set(["q"]);
const PH = /\{([a-zA-Z0-9_]+)\}/g;
const vars = (s: string) => [...s.matchAll(PH)].map((m) => m[1]);
/** The learn.* dictionary keys the page renders through t(key, learnVars(lang)). */
const STEP_KEYS = (Object.keys(DICT.en) as TKey[]).filter((k) => k.startsWith("learn.step"));

/** Every string leaf of the copy with its path, so a failure names the sentence. */
function leaves(v: unknown, path = "", out: [string, string][] = []): [string, string][] {
  if (typeof v === "string") out.push([path, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => leaves(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) leaves(x, path ? `${path}.${k}` : k, out);
  return out;
}

test("the filled Learn copy carries no placeholder in either language", () => {
  for (const lang of LANGS) {
    const v = learnVars(lang);
    const left = leaves(learnDoc(lang)).flatMap(([p, s]) => vars(s).filter((k) => !RUNTIME.has(k)).map((k) => `${lang} ${p}: {${k}}`));
    setLang(lang);
    const steps = STEP_KEYS.flatMap((k) => vars(t(k, v)).map((ph) => `${lang} ${k}: {${ph}}`));
    assert.deepEqual([...left, ...steps], []);
    // the runtime placeholder survives the fill for the page to replace
    assert.ok(learnDoc(lang).detail.noMatch.includes("{q}"), `${lang} noMatch keeps {q}`);
  }
});

test("no percentage is typed into the raw copy; every one is a placeholder", () => {
  const typed: string[] = [];
  for (const lang of LANGS) {
    for (const [p, s] of leaves(LEARN[lang])) if (s.includes("%")) typed.push(`${lang} ${p}`);
    for (const k of STEP_KEYS) if (DICT[lang][k].includes("%")) typed.push(`${lang} ${k}`);
  }
  assert.deepEqual(typed, []);
});

test("each placeholder is the protocol constant, formatted once", () => {
  const pct = (bps: number) => `${bps / 100}%`; // independent of the formatter's rounding
  for (const lang of LANGS) {
    const v = learnVars(lang);
    assert.equal(v.fee, pct(PROTOCOL.tradeFeeBps));
    assert.equal(v.execFee, pct(PROTOCOL.executorFeeBps));
    assert.equal(v.ref, pct(PROTOCOL.referralBps));
    assert.equal(v.launcherRef, pct(PROTOCOL.launcherBps));
    assert.equal(v.burn, pct(PROTOCOL.burnShareBps));
    assert.equal(v.burnSlippage, pct(PROTOCOL.burnMaxSlippageBps));
    assert.equal(v.symbolMax, String(PROTOCOL.symbolMax));
  }
  const en = learnVars("en");
  const zh = learnVars("zh");
  assert.equal(en.supply, PROTOCOL.supply.toLocaleString("en-US"));
  assert.equal(en.supplyShort, `${PROTOCOL.supply / 1e9}B`);
  assert.equal(zh.supply, `${PROTOCOL.supply / 1e8} 亿`);
  assert.equal(zh.supplyShort, zh.supply);
  const day = 86400;
  assert.equal(en.vest, `${PROTOCOL.buybackVestSecs / (365 * day)} years`);
  assert.equal(zh.vest, `${PROTOCOL.buybackVestSecs / (365 * day)} 年`);
  assert.equal(en.wallStream, `${PROTOCOL.wallStreamSecs / day} days`);
  assert.equal(zh.wallStream, `${PROTOCOL.wallStreamSecs / day} 天`);
  assert.equal(en.refTtl, `${PROTOCOL.referralTagTtlSecs / day} days`);
  assert.equal(zh.refTtl, `${PROTOCOL.referralTagTtlSecs / day} 天`);
  assert.equal(en.pofRoundMin, `${PROTOCOL.pofRoundMinSecs / 60} minute`);
  assert.equal(zh.pofRoundMin, `${PROTOCOL.pofRoundMinSecs / 60} 分钟`);
  assert.equal(en.pofRoundMax, `${PROTOCOL.pofRoundMaxSecs / 3600} hours`);
  assert.equal(zh.pofRoundMax, `${PROTOCOL.pofRoundMaxSecs / 3600} 小时`);
  assert.equal(en.burnInterval, `${PROTOCOL.burnMinIntervalSecs / 3600} hours`);
  assert.equal(zh.burnInterval, `${PROTOCOL.burnMinIntervalSecs / 3600} 小时`);
  // the exact strings the copy shows today; a change here is a protocol change, not a typo
  assert.deepEqual(
    [en.fee, en.execFee, en.ref, en.launcherRef, en.burn, en.burnSlippage, en.burnInterval, en.vest, en.wallStream, en.pofRoundMin, en.pofRoundMax, en.refTtl, en.supply, en.supplyShort, en.symbolMax],
    ["1%", "0.5%", "5.55%", "5.55%", "70%", "5%", "24 hours", "5 years", "7 days", "1 minute", "24 hours", "30 days", "1,000,000,000", "1B", "10"],
  );
});

test("the filled copy is the raw copy with every placeholder replaced by its value", () => {
  for (const lang of LANGS) {
    const v = learnVars(lang) as Record<string, string>;
    const filled = new Map(leaves(learnDoc(lang)));
    for (const [p, raw] of leaves(LEARN[lang])) {
      assert.equal(filled.get(p), fillText(raw, v), `${lang} ${p}`);
      for (const k of vars(raw)) if (!RUNTIME.has(k)) assert.ok(filled.get(p)!.includes(v[k]), `${lang} ${p} shows ${k}=${v[k]}`);
    }
  }
});

test("the placeholders the copy uses and the fill map provides are the same set", () => {
  const used = new Set<string>();
  for (const lang of LANGS) {
    for (const [, s] of leaves(LEARN[lang])) for (const k of vars(s)) used.add(k);
    for (const k of STEP_KEYS) for (const ph of vars(DICT[lang][k])) used.add(ph);
  }
  for (const k of RUNTIME) used.delete(k);
  const provided = (Object.keys(learnVars("en")) as LearnVar[]).sort();
  assert.deepEqual([...used].sort(), provided);
  assert.deepEqual((Object.keys(learnVars("zh")) as LearnVar[]).sort(), provided);
});

test("both languages carry the same placeholders at the same place", () => {
  const en = new Map(leaves(LEARN.en));
  const zh = new Map(leaves(LEARN.zh));
  const bad: string[] = [];
  for (const [p, s] of en) {
    const z = zh.get(p);
    if (z == null) {
      bad.push(`zh missing ${p}`);
      continue;
    }
    const a = vars(s).sort().join(",");
    const b = vars(z).sort().join(",");
    if (a !== b) bad.push(`${p}: en {${a}} zh {${b}}`);
  }
  for (const p of zh.keys()) if (!en.has(p)) bad.push(`en missing ${p}`);
  assert.deepEqual(bad, []);
});

test("the mirrored constants agree with the modules that already carry them", () => {
  assert.equal(PROTOCOL.symbolMax, SYMBOL_MAX);
  assert.equal(PROTOCOL.pofRoundMinSecs, POF_BOUNDS.roundSecondsMin);
  assert.equal(PROTOCOL.pofRoundMaxSecs, POF_BOUNDS.roundSecondsMax);
  assert.equal(BigInt(PROTOCOL.executorFeeBps), EXECUTOR_FEE_BPS);
});
