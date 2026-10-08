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

test("two agreeing edits of the same reused field stay as the caller sent them", () => {
  const generic = Object.assign({}, edit, {
    file: "data/teaching/generic/invent-and-simplify.json",
    company: "generic",
  });
  const result = reuse.expand([edit, generic], index, maps, filesFor(BEFORE));
  assert.equal(result.ok, true);
  assert.equal(result.changes.length, 2);
});
