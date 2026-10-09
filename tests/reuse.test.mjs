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

test("a reused concrete question delete is copied onto every matching file", () => {
  const result = reuse.expand([Object.assign({}, edit, {
    op: "remove",
    path: ["deepen"],
    index: 1,
    before: BEFORE,
    after: undefined,
  })], index, maps, filesFor(BEFORE));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.changes.length, 2);
  assert.equal(result.changes[1].op, "remove");
  assert.equal(result.changes[1].file, "data/teaching/generic/invent-and-simplify.json");
  assert.equal(result.changes[1].before, BEFORE);
  assert.equal(result.changes[1].index, 1);
});

test("a reused teaching catalog entry keeps the other company's id", () => {
  const genericIndex = JSON.stringify({
    principles: [{ id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" }],
  });
  const amazonIndex = JSON.stringify({
    principles: [
      { id: 1001, slug: "customer-obsession", file: "customer-obsession.json" },
      { id: 1003, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
    ],
  });
  const texts = Object.assign(filesFor(BEFORE), {
    "principles:data/teaching/generic/index.json": genericIndex,
    "principles:data/teaching/amazon/index.json": amazonIndex,
  });
  const removed = reuse.expand([{
    op: "remove",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["principles"],
    index: 0,
    seq: 1,
    before: { id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
    label: "Invent and Simplify",
    field: "deleted",
    company: "generic",
  }], index, maps, texts);
  assert.equal(removed.ok, true, removed.error);
  const copy = removed.changes[1];
  assert.equal(copy.file, "data/teaching/amazon/index.json");
  assert.equal(copy.index, 1);
  assert.equal(copy.before.id, 1003);
  const added = reuse.expand([{
    op: "insert",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["principles"],
    index: 1,
    seq: 2,
    value: { id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
    label: "Invent and Simplify",
    field: "added",
    company: "generic",
  }], index, maps, {
    "principles:data/teaching/generic/index.json": JSON.stringify({ principles: [] }),
    "principles:data/teaching/amazon/index.json": JSON.stringify({ principles: [] }),
  });
  assert.equal(added.ok, true, added.error);
  assert.equal(added.changes[1].index, 0);
  assert.deepEqual(added.changes[1].value, { id: 1003, slug: "invent-and-simplify", file: "invent-and-simplify.json" });
});

test("a reused list edit is refused when any sibling entry already differs", () => {
  const amazon = JSON.stringify({ id: 1003, slug: "invent-and-simplify", deepen: ["A", "B", "C"] });
  const different = JSON.stringify({ id: 8006, slug: "invent-and-simplify", deepen: ["A", "DIFFERENT", "C"] });
  const matched = JSON.stringify({ id: 8006, slug: "invent-and-simplify", deepen: ["A", "B", "C"] });
  const files = {
    "principles:data/teaching/amazon/invent-and-simplify.json": amazon,
    "principles:data/teaching/generic/invent-and-simplify.json": different,
  };
  function run(op, extra, texts) {
    return reuse.expand([Object.assign({
      op: op,
      repo: "principles",
      file: "data/teaching/amazon/invent-and-simplify.json",
      path: ["deepen"],
      index: 0,
      seq: 1,
      company: "amazon",
    }, extra)], index, maps, texts || files);
  }
  const inserted = run("insert", { value: "New?" });
  assert.equal(inserted.ok, false);
  assert.match(inserted.error, /already differs/);
  const removed = run("remove", { before: "A" });
  assert.equal(removed.ok, false);
  assert.match(removed.error, /already differs/);
  const moved = run("move", { to: 2, before: "A" });
  assert.equal(moved.ok, false);
  assert.match(moved.error, /already differs/);
  const sameFiles = {
    "principles:data/teaching/amazon/invent-and-simplify.json": amazon,
    "principles:data/teaching/generic/invent-and-simplify.json": matched,
  };
  const copied = run("insert", { index: 1, value: "New?" }, sameFiles);
  assert.equal(copied.ok, true, copied.error);
  assert.equal(copied.changes[1].op, "insert");
  assert.equal(copied.changes[1].index, 1);
  assert.equal(copied.changes[1].value, "New?");
  const movedOk = run("move", { to: 2, before: "A" }, sameFiles);
  assert.equal(movedOk.ok, true, movedOk.error);
  assert.equal(movedOk.changes[1].op, "move");
  assert.equal(movedOk.changes[1].index, 0);
  assert.equal(movedOk.changes[1].to, 2);
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
  const translated = reuse.expand([{
    op: "insert",
    repo: "principles",
    file: "data/teaching/amazon/deliver-results.json",
    path: ["deepen"],
    index: 1,
    seq: 1,
    value: "New?",
    company: "amazon",
  }], renamedIndex, renamedMaps, {
    "principles:data/teaching/amazon/deliver-results.json": JSON.stringify({
      deepen: ["See {lp:insist-on-the-highest-standards}."],
    }),
    "principles:data/teaching/generic/deliver-results.json": JSON.stringify({
      deepen: ["See {lp:insist-on-high-standards}."],
    }),
  });
  assert.equal(translated.ok, true, translated.error);
  assert.equal(translated.changes[1].value, "New?");
});

test("a later caller copy is applied before the next edit of that list", () => {
  const first = {
    op: "insert",
    repo: "principles",
    file: "data/teaching/amazon/invent-and-simplify.json",
    path: ["deepen"],
    index: 0,
    seq: 1,
    value: "First?",
    company: "amazon",
  };
  const second = {
    op: "insert",
    repo: "principles",
    file: "data/teaching/amazon/invent-and-simplify.json",
    path: ["deepen"],
    index: 1,
    seq: 2,
    value: "Second?",
    company: "amazon",
  };
  const generic = {
    op: "insert",
    repo: "principles",
    file: "data/teaching/generic/invent-and-simplify.json",
    path: ["deepen"],
    index: 0,
    seq: 3,
    value: "First?",
    company: "generic",
  };
  const result = reuse.expand([first, second, generic], index, maps, filesFor(BEFORE));
  assert.equal(result.ok, true, result.error);
  const genericEdits = result.changes.filter((one) => one.file.indexOf("/generic/") !== -1);
  assert.equal(genericEdits.length, 2);
  assert.equal(genericEdits[0], generic);
  assert.equal(genericEdits[0].value, "First?");
  assert.equal(genericEdits[1].value, "Second?");
  assert.equal(genericEdits[1].index, 1);
  assert.ok(result.changes.indexOf(generic) < result.changes.indexOf(second));
  assert.ok(result.changes.indexOf(generic) < result.changes.indexOf(genericEdits[1]));
  const diverged = {
    "principles:data/teaching/amazon/invent-and-simplify.json": JSON.stringify({
      id: 1003,
      slug: "invent-and-simplify",
      deepen: ["A", "B", "C"],
    }),
    "principles:data/teaching/generic/invent-and-simplify.json": JSON.stringify({
      id: 8006,
      slug: "invent-and-simplify",
      deepen: ["A", "DIFFERENT", "C"],
    }),
  };
  const refused = reuse.expand([first, second, generic], index, maps, diverged);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /already differs/);
});

test("a later caller catalog copy is applied before the next catalog insert", () => {
  const both = {
    companies: [
      {
        id: "amazon",
        principles: [
          { id: 1001, slug: "customer-obsession" },
          { id: 1003, slug: "invent-and-simplify" },
        ],
      },
      {
        id: "generic",
        principles: [
          { id: 8001, slug: "customer-obsession" },
          { id: 8006, slug: "invent-and-simplify" },
        ],
      },
    ],
  };
  const files = {
    "principles:data/teaching/amazon/index.json": JSON.stringify({
      principles: [{ id: 1014, slug: "deliver-results", file: "deliver-results.json" }],
    }),
    "principles:data/teaching/generic/index.json": JSON.stringify({
      principles: [{ id: 8014, slug: "deliver-results", file: "deliver-results.json" }],
    }),
  };
  const first = {
    op: "insert",
    repo: "principles",
    file: "data/teaching/amazon/index.json",
    path: ["principles"],
    index: 0,
    seq: 1,
    value: { id: 1001, slug: "customer-obsession", file: "customer-obsession.json" },
    company: "amazon",
  };
  const second = {
    op: "insert",
    repo: "principles",
    file: "data/teaching/amazon/index.json",
    path: ["principles"],
    index: 0,
    seq: 2,
    value: { id: 1003, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
    company: "amazon",
  };
  const generic = {
    op: "insert",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["principles"],
    index: 0,
    seq: 3,
    value: { id: 8001, slug: "customer-obsession", file: "customer-obsession.json" },
    company: "generic",
  };
  const result = reuse.expand([first, second, generic], both, maps, files);
  assert.equal(result.ok, true, result.error);
  const genericEdits = result.changes.filter((one) => one.file.indexOf("/generic/") !== -1);
  assert.equal(genericEdits.length, 2);
  assert.equal(genericEdits[0], generic);
  assert.equal(genericEdits[0].value.slug, "customer-obsession");
  assert.equal(genericEdits[1].value.slug, "invent-and-simplify");
  assert.equal(genericEdits[1].value.id, 8006);
  assert.equal(genericEdits[1].index, 0);
  assert.ok(result.changes.indexOf(generic) < result.changes.indexOf(second));
  assert.ok(result.changes.indexOf(generic) < result.changes.indexOf(genericEdits[1]));
});

test("the same list edit is refused when the sibling list already differs", () => {
  const amazon = JSON.stringify({ id: 1003, slug: "invent-and-simplify", deepen: ["A", "B", "C"] });
  const different = JSON.stringify({ id: 8006, slug: "invent-and-simplify", deepen: ["A", "DIFFERENT", "C"] });
  const matched = JSON.stringify({ id: 8006, slug: "invent-and-simplify", deepen: ["A", "B", "C"] });
  function pair(op, extra) {
    return [
      Object.assign({
        op: op,
        repo: "principles",
        file: "data/teaching/amazon/invent-and-simplify.json",
        path: ["deepen"],
        index: 0,
        seq: 1,
        company: "amazon",
      }, extra),
      Object.assign({
        op: op,
        repo: "principles",
        file: "data/teaching/generic/invent-and-simplify.json",
        path: ["deepen"],
        index: 0,
        seq: 2,
        company: "generic",
      }, extra),
    ];
  }
  const files = {
    "principles:data/teaching/amazon/invent-and-simplify.json": amazon,
    "principles:data/teaching/generic/invent-and-simplify.json": different,
  };
  const inserted = reuse.expand(pair("insert", { value: "New?" }), index, maps, files);
  assert.equal(inserted.ok, false);
  assert.match(inserted.error, /already differs/);
  const removed = reuse.expand(pair("remove", { before: "A" }), index, maps, files);
  assert.equal(removed.ok, false);
  assert.match(removed.error, /already differs/);
  const moved = reuse.expand(pair("move", { to: 2, before: "A" }), index, maps, files);
  assert.equal(moved.ok, false);
  assert.match(moved.error, /already differs/);
  const same = {
    "principles:data/teaching/amazon/invent-and-simplify.json": amazon,
    "principles:data/teaching/generic/invent-and-simplify.json": matched,
  };
  const copied = reuse.expand(pair("insert", { index: 1, value: "New?" }), index, maps, same);
  assert.equal(copied.ok, true, copied.error);
  assert.equal(copied.changes.length, 2);
});

test("a reused list that already differs is refused", () => {
  const result = reuse.expand([Object.assign({}, edit, {
    op: "remove",
    path: ["deepen"],
    index: 1,
    before: BEFORE,
  })], index, maps, filesFor("A different question?"));
  assert.equal(result.ok, false);
  assert.match(result.error, /already differs/);
});

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

test("a related note selected by slug is found under the destination slug", () => {
  const amazonNote = "See {lp:insist-on-the-highest-standards}.";
  const genericNote = "See {lp:insist-on-high-standards}.";
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
      related: [{ id: "insist-on-the-highest-standards", note: amazonNote }],
    }),
    "principles:data/teaching/generic/deliver-results.json": JSON.stringify({
      related: [{ id: "insist-on-high-standards", note: genericNote }],
    }),
  };
  const change = Object.assign({}, edit, {
    file: "data/teaching/amazon/deliver-results.json",
    path: ["related", { id: "insist-on-the-highest-standards" }, "note"],
    before: amazonNote,
    after: "Read {lp:insist-on-the-highest-standards}.",
    company: "amazon",
  });
  const result = reuse.expand([change], renamedIndex, renamedMaps, files);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.changes.length, 2);
  assert.deepEqual(result.changes[1].path, ["related", { id: "insist-on-high-standards" }, "note"]);
  assert.equal(result.changes[1].before, genericNote);
  assert.equal(result.changes[1].after, "Read {lp:insist-on-high-standards}.");
});

test("a related selector walks a chain of maps to the far company", () => {
  const amazonNote = "See {lp:insist-on-the-highest-standards}.";
  const genericNote = "See {lp:insist-on-high-standards}.";
  const armNote = "See {lp:high-bar}.";
  const chainIndex = {
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
      {
        id: "arm",
        principles: [
          { id: 9007, slug: "high-bar" },
          { id: 9014, slug: "deliver-results" },
        ],
      },
    ],
  };
  const chainMaps = [
    {
      source: "generic",
      target: "amazon",
      pairs: [
        { sourceSlug: "insist-on-high-standards", targetIds: [1007] },
        { sourceSlug: "deliver-results", targetIds: [1014] },
      ],
    },
    {
      source: "generic",
      target: "arm",
      pairs: [
        { sourceSlug: "insist-on-high-standards", targetIds: [9007] },
        { sourceSlug: "deliver-results", targetIds: [9014] },
      ],
    },
  ];
  const files = {
    "principles:data/teaching/amazon/deliver-results.json": JSON.stringify({
      related: [{ id: "insist-on-the-highest-standards", note: amazonNote }],
    }),
    "principles:data/teaching/generic/deliver-results.json": JSON.stringify({
      related: [{ id: "insist-on-high-standards", note: genericNote }],
    }),
    "principles:data/teaching/arm/deliver-results.json": JSON.stringify({
      related: [{ id: "high-bar", note: armNote }],
    }),
  };
  const change = Object.assign({}, edit, {
    file: "data/teaching/amazon/deliver-results.json",
    path: ["related", { id: "insist-on-the-highest-standards" }, "note"],
    before: amazonNote,
    after: "Read {lp:insist-on-the-highest-standards}.",
    company: "amazon",
  });
  const result = reuse.expand([change], chainIndex, chainMaps, files);
  assert.equal(result.ok, true, result.error);
  const arm = result.changes.filter((one) => one.file.indexOf("/arm/") !== -1)[0];
  assert.ok(arm);
  assert.deepEqual(arm.path, ["related", { id: "high-bar" }, "note"]);
  assert.equal(arm.before, armNote);
  assert.equal(arm.after, "Read {lp:high-bar}.");
});

test("a facet row edit does not ask for derivation maps", () => {
  assert.equal(reuse.needsMaps([{ repo: "principles", file: "data/facets.json" }]), false);
  assert.equal(reuse.needsMaps([edit]), true);
});

test("a chain of maps rewrites the slug through the shared source", () => {
  const amazonWhy = "See {lp:insist-on-the-highest-standards}.";
  const genericWhy = "See {lp:insist-on-high-standards}.";
  const armWhy = "See {lp:high-bar}.";
  const edited = "Read {lp:insist-on-the-highest-standards}.";
  const chainIndex = {
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
      {
        id: "arm",
        principles: [
          { id: 9007, slug: "high-bar" },
          { id: 9014, slug: "deliver-results" },
        ],
      },
    ],
  };
  const chainMaps = [
    {
      source: "generic",
      target: "amazon",
      pairs: [
        { sourceSlug: "insist-on-high-standards", targetIds: [1007] },
        { sourceSlug: "deliver-results", targetIds: [1014] },
      ],
    },
    {
      source: "generic",
      target: "arm",
      pairs: [
        { sourceSlug: "insist-on-high-standards", targetIds: [9007] },
        { sourceSlug: "deliver-results", targetIds: [9014] },
      ],
    },
  ];
  const files = {
    "principles:data/teaching/amazon/deliver-results.json": JSON.stringify({ why: amazonWhy }),
    "principles:data/teaching/generic/deliver-results.json": JSON.stringify({ why: genericWhy }),
    "principles:data/teaching/arm/deliver-results.json": JSON.stringify({ why: armWhy }),
  };
  const change = Object.assign({}, edit, {
    file: "data/teaching/amazon/deliver-results.json",
    path: ["why"],
    before: amazonWhy,
    after: edited,
    company: "amazon",
  });
  const result = reuse.expand([change], chainIndex, chainMaps, files);
  assert.equal(result.ok, true);
  assert.equal(result.changes.length, 3);
  const generic = result.changes.filter((one) => one.file.indexOf("/generic/") !== -1)[0];
  const arm = result.changes.filter((one) => one.file.indexOf("/arm/") !== -1)[0];
  assert.equal(generic.before, genericWhy);
  assert.equal(generic.after, "Read {lp:insist-on-high-standards}.");
  assert.equal(arm.before, armWhy);
  assert.equal(arm.after, "Read {lp:high-bar}.");
});

test("a company id named constructor still walks the derivation map", () => {
  const sentence = "Ship the simple version.";
  const ctorIndex = {
    companies: [
      { id: "constructor", principles: [{ id: 1, slug: "deliver-results" }] },
      { id: "generic", principles: [{ id: 2, slug: "deliver-results" }] },
    ],
  };
  const ctorMaps = [{
    source: "generic",
    target: "constructor",
    pairs: [{ sourceSlug: "deliver-results", targetIds: [1] }],
  }];
  const files = {
    "principles:data/teaching/constructor/deliver-results.json": JSON.stringify({ why: sentence }),
    "principles:data/teaching/generic/deliver-results.json": JSON.stringify({ why: sentence }),
  };
  const change = {
    repo: "principles",
    file: "data/teaching/constructor/deliver-results.json",
    path: ["why"],
    before: sentence,
    after: "Ship the simpler version.",
    company: "constructor",
  };
  const result = reuse.expand([change], ctorIndex, ctorMaps, files);
  assert.equal(result.ok, true);
  assert.equal(result.changes.length, 2);
  const generic = result.changes.filter((one) => one.file.indexOf("/generic/") !== -1)[0];
  assert.equal(generic.before, sentence);
  assert.equal(generic.after, "Ship the simpler version.");
});

test("a reused copy is grouped under the destination company and principle", () => {
  const plan = require("../lib/plan.js");
  const before = "Hold the bar.";
  const named = {
    companies: [
      {
        id: "amazon",
        name: "Amazon",
        principles: [{ id: 1007, slug: "insist-on-the-highest-standards", name: "Insist on the Highest Standards" }],
      },
      {
        id: "generic",
        name: "Universal Leadership Principles",
        principles: [{ id: 8007, slug: "insist-on-high-standards", name: "Insist on High Standards" }],
      },
    ],
  };
  const namedMaps = [{
    source: "generic",
    target: "amazon",
    pairs: [{ sourceSlug: "insist-on-high-standards", targetIds: [1007] }],
  }];
  const files = {
    "principles:data/teaching/amazon/insist-on-the-highest-standards.json": JSON.stringify({ why: before }),
    "principles:data/teaching/generic/insist-on-high-standards.json": JSON.stringify({ why: before }),
  };
  const change = {
    repo: "principles",
    file: "data/teaching/amazon/insist-on-the-highest-standards.json",
    path: ["why"],
    before: before,
    after: "Hold a higher bar.",
    label: "Hold the bar.",
    field: "Why",
    company: "amazon",
    companyName: "Amazon",
    principle: "Insist on the Highest Standards",
    principleName: "Insist on the Highest Standards",
  };
  const result = reuse.expand([change], named, namedMaps, files);
  assert.equal(result.ok, true);
  const generic = result.changes.filter((one) => one.file.indexOf("/generic/") !== -1)[0];
  assert.equal(generic.company, "generic");
  assert.equal(generic.companyName, "Universal Leadership Principles");
  assert.equal(generic.principleName, "Insist on High Standards");
  const body = plan.pullBody(result.changes, "", "");
  assert.match(body, /## Universal Leadership Principles\n\n### Insist on High Standards\n\n- Hold the bar\., field Why\n {2}- principles `data\/teaching\/generic\/insist-on-high-standards\.json`/);
  assert.doesNotMatch(body, /## Generic/);
  assert.match(body, /## Amazon\n\n### Insist on the Highest Standards/);
});

test("a reused set-level reading edit keeps the set label", () => {
  const plan = require("../lib/plan.js");
  const before = "A short note.";
  const named = {
    companies: [
      { id: "amazon", name: "Amazon", principles: [] },
      { id: "generic", name: "Universal Leadership Principles", principles: [] },
    ],
  };
  const namedMaps = [{ source: "generic", target: "amazon", pairs: [] }];
  const files = {
    "principles:data/teaching/amazon/index.json": JSON.stringify({ blog: [{ note: before }] }),
    "principles:data/teaching/generic/index.json": JSON.stringify({ blog: [{ note: before }] }),
  };
  const change = {
    repo: "principles",
    file: "data/teaching/amazon/index.json",
    path: ["blog", 0, "note"],
    before: before,
    after: "A clearer note.",
    label: "A short note.",
    field: "Note",
    company: "amazon",
    companyName: "Amazon",
    principle: "The set",
    principleName: "The set",
  };
  const result = reuse.expand([change], named, namedMaps, files);
  assert.equal(result.ok, true);
  const generic = result.changes.filter((one) => one.file.indexOf("/generic/") !== -1)[0];
  assert.equal(generic.company, "generic");
  assert.equal(generic.companyName, "Universal Leadership Principles");
  assert.equal(generic.principleName, "The set");
  const body = plan.pullBody([generic], "", "");
  assert.match(body, /## Universal Leadership Principles/);
  assert.match(body, /### The set/);
  assert.doesNotMatch(body, /### index/);
});

test("a matching reused catalog entry is already satisfied", () => {
  const texts = {
    "principles:data/teaching/generic/index.json": JSON.stringify({
      principles: [{ id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" }],
    }),
    "principles:data/teaching/amazon/index.json": JSON.stringify({
      principles: [{ id: 1003, slug: "invent-and-simplify", file: "invent-and-simplify.json" }],
    }),
  };
  const result = reuse.expand([{
    op: "insert",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["principles"],
    index: 1,
    seq: 3,
    value: { id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
    company: "generic",
  }], index, maps, texts);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.changes.length, 1);
});

test("a reused catalog insert refuses an entry that does not match", () => {
  const result = reuse.expand([{
    op: "insert",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["principles"],
    index: 0,
    seq: 5,
    value: { id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
    company: "generic",
  }], index, maps, {
    "principles:data/teaching/generic/index.json": JSON.stringify({ principles: [] }),
    "principles:data/teaching/amazon/index.json": JSON.stringify({
      principles: [{ id: 9999, slug: "invent-and-simplify", file: "invent-and-simplify.json" }],
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /does not match/);
});

test("a reused catalog move keeps the destination id", () => {
  const result = reuse.expand([{
    op: "move",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["principles"],
    index: 0,
    to: 1,
    seq: 4,
    before: { id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
    company: "generic",
  }], index, maps, {
    "principles:data/teaching/generic/index.json": JSON.stringify({
      principles: [
        { id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
        { id: 8001, slug: "customer-obsession", file: "customer-obsession.json" },
      ],
    }),
    "principles:data/teaching/amazon/index.json": JSON.stringify({
      principles: [
        { id: 1001, slug: "customer-obsession", file: "customer-obsession.json" },
        { id: 1003, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
      ],
    }),
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].file, "data/teaching/generic/index.json");
});

test("a reused catalog move still retargets when the destination order differs", () => {
  const result = reuse.expand([{
    op: "move",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["principles"],
    index: 0,
    to: 1,
    seq: 4,
    before: { id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
    company: "generic",
  }], index, maps, {
    "principles:data/teaching/generic/index.json": JSON.stringify({
      principles: [
        { id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
        { id: 8001, slug: "customer-obsession", file: "customer-obsession.json" },
      ],
    }),
    "principles:data/teaching/amazon/index.json": JSON.stringify({
      principles: [
        { id: 1003, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
        { id: 1001, slug: "customer-obsession", file: "customer-obsession.json" },
      ],
    }),
  });
  assert.equal(result.ok, true, result.error);
  const copy = result.changes[1];
  assert.equal(copy.op, "move");
  assert.equal(copy.index, 0);
  assert.equal(copy.to, 1);
  assert.equal(copy.before.id, 1003);
});

test("two removes on one reused list use the list after the first removal", () => {
  const result = reuse.expand([
    {
      op: "remove",
      repo: "principles",
      file: "data/teaching/generic/invent-and-simplify.json",
      path: ["deepen"],
      index: 0,
      seq: 1,
      before: "Other question?",
      company: "generic",
    },
    {
      op: "remove",
      repo: "principles",
      file: "data/teaching/generic/invent-and-simplify.json",
      path: ["deepen"],
      index: 0,
      seq: 2,
      before: BEFORE,
      company: "generic",
    },
  ], index, maps, filesFor(BEFORE));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.changes.length, 4);
  const copies = result.changes.filter((one) => one.file.indexOf("/amazon/") !== -1);
  assert.equal(copies.length, 2);
  assert.equal(copies[0].before, "Other question?");
  assert.equal(copies[1].before, BEFORE);
  assert.equal(copies[0].index, 0);
  assert.equal(copies[1].index, 0);
});

test("a reused catalog insert keeps the source position", () => {
  const result = reuse.expand([{
    op: "insert",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["principles"],
    index: 1,
    seq: 4,
    value: { id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
    company: "generic",
  }], index, maps, {
    "principles:data/teaching/generic/index.json": JSON.stringify({
      principles: [
        { id: 8001, slug: "customer-obsession", file: "customer-obsession.json" },
        { id: 8002, slug: "ownership", file: "ownership.json" },
      ],
    }),
    "principles:data/teaching/amazon/index.json": JSON.stringify({
      principles: [
        { id: 1001, slug: "customer-obsession", file: "customer-obsession.json" },
        { id: 1002, slug: "ownership", file: "ownership.json" },
      ],
    }),
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.changes[1].index, 1);
  assert.deepEqual(result.changes[1].value, { id: 1003, slug: "invent-and-simplify", file: "invent-and-simplify.json" });
});

test("a reused catalog insert adopts the caller's position", () => {
  const texts = {
    "principles:data/teaching/generic/index.json": JSON.stringify({
      principles: [{ id: 8001, slug: "customer-obsession", file: "customer-obsession.json" }],
    }),
    "principles:data/teaching/amazon/index.json": JSON.stringify({
      principles: [{ id: 1001, slug: "customer-obsession", file: "customer-obsession.json" }],
    }),
  };
  const result = reuse.expand([
    {
      op: "insert",
      repo: "principles",
      file: "data/teaching/generic/index.json",
      path: ["principles"],
      index: 1,
      seq: 1,
      value: { id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
      company: "generic",
    },
    {
      op: "insert",
      repo: "principles",
      file: "data/teaching/amazon/index.json",
      path: ["principles"],
      index: 0,
      seq: 2,
      value: { id: 1003, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
      company: "amazon",
    },
  ], index, maps, texts);
  assert.equal(result.ok, true, result.error);
  const amazon = result.changes.filter((one) => one.file === "data/teaching/amazon/index.json");
  assert.equal(amazon.length, 1);
  assert.equal(amazon[0].index, 0);
  assert.deepEqual(amazon[0].value, { id: 1003, slug: "invent-and-simplify", file: "invent-and-simplify.json" });
});

test("a reused catalog insert rejects a caller entry that does not match", () => {
  const result = reuse.expand([
    {
      op: "insert",
      repo: "principles",
      file: "data/teaching/generic/index.json",
      path: ["principles"],
      index: 1,
      seq: 1,
      value: { id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
      company: "generic",
    },
    {
      op: "insert",
      repo: "principles",
      file: "data/teaching/amazon/index.json",
      path: ["principles"],
      index: 0,
      seq: 2,
      value: { id: 9999, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
      company: "amazon",
    },
  ], index, maps, {
    "principles:data/teaching/generic/index.json": JSON.stringify({ principles: [] }),
    "principles:data/teaching/amazon/index.json": JSON.stringify({ principles: [] }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /does not match/);
});

test("a reused catalog insert stays after earlier edits of that catalog", () => {
  const patch = require("../lib/patch.js");
  const both = {
    companies: [
      {
        id: "amazon",
        principles: [
          { id: 1001, slug: "customer-obsession" },
          { id: 1002, slug: "ownership" },
          { id: 1003, slug: "invent-and-simplify" },
        ],
      },
      {
        id: "generic",
        principles: [
          { id: 8001, slug: "customer-obsession" },
          { id: 8002, slug: "ownership" },
          { id: 8006, slug: "invent-and-simplify" },
        ],
      },
    ],
  };
  function catalog(principles) {
    return JSON.stringify({
      principles: principles,
      blog: [{ title: "A note", url: "https://kindel.com/a", note: "Why it belongs." }],
    });
  }
  function insert(file, index, seq, value) {
    return {
      op: "insert",
      repo: "principles",
      file: file,
      path: ["principles"],
      index: index,
      seq: seq,
      value: value,
      company: file.indexOf("/generic/") === -1 ? "amazon" : "generic",
    };
  }
  const emptyFiles = {
    "principles:data/teaching/generic/index.json": catalog([]),
    "principles:data/teaching/amazon/index.json": catalog([]),
  };
  const empty = reuse.expand([
    insert("data/teaching/generic/index.json", 0, 1, { id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" }),
    insert("data/teaching/amazon/index.json", 0, 2, { id: 1001, slug: "customer-obsession", file: "customer-obsession.json" }),
    insert("data/teaching/amazon/index.json", 1, 3, { id: 1003, slug: "invent-and-simplify", file: "invent-and-simplify.json" }),
  ], both, maps, emptyFiles);
  assert.equal(empty.ok, true, empty.error);
  const emptyAmazon = empty.changes.filter((one) => one.file === "data/teaching/amazon/index.json");
  assert.deepEqual(emptyAmazon.map((one) => one.index), [0, 1]);
  assert.deepEqual(emptyAmazon.map((one) => one.value.slug), ["customer-obsession", "invent-and-simplify"]);
  assert.deepEqual(
    JSON.parse(patch.applyPatches(emptyFiles["principles:data/teaching/amazon/index.json"], emptyAmazon)).principles.map((item) => item.slug),
    ["customer-obsession", "invent-and-simplify"]
  );
  const keptFiles = {
    "principles:data/teaching/generic/index.json": catalog([{ id: 8002, slug: "ownership", file: "ownership.json" }]),
    "principles:data/teaching/amazon/index.json": catalog([{ id: 1002, slug: "ownership", file: "ownership.json" }]),
  };
  const kept = reuse.expand([
    insert("data/teaching/generic/index.json", 0, 1, { id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" }),
    insert("data/teaching/amazon/index.json", 0, 2, { id: 1001, slug: "customer-obsession", file: "customer-obsession.json" }),
    insert("data/teaching/amazon/index.json", 1, 3, { id: 1003, slug: "invent-and-simplify", file: "invent-and-simplify.json" }),
  ], both, maps, keptFiles);
  assert.equal(kept.ok, true, kept.error);
  const keptAmazon = kept.changes.filter((one) => one.file === "data/teaching/amazon/index.json");
  assert.deepEqual(keptAmazon.map((one) => [one.index, one.value.slug]), [
    [0, "customer-obsession"],
    [1, "invent-and-simplify"],
  ]);
  assert.deepEqual(
    JSON.parse(patch.applyPatches(keptFiles["principles:data/teaching/amazon/index.json"], keptAmazon)).principles.map((item) => item.slug),
    ["customer-obsession", "invent-and-simplify", "ownership"]
  );
});

test("a mapped teaching record takes the destination principle id", () => {
  const record = { id: 1003, slug: "invent-and-simplify", why: ["Same prose."] };
  const present = reuse.expand([{
    op: "create",
    repo: "principles",
    file: "data/teaching/amazon/invent-and-simplify.json",
    path: [],
    value: record,
    company: "amazon",
  }], index, maps, {
    "principles:data/teaching/generic/invent-and-simplify.json": JSON.stringify({
      id: 8006,
      slug: "invent-and-simplify",
      why: ["Same prose."],
    }),
  });
  assert.equal(present.ok, true, present.error);
  assert.equal(present.changes.length, 1);
  const missing = reuse.expand([{
    op: "create",
    repo: "principles",
    file: "data/teaching/amazon/invent-and-simplify.json",
    path: [],
    value: record,
    company: "amazon",
  }], index, maps, {});
  assert.equal(missing.ok, true, missing.error);
  assert.equal(missing.changes.length, 2);
  assert.equal(missing.changes[1].file, "data/teaching/generic/invent-and-simplify.json");
  assert.equal(missing.changes[1].value.id, 8006);
  assert.equal(missing.changes[1].value.slug, "invent-and-simplify");
  const differed = reuse.expand([{
    op: "create",
    repo: "principles",
    file: "data/teaching/amazon/invent-and-simplify.json",
    path: [],
    value: record,
    company: "amazon",
  }], index, maps, {
    "principles:data/teaching/generic/invent-and-simplify.json": JSON.stringify({
      id: 8006,
      slug: "invent-and-simplify",
      why: ["Different prose."],
    }),
  });
  assert.equal(differed.ok, false);
  assert.match(differed.error, /already differs/);
});

test("a new catalog does not have to match the other company's catalog", () => {
  const created = {
    title: "Amazon: a user's manual",
    principles: [{ id: 1003, slug: "invent-and-simplify", file: "invent-and-simplify.json" }],
    blog: [{ title: "Kindel", url: "https://kindel.com/", note: "The public site." }],
  };
  const matched = reuse.expand([{
    op: "create",
    repo: "principles",
    file: "data/teaching/amazon/index.json",
    path: [],
    value: created,
    company: "amazon",
  }], index, maps, {
    "principles:data/teaching/generic/index.json": JSON.stringify({
      title: "Universal: a user's manual",
      principles: [{ id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" }],
      blog: [{ title: "Other", url: "https://kindel.com/other", note: "Other." }],
    }),
  });
  assert.equal(matched.ok, true, matched.error);
  assert.equal(matched.changes.length, 1);
  const added = reuse.expand([{
    op: "create",
    repo: "principles",
    file: "data/teaching/amazon/index.json",
    path: [],
    value: created,
    company: "amazon",
  }], index, maps, {
    "principles:data/teaching/generic/index.json": JSON.stringify({
      title: "Universal: a user's manual",
      principles: [],
      blog: [],
    }),
  });
  assert.equal(added.ok, true, added.error);
  assert.equal(added.changes[1].op, "insert");
  assert.deepEqual(added.changes[1].value, { id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" });
});

test("the same list edit sent for both companies is not copied twice", () => {
  const generic = {
    op: "insert",
    repo: "principles",
    file: "data/teaching/generic/invent-and-simplify.json",
    path: ["deepen"],
    index: 0,
    seq: 1,
    value: "First?",
    company: "generic",
  };
  const amazon = {
    op: "insert",
    repo: "principles",
    file: "data/teaching/amazon/invent-and-simplify.json",
    path: ["deepen"],
    index: 0,
    seq: 2,
    value: "First?",
    company: "amazon",
  };
  const result = reuse.expand([generic, amazon], index, maps, filesFor(BEFORE));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.changes.length, 2);
  const catalog = reuse.expand([
    {
      op: "insert",
      repo: "principles",
      file: "data/teaching/generic/index.json",
      path: ["principles"],
      index: 0,
      seq: 1,
      value: { id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
      company: "generic",
    },
    {
      op: "insert",
      repo: "principles",
      file: "data/teaching/amazon/index.json",
      path: ["principles"],
      index: 0,
      seq: 2,
      value: { id: 1003, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
      company: "amazon",
    },
  ], index, maps, {
    "principles:data/teaching/generic/index.json": JSON.stringify({ principles: [] }),
    "principles:data/teaching/amazon/index.json": JSON.stringify({ principles: [] }),
  });
  assert.equal(catalog.ok, true, catalog.error);
  assert.equal(catalog.changes.length, 2);
});

test("a reused list copy stays ahead of a later edit of that copy", () => {
  const generic = {
    op: "insert",
    repo: "principles",
    file: "data/teaching/generic/invent-and-simplify.json",
    path: ["deepen"],
    index: 0,
    seq: 1,
    value: "First?",
    company: "generic",
  };
  const amazon = {
    op: "insert",
    repo: "principles",
    file: "data/teaching/amazon/invent-and-simplify.json",
    path: ["deepen"],
    index: 0,
    seq: 2,
    value: "Second?",
    company: "amazon",
  };
  const result = reuse.expand([generic, amazon], index, maps, filesFor(BEFORE));
  assert.equal(result.ok, true, result.error);
  const amazonEdits = result.changes.filter((one) => one.file.indexOf("/amazon/") !== -1);
  assert.equal(amazonEdits.length, 2);
  assert.equal(amazonEdits[0].value, "First?");
  assert.equal(amazonEdits[1].value, "Second?");
  assert.ok(result.changes.indexOf(amazonEdits[0]) < result.changes.indexOf(amazon));
});

test("a reused catalog copy stays ahead of a later edit of that catalog", () => {
  const both = {
    companies: [
      {
        id: "amazon",
        principles: [
          { id: 1001, slug: "customer-obsession" },
          { id: 1003, slug: "invent-and-simplify" },
        ],
      },
      {
        id: "generic",
        principles: [
          { id: 8001, slug: "customer-obsession" },
          { id: 8006, slug: "invent-and-simplify" },
        ],
      },
    ],
  };
  const generic = {
    op: "insert",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["principles"],
    index: 0,
    seq: 1,
    value: { id: 8001, slug: "customer-obsession", file: "customer-obsession.json" },
    company: "generic",
  };
  const amazon = {
    op: "insert",
    repo: "principles",
    file: "data/teaching/amazon/index.json",
    path: ["principles"],
    index: 0,
    seq: 2,
    value: { id: 1003, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
    company: "amazon",
  };
  const result = reuse.expand([generic, amazon], both, maps, {
    "principles:data/teaching/generic/index.json": JSON.stringify({ principles: [] }),
    "principles:data/teaching/amazon/index.json": JSON.stringify({ principles: [] }),
  });
  assert.equal(result.ok, true, result.error);
  const amazonEdits = result.changes.filter((one) => one.file.indexOf("/amazon/") !== -1);
  assert.equal(amazonEdits.length, 2);
  assert.equal(amazonEdits[0].value.slug, "customer-obsession");
  assert.equal(amazonEdits[0].value.id, 1001);
  assert.equal(amazonEdits[1].value.slug, "invent-and-simplify");
  assert.ok(result.changes.indexOf(amazonEdits[0]) < result.changes.indexOf(amazon));
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

test("a three-company reuse group keeps one copy of a shared list edit", () => {
  const grouped = {
    companies: index.companies.concat([
      { id: "arm", principles: [{ id: 3003, slug: "invent-and-simplify" }] },
    ]),
  };
  const groupMaps = maps.concat([{
    source: "amazon",
    target: "arm",
    pairs: [{ sourceSlug: "invent-and-simplify", targetIds: [3003] }],
  }]);
  const files = Object.assign({}, filesFor(BEFORE), {
    "principles:data/teaching/arm/invent-and-simplify.json": teach(3003, BEFORE),
  });
  function listed(company, seq, op, extra) {
    return Object.assign({
      op: op,
      repo: "principles",
      file: "data/teaching/" + company + "/invent-and-simplify.json",
      path: ["deepen"],
      seq: seq,
      company: company,
    }, extra);
  }
  const shared = reuse.expand([
    listed("generic", 1, "insert", { index: 0, value: "First?" }),
    listed("amazon", 2, "insert", { index: 0, value: "First?" }),
  ], grouped, groupMaps, files);
  assert.equal(shared.ok, true, shared.error);
  assert.equal(shared.changes.length, 3);
  const armInserts = shared.changes.filter((one) => one.file.indexOf("/arm/") !== -1);
  assert.equal(armInserts.length, 1);
  assert.equal(armInserts[0].op, "insert");
  assert.equal(armInserts[0].value, "First?");
  const repeated = reuse.expand([
    listed("generic", 1, "insert", { index: 0, value: "First?" }),
    listed("generic", 2, "insert", { index: 0, value: "First?" }),
  ], grouped, groupMaps, files);
  assert.equal(repeated.ok, true, repeated.error);
  assert.equal(repeated.changes.filter((one) => one.file.indexOf("/arm/") !== -1 && one.op === "insert").length, 2);
  assert.equal(repeated.changes.filter((one) => one.file.indexOf("/amazon/") !== -1 && one.op === "insert").length, 2);
  const removed = reuse.expand([
    listed("generic", 1, "remove", { index: 1, before: BEFORE }),
    listed("amazon", 2, "remove", { index: 1, before: BEFORE }),
  ], grouped, groupMaps, files);
  assert.equal(removed.ok, true, removed.error);
  const armRemoves = removed.changes.filter((one) => one.file.indexOf("/arm/") !== -1);
  assert.equal(armRemoves.length, 1);
  assert.equal(armRemoves[0].op, "remove");
  assert.equal(armRemoves[0].before, BEFORE);
  const moved = reuse.expand([
    listed("generic", 1, "move", { index: 0, to: 2, before: "Other question?" }),
    listed("amazon", 2, "move", { index: 0, to: 2, before: "Other question?" }),
  ], grouped, groupMaps, files);
  assert.equal(moved.ok, true, moved.error);
  const armMoves = moved.changes.filter((one) => one.file.indexOf("/arm/") !== -1);
  assert.equal(armMoves.length, 1);
  assert.equal(armMoves[0].op, "move");
  assert.equal(armMoves[0].to, 2);
});

test("a caller-supplied deletion of a reused file is not copied again", () => {
  const amazon = {
    op: "delete",
    repo: "principles",
    file: "data/teaching/amazon/invent-and-simplify.json",
    path: [],
    seq: 1,
    company: "amazon",
  };
  const generic = {
    op: "delete",
    repo: "principles",
    file: "data/teaching/generic/invent-and-simplify.json",
    path: [],
    seq: 2,
    company: "generic",
  };
  const both = reuse.expand([amazon, generic], index, maps, filesFor(BEFORE));
  assert.equal(both.ok, true, both.error);
  assert.equal(both.changes.length, 2);
  assert.equal(both.changes[0], amazon);
  assert.equal(both.changes[1], generic);
  const one = reuse.expand([amazon], index, maps, filesFor(BEFORE));
  assert.equal(one.ok, true, one.error);
  assert.equal(one.changes.length, 2);
  assert.equal(one.changes[1].op, "delete");
  assert.equal(one.changes[1].file, generic.file);
  const grouped = {
    companies: index.companies.concat([
      { id: "arm", principles: [{ id: 3003, slug: "invent-and-simplify" }] },
    ]),
  };
  const groupMaps = maps.concat([{
    source: "amazon",
    target: "arm",
    pairs: [{ sourceSlug: "invent-and-simplify", targetIds: [3003] }],
  }]);
  const files = Object.assign({}, filesFor(BEFORE), {
    "principles:data/teaching/arm/invent-and-simplify.json": teach(3003, BEFORE),
  });
  const third = reuse.expand([amazon, generic], grouped, groupMaps, files);
  assert.equal(third.ok, true, third.error);
  const armDeletes = third.changes.filter((item) => item.file.indexOf("/arm/") !== -1);
  assert.equal(armDeletes.length, 1);
  assert.equal(armDeletes[0].op, "delete");
});

test("a caller-supplied create of a reused file is not copied again", () => {
  const record = { id: 1003, slug: "invent-and-simplify", why: ["Same prose."] };
  const amazon = {
    op: "create",
    repo: "principles",
    file: "data/teaching/amazon/invent-and-simplify.json",
    path: [],
    seq: 1,
    value: record,
    company: "amazon",
  };
  const alone = reuse.expand([amazon], index, maps, {});
  assert.equal(alone.ok, true, alone.error);
  assert.equal(alone.changes.length, 2);
  const generic = {
    op: "create",
    repo: "principles",
    file: "data/teaching/generic/invent-and-simplify.json",
    path: [],
    seq: 2,
    value: alone.changes[1].value,
    company: "generic",
  };
  const both = reuse.expand([amazon, generic], index, maps, {});
  assert.equal(both.ok, true, both.error);
  assert.equal(both.changes.length, 2);
  assert.equal(both.changes[0], amazon);
  assert.equal(both.changes[1], generic);
  const grouped = {
    companies: index.companies.concat([
      { id: "arm", principles: [{ id: 3003, slug: "invent-and-simplify" }] },
    ]),
  };
  const groupMaps = maps.concat([{
    source: "amazon",
    target: "arm",
    pairs: [{ sourceSlug: "invent-and-simplify", targetIds: [3003] }],
  }]);
  const third = reuse.expand([amazon, generic], grouped, groupMaps, {});
  assert.equal(third.ok, true, third.error);
  const armCreates = third.changes.filter((item) => item.file.indexOf("/arm/") !== -1);
  assert.equal(armCreates.length, 1);
  assert.equal(armCreates[0].op, "create");
  assert.equal(armCreates[0].value.id, 3003);
  const catalog = {
    title: "Notes",
    principles: [{ id: 1003, slug: "invent-and-simplify", file: "invent-and-simplify.json" }],
  };
  const amazonCatalog = {
    op: "create",
    repo: "principles",
    file: "data/teaching/amazon/index.json",
    path: [],
    seq: 3,
    value: catalog,
    company: "amazon",
  };
  const catalogAlone = reuse.expand([amazonCatalog], index, maps, {});
  assert.equal(catalogAlone.ok, true, catalogAlone.error);
  assert.equal(catalogAlone.changes.length, 2);
  assert.equal(catalogAlone.changes[1].op, "create");
  const genericCatalog = {
    op: "create",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: [],
    seq: 4,
    value: catalogAlone.changes[1].value,
    company: "generic",
  };
  const catalogs = reuse.expand([amazonCatalog, genericCatalog], index, maps, {});
  assert.equal(catalogs.ok, true, catalogs.error);
  assert.equal(catalogs.changes.length, 2);
  assert.equal(catalogs.changes[0], amazonCatalog);
  assert.equal(catalogs.changes[1], genericCatalog);
});

test("projection counts repeated structural edits and keeps one replacement per path", () => {
  const file = "data/teaching/amazon/invent-and-simplify.json";
  const inserts = [1, 2].map((seq) => ({
    op: "insert",
    repo: "principles",
    file: file,
    path: ["deepen"],
    index: 1,
    seq: seq,
    value: "Another question?",
  }));
  const projected = reuse.project(inserts, index, maps);
  assert.equal(projected.changes, 4);
  assert.equal(projected.files, 2);
  const repeated = reuse.project([inserts[0], Object.assign({}, inserts[0])], index, maps);
  assert.equal(repeated.changes, 2);
  const replacements = [1, 2].map(() => ({
    repo: "principles",
    file: file,
    path: ["deepen", 1],
    before: BEFORE,
    after: AFTER,
  }));
  const replaced = reuse.project(replacements, index, maps);
  assert.equal(replaced.changes, 2);
  assert.equal(replaced.files, 2);
});

const sharedReading = [
  { title: "Copied", url: "https://kindel.com/copied", note: "The copied source." },
];
const extraReading = {
  title: "Extra",
  url: "https://kindel.com/extra",
  note: "Source-only reading.",
};

test("appended further reading on the source is not copied to the target", () => {
  const files = {
    "principles:data/teaching/amazon/index.json": JSON.stringify({ blog: sharedReading }),
    "principles:data/teaching/generic/index.json": JSON.stringify({ blog: sharedReading }),
  };
  const inserted = reuse.expand([{
    op: "insert",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["blog"],
    index: 1,
    value: extraReading,
    company: "generic",
  }], index, maps, files);
  assert.equal(inserted.ok, true, inserted.error);
  assert.equal(inserted.changes.length, 1);
  assert.equal(inserted.changes[0].file, "data/teaching/generic/index.json");

  const withExtra = {
    "principles:data/teaching/amazon/index.json": JSON.stringify({ blog: sharedReading }),
    "principles:data/teaching/generic/index.json": JSON.stringify({ blog: sharedReading.concat([extraReading]) }),
  };
  const edited = reuse.expand([{
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["blog", 1, "note"],
    before: extraReading.note,
    after: "A clearer extra note.",
    company: "generic",
  }], index, maps, withExtra);
  assert.equal(edited.ok, true, edited.error);
  assert.equal(edited.changes.length, 1);
  assert.equal(edited.changes[0].file, "data/teaching/generic/index.json");

  const removed = reuse.expand([{
    op: "remove",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["blog"],
    index: 1,
    before: extraReading,
    company: "generic",
  }], index, maps, withExtra);
  assert.equal(removed.ok, true, removed.error);
  assert.equal(removed.changes.length, 1);
});

test("appending on a mid-chain company still copies upstream", () => {
  const grouped = {
    companies: index.companies.concat([
      { id: "arm", principles: [{ id: 3003, slug: "invent-and-simplify" }] },
    ]),
  };
  const groupMaps = maps.concat([{
    source: "amazon",
    target: "arm",
    pairs: [{ sourceSlug: "invent-and-simplify", targetIds: [3003] }],
  }]);
  const files = {
    "principles:data/teaching/amazon/index.json": JSON.stringify({ blog: sharedReading }),
    "principles:data/teaching/generic/index.json": JSON.stringify({ blog: sharedReading }),
    "principles:data/teaching/arm/index.json": JSON.stringify({ blog: sharedReading }),
  };
  const result = reuse.expand([{
    op: "insert",
    repo: "principles",
    file: "data/teaching/amazon/index.json",
    path: ["blog"],
    index: 1,
    value: extraReading,
    company: "amazon",
  }], grouped, groupMaps, files);
  assert.equal(result.ok, true, result.error);
  const generic = result.changes.filter((one) => one.file.indexOf("/generic/") !== -1);
  const arm = result.changes.filter((one) => one.file.indexOf("/arm/") !== -1);
  assert.equal(generic.length, 1, "amazon append copies to generic");
  assert.equal(arm.length, 0, "amazon extra does not copy to arm");
});

test("a root-source append does not copy through a chain", () => {
  const grouped = {
    companies: index.companies.concat([
      { id: "arm", principles: [{ id: 3003, slug: "invent-and-simplify" }] },
    ]),
  };
  const groupMaps = maps.concat([{
    source: "amazon",
    target: "arm",
    pairs: [{ sourceSlug: "invent-and-simplify", targetIds: [3003] }],
  }]);
  const files = {
    "principles:data/teaching/amazon/index.json": JSON.stringify({ blog: sharedReading }),
    "principles:data/teaching/generic/index.json": JSON.stringify({ blog: sharedReading }),
    "principles:data/teaching/arm/index.json": JSON.stringify({ blog: sharedReading }),
  };
  const inserted = reuse.expand([{
    op: "insert",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["blog"],
    index: 1,
    value: extraReading,
    company: "generic",
  }], grouped, groupMaps, files);
  assert.equal(inserted.ok, true, inserted.error);
  assert.equal(inserted.changes.length, 1);
  assert.equal(inserted.changes[0].file, "data/teaching/generic/index.json");

  const withExtra = {
    "principles:data/teaching/amazon/index.json": JSON.stringify({ blog: sharedReading }),
    "principles:data/teaching/generic/index.json": JSON.stringify({ blog: sharedReading.concat([extraReading]) }),
    "principles:data/teaching/arm/index.json": JSON.stringify({ blog: sharedReading }),
  };
  const edited = reuse.expand([{
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["blog", 1, "note"],
    before: extraReading.note,
    after: "A clearer extra note.",
    company: "generic",
  }], grouped, groupMaps, withExtra);
  assert.equal(edited.ok, true, edited.error);
  assert.equal(edited.changes.length, 1);
  assert.equal(edited.changes[0].file, "data/teaching/generic/index.json");

  const copied = reuse.expand([{
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["blog", 0, "note"],
    before: sharedReading[0].note,
    after: "A clearer copied note.",
    company: "generic",
  }], grouped, groupMaps, files);
  assert.equal(copied.ok, true, copied.error);
  assert.equal(copied.changes.filter((one) => one.file.indexOf("/amazon/") !== -1).length, 1);
  assert.equal(copied.changes.filter((one) => one.file.indexOf("/arm/") !== -1).length, 1);
});

test("appending further reading on the copied target still copies to the source", () => {
  const files = {
    "principles:data/teaching/amazon/index.json": JSON.stringify({ blog: sharedReading }),
    "principles:data/teaching/generic/index.json": JSON.stringify({ blog: sharedReading }),
  };
  const result = reuse.expand([{
    op: "insert",
    repo: "principles",
    file: "data/teaching/amazon/index.json",
    path: ["blog"],
    index: 1,
    value: extraReading,
    company: "amazon",
  }], index, maps, files);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.changes.length, 2);
  assert.equal(result.changes[1].file, "data/teaching/generic/index.json");
  assert.equal(result.changes[1].index, 1);
});

test("a further reading extra cannot move into the copied prefix", () => {
  const files = {
    "principles:data/teaching/amazon/index.json": JSON.stringify({ blog: sharedReading }),
    "principles:data/teaching/generic/index.json": JSON.stringify({ blog: sharedReading.concat([extraReading]) }),
  };
  const result = reuse.expand([{
    op: "move",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["blog"],
    index: 1,
    to: 0,
    before: extraReading,
    company: "generic",
  }], index, maps, files);
  assert.equal(result.ok, false);
  assert.match(result.error, /copied prefix/);
});

test("an empty further reading list is not treated as a copied prefix", () => {
  const files = {
    "principles:data/teaching/amazon/index.json": JSON.stringify({ blog: [] }),
    "principles:data/teaching/generic/index.json": JSON.stringify({ blog: sharedReading.concat([extraReading]) }),
  };
  const result = reuse.expand([{
    op: "insert",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["blog"],
    index: 2,
    value: extraReading,
    company: "generic",
  }], index, maps, files);
  assert.equal(result.ok, false);
  assert.match(result.error, /already differs/);
});

test("a copied reading edit still lands on every matching file when extras follow", () => {
  const files = {
    "principles:data/teaching/amazon/index.json": JSON.stringify({ blog: sharedReading }),
    "principles:data/teaching/generic/index.json": JSON.stringify({ blog: sharedReading.concat([extraReading]) }),
  };
  const result = reuse.expand([{
    repo: "principles",
    file: "data/teaching/amazon/index.json",
    path: ["blog", 0, "note"],
    before: sharedReading[0].note,
    after: "A clearer copied note.",
    company: "amazon",
  }], index, maps, files);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.changes.length, 2);
  assert.equal(result.changes[1].file, "data/teaching/generic/index.json");
  assert.equal(result.changes[1].after, "A clearer copied note.");
});

test("the first further reading entry is copied when both lists are empty", () => {
  const files = {
    "principles:data/teaching/amazon/index.json": JSON.stringify({ blog: [] }),
    "principles:data/teaching/generic/index.json": JSON.stringify({ blog: [] }),
  };
  const result = reuse.expand([{
    op: "insert",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["blog"],
    index: 0,
    value: sharedReading[0],
    company: "generic",
  }], index, maps, files);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.changes.length, 2);
  assert.equal(result.changes[1].file, "data/teaching/amazon/index.json");
  assert.equal(result.changes[1].index, 0);
});

test("a longer downstream further reading list is refused", () => {
  const targetExtra = {
    title: "Target",
    url: "https://kindel.com/target",
    note: "Downstream-only reading.",
  };
  const files = {
    "principles:data/teaching/amazon/index.json": JSON.stringify({ blog: sharedReading.concat([targetExtra]) }),
    "principles:data/teaching/generic/index.json": JSON.stringify({ blog: sharedReading }),
  };
  const result = reuse.expand([{
    op: "insert",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["blog"],
    index: 1,
    value: extraReading,
    company: "generic",
  }], index, maps, files);
  assert.equal(result.ok, false);
  assert.match(result.error, /already differs/);
});

test("removing the last copied reading is refused while an extra remains", () => {
  const files = {
    "principles:data/teaching/amazon/index.json": JSON.stringify({ blog: sharedReading }),
    "principles:data/teaching/generic/index.json": JSON.stringify({ blog: sharedReading.concat([extraReading]) }),
  };
  const result = reuse.expand([{
    op: "remove",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["blog"],
    index: 0,
    before: sharedReading[0],
    company: "generic",
  }], index, maps, files);
  assert.equal(result.ok, false);
  assert.match(result.error, /empty/);
});

test("a url-selected extra stays on the source", () => {
  const files = {
    "principles:data/teaching/amazon/index.json": JSON.stringify({ blog: sharedReading }),
    "principles:data/teaching/generic/index.json": JSON.stringify({ blog: sharedReading.concat([extraReading]) }),
  };
  const result = reuse.expand([{
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["blog", { url: extraReading.url }, "note"],
    before: extraReading.note,
    after: "A clearer extra note.",
    company: "generic",
  }], index, maps, files);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].file, "data/teaching/generic/index.json");
});
