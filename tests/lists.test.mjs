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

function genericIndexText() {
  return JSON.stringify({
    companies: [{
      id: "generic",
      principles: [
        { id: 8002, slug: "ownership" },
        { id: 8003, slug: "earn-trust" },
        { id: 8004, slug: "deliver-results" },
      ],
    }],
  });
}

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
    {
      "principles:data/index.json": genericIndexText(),
      "principles:data/teaching/generic/ownership.json": before,
    },
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
    "principles:data/maps/_list.json": JSON.stringify(["data/maps/generic-amazon.json"]),
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
  const essay = "https://blog.kindel.com/" + "2024/07/23/how-to-write-a-working-backwards-doc/";
  const queried = "https://blog.kindel.com/" + "2024/07/23/how-to-write-a-working-backwards-doc/?utm=1";
  const other = "https://blog.kindel.com/" + "2019/05/30/focusing-on-users-is-not-customer-obsession/";
  assert.match(rules.essayUrlError(essay, ["how-to-write-a-working-backwards-doc"]), /kindel.com\/essays\/how-to-write-a-working-backwards-doc/);
  assert.match(rules.essayUrlError(queried, ["how-to-write-a-working-backwards-doc"]), /kindel.com\/essays\/how-to-write-a-working-backwards-doc/);
  assert.equal(rules.essayUrlError("https://kindel.com/essays/how-to-write-a-working-backwards-doc/", ["how-to-write-a-working-backwards-doc"]), "");
  assert.equal(rules.essayUrlError(other, ["how-to-write-a-working-backwards-doc"]), "");
  const inserted = rules.checkItem({
    title: "Working Backwards",
    url: essay,
    note: "A note.",
  }, { item: "blog" });
  assert.match(inserted.join("\n"), /kindel.com\/essays\/how-to-write-a-working-backwards-doc/);
  const byId = rules.checkItem({
    title: "The 5 Ps",
    url: "https://blog.kindel.com/" + "?p=419",
    note: "A note.",
  }, { item: "blog" });
  assert.match(byId.join("\n"), /essays\/the-5-ps-achieving-focus-in-any-endeavor/);
  const dated = "https://blog.kindel.com/2020/01/02/";
  ["constructor", "toString", "hasOwnProperty"].forEach((name) => {
    assert.equal(rules.essayUrlError(dated + name + "/"), "", name);
    assert.equal(rules.essayUrlError(dated + name + "/", { tenets: "tenets" }), "", "caller " + name);
  });
  assert.match(rules.essayUrlError(dated + "tenets/"), /essays\/tenets/);
  assert.match(rules.essayUrlError(dated + "constructor/", { constructor: "constructor" }), /essays\/constructor/);
});

test("a new essay link has to be the catalog URL exactly", () => {
  const canonical = "https://kindel.com/essays/tenets/";
  assert.equal(rules.essayUrlError(canonical), "");
  assert.equal(rules.essayUrlError(canonical, ["tenets"]), "");
  assert.equal(rules.essayUrlError(canonical, { tenets: "tenets" }), "");
  assert.equal(rules.essayUrlError("https://kindel.com/essays/tenets"), "This essay has to use https://kindel.com/essays/tenets/.");
  assert.equal(rules.essayUrlError(" " + canonical), "This essay has to use https://kindel.com/essays/tenets/.");
  assert.equal(rules.essayUrlError(canonical + " "), "This essay has to use https://kindel.com/essays/tenets/.");
  assert.equal(rules.essayUrlError("https://www.kindel.com/essays/tenets/"), "This essay has to use https://kindel.com/essays/tenets/.");
  assert.equal(rules.essayUrlError("https://kindel.com./essays/tenets/"), "This essay has to use https://kindel.com/essays/tenets/.");
  assert.equal(rules.essayUrlError("https://kindel.com//essays/tenets/"), "This essay has to use https://kindel.com/essays/tenets/.");
  assert.equal(rules.essayUrlError("https://kindel.com/essays/tenets/?utm=1"), "This essay has to use https://kindel.com/essays/tenets/.");
  assert.equal(rules.essayUrlError("https://kindel.com/essays/not-in-catalog"), "This essay link is not in the catalog.");
  assert.equal(rules.essayUrlError(" https://kindel.com/essays/not-in-catalog "), "This essay link is not in the catalog.");
  assert.equal(rules.essayUrlError(canonical, ["other-slug"]), "This essay link is not in the catalog.");
  assert.equal(rules.essayUrlError("https://kindel.com/leadership"), "");
  const unknown = rules.checkItem({
    title: "Missing",
    url: "https://kindel.com/essays/not-in-catalog",
    note: "A note.",
  }, { item: "blog" });
  assert.match(unknown.join("\n"), /not in the catalog/);
  const spaced = rules.checkItem({
    title: "Spaced",
    url: " " + canonical + " ",
    note: "A note.",
  }, { item: "blog" });
  assert.match(spaced.join("\n"), /essays\/tenets/);
  const other = rules.checkItem({
    title: "Other",
    url: "https://example.com/notes",
    note: "A note.",
  }, { item: "blog" });
  assert.deepEqual(other, []);
});

test("an existing essay permalink does not block a new reading link", () => {
  const before = teaching(8).replace(
    "https://kindel.com/a",
    "https://blog.kindel.com/" + "2019/05/30/focusing-on-users-is-not-customer-obsession/"
  );
  const prepared = plan.prepare(
    {
      "principles:data/index.json": genericIndexText(),
      "principles:data/teaching/generic/ownership.json": before,
    },
    [{
      op: "insert",
      repo: "principles",
      file: "data/teaching/generic/ownership.json",
      path: ["blog"],
      index: 1,
      seq: 1,
      value: { title: "More", url: "https://kindel.com/b", note: "A second note." },
      label: "More",
      field: "added",
      company: "generic",
      companyName: "Universal Leadership Principles",
      principleName: "Ownership",
    }],
    slugs
  );
  assert.equal(prepared.ok, true, JSON.stringify(prepared.errors));
});

test("removing a teaching record also has to clear its catalog entry", () => {
  const catalog = JSON.stringify({
    principles: [{ id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" }],
  });
  const record = "data/teaching/generic/invent-and-simplify.json";
  const before = {
    "principles:data/teaching/generic/index.json": catalog,
    ["principles:" + record]: "{}\n",
  };
  const removal = {
    op: "delete",
    repo: "principles",
    file: record,
    path: [],
  };
  assert.match(guard.review(before, before, [removal]).join("\n"), /needs its teaching catalog/);
  assert.match(guard.review({}, {}, [removal]).join("\n"), /needs its teaching catalog/);
  const catalogTouch = {
    op: "replace",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["title"],
    before: "Teaching",
    after: "Teaching.",
  };
  assert.match(guard.review(before, before, [removal, catalogTouch]).join("\n"), /still leaves it in the teaching catalog/);
  const cleared = guard.review(before, Object.assign({}, before, {
    "principles:data/teaching/generic/index.json": JSON.stringify({ principles: [{ id: 8001, slug: "ownership", file: "ownership.json" }] }),
  }), [removal, {
    op: "remove",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["principles"],
    index: 0,
    before: { id: 8006, slug: "invent-and-simplify", file: "invent-and-simplify.json" },
  }]);
  assert.equal(cleared.length, 0);
  const dropped = guard.review(before, {}, [removal, {
    op: "delete",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: [],
  }]);
  assert.equal(dropped.length, 0);
});

test("a shared BIQ list cannot grow on the company that only displays it", () => {
  const before = JSON.stringify({
    companies: [
      { id: "amazon", name: "Amazon", examples: true, principles: [{ id: 1001, name: "Customer Obsession", facets: ["customer-obsession"], questions: [{ id: "f76d64d6", text: "Tell me?", manager: false }] }] },
      { id: "generic", name: "Universal Leadership Principles", examples: false, principles: [{ id: 8001, name: "Customer Obsession", facets: ["customer-obsession"], questions: [] }] },
    ],
  });
  const after = JSON.parse(before);
  after.companies[1].principles[0].questions = [{ text: "Who changed the plan?" }];
  const errors = guard.review(
    { "biq:data/questions.json": before },
    { "biq:data/questions.json": JSON.stringify(after) },
    [{ repo: "biq", file: "data/questions.json", op: "insert", path: ["companies", { id: "generic" }, "principles", { id: 8001 }, "questions"], index: 0 }]
  );
  assert.match(errors.join("\n"), /shared from Amazon/);
});

test("a new BIQ question is accepted with its stub pack", () => {
  const beforeDoc = {
    companies: [
      { id: "amazon", name: "Amazon", examples: true, principles: [{ id: 1001, name: "Customer Obsession", facets: ["customer-obsession"], questions: [{ id: "f76d64d6", text: "Tell me?", manager: false }] }] },
      { id: "generic", name: "Universal Leadership Principles", examples: false, principles: [{ id: 8001, name: "Customer Obsession", facets: ["customer-obsession"], questions: [] }] },
    ],
  };
  const before = JSON.stringify(beforeDoc);
  const added = { text: "Who changed the plan?", manager: false, id: "abc12345" };
  const afterDoc = JSON.parse(before);
  afterDoc.companies[0].principles[0].questions.push(added);
  const pack = JSON.stringify({ principle_id: 1001, principle: "Customer Obsession", question: added.text }, null, 2) + "\n";
  const files = {
    "biq:data/questions.json": JSON.stringify(afterDoc),
    "biq:data/examples/abc12345.json": pack,
  };
  const errors = guard.review(
    { "biq:data/questions.json": before },
    files,
    [
      { repo: "biq", file: "data/questions.json", op: "insert", path: ["companies", { id: "amazon" }, "principles", { id: 1001 }, "questions"], index: 1, value: added },
      { repo: "biq", file: "data/examples/abc12345.json", op: "create", path: [], value: { principle_id: 1001, principle: "Customer Obsession", question: added.text } },
    ]
  );
  assert.deepEqual(errors, []);
  const wrong = Object.assign({}, files, {
    "biq:data/examples/abc12345.json": JSON.stringify({ principle_id: 1002, principle: "Ownership", question: added.text }),
  });
  const mismatch = guard.review({ "biq:data/questions.json": before }, wrong, [
    { repo: "biq", file: "data/questions.json", op: "insert", path: ["companies", { id: "amazon" }, "principles", { id: 1001 }, "questions"], index: 1 },
    { repo: "biq", file: "data/examples/abc12345.json", op: "create", path: [], value: { principle_id: 1002, principle: "Ownership", question: added.text } },
  ]);
  assert.match(mismatch.join("\n"), /different principle/);
});

test("a stub example pack is a new file next to the question", () => {
  const bank = JSON.stringify({
    companies: [{ id: "amazon", name: "Amazon", examples: true, principles: [{ id: 1001, name: "Customer Obsession", facets: ["customer-obsession"], questions: [{ text: "Tell me?", manager: false, id: "f76d64d6" }] }] }],
  }, null, 2) + "\n";
  const prepared = plan.prepare(
    { "biq:data/questions.json": bank },
    [
      {
        op: "insert",
        repo: "biq",
        file: "data/questions.json",
        path: ["companies", { id: "amazon" }, "principles", { id: 1001 }, "questions"],
        index: 1,
        value: { text: "Who changed the plan?", manager: false, id: "abc12345" },
        label: "Who changed the plan?",
        field: "added",
        company: "amazon",
      },
      {
        op: "create",
        repo: "biq",
        file: "data/examples/abc12345.json",
        path: [],
        value: { principle_id: 1001, principle: "Customer Obsession", question: "Who changed the plan?" },
        label: "Example pack",
        field: "added",
      },
    ],
    {}
  );
  assert.equal(prepared.ok, true, prepared.ok ? "" : prepared.errors[0].error);
  const pack = prepared.files.filter((file) => file.file.indexOf("examples/") !== -1)[0];
  assert.equal(pack.created, true);
  assert.match(pack.after, /Who changed the plan\?/);
  const wrongName = plan.prepare(
    { "biq:data/questions.json": bank },
    [
      {
        op: "insert",
        repo: "biq",
        file: "data/questions.json",
        path: ["companies", { id: "amazon" }, "principles", { id: 1001 }, "questions"],
        index: 1,
        value: { text: "Who changed the plan?", manager: false, id: "abc12345" },
        label: "Who changed the plan?",
        field: "added",
        company: "amazon",
      },
      {
        op: "create",
        repo: "biq",
        file: "data/examples/abc12345.json",
        path: [],
        value: { principle_id: 1001, principle: "Ownership", question: "Who changed the plan?" },
        label: "Example pack",
        field: "added",
      },
    ],
    {}
  );
  assert.equal(wrongName.ok, false);
  assert.match(wrongName.errors[0].error, /names a different principle/);
  assert.equal(allow.assess({
    op: "create",
    repo: "biq",
    file: "data/examples/abc12345.json",
    path: [],
    value: { principle_id: 1001, principle: "Customer Obsession", question: "Who changed the plan?" },
  }).ok, true);
});

test("a related note has to name a principle this company has", () => {
  const change = {
    op: "insert",
    repo: "principles",
    file: "data/teaching/generic/ownership.json",
    path: ["related"],
    index: 2,
    value: { id: "not-a-real-principle", note: "A note." },
    company: "generic",
  };
  const prepared = plan.prepare(
    {
      "principles:data/index.json": genericIndexText(),
      "principles:data/teaching/generic/ownership.json": teaching(8),
    },
    [change],
    { generic: slugs.generic.concat(["not-a-real-principle"]) }
  );
  assert.equal(prepared.ok, false);
  assert.match(prepared.errors[0].error, /Unknown principle/);
  const unloaded = plan.prepare(
    { "principles:data/teaching/generic/ownership.json": teaching(8) },
    [change],
    { generic: slugs.generic.concat(["not-a-real-principle"]) }
  );
  assert.equal(unloaded.ok, false);
  assert.match(unloaded.errors[0].error, /principle list/);
});

test("a facet id is the slug of its label and principles are numbers", () => {
  const row = {
    id: "the-work",
    situation: "The work.",
    under: "Does less.",
    justRight: "Does the job.",
    over: "Does every job.",
    words: "generated",
  };
  const mismatch = rules.checkItem({
    id: "not-the-label",
    label: "Customer Obsession",
    principles: [1001],
    rows: [row],
  }, { item: "facet" });
  assert.match(mismatch.join("\n"), /slug of its label/);
  const ampersand = rules.checkItem({
    id: "r-and-d",
    label: "R&D",
    principles: [1001],
    rows: [row],
  }, { item: "facet" });
  assert.equal(ampersand.join("\n"), "");
  const strings = rules.checkItem({
    id: "ownership",
    label: "Ownership",
    principles: ["1002"],
    rows: [row],
  }, { item: "facet" });
  assert.match(strings.join("\n"), /numeric id/);
});

test("a string principle id does not satisfy the facet list", () => {
  const row = {
    id: "the-work",
    situation: "The work.",
    under: "Does less.",
    justRight: "Does the job.",
    over: "Does every job.",
    words: "generated",
  };
  const facets = JSON.stringify({
    version: 1,
    facets: [{ id: "ownership", label: "Ownership", principles: ["1002"], rows: [row] }],
  });
  const index = JSON.stringify({ companies: [{ id: "amazon", principles: [{ id: 1002, facets: ["ownership"] }] }] });
  const questions = JSON.stringify({ companies: [{ id: "amazon", principles: [{ id: 1002, facets: ["ownership"], questions: [{ text: "Tell me?" }] }] }] });
  const map = JSON.stringify({ pairs: [{ sourceId: 1002, facets: ["ownership"] }] });
  const files = {
    "principles:data/facets.json": facets,
    "principles:data/index.json": index,
    "biq:data/questions.json": questions,
    "principles:data/maps/generic-amazon.json": map,
    "principles:data/maps/_list.json": JSON.stringify(["data/maps/generic-amazon.json"]),
  };
  const errors = guard.review(files, files, [{
    op: "insert",
    repo: "principles",
    file: "data/facets.json",
    path: ["facets"],
    index: 1,
  }]);
  assert.match(errors.join("\n"), /does not match the index/);
});

test("a removed facet cannot stay in the question bank facet map", () => {
  const row = {
    id: "the-work",
    situation: "The work.",
    under: "Does less.",
    justRight: "Does the job.",
    over: "Does every job.",
    words: "generated",
  };
  const beforeFacets = {
    version: 1,
    facets: [
      { id: "ownership", label: "Ownership", principles: [1002], rows: [row] },
      { id: "other", label: "Other", principles: [1002], rows: [row] },
    ],
  };
  const afterFacets = { version: 1, facets: [beforeFacets.facets[1]] };
  const index = JSON.stringify({ companies: [{ id: "amazon", principles: [{ id: 1002, facets: ["other"] }] }] });
  const questions = JSON.stringify({
    companies: [{ id: "amazon", principles: [{ id: 1002, facets: ["other"], questions: [{ text: "Tell me?" }] }] }],
    facetQuestions: { ownership: ["abcd1234"] },
  });
  const map = JSON.stringify({ pairs: [{ sourceId: 1002, facets: ["other"] }] });
  const before = {
    "principles:data/facets.json": JSON.stringify(beforeFacets),
    "principles:data/index.json": index,
    "biq:data/questions.json": questions,
    "principles:data/maps/generic-amazon.json": map,
    "principles:data/maps/_list.json": JSON.stringify(["data/maps/generic-amazon.json"]),
  };
  const errors = guard.review(before, Object.assign({}, before, {
    "principles:data/facets.json": JSON.stringify(afterFacets),
  }), [{
    op: "remove",
    repo: "principles",
    file: "data/facets.json",
    path: ["facets"],
    index: 0,
  }]);
  assert.match(errors.join("\n"), /still referenced by facet questions/);
});

test("a new teaching catalog checks each entry and each new reading link", () => {
  const essay = "https://blog.kindel.com/" + "2024/07/23/how-to-write-a-working-backwards-doc/";
  const emptyEntry = rules.structuralShape({
    principles: [{}],
    blog: [{ title: "A note", url: "https://kindel.com/a", note: "Why it belongs." }],
  }, "data/teaching/amazon/index.json", true);
  assert.match(emptyEntry.join("\n"), /numeric id/);
  const dated = rules.structuralShape({
    principles: [{ id: 1002, slug: "ownership", file: "ownership.json" }],
    blog: [{ title: "Working Backwards", url: essay, note: "A note." }],
  }, "data/teaching/amazon/index.json", true);
  assert.match(dated.join("\n"), /kindel\.com\/essays\//);
  const kept = rules.structuralShape({
    principles: [{}],
    blog: [{ title: "Working Backwards", url: essay, note: "A note." }],
  }, "data/teaching/amazon/index.json", false);
  assert.equal(kept.join("\n").indexOf("numeric id"), -1);
  assert.equal(kept.join("\n").indexOf("kindel.com/essays"), -1);
  const ok = rules.structuralShape({
    principles: [{ id: 1002, slug: "ownership", file: "ownership.json" }],
    blog: [{ title: "A note", url: "https://kindel.com/a", note: "Why it belongs." }],
  }, "data/teaching/amazon/index.json", true, { records: { ownership: 1002 } });
  assert.equal(ok.length, 0);
});

test("a new facet row has to be a complete calibration row", () => {
  const bad = rules.checkItem({
    id: "thin",
    label: "Thin",
    principles: [1001],
    rows: [{ id: "thin-row", words: "generated", under: "Too little." }],
  }, { item: "facet" });
  assert.match(bad.join("\n"), /situation/);
});

function facetDoc(rows) {
  return {
    version: 1,
    facets: [{
      id: "ownership",
      label: "ownership",
      principles: [1002],
      rows: rows,
    }],
  };
}

const generatedRow = {
  id: "the-work",
  situation: "The work",
  under: "Does less.",
  justRight: "Does the job.",
  over: "Does every job.",
  words: "generated",
};

function sourceFiles(facets) {
  return {
    "principles:data/facets.json": JSON.stringify(facets),
    "principles:data/index.json": JSON.stringify({
      companies: [{
        id: "amazon",
        principles: [
          { id: 1002, slug: "ownership", file: "data/amazon/ownership.json" },
          { id: 1001, slug: "customer-obsession", file: "data/amazon/customer-obsession.json" },
        ],
      }],
    }),
    "principles:data/amazon/ownership.json": JSON.stringify({
      id: 1002,
      rows: [{ id: "knowing-what-you-own" }],
    }),
    "principles:data/amazon/customer-obsession.json": JSON.stringify({
      id: 1001,
      rows: [{ id: "knowing-what-you-own" }],
    }),
  };
}

test("a source ref has to name a row on a principle this facet lists", () => {
  const files = sourceFiles(facetDoc([generatedRow]));
  function insert(value) {
    return plan.prepare(files, [{
      op: "insert",
      repo: "principles",
      file: "data/facets.json",
      path: ["facets", { id: "ownership" }, "rows"],
      index: 0,
      value: value,
    }]);
  }
  const missingPrinciple = insert({ principle: 9999, id: "missing-row" });
  assert.equal(missingPrinciple.ok, false);
  assert.match(missingPrinciple.errors[0].error, /does not list/);
  const missingRow = insert({ principle: 1002, id: "missing-row" });
  assert.equal(missingRow.ok, false);
  assert.match(missingRow.errors[0].error, /does not match a row/);
  const unlisted = insert({ principle: 1001, id: "knowing-what-you-own" });
  assert.equal(unlisted.ok, false);
  assert.match(unlisted.errors[0].error, /does not list/);
  const unloaded = plan.prepare({
    "principles:data/facets.json": files["principles:data/facets.json"],
  }, [{
    op: "insert",
    repo: "principles",
    file: "data/facets.json",
    path: ["facets", { id: "ownership" }, "rows"],
    index: 0,
    value: { principle: 1002, id: "knowing-what-you-own" },
  }]);
  assert.equal(unloaded.ok, false);
  assert.match(unloaded.errors[0].error, /not loaded/);
  const added = insert({ principle: 1002, id: "knowing-what-you-own" });
  assert.equal(added.ok, true, JSON.stringify(added.errors));
  const present = facetDoc([{ principle: 1002, id: "knowing-what-you-own" }, generatedRow]);
  const moved = plan.prepare(sourceFiles(present), [{
    op: "move",
    repo: "principles",
    file: "data/facets.json",
    path: ["facets", { id: "ownership" }, "rows"],
    index: 0,
    to: 1,
    before: { principle: 1002, id: "knowing-what-you-own" },
  }]);
  assert.equal(moved.ok, true, JSON.stringify(moved.errors));
  const stale = facetDoc([{ principle: 1002, id: "missing-row" }, generatedRow]);
  const movedMissing = plan.prepare(sourceFiles(stale), [{
    op: "move",
    repo: "principles",
    file: "data/facets.json",
    path: ["facets", { id: "ownership" }, "rows"],
    index: 0,
    to: 1,
    before: { principle: 1002, id: "missing-row" },
  }]);
  assert.equal(movedMissing.ok, false);
  assert.match(movedMissing.errors[0].error, /does not match a row/);
});

test("a save cannot produce two facets with the same id", () => {
  const before = facetDoc([generatedRow]);
  const duplicate = plan.prepare({
    "principles:data/facets.json": JSON.stringify(before),
  }, [{
    op: "insert",
    repo: "principles",
    file: "data/facets.json",
    path: ["facets"],
    index: 1,
    value: {
      id: "ownership",
      label: "ownership",
      principles: [1002],
      rows: [generatedRow],
    },
  }]);
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.errors[0].error, /Facet id ownership is already used/);
  const distinct = JSON.parse(JSON.stringify(before));
  distinct.facets.push({
    id: "customer-obsession",
    label: "customer obsession",
    principles: [1001],
    rows: [generatedRow],
  });
  const emptyRows = { "1001": Object.create(null), "1002": Object.create(null) };
  assert.equal(rules.structuralShape(distinct, "data/facets.json", false, { rowsByPrinciple: emptyRows }).length, 0);
});

test("a facet save rejects duplicate row ids and a generated id that shadows a source ref", () => {
  const source = { principle: 1002, id: "knowing-what-you-own" };
  const otherSource = { principle: 1001, id: "knowing-what-you-own" };
  const rowMap = {
    "1002": { "knowing-what-you-own": true },
    "1001": { "knowing-what-you-own": true },
  };
  function shape(rows, principles) {
    const doc = facetDoc(rows);
    if (principles) doc.facets[0].principles = principles;
    return rules.structuralShape(doc, "data/facets.json", false, { rowsByPrinciple: rowMap }).join("\n");
  }
  assert.match(shape([source, generatedRow, Object.assign({}, generatedRow)]), /Row id the-work is already used/);
  assert.match(shape([source, source, generatedRow]), /Source ref 1002\/knowing-what-you-own is already used/);
  assert.match(shape([source, Object.assign({}, generatedRow, { id: "knowing-what-you-own" })]), /Generated row id knowing-what-you-own reuses a source ref id/);
  assert.match(shape([Object.assign({}, generatedRow, { id: "knowing-what-you-own" }), source]), /Source ref 1002\/knowing-what-you-own reuses a generated row id/);
  assert.equal(shape([source, otherSource, generatedRow], [1002, 1001]), "");
  const before = facetDoc([source, generatedRow]);
  const duplicate = plan.prepare(sourceFiles(before), [{
    op: "insert",
    repo: "principles",
    file: "data/facets.json",
    path: ["facets", { id: "ownership" }, "rows"],
    index: 2,
    value: Object.assign({}, generatedRow),
  }]);
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.errors[0].error, /Row id the-work is already used/);
});

test("removing the last source ref is refused when a listed principle has record rows", () => {
  const source = { principle: 1002, id: "knowing-what-you-own" };
  const before = facetDoc([source, generatedRow]);
  function removeSource(files) {
    return plan.prepare(files, [{
      op: "remove",
      repo: "principles",
      file: "data/facets.json",
      path: ["facets", { id: "ownership" }, "rows"],
      index: 0,
      before: source,
    }]);
  }
  const removed = removeSource(sourceFiles(before));
  assert.equal(removed.ok, false);
  assert.match(removed.errors[0].error, /Facet ownership needs at least one source ref/);
  const unloaded = removeSource({
    "principles:data/facets.json": JSON.stringify(before),
    "principles:data/index.json": sourceFiles(before)["principles:data/index.json"],
  });
  assert.equal(unloaded.ok, false);
  assert.match(unloaded.errors[0].error, /not loaded/);
  const emptyFiles = sourceFiles(before);
  emptyFiles["principles:data/amazon/ownership.json"] = JSON.stringify({ id: 1002, rows: [] });
  const allowed = removeSource(emptyFiles);
  assert.equal(allowed.ok, true, JSON.stringify(allowed.errors));
  const second = { principle: 1002, id: "second-row" };
  const keptDoc = facetDoc([source, second, generatedRow]);
  const keptFiles = sourceFiles(keptDoc);
  keptFiles["principles:data/amazon/ownership.json"] = JSON.stringify({
    id: 1002,
    rows: [{ id: "knowing-what-you-own" }, { id: "second-row" }],
  });
  const kept = plan.prepare(keptFiles, [{
    op: "remove",
    repo: "principles",
    file: "data/facets.json",
    path: ["facets", { id: "ownership" }, "rows"],
    index: 0,
    before: source,
  }]);
  assert.equal(kept.ok, true, JSON.stringify(kept.errors));
});

test("a generated-only facet is refused when a listed principle has record rows", () => {
  const before = facetDoc([{ principle: 1002, id: "knowing-what-you-own" }, generatedRow]);
  const inserted = plan.prepare(sourceFiles(before), [{
    op: "insert",
    repo: "principles",
    file: "data/facets.json",
    path: ["facets"],
    index: 1,
    value: {
      id: "customer-obsession",
      label: "customer obsession",
      principles: [1001],
      rows: [generatedRow],
    },
  }]);
  assert.equal(inserted.ok, false);
  assert.match(inserted.errors[0].error, /Facet customer-obsession needs at least one source ref/);
  const mixed = {
    version: 1,
    facets: [
      before.facets[0],
      {
        id: "customer-obsession",
        label: "customer obsession",
        principles: [1001],
        rows: [generatedRow],
      },
    ],
  };
  const blocked = plan.prepare(sourceFiles(mixed), [{
    op: "move",
    repo: "principles",
    file: "data/facets.json",
    path: ["facets", { id: "ownership" }, "rows"],
    index: 0,
    to: 1,
    before: { principle: 1002, id: "knowing-what-you-own" },
  }]);
  assert.equal(blocked.ok, false);
  assert.match(blocked.errors[0].error, /Facet customer-obsession needs at least one source ref/);
  const allowedDoc = JSON.parse(JSON.stringify(mixed));
  assert.equal(rules.structuralShape(allowedDoc, "data/facets.json", false, {
    rowsByPrinciple: {
      "1002": { "knowing-what-you-own": true },
      "1001": Object.create(null),
    },
  }).length, 0);
});

const records = { ownership: 8002, "earn-trust": 8003, "deliver-results": 8004 };

test("a new teaching record checks each entry", () => {
  const doc = JSON.parse(teaching(8));
  doc.examples = [{}, {}];
  const errors = rules.structuralShape(doc, "data/teaching/generic/ownership.json", true, { slugs: slugs.generic, records: records });
  assert.match(errors.join("\n"), /example needs a title/);
});

test("a new teaching record has to match its principle", () => {
  const doc = JSON.parse(teaching(8));
  const file = "data/teaching/generic/ownership.json";
  const spec = { slugs: slugs.generic, records: records };
  assert.equal(rules.structuralShape(doc, file, true, spec).length, 0);
  const missingId = JSON.parse(teaching(8));
  delete missingId.id;
  assert.match(rules.structuralShape(missingId, file, true, spec).join("\n"), /numeric id/);
  const boolId = JSON.parse(teaching(8));
  boolId.id = true;
  assert.match(rules.structuralShape(boolId, file, true, spec).join("\n"), /numeric id/);
  const wrongSlug = JSON.parse(teaching(8));
  wrongSlug.slug = "earn-trust";
  assert.match(rules.structuralShape(wrongSlug, file, true, spec).join("\n"), /slug has to match its file/);
  const unknown = rules.structuralShape(doc, file, true, { slugs: slugs.generic, records: { "earn-trust": 8003 } });
  assert.match(unknown.join("\n"), /no principle named ownership/);
  const wrongId = JSON.parse(teaching(8));
  wrongId.id = 1111;
  assert.match(rules.structuralShape(wrongId, file, true, spec).join("\n"), /id does not match the principle/);
  const unloaded = rules.structuralShape(doc, file, true, { slugs: slugs.generic });
  assert.match(unloaded.join("\n"), /principle list for this company is missing/);
  const existing = JSON.parse(teaching(8));
  existing.id = "8002";
  existing.slug = "not-the-file";
  const kept = rules.structuralShape(existing, file, false, spec);
  assert.equal(kept.join("\n").indexOf("numeric id"), -1);
  assert.equal(kept.join("\n").indexOf("match its file"), -1);
  const indexText = JSON.stringify({
    companies: [{
      id: "generic",
      principles: [
        { id: 8002, slug: "ownership" },
        { id: 8003, slug: "earn-trust" },
        { id: 8004, slug: "deliver-results" },
      ],
    }],
  });
  const create = {
    op: "create",
    repo: "principles",
    file: file,
    path: [],
    value: JSON.parse(teaching(8)),
    company: "generic",
  };
  const catalog = {
    op: "create",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: [],
    value: {
      title: "Universal: a user's manual",
      principles: [{ id: 8002, slug: "ownership", file: "ownership.json" }],
      blog: [{ title: "A note", url: "https://kindel.com/a", note: "Why it belongs." }],
    },
    company: "generic",
  };
  const prepared = plan.prepare({ "principles:data/index.json": indexText }, [create, catalog], slugs);
  assert.equal(prepared.ok, true, prepared.ok ? "" : prepared.errors[0].error);
  const mismatched = JSON.parse(JSON.stringify(create));
  mismatched.value = JSON.parse(teaching(8));
  mismatched.value.id = 1111;
  const refused = plan.prepare({ "principles:data/index.json": indexText }, [mismatched], slugs);
  assert.equal(refused.ok, false);
  assert.match(refused.errors[0].error, /id does not match the principle/);
});

test("a new teaching catalog checks a reading token for resolution only", () => {
  const indexText = JSON.stringify({
    companies: [{
      id: "generic",
      principles: [
        { id: 8002, slug: "ownership" },
        { id: 8003, slug: "earn-trust" },
        { id: 8004, slug: "deliver-results" },
      ],
    }],
  });
  const catalog = {
    op: "create",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: [],
    value: {
      title: "Universal: a user's manual",
      principles: [{ id: 8002, slug: "ownership", file: "ownership.json" }],
      blog: [{ title: "A note", url: "https://kindel.com/a", note: "See {lp:ownership}." }],
    },
    company: "generic",
  };
  const files = {
    "principles:data/index.json": indexText,
    "principles:data/teaching/generic/ownership.json": teaching(8),
  };
  const ok = plan.prepare(files, [catalog], slugs);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  const unknown = {
    op: "create",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: [],
    value: {
      title: "Universal: a user's manual",
      principles: [{ id: 8002, slug: "ownership", file: "ownership.json" }],
      blog: [{ title: "A note", url: "https://kindel.com/a", note: "See {lp:not-a-principle}." }],
    },
    company: "generic",
  };
  const bad = plan.prepare(files, [unknown], slugs);
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0].error, /Unknown principle link/);
  assert.equal(bad.errors[0].error.indexOf("missing from related"), -1);
  const record = JSON.parse(teaching(8));
  record.blog[0].note = "See {lp:ownership}.";
  const recordCreate = {
    op: "create",
    repo: "principles",
    file: "data/teaching/generic/ownership.json",
    path: [],
    value: record,
    company: "generic",
  };
  const needsRelated = plan.prepare({ "principles:data/index.json": indexText }, [recordCreate], slugs);
  assert.equal(needsRelated.ok, false);
  assert.match(needsRelated.errors[0].error, /missing from related/);
});

test("a catalog id has to match the company principle", () => {
  const indexText = JSON.stringify({
    companies: [{
      id: "generic",
      principles: [
        { id: 8002, slug: "ownership" },
        { id: 8003, slug: "earn-trust" },
        { id: 8004, slug: "deliver-results" },
      ],
    }],
  });
  const catalogText = JSON.stringify({
    principles: [{ id: 8002, slug: "ownership", file: "ownership.json" }],
    blog: [{ title: "A note", url: "https://kindel.com/a", note: "Why it belongs." }],
  });
  const wrongInsert = {
    op: "insert",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: ["principles"],
    index: 1,
    value: { id: 1111, slug: "earn-trust", file: "earn-trust.json" },
    company: "generic",
  };
  const inserted = plan.prepare({
    "principles:data/index.json": indexText,
    "principles:data/teaching/generic/index.json": catalogText,
  }, [wrongInsert], slugs);
  assert.equal(inserted.ok, false);
  assert.match(inserted.errors[0].error, /id does not match the principle/);
  const created = plan.prepare({ "principles:data/index.json": indexText }, [{
    op: "create",
    repo: "principles",
    file: "data/teaching/generic/index.json",
    path: [],
    value: {
      title: "Universal: a user's manual",
      principles: [{ id: 1111, slug: "ownership", file: "ownership.json" }],
      blog: [{ title: "A note", url: "https://kindel.com/a", note: "Why it belongs." }],
    },
    company: "generic",
  }], slugs);
  assert.equal(created.ok, false);
  assert.match(created.errors[0].error, /id does not match the principle/);
  const unloaded = plan.prepare({
    "principles:data/teaching/generic/index.json": catalogText,
  }, [wrongInsert], slugs);
  assert.equal(unloaded.ok, false);
  assert.match(unloaded.errors[0].error, /principle list for this company is missing/);
});

test("adding teaching lists the record, and a catalog entry needs the file", () => {
  const record = teaching(8);
  const missingCatalog = guard.review({}, {
    "principles:data/teaching/amazon/ownership.json": record,
  }, [{
    op: "create",
    repo: "principles",
    file: "data/teaching/amazon/ownership.json",
    path: [],
    value: JSON.parse(record),
  }]);
  assert.match(missingCatalog.join("\n"), /needs its teaching catalog/);
  const catalog = JSON.stringify({
    principles: [{ id: 1002, slug: "ownership", file: "ownership.json" }],
    blog: [{ title: "A note", url: "https://kindel.com/a", note: "Why it belongs." }],
  });
  const missingRecord = guard.review({
    "principles:data/teaching/amazon/index.json": JSON.stringify({ principles: [], blog: [{ title: "A note", url: "https://kindel.com/a", note: "Why it belongs." }] }),
  }, {
    "principles:data/teaching/amazon/index.json": catalog,
  }, [{
    op: "insert",
    repo: "principles",
    file: "data/teaching/amazon/index.json",
    path: ["principles"],
    index: 0,
    value: { id: 1002, slug: "ownership", file: "ownership.json" },
  }]);
  assert.match(missingRecord.join("\n"), /not in this save/);
});

test("an example pack has to match a question in the save", () => {
  const bank = JSON.stringify({
    companies: [{ id: "amazon", principles: [{ id: 1001, questions: [{ id: "f76d64d6", text: "Tell me?" }] }] }],
  });
  const errors = guard.review({
    "biq:data/questions.json": bank,
  }, {
    "biq:data/questions.json": bank,
    "biq:data/examples/abc12345.json": "{}\n",
  }, [{
    op: "create",
    repo: "biq",
    file: "data/examples/abc12345.json",
    path: [],
    value: { principle_id: 1001, principle: "Customer Obsession", question: "Who changed the plan?" },
  }]);
  assert.match(errors.join("\n"), /does not match a question/);
});

test("a facet change needs every map named in the repository list", () => {
  const facets = JSON.stringify({ version: 1, facets: [] });
  const index = JSON.stringify({ companies: [{ id: "amazon", principles: [{ id: 1002, facets: [] }] }] });
  const questions = JSON.stringify({ companies: [{ id: "amazon", principles: [{ id: 1002, facets: [], questions: [{ text: "Tell me?" }] }] }] });
  const errors = guard.review({
    "principles:data/facets.json": facets,
    "principles:data/index.json": index,
    "biq:data/questions.json": questions,
    "principles:data/maps/_list.json": JSON.stringify(["data/maps/generic-amazon.json", "data/maps/generic-arm.json"]),
  }, {
    "principles:data/facets.json": facets,
    "principles:data/index.json": index,
    "biq:data/questions.json": questions,
    "principles:data/maps/_list.json": JSON.stringify(["data/maps/generic-amazon.json", "data/maps/generic-arm.json"]),
    "principles:data/maps/generic-amazon.json": JSON.stringify({ pairs: [] }),
  }, [{
    op: "remove",
    repo: "principles",
    file: "data/facets.json",
    path: ["facets"],
    index: 0,
  }]);
  assert.match(errors.join("\n"), /generic-arm.json is not in this save/);
});

test("a question still named by a facet cannot be removed", () => {
  const before = JSON.stringify({
    companies: [{ id: "amazon", name: "Amazon", examples: true, principles: [{ id: 1001, name: "Customer Obsession", questions: [{ id: "abcd1234", text: "Tell me?" }, { id: "bbbb2222", text: "Another?" }] }] }],
    facetQuestions: { "customer-obsession": { ids: ["abcd1234"], authored: [] } },
  });
  const after = JSON.stringify({
    companies: [{ id: "amazon", name: "Amazon", examples: true, principles: [{ id: 1001, name: "Customer Obsession", questions: [{ id: "bbbb2222", text: "Another?" }] }] }],
    facetQuestions: { "customer-obsession": { ids: ["abcd1234"], authored: [] } },
  });
  const errors = guard.review(
    { "biq:data/questions.json": before },
    { "biq:data/questions.json": after },
    [{ repo: "biq", file: "data/questions.json", op: "remove", path: ["companies", { id: "amazon" }, "principles", { id: 1001 }, "questions"], index: 0 }]
  );
  assert.match(errors.join("\n"), /abcd1234 is still linked from customer-obsession/);
});

test("facet questions keep a principle covered when its stored list is empty", () => {
  const before = JSON.stringify({
    companies: [{ id: "generic", name: "Universal Leadership Principles", examples: false, principles: [{ id: 8001, name: "Customer Obsession", facets: ["customer-obsession"], questions: [] }] }],
    facetQuestions: { "customer-obsession": { ids: ["abcd1234"], authored: [{ text: "Tell me?" }] } },
  });
  const after = JSON.stringify({
    companies: [{ id: "generic", name: "Universal Leadership Principles", examples: false, principles: [{ id: 8001, name: "Customer Obsession", facets: [], questions: [] }] }],
    facetQuestions: { "customer-obsession": { ids: ["abcd1234"], authored: [{ text: "Tell me?" }] } },
  });
  const errors = guard.review(
    { "biq:data/questions.json": before },
    { "biq:data/questions.json": after },
    [{ repo: "biq", file: "data/questions.json", op: "remove", path: ["companies", { id: "generic" }, "principles", { id: 8001 }, "facets"], index: 0 }]
  );
  assert.match(errors.join("\n"), /Customer Obsession would have no BIQ question/);
});

test("removing a calibration row a facet names is refused", () => {
  const kept = {
    id: "knowing-what-you-own",
    situation: "The work",
    under: "Does less.",
    justRight: "Does the job.",
    over: "Does every job.",
  };
  const other = {
    id: "second-row",
    situation: "The other work",
    under: "Does less.",
    justRight: "Does the job.",
    over: "Does every job.",
  };
  const record = { id: 1002, rows: [kept, other] };
  const facets = {
    version: 1,
    facets: [{
      id: "ownership",
      label: "ownership",
      principles: [1002],
      rows: [
        { principle: 1002, id: "knowing-what-you-own" },
        {
          id: "the-work",
          situation: "The work",
          under: "Does less.",
          justRight: "Does the job.",
          over: "Does every job.",
          words: "generated",
        },
      ],
    }],
  };
  function removeRow(index, before) {
    return {
      op: "remove",
      repo: "principles",
      file: "data/amazon/ownership.json",
      path: ["rows"],
      index: index,
      before: before,
    };
  }
  const named = plan.prepare({
    "principles:data/amazon/ownership.json": JSON.stringify(record),
    "principles:data/facets.json": JSON.stringify(facets),
  }, [removeRow(0, kept)]);
  assert.equal(named.ok, false);
  assert.match(named.errors[0].error, /does not match a row/);
  const missingMap = plan.prepare({
    "principles:data/amazon/ownership.json": JSON.stringify(record),
  }, [removeRow(1, other)]);
  assert.equal(missingMap.ok, false);
  assert.match(missingMap.errors[0].error, /facet map is not loaded/);
  const otherFacets = JSON.parse(JSON.stringify(facets));
  otherFacets.facets[0].rows[0] = { principle: 1001, id: "knowing-what-you-own" };
  const unloaded = plan.prepare({
    "principles:data/amazon/ownership.json": JSON.stringify(record),
    "principles:data/facets.json": JSON.stringify(otherFacets),
  }, [removeRow(1, other)]);
  assert.equal(unloaded.ok, false);
  assert.match(unloaded.errors[0].error, /not loaded/);
  const stillNamed = plan.prepare({
    "principles:data/amazon/ownership.json": JSON.stringify(record),
    "principles:data/facets.json": JSON.stringify(facets),
  }, [removeRow(1, other)]);
  assert.equal(stillNamed.ok, true, JSON.stringify(stillNamed.errors));
});

test("a principle row id cannot be reused", () => {
  const row = {
    id: "knowing-what-you-own",
    situation: "The work",
    under: "Does less.",
    justRight: "Does the job.",
    over: "Does every job.",
  };
  const record = { id: 1002, rows: [row] };
  const files = {
    "principles:data/amazon/ownership.json": JSON.stringify(record),
    "principles:data/facets.json": JSON.stringify({ version: 1, facets: [] }),
  };
  function insert(id) {
    return plan.prepare(files, [{
      op: "insert",
      repo: "principles",
      file: "data/amazon/ownership.json",
      path: ["rows"],
      index: 1,
      value: {
        id: id,
        situation: "Another situation",
        under: "Does less.",
        justRight: "Does the job.",
        over: "Does every job.",
      },
    }]);
  }
  const duplicate = insert("knowing-what-you-own");
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.errors[0].error, /Row id knowing-what-you-own is already used/);
  const distinct = insert("second-row");
  assert.equal(distinct.ok, true, JSON.stringify(distinct.errors));
});

test("a question id cannot move onto another principle", () => {
  const before = JSON.stringify({
    companies: [{
      id: "amazon",
      name: "Amazon",
      examples: true,
      principles: [
        { id: 1001, name: "Customer Obsession", questions: [{ id: "abcd1234", text: "Tell me?" }, { id: "cccc3333", text: "Another?" }] },
        { id: 1002, name: "Ownership", questions: [{ id: "bbbb2222", text: "Who owns this?" }] },
      ],
    }],
  });
  const after = JSON.stringify({
    companies: [{
      id: "amazon",
      name: "Amazon",
      examples: true,
      principles: [
        { id: 1001, name: "Customer Obsession", questions: [{ id: "cccc3333", text: "Another?" }] },
        { id: 1002, name: "Ownership", questions: [{ id: "bbbb2222", text: "Who owns this?" }, { id: "abcd1234", text: "Tell me?" }] },
      ],
    }],
  });
  const errors = guard.review(
    { "biq:data/questions.json": before },
    { "biq:data/questions.json": after, "biq:data/examples/abcd1234.json": JSON.stringify({ principle_id: 1002, question: "Tell me?" }) },
    [
      { repo: "biq", file: "data/questions.json", op: "remove", path: ["companies", { id: "amazon" }, "principles", { id: 1001 }, "questions"], index: 0 },
      { repo: "biq", file: "data/questions.json", op: "insert", path: ["companies", { id: "amazon" }, "principles", { id: 1002 }, "questions"], index: 1, value: { id: "abcd1234", text: "Tell me?" } },
    ]
  );
  assert.match(errors.join("\n"), /abcd1234 already belongs to a different principle/);
});

test("a support file is not a saved example pack", () => {
  const bank = JSON.stringify({
    companies: [{ id: "amazon", name: "Amazon", examples: true, principles: [{ id: 1001, name: "Customer Obsession", questions: [{ id: "f76d64d6", text: "Tell me?", manager: false }] }] }],
  }, null, 2) + "\n";
  const added = { text: "Who changed the plan?", manager: false, id: "abc12345" };
  const prepared = plan.prepare({
    "biq:data/questions.json": bank,
    "biq:data/examples/abc12345.json": JSON.stringify({ principle_id: 1001, principle: "Customer Obsession", question: added.text }, null, 2) + "\n",
  }, [{
    op: "insert",
    repo: "biq",
    file: "data/questions.json",
    path: ["companies", { id: "amazon" }, "principles", { id: 1001 }, "questions"],
    index: 1,
    value: added,
  }], {});
  assert.equal(prepared.ok, false);
  assert.match(prepared.errors[0].error, /example pack/);
  const withPack = plan.prepare({
    "biq:data/questions.json": bank,
  }, [{
    op: "insert",
    repo: "biq",
    file: "data/questions.json",
    path: ["companies", { id: "amazon" }, "principles", { id: 1001 }, "questions"],
    index: 1,
    value: added,
  }, {
    op: "create",
    repo: "biq",
    file: "data/examples/abc12345.json",
    path: [],
    value: { principle_id: 1001, principle: "Customer Obsession", question: added.text },
  }], {});
  assert.equal(withPack.ok, true, JSON.stringify(withPack.errors));
  assert.ok(withPack.files.some((file) => file.file === "data/examples/abc12345.json"));
});

test("a support catalog does not stand in for the catalog change", () => {
  const indexText = JSON.stringify({
    companies: [{
      id: "generic",
      principles: [
        { id: 8002, slug: "ownership" },
        { id: 8003, slug: "earn-trust" },
        { id: 8004, slug: "deliver-results" },
      ],
    }],
  });
  const catalog = JSON.stringify({
    principles: [{ id: 8002, slug: "ownership", file: "ownership.json" }],
    blog: [{ title: "A note", url: "https://kindel.com/a", note: "Why it belongs." }],
  });
  const create = {
    op: "create",
    repo: "principles",
    file: "data/teaching/generic/ownership.json",
    path: [],
    value: JSON.parse(teaching(8)),
    company: "generic",
  };
  const prepared = plan.prepare({
    "principles:data/index.json": indexText,
    "principles:data/teaching/generic/index.json": catalog,
  }, [create], slugs);
  assert.equal(prepared.ok, false);
  assert.match(prepared.errors[0].error, /needs its teaching catalog/);
  const record = "data/teaching/generic/invent-and-simplify.json";
  const removed = plan.prepare({
    "principles:data/teaching/generic/index.json": JSON.stringify({
      principles: [{ id: 8001, slug: "ownership", file: "ownership.json" }],
      blog: [{ title: "A note", url: "https://kindel.com/a", note: "Why it belongs." }],
    }),
    ["principles:" + record]: "{}\n",
  }, [{
    op: "delete",
    repo: "principles",
    file: record,
    path: [],
    company: "generic",
  }], { generic: ["invent-and-simplify"] });
  assert.equal(removed.ok, false);
  assert.match(removed.errors[0].error, /needs its teaching catalog/);
});

test("calibration words stay inside quoted, authored, and generated", () => {
  const row = {
    id: "the-work",
    situation: "The work",
    under: "Does less.",
    justRight: "Does the job.",
    over: "Does every job.",
    words: "borrowed",
  };
  assert.match(rules.checkItem(row, { item: "row" }).join("\n"), /quoted, authored, or generated/);
  const authored = Object.assign({}, row, { words: "authored" });
  assert.equal(rules.checkItem(authored, { item: "row" }).length, 0);
  const unmarked = Object.assign({}, row);
  delete unmarked.words;
  assert.equal(rules.checkItem(unmarked, { item: "row" }).length, 0);
  assert.match(rules.structuralShape({ rows: [row] }, "data/dawn/ownership.json", false).join("\n"), /quoted, authored, or generated/);
  const before = JSON.stringify({
    rows: [{
      id: "better-than-yesterday",
      situation: "Yesterday",
      under: "Does less.",
      justRight: "Does the job.",
      over: "Does every job.",
      words: "quoted",
    }],
  });
  const insert = {
    op: "insert",
    repo: "principles",
    file: "data/dawn/ownership.json",
    path: ["rows"],
    index: 1,
    value: unmarked,
  };
  const dawnFiles = {
    "principles:data/dawn/ownership.json": before,
    "principles:data/facets.json": JSON.stringify({ version: 1, facets: [] }),
  };
  const missing = plan.prepare(dawnFiles, [insert], {});
  assert.equal(missing.ok, false);
  assert.match(missing.errors[0].error, /words/);
  const marked = JSON.parse(JSON.stringify(insert));
  marked.value = authored;
  const saved = plan.prepare(dawnFiles, [marked], {});
  assert.equal(saved.ok, true, JSON.stringify(saved.errors));
  assert.match(saved.files[0].after, /"words": "authored"/);
});

test("a source ref cannot carry inline prose", () => {
  const spec = {
    item: "facetRow",
    facetPrinciples: [1002],
    rowsByPrinciple: { "1002": { "knowing-what-you-own": true } },
  };
  const partial = rules.checkItem({ principle: 1002, id: "knowing-what-you-own", under: "Does less." }, spec);
  assert.match(partial.join("\n"), /must not name a principle/);
  assert.match(partial.join("\n"), /situation/);
  const bare = rules.checkItem({ principle: 1002, id: "knowing-what-you-own" }, spec);
  assert.deepEqual(bare, []);
  const inserted = plan.prepare(sourceFiles(facetDoc([generatedRow])), [{
    op: "insert",
    repo: "principles",
    file: "data/facets.json",
    path: ["facets", { id: "ownership" }, "rows"],
    index: 0,
    value: { principle: 1002, id: "knowing-what-you-own", under: "Does less." },
  }]);
  assert.equal(inserted.ok, false);
  assert.match(inserted.errors[0].error, /must not name a principle|situation/);
});

test("a facet label rejects an em dash, an en dash, and ---", () => {
  function labeled(label) {
    return rules.checkItem({
      id: "ownership-deep",
      label: label,
      principles: [1002],
      rows: [generatedRow],
    }, { item: "facet" }).join("\n");
  }
  assert.match(labeled("Ownership\u2014deep"), /em dash/);
  assert.match(labeled("Ownership\u2013deep"), /en dash/);
  assert.match(labeled("Ownership---deep"), /---/);
  const plain = labeled("Ownership deep");
  assert.equal(plain.indexOf("dash"), -1);
  assert.equal(plain.indexOf("---"), -1);
});

test("a teaching catalog rejects prohibited dashes and keeps an en dash in a reading title", () => {
  const entry = { id: 1002, slug: "ownership", file: "ownership.json" };
  const blog = [{ title: "A note", url: "https://kindel.com/a", note: "Why it belongs." }];
  function shape(doc) {
    return rules.structuralShape(doc, "data/teaching/amazon/index.json", false, { records: { ownership: 1002 } }).join("\n");
  }
  assert.match(shape({
    principles: [entry],
    blog: [{ title: "A note", url: "https://kindel.com/a", note: "Why\u2014it belongs." }],
  }), /em dash/);
  assert.match(shape({
    principles: [entry],
    blog: [{ title: "A note", url: "https://kindel.com/a", note: "Why---it belongs." }],
  }), /---/);
  assert.match(shape({
    principles: [entry],
    blog: [{ title: "A note", url: "https://kindel.com/a", note: "Why\u2013it belongs." }],
  }), /en dash/);
  assert.equal(shape({
    principles: [entry],
    blog: [{ title: "2019\u20132020", url: "https://kindel.com/a", note: "Why it belongs." }],
  }), "");
  assert.equal(shape({ principles: [entry], blog: blog }), "");
});

test("a facet added only on the target principle is refused", () => {
  const facets = {
    version: 1,
    facets: [{
      id: "ownership",
      label: "ownership",
      principles: [8002, 1002],
      rows: [generatedRow],
    }],
  };
  const index = {
    companies: [
      { id: "generic", principles: [{ id: 8002, slug: "ownership", facets: ["ownership"] }] },
      { id: "amazon", principles: [{ id: 1002, slug: "ownership", facets: ["ownership"] }] },
    ],
  };
  const questions = {
    companies: [
      { id: "generic", principles: [{ id: 8002, facets: ["ownership"], questions: [{ text: "Tell me?" }] }] },
      { id: "amazon", principles: [{ id: 1002, facets: ["ownership"], questions: [{ text: "Tell me?" }] }] },
    ],
  };
  const map = {
    source: "generic",
    target: "amazon",
    pairs: [{ sourceId: 8002, facets: ["ownership"], targetIds: [1002] }],
  };
  const before = {
    "principles:data/facets.json": JSON.stringify(facets),
    "principles:data/index.json": JSON.stringify(index),
    "biq:data/questions.json": JSON.stringify(questions),
    "principles:data/maps/generic-amazon.json": JSON.stringify(map),
    "principles:data/maps/_list.json": JSON.stringify(["data/maps/generic-amazon.json"]),
  };
  const afterFacets = JSON.parse(JSON.stringify(facets));
  afterFacets.facets.push({
    id: "extra",
    label: "extra",
    principles: [1002],
    rows: [generatedRow],
  });
  const afterIndex = JSON.parse(JSON.stringify(index));
  afterIndex.companies[1].principles[0].facets = ["extra", "ownership"];
  const afterQuestions = JSON.parse(JSON.stringify(questions));
  afterQuestions.companies[1].principles[0].facets = ["extra", "ownership"];
  const errors = guard.review(before, Object.assign({}, before, {
    "principles:data/facets.json": JSON.stringify(afterFacets),
    "principles:data/index.json": JSON.stringify(afterIndex),
    "biq:data/questions.json": JSON.stringify(afterQuestions),
  }), [{
    op: "insert",
    repo: "principles",
    file: "data/facets.json",
    path: ["facets"],
    index: 1,
  }]);
  assert.match(errors.join("\n"), /does not match the target facets of principle 8002/);
  const matched = JSON.parse(JSON.stringify(map));
  matched.pairs[0].facets = ["extra", "ownership"];
  const sourceAlso = JSON.parse(JSON.stringify(afterFacets));
  sourceAlso.facets[1].principles = [8002, 1002];
  const alignedIndex = JSON.parse(JSON.stringify(afterIndex));
  alignedIndex.companies[0].principles[0].facets = ["extra", "ownership"];
  const alignedQuestions = JSON.parse(JSON.stringify(afterQuestions));
  alignedQuestions.companies[0].principles[0].facets = ["extra", "ownership"];
  const same = guard.review(before, Object.assign({}, before, {
    "principles:data/facets.json": JSON.stringify(sourceAlso),
    "principles:data/index.json": JSON.stringify(alignedIndex),
    "biq:data/questions.json": JSON.stringify(alignedQuestions),
    "principles:data/maps/generic-amazon.json": JSON.stringify(matched),
  }), [{
    op: "insert",
    repo: "principles",
    file: "data/facets.json",
    path: ["facets"],
    index: 1,
  }]);
  assert.equal(same.join("\n").indexOf("target facets"), -1);
});

function packLevel() {
  return {
    raiseTranscript: [{ role: "candidate", text: "Yes." }],
    lowerTranscript: [{ role: "candidate", text: "No." }],
    raiseFeedback: "Raises.",
    lowerFeedback: "Lowers.",
  };
}

function completePack() {
  return {
    principle_id: 1001,
    principle: "Customer Obsession",
    question: "Another?",
    levels: { junior: packLevel(), senior: packLevel(), exec: packLevel() },
  };
}

test("removing a BIQ question requires a remaining complete pack", () => {
  const beforeDoc = {
    companies: [{
      id: "amazon",
      name: "Amazon",
      examples: true,
      principles: [{
        id: 1001,
        name: "Customer Obsession",
        questions: [
          { id: "abcd1234", text: "Tell me?" },
          { id: "bbbb2222", text: "Another?" },
        ],
      }],
    }],
  };
  const afterDoc = JSON.parse(JSON.stringify(beforeDoc));
  afterDoc.companies[0].principles[0].questions = [{ id: "bbbb2222", text: "Another?" }];
  const before = { "biq:data/questions.json": JSON.stringify(beforeDoc) };
  const change = [{
    repo: "biq",
    file: "data/questions.json",
    op: "remove",
    path: ["companies", { id: "amazon" }, "principles", { id: 1001 }, "questions"],
    index: 0,
  }];
  function reviewPack(pack) {
    const after = { "biq:data/questions.json": JSON.stringify(afterDoc) };
    if (pack) after["biq:data/examples/bbbb2222.json"] = JSON.stringify(pack);
    return guard.review(before, after, change).join("\n");
  }
  assert.match(reviewPack(null), /Customer Obsession would have no question with Junior, Senior, and Exec examples/);
  assert.match(reviewPack({ principle_id: 1001, question: "Another?" }), /Junior, Senior, and Exec/);
  const partial = completePack();
  delete partial.levels.exec;
  assert.match(reviewPack(partial), /Junior, Senior, and Exec/);
  const emptyTranscript = completePack();
  emptyTranscript.levels.junior.raiseTranscript = [];
  assert.match(reviewPack(emptyTranscript), /Junior, Senior, and Exec/);
  const splitAfter = JSON.parse(JSON.stringify(beforeDoc));
  splitAfter.companies[0].principles[0].questions = [
    { id: "bbbb2222", text: "Another?" },
    { id: "cccc3333", text: "Third?" },
  ];
  const juniorOnly = { levels: { junior: packLevel(), senior: packLevel() } };
  const execOnly = { levels: { exec: packLevel() } };
  const split = guard.review(before, {
    "biq:data/questions.json": JSON.stringify(splitAfter),
    "biq:data/examples/bbbb2222.json": JSON.stringify(juniorOnly),
    "biq:data/examples/cccc3333.json": JSON.stringify(execOnly),
  }, change);
  assert.match(split.join("\n"), /Junior, Senior, and Exec/);
  assert.deepEqual(guard.review(before, {
    "biq:data/questions.json": JSON.stringify(afterDoc),
    "biq:data/examples/bbbb2222.json": JSON.stringify(completePack()),
  }, change), []);
});
