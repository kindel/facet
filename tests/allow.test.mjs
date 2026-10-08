import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const allow = require("../lib/allow.js");
const plan = require("../lib/plan.js");

function change(over) {
  return Object.assign({
    repo: "principles",
    file: "data/facets.json",
    path: ["facets", { id: "acts-like-an-owner" }, "rows", { id: "covering-before-time-off" }, "under"],
    before: "Leaves without a handoff.",
    after: "Leaves without writing a handoff.",
  }, over);
}

test("card is Facet, beta, and unlisted", () => {
  const card = JSON.parse(readFileSync(new URL("../card.json", import.meta.url), "utf8"));
  assert.equal(card.id, "facet");
  assert.equal(card.name, "Facet");
  assert.equal(card.status, "beta");
  assert.equal(card.unlisted, true);
  assert.equal(card.href, "/kld/apps/facet/");
  assert.equal(card.summary, "Edit a facet or a question, then open a pull request.");
});

test("allowlist accepts facet text, record rows, questions, and further reading", () => {
  assert.equal(allow.assess(change()).ok, true);
  assert.equal(allow.assess(change({
    file: "data/amazon/ownership.json",
    path: ["rows", { id: "knowing-what-you-own" }, "justRight"],
  })).ok, true);
  assert.equal(allow.assess(change({
    repo: "biq",
    file: "data/questions.json",
    path: ["companies", { id: "amazon" }, "principles", { id: 1001 }, "questions", { id: "f76d64d6" }, "text"],
  })).ok, true);
  assert.equal(allow.assess(change({
    file: "data/teaching/generic/ownership.json",
    path: ["blog", 0, "url"],
    after: "https://blog.kindel.com/example/",
  })).ok, true);
  assert.equal(allow.assess(change({
    file: "data/teaching/amazon/index.json",
    path: ["blog", { url: "https://blog.kindel.com/x/" }, "note"],
  })).ok, true);
});

test("allowlist accepts a concrete question on deepen and rejects the neighbors", () => {
  const ok = allow.assess(change({
    file: "data/teaching/generic/ownership.json",
    path: ["deepen", 0],
    before: "Did you write the handoff down?",
    after: "Did you write the handoff down before you left?",
  }));
  assert.equal(ok.ok, true);
  assert.equal(ok.spec.kind, "teaching");
  assert.equal(ok.spec.field, "deepen");
  assert.equal(ok.spec.questionMark, true);
  assert.equal(ok.spec.tokens, true);
  const rejected = [
    change({ file: "data/teaching/generic/ownership.json", path: ["deepen"] }),
    change({ file: "data/teaching/generic/ownership.json", path: ["deepen", 0, "text"] }),
    change({ file: "data/teaching/generic/ownership.json", path: ["deepen", "0"] }),
    change({ file: "data/teaching/generic/index.json", path: ["deepen", 0] }),
    change({ file: "data/teaching/amazon/index.json", path: ["deepen", 1] }),
  ];
  rejected.forEach((item) => {
    assert.equal(allow.assess(item).ok, false, JSON.stringify(item.file) + " " + JSON.stringify(item.path));
  });
});

test("allowlist rejects new files, traversal, and fields the schema does not edit", () => {
  const rejected = [
    change({ file: "data/index.json", path: ["version"] }),
    change({ file: "data/maps/generic-amazon.json", path: ["edits", 0] }),
    change({ file: "../secrets.json", path: ["token"] }),
    change({ file: "data/amazon/ownership.json", path: ["definition"] }),
    change({ file: "data/amazon/ownership.json", path: ["rows", { id: "knowing-what-you-own" }, "words"] }),
    change({ file: "data/facets.json", path: ["facets", { id: "acts-like-an-owner" }, "label"] }),
    change({
      repo: "biq",
      file: "data/questions.json",
      path: ["companies", { id: "amazon" }, "principles", { id: 1001 }, "questions", { id: "f76d64d6" }, "id"],
    }),
    change({
      repo: "biq",
      file: "data/examples/f76d64d6.json",
      path: ["question"],
    }),
    change({ file: "data/teaching/amazon/index.json", path: ["howTo", 0] }),
    change({ file: "data/nope/ownership.json", path: ["rows", { id: "x" }, "under"] }),
    change({ repo: "kindelwww", file: "data/facets.json", path: ["facets"] }),
    change({ file: "data/amazon/ownership.json", path: ["rows", { id: "Not A Slug" }, "under"] }),
  ];
  rejected.forEach((item) => {
    assert.equal(allow.assess(item).ok, false, JSON.stringify(item.file) + " " + JSON.stringify(item.path));
  });
});

test("inherited names are not company ids", () => {
  const names = ["constructor", "__proto__", "toString", "hasOwnProperty"];
  names.forEach((name) => {
    assert.equal(allow.assess({
      op: "insert",
      repo: "biq",
      file: "data/questions.json",
      path: ["companies", { id: name }, "principles", { id: 1001 }, "questions"],
      index: 0,
      value: { text: "Who?" },
    }).ok, false, "list " + name);
    assert.equal(allow.assess({
      op: "insert",
      repo: "biq",
      file: "data/questions.json",
      path: ["companies", { id: name }, "principles", { id: 1001 }, "facets"],
      index: 0,
      value: "ownership",
    }).ok, false, "facets " + name);
    assert.equal(allow.assess({
      op: "create",
      repo: "principles",
      file: "data/teaching/" + name + "/ownership.json",
      path: [],
      value: { slug: "ownership", why: ["Because."] },
    }).ok, false, "create " + name);
  });
  assert.equal(allow.assess({
    op: "insert",
    repo: "biq",
    file: "data/questions.json",
    path: ["companies", { id: "amazon" }, "principles", { id: 1001 }, "questions"],
    index: 0,
    value: { text: "Who?" },
  }).ok, true);
});

test("generated facet rows are required, and source refs are not editable prose", () => {
  const text = `{
  "facets": [
    {
      "id": "acts-like-an-owner",
      "rows": [
        {"principle": 1002, "id": "knowing-what-you-own"},
        {
          "id": "covering-before-time-off",
          "situation": "Covering work before time off",
          "under": "Leaves without a handoff.",
          "justRight": "Writes the handoff down.",
          "over": "Stays online all week.",
          "words": "authored"
        }
      ]
    }
  ]
}
`;
  const result = plan.prepare(
    { "principles:data/facets.json": text },
    [change()]
  );
  assert.equal(result.ok, false);
  assert.match(result.errors[0].error, /generated/);
});
