import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const insert = require("../lib/insert.js");

const TOKEN = "{lp:ownership}";

function at(text, start, end) {
  return insert.insertToken(text, { start: start, end: end == null ? start : end }, TOKEN);
}

function dedent(source) {
  const lines = source.replace(/^\n/, "").replace(/\s+$/, "").split("\n");
  const widths = lines.filter((line) => line.trim()).map((line) => line.match(/^ */)[0].length);
  const n = Math.min.apply(null, widths);
  return lines.map((line) => (line.trim() ? line.slice(n) : "")).join("\n");
}

test("a token in the middle of a word gets a space on each side", () => {
  const got = at("helloworld", 5);
  assert.equal(got.text, "hello {lp:ownership} world");
  assert.equal(got.caret, "hello ".length + TOKEN.length);
});

test("a selection is replaced", () => {
  const got = at("hello WORLDthere", 6, 11);
  assert.equal(got.text, "hello {lp:ownership} there");
  assert.equal(got.caret, "hello ".length + TOKEN.length);
  const spaced = at("say hello now", 4, 9);
  assert.equal(spaced.text, "say {lp:ownership} now");
  assert.equal(spaced.caret, "say ".length + TOKEN.length);
});

test("a caret at the start keeps the following text", () => {
  const got = at("hello", 0);
  assert.equal(got.text, "{lp:ownership} hello");
  assert.equal(got.caret, TOKEN.length);
});

test("a caret at the end appends the token", () => {
  const got = at("hello", 5);
  assert.equal(got.text, "hello {lp:ownership}");
  assert.equal(got.caret, got.text.length);
});

test("no focus history appends, including an empty field", () => {
  const got = insert.insertToken("hello", null, TOKEN);
  assert.equal(got.text, "hello {lp:ownership}");
  assert.equal(got.caret, got.text.length);
  const empty = insert.insertToken("", null, TOKEN);
  assert.equal(empty.text, TOKEN);
  assert.equal(empty.caret, TOKEN.length);
  const untouched = at("", 0);
  assert.equal(untouched.text, TOKEN);
  assert.equal(untouched.caret, TOKEN.length);
});

test("a neighbor that is already whitespace does not gain another space", () => {
  assert.equal(at("hello ", 6).text, "hello {lp:ownership}");
  assert.equal(at(" hello", 0).text, "{lp:ownership} hello");
  assert.equal(at("hello\nworld", 5).text, "hello {lp:ownership}\nworld");
  assert.equal(at("hello  world", 6).text, "hello {lp:ownership} world");
  assert.equal(at("hello\tworld", 5).text, "hello {lp:ownership}\tworld");
});

function sliceBetween(source, startMark, endMark) {
  const at = source.indexOf(startMark);
  const lineStart = source.lastIndexOf("\n", at) + 1;
  const end = source.indexOf(endMark, at);
  return source.slice(lineStart, end);
}

test("a marked calibration list adds an authored row, and generic stays closed", () => {
  const page = fs.readFileSync(new URL("../js/facet.js", import.meta.url), "utf8");
  assert.match(page, /draft\.mode === "row" && existing\.length && existing\.every/);
  assert.match(page, /value\.words = "authored"/);
  assert.match(page, /if \(unpublished\(co\.id\)\) return;/);
});

test("the page uses the same insert helper", () => {
  const lib = fs.readFileSync(new URL("../lib/insert.js", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../js/facet.js", import.meta.url), "utf8");
  const body = dedent(sliceBetween(lib, "function isSpace", "module.exports"));
  const copied = dedent(sliceBetween(page, "function isSpace", "function rememberCaret"));
  assert.match(body, /function insertToken/);
  assert.equal(copied, body);
});
