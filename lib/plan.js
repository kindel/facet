"use strict";

var allow = require("./allow");
var rules = require("./rules");
var patch = require("./patch");
var guard = require("./guard");

function cleanLabel(value) {
  return guard.clip(value, guard.MAX_LABEL).replace(/\u2014/g, ",").replace(/---/g, ",");
}

function specFor(text, change, spec, slugs) {
  var next = Object.assign({}, spec);
  if (spec.sentences || spec.requireGenerated) {
    var parentPath = change.path.slice(0, -1);
    var parent;
    try {
      parent = patch.locate(text, parentPath).value;
    } catch (err) {
      return { error: "That field is not in the file." };
    }
    if (!parent || typeof parent !== "object") return { error: "That field is not in the file." };
    if (spec.requireGenerated && parent.words !== "generated") {
      return { error: "Only generated facet rows can be edited here." };
    }
    if (spec.sentences && parent.words === "quoted") next.sentences = false;
  }
  if (spec.tokens && slugs) next.slugs = slugs;
  return { spec: next };
}

function prepare(files, changes, slugsByCompany) {
  var errors = [];
  var seen = {};
  var grouped = {};
  for (var i = 0; i < changes.length; i++) {
    var change = changes[i];
    var gate = allow.assess(change);
    if (!gate.ok) {
      errors.push({ index: i, error: gate.error });
      continue;
    }
    var key = allow.pathKey(change);
    if (seen[key]) {
      errors.push({ index: i, error: "That field is edited twice." });
      continue;
    }
    seen[key] = true;
    var fileKey = change.repo + ":" + change.file;
    if (!grouped[fileKey]) grouped[fileKey] = { repo: change.repo, file: change.file, changes: [] };
    grouped[fileKey].changes.push({ change: change, spec: gate.spec, index: i });
  }
  if (errors.length) return { ok: false, errors: errors };

  var fileKeys = Object.keys(grouped);
  var built = [];
  for (var f = 0; f < fileKeys.length; f++) {
    var group = grouped[fileKeys[f]];
    var original = files[fileKeys[f]];
    if (typeof original !== "string") {
      errors.push({ index: group.changes[0].index, error: "The original file text is missing." });
      continue;
    }
    var parsed;
    try {
      parsed = JSON.parse(original);
    } catch (err) {
      errors.push({ index: group.changes[0].index, error: "That file is not valid JSON." });
      continue;
    }
    if (!parsed) {
      errors.push({ index: group.changes[0].index, error: "That file is not valid JSON." });
      continue;
    }
    var teachingFile = group.file.indexOf("data/teaching/") === 0;
    var slugs = null;
    var company = group.changes[0].spec.company;
    if (company && slugsByCompany && Array.isArray(slugsByCompany[company])) slugs = slugsByCompany[company];
    var patches = [];
    for (var c = 0; c < group.changes.length; c++) {
      var item = group.changes[c];
      var resolved = specFor(original, item.change, item.spec, slugs);
      if (resolved.error) {
        errors.push({ index: item.index, error: resolved.error });
        continue;
      }
      var textErrors = rules.checkText(item.change.after, resolved.spec);
      if (textErrors.length) {
        errors.push({ index: item.index, error: textErrors[0], errors: textErrors });
        continue;
      }
      patches.push(item.change);
    }
    if (errors.length) continue;
    var next;
    try {
      next = patch.applyPatches(original, patches);
    } catch (err) {
      var message = err.code === "CONFLICT"
        ? "The file changed since it was loaded. Reload and try that edit again."
        : "That field is not in the file.";
      errors.push({ index: group.changes[0].index, error: message });
      continue;
    }
    if (teachingFile) {
      if (!slugs) {
        errors.push({ index: group.changes[0].index, error: "The principle list for this company is missing, so this save cannot be checked." });
        continue;
      }
      var linked = rules.teachingLinks(JSON.parse(next), slugs, group.file.slice(-11) !== "/index.json");
      if (linked.length) {
        errors.push({ index: group.changes[0].index, error: linked[0] });
        continue;
      }
    }
    built.push({
      repo: group.repo,
      file: group.file,
      before: original,
      after: next,
      changes: group.changes.map(function (item) { return item.change; }),
    });
  }
  if (errors.length) return { ok: false, errors: errors };
  return { ok: true, files: built };
}

function lineDiff(before, after, filePath) {
  var a = before.split("\n");
  var b = after.split("\n");
  var out = ["--- a/" + filePath, "+++ b/" + filePath];
  if (a.length === b.length) {
    var changed = [];
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) changed.push(i);
    if (!changed.length) return "";
    var ranges = [];
    var start = changed[0];
    var end = changed[0];
    for (var c = 1; c < changed.length; c++) {
      if (changed[c] <= end + 6) end = changed[c];
      else {
        ranges.push([start, end]);
        start = changed[c];
        end = changed[c];
      }
    }
    ranges.push([start, end]);
    for (var r = 0; r < ranges.length; r++) {
      var from = Math.max(0, ranges[r][0] - 3);
      var to = Math.min(a.length, ranges[r][1] + 4);
      out.push("@@ -" + (from + 1) + "," + (to - from) + " +" + (from + 1) + "," + (to - from) + " @@");
      for (var line = from; line < to; line++) {
        if (a[line] === b[line]) out.push(" " + a[line]);
        else {
          out.push("-" + a[line]);
          out.push("+" + b[line]);
        }
      }
    }
    return out.join("\n") + "\n";
  }
  out.push("@@ -1," + a.length + " +" + "1," + b.length + " @@");
  for (var n = 0; n < a.length; n++) out.push("-" + a[n]);
  for (var m = 0; m < b.length; m++) out.push("+" + b[m]);
  return out.join("\n") + "\n";
}

function fieldPath(path) {
  var parts = [];
  for (var i = 0; i < path.length; i++) {
    var step = path[i];
    if (typeof step === "string") parts.push(step);
    else if (typeof step === "number") parts.push(String(step));
    else if (step && step.id != null) parts.push(String(step.id));
    else if (step && step.url) parts.push("url");
    else parts.push("?");
  }
  return parts.join(".");
}

function branchName(now, suffix) {
  var d = new Date(now);
  function p(n) { return String(n).padStart(2, "0"); }
  var stamp = d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "-" + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds());
  var tail = suffix || Math.random().toString(16).slice(2, 6);
  return "editor/submission-" + stamp + "-" + tail;
}

function describe(change) {
  var label = cleanLabel(change.label) || fieldPath(change.path);
  var field = cleanLabel(change.field) || (change.path.length ? String(change.path[change.path.length - 1]) : "field");
  return { label: label, field: field, path: fieldPath(change.path) };
}

var COMPANY_ORDER = Object.keys(allow.COMPANIES);

function titleWord(value) {
  var parts = String(value || "").split("-");
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].slice(1);
  }
  return parts.join(" ");
}

function locateChange(change) {
  var companyId = typeof change.company === "string" ? change.company.trim() : "";
  var companyName = cleanLabel(change.companyName);
  var principleName = cleanLabel(change.principleName || change.principle);
  var shared = change.shared === true;
  var file = String(change.file || "");
  if (!shared && !companyId && !companyName) {
    if (file === "data/facets.json") shared = true;
    else {
      var teach = /^data\/teaching\/([a-z0-9-]+)\//.exec(file);
      var rec = /^data\/([a-z0-9-]+)\/([a-z0-9-]+)\.json$/.exec(file);
      if (teach) companyId = teach[1];
      else if (rec) {
        companyId = rec[1];
        if (!principleName) principleName = titleWord(rec[2]);
      }
    }
  }
  if (!companyName && companyId) companyName = titleWord(companyId);
  if (shared) {
    return {
      id: "shared",
      name: "Shared",
      principle: principleName || "Facet rows",
      order: COMPANY_ORDER.length + 1,
    };
  }
  if (!companyName) {
    return {
      id: "other",
      name: "Other",
      principle: principleName || "Fields",
      order: COMPANY_ORDER.length + 2,
    };
  }
  var order = COMPANY_ORDER.indexOf(companyId || companyName.toLowerCase());
  if (order < 0) order = COMPANY_ORDER.length;
  return {
    id: companyId || companyName.toLowerCase(),
    name: companyName,
    principle: principleName || "Fields",
    order: order,
  };
}

function pullBody(changes, name, note) {
  var lines = ["Opened from Facet on kindel.com.", ""];
  var who = cleanLabel(name);
  var why = guard.clip(note, guard.MAX_NOTE).replace(/\u2014/g, ",").replace(/---/g, ",");
  if (who) lines.push("Name: " + who, "");
  if (why) lines.push("Note:", why, "");

  var groups = [];
  var byCompany = Object.create(null);
  for (var i = 0; i < changes.length; i++) {
    var spot = locateChange(changes[i]);
    if (!byCompany[spot.id]) {
      byCompany[spot.id] = { id: spot.id, name: spot.name, order: spot.order, principles: Object.create(null) };
      groups.push(byCompany[spot.id]);
    }
    var bucket = byCompany[spot.id].principles;
    if (!bucket[spot.principle]) bucket[spot.principle] = [];
    bucket[spot.principle].push(changes[i]);
  }
  groups.sort(function (a, b) {
    if (a.order !== b.order) return a.order - b.order;
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  });
  for (var g = 0; g < groups.length; g++) {
    lines.push("## " + groups[g].name, "");
    var principles = Object.keys(groups[g].principles).sort(function (a, b) {
      var al = a.toLowerCase();
      var bl = b.toLowerCase();
      if (al < bl) return -1;
      if (al > bl) return 1;
      return 0;
    });
    for (var p = 0; p < principles.length; p++) {
      lines.push("### " + principles[p], "");
      var items = groups[g].principles[principles[p]];
      for (var c = 0; c < items.length; c++) {
        var d = describe(items[c]);
        lines.push("- " + d.label + ", field " + d.field);
        lines.push("  - " + items[c].repo + " `" + items[c].file + "` `" + d.path + "`");
      }
      lines.push("");
    }
  }
  lines.push("Review the diff on this pull request. Only these fields were edited.");
  var body = lines.join("\n");
  if (body.length <= 60000) return body;
  var kept = [];
  var used = 0;
  var tail = "\n\nFurther edits are in the diff. Only these fields were edited.\n";
  for (var n = 0; n < lines.length; n++) {
    if (used + lines[n].length + 1 + tail.length > 60000) break;
    kept.push(lines[n]);
    used += lines[n].length + 1;
  }
  return kept.join("\n") + tail;
}

function pullTitle(changes) {
  if (changes.length === 1) {
    var d = describe(changes[0]);
    return ("Facet: Edit " + d.label + ", " + d.field).slice(0, 120);
  }
  return ("Facet: Edit " + changes.length + " content fields").slice(0, 120);
}

function commitMessage(changes) {
  var lines = ["Edit content from Facet on kindel.com", ""];
  var shown = Math.min(changes.length, 20);
  for (var i = 0; i < shown; i++) {
    var d = describe(changes[i]);
    lines.push("- " + d.label + ", " + d.field);
  }
  if (changes.length > shown) lines.push("- and " + (changes.length - shown) + " more");
  return lines.join("\n");
}

function buildPlan(prepared, meta) {
  meta = meta || {};
  var now = meta.now || Date.now();
  var byRepo = {};
  for (var i = 0; i < prepared.files.length; i++) {
    var file = prepared.files[i];
    if (!byRepo[file.repo]) byRepo[file.repo] = [];
    byRepo[file.repo].push(file);
  }
  var repos = Object.keys(byRepo);
  var pulls = [];
  for (var r = 0; r < repos.length; r++) {
    var files = byRepo[repos[r]];
    var changes = [];
    var diffs = [];
    for (var f = 0; f < files.length; f++) {
      changes = changes.concat(files[f].changes);
      diffs.push({
        path: files[f].file,
        patch: lineDiff(files[f].before, files[f].after, files[f].file),
        content: files[f].after,
      });
    }
    pulls.push({
      repo: "kindel/" + repos[r],
      repoKey: repos[r],
      branch: branchName(now, meta.suffix ? meta.suffix + (repos.length > 1 ? repos[r].slice(0, 1) : "") : ""),
      base: repos[r] === "biq" || repos[r] === "principles" ? "main" : "main",
      title: pullTitle(changes),
      body: pullBody(changes, meta.name, meta.note),
      message: commitMessage(changes),
      files: diffs,
    });
  }
  return pulls;
}

module.exports = {
  prepare: prepare,
  lineDiff: lineDiff,
  branchName: branchName,
  pullBody: pullBody,
  buildPlan: buildPlan,
  cleanLabel: cleanLabel,
};
