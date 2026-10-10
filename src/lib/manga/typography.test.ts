import { test } from "node:test";
import assert from "node:assert/strict";
import { smartEdit, smartType } from "./typography.ts";

test("ellipsis, dashes and curly quotes", () => {
  assert.equal(smartType('He said "hi"... wait -- no'), "He said “hi”… wait — no");
  assert.equal(smartType("'tis 'quoted'"), "‘tis ‘quoted’");
  assert.equal(smartType("a - b"), "a – b");
  assert.equal(smartType("plain text"), "plain text");
});

test("smartEdit keeps the caret at the end of the replaced prefix", () => {
  const r = smartEdit('say "yo" now', 8);
  assert.deepEqual(r, { text: "say “yo” now", caret: 8 });
  assert.equal(smartEdit("nothing", 3), null);
  const e = smartEdit("wait... go", 7);
  assert.deepEqual(e, { text: "wait… go", caret: 5 });
});
