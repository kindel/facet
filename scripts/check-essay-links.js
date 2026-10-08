#!/usr/bin/env node
"use strict";

// Fails when a blog.kindel.com post URL uses a slug from the Essays category.
// data/essay_slugs.json is a snapshot of that category (slug essays, id 448).
// Refresh: fetch every page of
// https://blog.kindel.com/wp-json/wp/v2/posts?categories=448&per_page=100&_fields=id,slug,link
// (follow X-WP-TotalPages) and rebuild by_slug and by_id the way
// kindelwww static/js/essay-links.js catalogFromPosts does.
// A dated permalink maps its last path segment. A ?p= id maps by_id.
// Links to posts that are not in the snapshot stay on blog.kindel.com.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const snap = JSON.parse(fs.readFileSync(path.join(root, "data", "essay_slugs.json"), "utf8"));
const bySlug = snap.by_slug || {};
const byId = snap.by_id || {};

const skipDir = new Set([".git", "node_modules", ".tools", "public", "resources", ".hugo_cache", "themes", "fixtures"]);
const skipFile = new Set(["essay_slugs.json", "essay-links.test.mjs", "essay-links.js", "essay-catalog.js", "check-essay-links.js"]);
const textExt = new Set([".html", ".md", ".js", ".mjs", ".json", ".css", ".go", ".txt", ".toml", ".yml", ".yaml"]);
const dated = /https?:\/\/(?:www\.)?blog\.kindel\.com\/\d{4}\/\d{2}\/\d{2}\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?/gi;
const byP = /https?:\/\/(?:www\.)?blog\.kindel\.com\/(?:index\.php)?\?[^"'\\\s>]*\bp=(\d+)/gi;

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (skipDir.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
}

const files = [];
walk(root, files);
const fail = [];
for (const file of files) {
  if (skipFile.has(path.basename(file))) continue;
  const ext = path.extname(file).toLowerCase();
  if (ext && !textExt.has(ext)) continue;
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    continue;
  }
  if (text.indexOf("\u0000") !== -1) continue;
  dated.lastIndex = 0;
  let m;
  while ((m = dated.exec(text))) {
    const slug = m[1].toLowerCase();
    if (Object.hasOwn(bySlug, slug)) fail.push(path.relative(root, file) + ": " + m[0]);
  }
  byP.lastIndex = 0;
  while ((m = byP.exec(text))) {
    const id = String(Number(m[1]));
    if (Object.hasOwn(byId, id)) fail.push(path.relative(root, file) + ": " + m[0]);
  }
}
if (fail.length) {
  console.error("essay link check: FAIL");
  fail.slice(0, 40).forEach(function (line) { console.error("  " + line); });
  if (fail.length > 40) console.error("  ... and " + (fail.length - 40) + " more");
  process.exit(1);
}
console.log("essay link check: ok");
