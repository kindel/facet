import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const links = require(join(root, "js/essay-links.js"));

const context = { window: {} };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(readFileSync(join(root, "js/essay-catalog.js"), "utf8"), context);
const catalog = context.window.KINDEL_ESSAY_CATALOG;

function apex(href) {
  const next = links.rewriteHref(href, catalog);
  if (typeof next === "string" && next.indexOf("/essays/") === 0) return "https://kindel.com" + next;
  return next;
}

test("further reading for an essay opens on kindel.com", () => {
  const blog = "https://blog.kindel.com/" + "2020/02/10/tenets/";
  assert.equal(apex(blog), "https://kindel.com/essays/tenets/");
  assert.equal(apex(blog + "#load"), "https://kindel.com/essays/tenets/#load");
  const other = "https://blog.kindel.com/2011/08/08/after-21-years-goodbye-microsoft/";
  assert.equal(apex(other), other);
  const engineer = "https://blog.kindel.com/2026/07/25/principal-engineer-tenets-unless-you-know-better-ones/";
  assert.equal(apex(engineer), engineer);
});

test("the page loads the matcher before the editor", () => {
  const index = readFileSync(join(root, "index.html"), "utf8");
  const layout = readFileSync(join(root, "layouts/page/facet.html"), "utf8");
  const source = readFileSync(join(root, "js/facet.js"), "utf8");
  for (const html of [index, layout]) {
    assert.ok(html.indexOf("essay-links.js") !== -1);
    assert.ok(html.indexOf("essay-links.js") < html.indexOf("facet.js"));
    assert.ok(html.indexOf("essay-catalog.js") < html.indexOf("facet.js"));
  }
  assert.match(source, /function essayHref/);
  assert.match(source, /essayHref\(url\)/);
  assert.match(source, /essayHref\(value\)/);
  assert.match(source, /essayHref\(after\)/);
});

test("checked-in copy does not point an essay at the blog", () => {
  const skip = new Set(["essay-links.test.mjs", "essay-links.js", "essay-catalog.js", "essay_slugs.json", "check-essay-links.js"]);
  const skipDir = new Set([".git", "node_modules"]);
  const dated = /https?:\/\/(?:www\.)?blog\.kindel\.com\/\d{4}\/\d{2}\/\d{2}\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?/gi;
  const hits = [];
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (skipDir.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (skip.has(name)) continue;
      const text = readFileSync(full, "utf8");
      dated.lastIndex = 0;
      let match;
      while ((match = dated.exec(text))) {
        if (catalog.bySlug[match[1].toLowerCase()]) hits.push(relative(root, full) + ": " + match[0]);
      }
    }
  }
  walk(root);
  assert.deepEqual(hits, []);
});
