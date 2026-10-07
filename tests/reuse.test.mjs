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

test("a matching field is copied even when another field already differs", () => {
  const amazon = JSON.stringify({
    id: 1003,
    slug: "invent-and-simplify",
    deepen: [BEFORE, "If your customer is internal, how does their work reach the person who pays?"],
  });
  const generic = JSON.stringify({
    id: 8006,
    slug: "invent-and-simplify",
    deepen: [BEFORE, "If your customer is internal, how does their work reach the person it is for?"],
  });
  const result = reuse.expand([Object.assign({}, edit, { path: ["deepen", 0] })], index, maps, {
    "principles:data/teaching/amazon/invent-and-simplify.json": amazon,
    "principles:data/teaching/generic/invent-and-simplify.json": generic,
  });
  assert.equal(result.ok, true);
  assert.equal(result.changes.length, 2);
  assert.deepEqual(result.changes[1].path, ["deepen", 0]);
  assert.equal(result.changes[1].after, AFTER);
});

test("a slug rename is rewritten into the reused copy", () => {
  const amazonWhy = "Standards live in {lp:insist-on-the-highest-standards}.";
  const genericWhy = "Standards live in {lp:insist-on-high-standards}.";
  const edited = "High standards live in {lp:insist-on-the-highest-standards}.";
  const renamedIndex = {
    companies: [
      {
        id: "amazon",
        principles: [
          { id: 1007, slug: "insist-on-the-highest-standards" },
          { id: 1014, slug: "deliver-results" },
        ],
      },
      {
        id: "generic",
        principles: [
          { id: 8007, slug: "insist-on-high-standards" },
          { id: 8014, slug: "deliver-results" },
        ],
      },
    ],
  };
  const renamedMaps = [{
    source: "generic",
    target: "amazon",
    pairs: [
      { sourceSlug: "insist-on-high-standards", targetIds: [1007] },
      { sourceSlug: "deliver-results", targetIds: [1014] },
    ],
  }];
  const files = {
    "principles:data/teaching/amazon/deliver-results.json": JSON.stringify({
      id: 1014, slug: "deliver-results", why: amazonWhy,
    }),
    "principles:data/teaching/generic/deliver-results.json": JSON.stringify({
      id: 8014, slug: "deliver-results", why: genericWhy,
    }),
  };
  const change = Object.assign({}, edit, {
    file: "data/teaching/amazon/deliver-results.json",
    path: ["why"],
    before: amazonWhy,
    after: edited,
    company: "amazon",
  });
  const result = reuse.expand([change], renamedIndex, renamedMaps, files);
  assert.equal(result.ok, true);
  assert.equal(result.changes.length, 2);
  assert.equal(result.changes[1].file, "data/teaching/generic/deliver-results.json");
  assert.equal(result.changes[1].before, genericWhy);
  assert.equal(result.changes[1].after, "High standards live in {lp:insist-on-high-standards}.");
});

test("a slug rename does not hide a real wording difference", () => {
  const amazonWhy = "Standards live in {lp:insist-on-the-highest-standards}.";
  const renamedIndex = {
    companies: [
      {
        id: "amazon",
        principles: [
          { id: 1007, slug: "insist-on-the-highest-standards" },
          { id: 1014, slug: "deliver-results" },
        ],
      },
      {
        id: "generic",
        principles: [
          { id: 8007, slug: "insist-on-high-standards" },
          { id: 8014, slug: "deliver-results" },
        ],
      },
    ],
  };
  const renamedMaps = [{
    source: "generic",
    target: "amazon",
    pairs: [
      { sourceSlug: "insist-on-high-standards", targetIds: [1007] },
      { sourceSlug: "deliver-results", targetIds: [1014] },
    ],
  }];
  const files = {
    "principles:data/teaching/amazon/deliver-results.json": JSON.stringify({
      id: 1014, slug: "deliver-results", why: amazonWhy,
    }),
    "principles:data/teaching/generic/deliver-results.json": JSON.stringify({
      id: 8014, slug: "deliver-results", why: "A different sentence about delivery.",
    }),
  };
  const change = Object.assign({}, edit, {
    file: "data/teaching/amazon/deliver-results.json",
    path: ["why"],
    before: amazonWhy,
    after: "High standards live in {lp:insist-on-the-highest-standards}.",
    company: "amazon",
  });
  const result = reuse.expand([change], renamedIndex, renamedMaps, files);
  assert.equal(result.ok, false);
  assert.match(result.error, /already differs/);
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
