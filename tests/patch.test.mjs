import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const patch = require("../lib/patch.js");
const plan = require("../lib/plan.js");
const rules = require("../lib/rules.js");

const original = `{
  "id": 1002,
  "slug": "ownership",
  "name": "Ownership",
  "rows": [
    {
      "id": "knowing-what-you-own",
      "situation": "Knowing what you own",
      "under": "Waits to be told the edges of the job.",
      "justRight": "Can name the outcome they own, and the edges they do not.",
      "over": "Treats every adjacent problem as theirs to solve tonight."
    },
    {
      "id": "credit-and-blame",
      "situation": "Credit and blame",
      "under": "Points at the other team.",
      "justRight": "Shares the credit and keeps the miss.",
      "over": "Narrates their own heroics in the writeup."
    }
  ]
}
`;

test("a string replace leaves every other byte alone", () => {
  const path = ["rows", { id: "knowing-what-you-own" }, "under"];
  const before = "Waits to be told the edges of the job.";
  const after = "Waits to be assigned the edges of the job.";
  const next = patch.applyPatches(original, [{ path, before, after }]);
  const oldLines = original.split("\n");
  const newLines = next.split("\n");
  assert.equal(newLines.length, oldLines.length);
  const changed = newLines.filter((line, i) => line !== oldLines[i]);
  assert.deepEqual(changed, ['      "under": "Waits to be assigned the edges of the job.",']);
  assert.equal(JSON.parse(next).rows[0].under, after);
  assert.equal(JSON.parse(next).rows[0].justRight, JSON.parse(original).rows[0].justRight);
  assert.equal(JSON.parse(next).rows[1].under, JSON.parse(original).rows[1].under);
  assert.ok(next.includes('      "situation": "Knowing what you own",'));
  assert.ok(next.endsWith("}\n") || next.endsWith("}"));
});

test("two fields in one file each change only their own line", () => {
  const patches = [
    {
      path: ["rows", { id: "knowing-what-you-own" }, "over"],
      before: "Treats every adjacent problem as theirs to solve tonight.",
      after: "Treats every adjacent problem as theirs to solve this week.",
    },
    {
      path: ["rows", { id: "credit-and-blame" }, "situation"],
      before: "Credit and blame",
      after: "Credit and the miss",
    },
  ];
  const next = patch.applyPatches(original, patches);
  const oldLines = original.split("\n");
  const newLines = next.split("\n");
  const changed = newLines.filter((line, i) => line !== oldLines[i]);
  assert.equal(changed.length, 2);
  assert.match(changed[0], /solve this week/);
  assert.match(changed[1], /Credit and the miss/);
});

test("a stale before value is rejected and the file is untouched", () => {
  assert.throws(
    () => patch.applyPatches(original, [{
      path: ["rows", 0, "under"],
      before: "not the current text",
      after: "New text.",
    }]),
    (err) => err.code === "CONFLICT"
  );
});

test("quotes and apostrophes stay valid JSON without reformatting neighbors", () => {
  const after = 'Says "not mine" and moves on.';
  const next = patch.applyPatches(original, [{
    path: ["rows", 1, "under"],
    before: "Points at the other team.",
    after,
  }]);
  assert.equal(JSON.parse(next).rows[1].under, after);
  assert.ok(next.includes('"under": "Says \\"not mine\\" and moves on."'));
  assert.ok(next.includes('"id": "credit-and-blame"'));
});

test("the diff hunk is the edited line, not a rewrite of the file", () => {
  const prepared = plan.prepare(
    { "principles:data/amazon/ownership.json": original },
    [{
      repo: "principles",
      file: "data/amazon/ownership.json",
      path: ["rows", { id: "credit-and-blame" }, "justRight"],
      before: "Shares the credit and keeps the miss.",
      after: "Shares the credit and names the miss.",
      label: "Credit and blame",
      field: "Just right",
    }]
  );
  assert.equal(prepared.ok, true);
  const pulls = plan.buildPlan(prepared, { name: "Ada", note: "Clearer verb.", now: Date.UTC(2026, 9, 7, 15, 4, 5), suffix: "ab12" });
  assert.equal(pulls.length, 1);
  assert.equal(pulls[0].branch, "editor/submission-20261007-150405-ab12");
  assert.match(pulls[0].files[0].patch, /^\-\-\- a\/data\/amazon\/ownership\.json/m);
  assert.match(pulls[0].files[0].patch, /^- {6}"justRight": "Shares the credit and keeps the miss\.",$/m);
  assert.match(pulls[0].files[0].patch, /^\+ {6}"justRight": "Shares the credit and names the miss\.",$/m);
  assert.doesNotMatch(pulls[0].files[0].patch, /"slug": "ownership"/);
  assert.match(pulls[0].files[0].patch, /^@@ -14,7 \+14,7 @@/m);
  assert.match(pulls[0].title, /^Facet: Edit Credit and blame, Just right/);
  assert.match(pulls[0].message, /Edit content from Facet on kindel.com/);
  assert.match(pulls[0].body, /^Opened from Facet on kindel.com\./);
  assert.match(pulls[0].body, /Name: Ada/);
  assert.match(pulls[0].body, /Clearer verb/);
  assert.match(pulls[0].body, /## Amazon/);
  assert.match(pulls[0].body, /### Ownership/);
  assert.match(pulls[0].body, /Credit and blame, field Just right/);
  assert.match(pulls[0].body, /data\/amazon\/ownership\.json/);
  assert.doesNotMatch(pulls[0].body, /\u2014/);
});

test("quoted calibration skips the sentence count, authored text does not", () => {
  const quoted = original.replace(
    '"id": "knowing-what-you-own"',
    '"id": "knowing-what-you-own",\n      "words": "quoted"'
  );
  const long = "One. Two. Three. Four. Five.";
  const ok = plan.prepare(
    { "principles:data/dawn/own-it.json": quoted },
    [{
      repo: "principles",
      file: "data/dawn/own-it.json",
      path: ["rows", { id: "knowing-what-you-own" }, "under"],
      before: "Waits to be told the edges of the job.",
      after: long,
    }]
  );
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  const blocked = plan.prepare(
    { "principles:data/amazon/ownership.json": original },
    [{
      repo: "principles",
      file: "data/amazon/ownership.json",
      path: ["rows", { id: "knowing-what-you-own" }, "under"],
      before: "Waits to be told the edges of the job.",
      after: long,
    }]
  );
  assert.equal(blocked.ok, false);
  assert.match(blocked.errors[0].error, /one to three sentences/i);
});

test("nearby edits share one hunk so context is not stale", () => {
  const before = '{\n  "a": "one",\n  "b": "two",\n  "c": "three"\n}\n';
  const after = '{\n  "a": "ONE",\n  "b": "two",\n  "c": "THREE"\n}\n';
  const patchText = plan.lineDiff(before, after, "data/sample.json");
  const headers = patchText.split("\n").filter((line) => line.startsWith("@@"));
  assert.equal(headers.length, 1);
  assert.match(patchText, /^   "b": "two",$/m);
  assert.doesNotMatch(patchText, /^- {2}"b":/m);
});

test("a teaching link must resolve and be listed in related", () => {
  const doc = {
    why: ["See {lp:ownership}."],
    related: [
      { id: "ownership", note: "The owner." },
      { id: "bias-for-action", note: "The bias." },
    ],
  };
  const slugs = ["ownership", "bias-for-action", "deliver-results"];
  assert.deepEqual(rules.teachingLinks(doc, slugs, true), []);
  assert.match(rules.teachingLinks({ ...doc, why: ["See {lp:missing}."] }, slugs, true)[0], /Unknown principle link/);
  assert.match(rules.teachingLinks({
    why: ["See {lp:deliver-results}."],
    related: doc.related,
  }, slugs, true)[0], /missing from related/);
});

test("em dashes, triple hyphens, and en dashes are rejected", () => {
  assert.ok(rules.checkText("Wait \u2014 then go.", {}).some((e) => /em dash/.test(e)));
  assert.ok(rules.checkText("Wait --- then go.", {}).some((e) => /---/.test(e)));
  assert.ok(rules.checkText("Wait \u2013 then go.", {}).length);
  assert.equal(rules.checkText("2019\u20132020 report", { allowEnDash: true }).length, 0);
});

test("deepen questions must end with a question mark", () => {
  const teaching = `{
  "deepen": [
    "Who owns the outcome?"
  ],
  "blog": [
    {"title": "A note", "url": "https://blog.kindel.com/x/", "note": "Why it belongs."}
  ]
}
`;
  const bad = plan.prepare(
    { "principles:data/teaching/amazon/ownership.json": teaching },
    [{
      repo: "principles",
      file: "data/teaching/amazon/ownership.json",
      path: ["deepen", 0],
      before: "Who owns the outcome?",
      after: "Who owns the outcome",
    }]
  );
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0].error, /\?/);
});

function onlyThoseTokens(before, after, pairs) {
  let expected = before;
  for (const [from, to] of pairs) {
    const oldToken = JSON.stringify(from);
    const newToken = JSON.stringify(to);
    const at = expected.indexOf(oldToken);
    assert.notEqual(at, -1, oldToken);
    assert.equal(expected.indexOf(oldToken, at + oldToken.length), -1, "ambiguous " + oldToken);
    expected = expected.slice(0, at) + newToken + expected.slice(at + oldToken.length);
  }
  assert.equal(after, expected);
}

function changedDiffLines(patchText) {
  return patchText.split("\n").filter((line) =>
    (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---")
  );
}

test("thirty plus edits across companies make one pull request per repo and touch only those fields", () => {
  const companies = [
    ["generic", "Generic"],
    ["amazon", "Amazon"],
    ["arm", "Arm"],
    ["coupang", "Coupang"],
  ];
  const files = {};
  const changes = [];
  companies.forEach(([company, companyName], companyIndex) => {
    for (let n = 0; n < 8; n++) {
      const slug = `principle-${companyIndex}-${n}`;
      const file = `data/${company}/${slug}.json`;
      const before = "Does the job.";
      const after = "Does the job well.";
      const text = `{
  "id": ${1000 + companyIndex},
  "slug": "${slug}",
  "rows": [
    {
      "id": "the-work",
      "situation": "The work in front of them",
      "under": "Does less than the job asks.",
      "justRight": "${before}",
      "over": "Does everyone else's job too."
    }
  ]
}
`;
      files[`principles:${file}`] = text;
      changes.push({
        repo: "principles",
        file,
        path: ["rows", { id: "the-work" }, "justRight"],
        before,
        after,
        label: "The work in front of them",
        field: "Just right",
        company,
        companyName,
        principleName: `Principle ${n}`,
      });
    }
  });

  const facetBefore = "Clears the block.";
  const facetAfter = "Clears the block today.";
  files["principles:data/facets.json"] = `{
  "facets": [
    {
      "id": "customer-obsession",
      "rows": [
        {
          "id": "blocked-customer",
          "situation": "A customer is blocked",
          "under": "Files the ticket and waits.",
          "justRight": "${facetBefore}",
          "over": "Drops the rest of the week.",
          "words": "generated"
        }
      ]
    }
  ]
}
`;
  changes.push({
    repo: "principles",
    file: "data/facets.json",
    path: ["facets", { id: "customer-obsession" }, "rows", { id: "blocked-customer" }, "justRight"],
    before: facetBefore,
    after: facetAfter,
    label: "A customer is blocked",
    field: "Just right",
    shared: true,
    principleName: "Customer obsession",
  });

  const questions = {
    amazon: [
      ["aaaa0001", "Tell me about a customer.", "Tell me about a customer you kept."],
      ["aaaa0002", "Tell me about a miss.", "Tell me about a miss you owned."],
    ],
    coupang: [
      ["bbbb0003", "Tell me about a launch.", "Tell me about a launch you ran."],
      ["bbbb0004", "Tell me about a tradeoff.", "Tell me about a tradeoff you made."],
    ],
  };
  const questionDoc = {
    companies: Object.entries(questions).map(([company, rows]) => ({
      id: company,
      principles: [{
        id: company === "amazon" ? 1001 : 3001,
        questions: rows.map(([id, text]) => ({ id, text })),
      }],
    })),
  };
  const questionText = JSON.stringify(questionDoc, null, 2) + "\n";
  files["biq:data/questions.json"] = questionText;
  Object.entries(questions).forEach(([company, rows]) => {
    const companyName = company === "amazon" ? "Amazon" : "Coupang";
    rows.forEach(([id, before, after]) => {
      changes.push({
        repo: "biq",
        file: "data/questions.json",
        path: ["companies", { id: company }, "principles", { id: company === "amazon" ? 1001 : 3001 }, "questions", { id }, "text"],
        before,
        after,
        label: before,
        field: "Question",
        company,
        companyName,
        principleName: company === "amazon" ? "Customer Obsession" : "Wow the Customer",
      });
    });
  });

  assert.ok(changes.length >= 30, String(changes.length));
  const prepared = plan.prepare(files, changes);
  assert.equal(prepared.ok, true, JSON.stringify(prepared.errors));
  prepared.files.forEach((file) => {
    const pairs = file.changes.map((change) => [change.before, change.after]);
    onlyThoseTokens(file.before, file.after, pairs);
    JSON.parse(file.after);
  });

  const pulls = plan.buildPlan(prepared, {
    name: "Ada",
    note: "A session of wording fixes.",
    now: Date.UTC(2026, 9, 7, 18, 0, 0),
    suffix: "batch",
  });
  assert.equal(pulls.length, 2);
  const principles = pulls.find((pull) => pull.repoKey === "principles");
  const biq = pulls.find((pull) => pull.repoKey === "biq");
  assert.equal(principles.files.length, 33);
  assert.equal(biq.files.length, 1);
  assert.equal(principles.branch, "editor/submission-20261007-180000-batchp");
  assert.equal(biq.branch, "editor/submission-20261007-180000-batchb");
  for (const pull of pulls) {
    assert.doesNotMatch(pull.body, /\u2014/);
    assert.ok(pull.body.length < 65536);
  }
  assert.match(principles.body, /## Generic\n\n### Principle 0/);
  assert.match(principles.body, /## Amazon\n\n### Principle 0/);
  assert.match(principles.body, /## Arm/);
  assert.match(principles.body, /## Coupang/);
  assert.match(principles.body, /## Shared\n\n### Customer obsession/);
  const amazonAt = principles.body.indexOf("## Amazon");
  const armAt = principles.body.indexOf("## Arm");
  const sharedAt = principles.body.indexOf("## Shared");
  assert.ok(amazonAt > principles.body.indexOf("## Generic"));
  assert.ok(armAt > amazonAt);
  assert.ok(sharedAt > principles.body.indexOf("## Coupang"));
  const amazonSection = principles.body.slice(amazonAt, armAt);
  assert.equal(amazonSection.split("\n").filter((line) => line.startsWith("- ")).length, 8);
  assert.match(biq.body, /## Amazon\n\n### Customer Obsession/);
  assert.match(biq.body, /## Coupang\n\n### Wow the Customer/);
  assert.equal(biq.body.split("\n").filter((line) => line.startsWith("- ")).length, 4);

  principles.files.forEach((file) => {
    const lines = changedDiffLines(file.patch);
    assert.equal(lines.length, 2, file.path + "\n" + file.patch);
    assert.match(lines[0], /justRight/);
    assert.match(lines[1], /justRight/);
    assert.doesNotMatch(file.patch, /^[+-].*"under":/m);
    assert.doesNotMatch(file.patch, /^[+-].*"over":/m);
    assert.doesNotMatch(file.patch, /^[+-].*"words":/m);
  });
  const questionLines = changedDiffLines(biq.files[0].patch);
  assert.equal(questionLines.length, 8);
  assert.ok(questionLines.every((line) => /"text":/.test(line)));
});

test("sentence split matches the principles validator", () => {
  assert.equal(rules.sentenceCount('Seeks input and is not "always." Seeks it again.'), 2);
  assert.equal(rules.sentenceCount("One sentence only."), 1);
  assert.equal(rules.sentenceCount("One. Two. Three."), 3);
});
