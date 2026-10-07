import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const reuse = require("../lib/reuse.js");

const BEFORE = "When is the last time you set aside delivery work to look at the bigger picture?";
const AFTER = "When did you last set aside delivery work to look at the bigger picture?";

function teach(id, sentence) {
  return JSON.stringify({
    id: id,
    slug: "invent-and-simplify",
    deepen: ["Other question?", sentence, "Third question?"],
  });
}

const index = {
  companies: [
    {
      id: "amazon",
      principles: [{ id: 1003, slug: "invent-and-simplify" }],
    },
    {
      id: "generic",
      principles: [{ id: 8006, slug: "invent-and-simplify" }],
    },
  ],
};

const maps = [{
  source: "generic",
  target: "amazon",
  pairs: [{ sourceSlug: "invent-and-simplify", targetIds: [1003] }],
}];

function filesFor(genericSentence) {
  return {
    "principles:data/teaching/amazon/invent-and-simplify.json": teach(1003, BEFORE),
    "principles:data/teaching/generic/invent-and-simplify.json": teach(8006, genericSentence),
  };
}

const edit = {
  repo: "principles",
  file: "data/teaching/amazon/invent-and-simplify.json",
  path: ["deepen", 1],
  before: BEFORE,
  after: AFTER,
  label: BEFORE,
  field: "Concrete question",
  company: "amazon",
  companyName: "Amazon",
  principleName: "Invent and Simplify",
};

test("a shared concrete question is copied onto the reused teaching file", () => {
  const result = reuse.expand([edit], index, maps, filesFor(BEFORE));
  assert.equal(result.ok, true);
  assert.equal(result.changes.length, 2);
  const copy = result.changes[1];
  assert.equal(copy.file, "data/teaching/generic/invent-and-simplify.json");
  assert.equal(copy.company, "generic");
  assert.equal(copy.before, BEFORE);
  assert.equal(copy.after, AFTER);
  assert.deepEqual(copy.path, ["deepen", 1]);
});

test("an allowlisted difference is not overwritten", () => {
  const result = reuse.expand([edit], index, maps, filesFor("A different allowed sentence?"));
  assert.equal(result.ok, false);
  assert.match(result.error, /already differs/);
});

test("a facet row edit does not ask for derivation maps", () => {
  assert.equal(reuse.needsMaps([{ repo: "principles", file: "data/facets.json" }]), false);
  assert.equal(reuse.needsMaps([edit]), true);
});

test("two agreeing edits of the same reused field stay as the caller sent them", () => {
  const generic = Object.assign({}, edit, {
    file: "data/teaching/generic/invent-and-simplify.json",
    company: "generic",
  });
  const result = reuse.expand([edit, generic], index, maps, filesFor(BEFORE));
  assert.equal(result.ok, true);
  assert.equal(result.changes.length, 2);
});
