import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const allow = require("../lib/allow.js");
const plan = require("../lib/plan.js");
const guard = require("../lib/guard.js");
const rules = require("../lib/rules.js");

function teaching(count) {
  const deepen = [];
  for (let i = 0; i < count; i++) deepen.push("Question " + i + "?");
  return JSON.stringify({
    id: 8002,
    slug: "ownership",
    why: ["One paragraph here.", "Two paragraphs here.", "Three paragraphs here."],
    calibrationIntro: "Read the rows before you score them.",
    examples: [
      { title: "Right", body: "They did the job." },
      { title: "Over", body: "They did everyone else's job." },
    ],
    looksLike: { individual: "You name the outcome.", manager: "You ask for the evidence." },
    deepen: deepen,
    related: [
      { id: "earn-trust", note: "Trust." },
      { id: "deliver-results", note: "Results." },
    ],
    blog: [{ title: "A note", url: "https://kindel.com/a", note: "Why it belongs." }],
  }, null, 2) + "\n";
}

const slugs = { generic: ["ownership", "earn-trust", "deliver-results"] };

test("lists that can change are allowlisted, and the others stay closed", () => {
  assert.equal(allow.assess({
    op: "insert",
    repo: "principles",
    file: "data/teaching/generic/ownership.json",
    path: ["blog"],
    index: 1,
    value: { title: "More", url: "https://kindel.com/b", note: "A note." },
  }).ok, true);
  assert.equal(allow.assess({
    op: "remove",
    repo: "principles",
    file: "data/teaching/generic/ownership.json",
    path: ["deepen"],
    index: 0,
    before: "Question 0?",
  }).ok, true);
  assert.equal(allow.assess({
    op: "insert",
    repo: "biq",
    file: "data/questions.json",
    path: ["companies", { id: "generic" }, "principles", { id: 8002 }, "questions"],
    index: 0,
    value: { id: "abcd1234", text: "Tell me about a time?" },
  }).ok, true);
  assert.equal(allow.assess({
    op: "insert",
    repo: "principles",
    file: "data/amazon/ownership.json",
    path: ["definition"],
    index: 0,
    value: "No.",
  }).ok, false);
  assert.equal(allow.assess({
    op: "create",
    repo: "principles",
    file: "data/amazon/ownership.json",
    value: { id: 1 },
  }).ok, false);
});

test("an added reading link is labeled and keeps the other bytes", () => {
  const before = teaching(6);
  const prepared = plan.prepare(
    { "principles:data/teaching/generic/ownership.json": before },
    [{
      op: "insert",
      repo: "principles",
      file: "data/teaching/generic/ownership.json",
      path: ["blog"],
      index: 1,
      seq: 1,
      value: { title: "More", url: "https://kindel.com/b", note: "A second note." },
      label: "More",
      field: "Further reading",
      company: "generic",
      companyName: "Universal Leadership Principles",
      principleName: "Ownership",
    }],
    slugs
  );
  assert.equal(prepared.ok, true, JSON.stringify(prepared.errors));
  const after = prepared.files[0].after;
  assert.ok(after.includes('"title": "A note"'));
  assert.ok(after.includes('"url": "https://kindel.com/b"'));
  assert.equal(JSON.parse(after).blog.length, 2);
  const pulls = plan.buildPlan(prepared, { now: Date.UTC(2026, 9, 8, 12, 0, 0), suffix: "list" });
  assert.match(pulls[0].title, /^Facet: Add More/);
  assert.match(pulls[0].body, /Added More/);
  assert.doesNotMatch(pulls[0].body, /\u2014/);
});

test("deleting a concrete question below six is refused", () => {
  const prepared = plan.prepare(
    { "principles:data/teaching/generic/ownership.json": teaching(6) },
    [{
      op: "remove",
      repo: "principles",
      file: "data/teaching/generic/ownership.json",
      path: ["deepen"],
      index: 0,
      before: "Question 0?",
      label: "Question 0?",
      field: "Concrete question",
      company: "generic",
    }],
    slugs
  );
  assert.equal(prepared.ok, false);
  assert.match(prepared.errors[0].error, /6 and 12/);
});

test("a principle cannot lose its last visible BIQ question", () => {
  const before = JSON.stringify({
    companies: [{
      id: "generic",
      name: "Universal Leadership Principles",
      examples: false,
      principles: [{ id: 8002, name: "Ownership", questions: [{ id: "abcd1234", text: "Tell me?" }] }],
    }],
  });
  const after = JSON.stringify({
    companies: [{
      id: "generic",
      name: "Universal Leadership Principles",
      examples: false,
      principles: [{ id: 8002, name: "Ownership", questions: [] }],
    }],
  });
  const errors = guard.review(
    { "biq:data/questions.json": before },
    { "biq:data/questions.json": after },
    [{ repo: "biq", file: "data/questions.json", op: "remove", path: ["companies", { id: "generic" }, "principles", { id: 8002 }, "questions"], index: 0 }]
  );
  assert.match(errors.join("\n"), /Ownership would have no BIQ question/);
});

test("an examples company cannot gain a question without a pack", () => {
  const before = JSON.stringify({
    companies: [{ id: "amazon", name: "Amazon", examples: true, principles: [{ id: 1002, name: "Ownership", questions: [] }] }],
  });
  const after = JSON.stringify({
    companies: [{ id: "amazon", name: "Amazon", examples: true, principles: [{ id: 1002, name: "Ownership", questions: [{ id: "abcd1234", text: "Tell me?" }] }] }],
  });
  const errors = guard.review(
    { "biq:data/questions.json": before },
    { "biq:data/questions.json": after },
    [{ repo: "biq", file: "data/questions.json", op: "insert", path: ["companies", { id: "amazon" }, "principles", { id: 1002 }, "questions"], index: 0 }]
  );
  assert.match(errors.join("\n"), /example pack/);
});

test("removing a facet that is still linked is refused, and so is a bare table", () => {
  const facets = {
    version: 1,
    facets: [{
      id: "ownership",
      label: "ownership",
      principles: [1002],
      rows: [{ id: "the-work", situation: "The work", under: "Does less.", justRight: "Does the job.", over: "Does every job.", words: "generated" }],
    }],
  };
  const index = { companies: [{ id: "amazon", principles: [{ id: 1002, slug: "ownership", facets: ["ownership"] }] }] };
  const questions = { companies: [{ id: "amazon", principles: [{ id: 1002, facets: ["ownership"], questions: [{ text: "Tell me?" }] }] }] };
  const map = { source: "generic", target: "amazon", pairs: [{ sourceId: 8002, sourceSlug: "ownership", facets: ["ownership"], targetIds: [1002] }] };
  const before = {
    "principles:data/facets.json": JSON.stringify(facets),
    "principles:data/index.json": JSON.stringify(index),
    "biq:data/questions.json": JSON.stringify(questions),
    "principles:data/maps/generic-amazon.json": JSON.stringify(map),
  };
  const stripped = JSON.parse(JSON.stringify(facets));
  stripped.facets = [];
  const errors = guard.review(before, Object.assign({}, before, {
    "principles:data/facets.json": JSON.stringify(stripped),
  }), [{
    op: "remove",
    repo: "principles",
    file: "data/facets.json",
    path: ["facets"],
    index: 0,
  }]);
  const text = errors.join("\n");
  assert.match(text, /calibration table/);
  assert.match(text, /still referenced/);
});

test("an essay permalink has to use the kindel essays path", () => {
  assert.match(rules.essayUrlError("https://blog.kindel.com/2024/07/23/how-to-write-a-working-backwards-doc/", ["how-to-write-a-working-backwards-doc"]), /kindel.com\/essays\/how-to-write-a-working-backwards-doc/);
  assert.equal(rules.essayUrlError("https://kindel.com/essays/how-to-write-a-working-backwards-doc/", ["how-to-write-a-working-backwards-doc"]), "");
  assert.equal(rules.essayUrlError("https://blog.kindel.com/2019/05/30/focusing-on-users-is-not-customer-obsession/", ["how-to-write-a-working-backwards-doc"]), "");
});
