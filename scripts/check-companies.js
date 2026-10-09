#!/usr/bin/env node
"use strict";

// Fails when kindel/principles or kindel/biq main publishes a company id
// that lib/allow.js does not allow. Facet builds edits from those lists,
// and knownCompany rejects any other id before a save.

var allow = require("../lib/allow.js");

var SOURCES = [
  ["principles", "https://raw.githubusercontent.com/kindel/principles/main/data/index.json"],
  ["biq", "https://raw.githubusercontent.com/kindel/biq/main/data/questions.json"],
];

function companyIds(name, doc) {
  if (!doc || !Array.isArray(doc.companies)) {
    throw new Error(name + " has no companies array");
  }
  var ids = [];
  for (var i = 0; i < doc.companies.length; i++) {
    var company = doc.companies[i];
    if (!company || typeof company.id !== "string") {
      throw new Error(name + " company " + i + " has no id");
    }
    ids.push(company.id);
  }
  return ids;
}

async function main() {
  var failed = false;
  for (var s = 0; s < SOURCES.length; s++) {
    var name = SOURCES[s][0];
    var res = await fetch(SOURCES[s][1]);
    if (!res.ok) throw new Error(name + " returned " + res.status);
    var missing = allow.missingCompanies(companyIds(name, await res.json()));
    if (missing.length) {
      console.error(name + " publishes companies the allowlist rejects: " + missing.join(", "));
      failed = true;
    }
  }
  if (failed) process.exit(1);
  console.log("Allowlist covers every company in principles and BIQ.");
}

main().catch(function (err) {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
