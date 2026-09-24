import { test } from "node:test";
import assert from "node:assert/strict";
import { PRIVACY, RISK, TERMS } from "../lib/content/legal";

// Every legal document has a title, an intro, real sections with real paragraphs, and the
// same number of sections in both languages, so a translation cannot silently lose one.
for (const [name, doc] of Object.entries({ TERMS, PRIVACY, RISK })) {
  test(`${name}: both languages complete and parallel`, () => {
    for (const lang of ["en", "zh"] as const) {
      const d = doc[lang];
      assert.ok(d.title.length >= 2, `${lang} title`);
      assert.ok(d.intro.length > 20, `${lang} intro`);
      assert.ok(d.sections.length >= 3, `${lang} sections`);
      for (const s of d.sections) {
        assert.ok(s.h.length > 1, `${lang} heading`);
        assert.ok(s.p.length >= 1, `${lang} ${s.h}: paragraphs`);
        for (const p of s.p) assert.ok(p.length > 20, `${lang} ${s.h}: paragraph too short`);
      }
    }
    assert.equal(doc.zh.sections.length, doc.en.sections.length, "same section count");
  });
}
