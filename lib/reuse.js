"use strict";

// A source company can reuse a target company's teaching. The principles
// validator requires those copies to match, except for an allowlisted
// sentence and a slug rename. One Facet edit has to land on every copy
// that still has the same text. Copies that already differ are left for
// the derivation map.

function needsMaps(changes) {
  for (var i = 0; i < changes.length; i++) {
    var one = changes[i];
    if (one && one.repo === "principles" && teachingFile(one.file)) return true;
  }
  return false;
}

function teachingFile(file) {
  var match = /^data\/teaching\/([a-z0-9-]+)\/([a-z0-9-]+)\.json$/.exec(file || "");
  if (!match) return null;
  return { company: match[1], slug: match[2], file: file };
}

function valueAt(doc, path) {
  var cur = doc;
  if (!Array.isArray(path)) return { ok: false };
  for (var i = 0; i < path.length; i++) {
    var step = path[i];
    if (typeof step === "number") {
      if (!Array.isArray(cur) || step < 0 || step >= cur.length) return { ok: false };
      cur = cur[step];
      continue;
    }
    if (typeof step === "string") {
      if (!cur || typeof cur !== "object" || Array.isArray(cur) || !Object.prototype.hasOwnProperty.call(cur, step)) {
        return { ok: false };
      }
      cur = cur[step];
      continue;
    }
    if (step && typeof step === "object" && !Array.isArray(step)) {
      if (!Array.isArray(cur)) return { ok: false };
      var keys = Object.keys(step);
      var found = null;
      for (var n = 0; n < cur.length; n++) {
        var item = cur[n];
        if (!item || typeof item !== "object") continue;
        var match = true;
        for (var k = 0; k < keys.length; k++) {
          if (item[keys[k]] !== step[keys[k]]) match = false;
        }
        if (match) {
          found = item;
          break;
        }
      }
      if (!found) return { ok: false };
      cur = found;
      continue;
    }
    return { ok: false };
  }
  return { ok: true, value: cur };
}

function groupsFrom(indexDoc, mapDocs) {
  var slugOf = {};
  var companies = (indexDoc && indexDoc.companies) || [];
  for (var c = 0; c < companies.length; c++) {
    var company = companies[c];
    if (!company || typeof company.id !== "string") continue;
    var principles = company.principles || [];
    for (var p = 0; p < principles.length; p++) {
      var rec = principles[p];
      if (!rec || typeof rec.slug !== "string") continue;
      slugOf[company.id + ":" + rec.id] = rec.slug;
    }
  }
  var parent = {};
  function add(file) {
    if (!parent[file]) parent[file] = file;
  }
  function find(file) {
    add(file);
    var root = file;
    while (parent[root] !== root) root = parent[root];
    while (parent[file] !== root) {
      var next = parent[file];
      parent[file] = root;
      file = next;
    }
    return root;
  }
  function unite(a, b) {
    var left = find(a);
    var right = find(b);
    if (left !== right) parent[right] = left;
  }
  var docs = mapDocs || [];
  for (var m = 0; m < docs.length; m++) {
    var doc = docs[m];
    if (!doc || typeof doc.source !== "string" || typeof doc.target !== "string") continue;
    unite(
      "data/teaching/" + doc.source + "/index.json",
      "data/teaching/" + doc.target + "/index.json"
    );
    var pairs = doc.pairs || [];
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i];
      var targetIds = pair && pair.targetIds;
      if (!pair || typeof pair.sourceSlug !== "string" || !Array.isArray(targetIds) || targetIds.length !== 1) {
        continue;
      }
      var targetSlug = slugOf[doc.target + ":" + targetIds[0]];
      if (!targetSlug) continue;
      unite(
        "data/teaching/" + doc.source + "/" + pair.sourceSlug + ".json",
        "data/teaching/" + doc.target + "/" + targetSlug + ".json"
      );
    }
  }
  var groups = {};
  var files = Object.keys(parent);
  for (var f = 0; f < files.length; f++) {
    var root = find(files[f]);
    if (!groups[root]) groups[root] = [];
    groups[root].push(files[f]);
  }
  return groups;
}

function changeKey(change) {
  return change.repo + "\n" + change.file + "\n" + JSON.stringify(change.path);
}

function expand(changes, indexDoc, mapDocs, files) {
  var groups = groupsFrom(indexDoc, mapDocs);
  var clusterOf = {};
  Object.keys(groups).forEach(function (root) {
    var cluster = groups[root];
    for (var i = 0; i < cluster.length; i++) clusterOf[cluster[i]] = cluster;
  });
  var out = changes.slice();
  var seen = {};
  for (var n = 0; n < changes.length; n++) {
    var original = changes[n];
    if (!original || original.repo !== "principles") continue;
    seen[changeKey(original)] = original;
  }
  for (var c = 0; c < changes.length; c++) {
    var change = changes[c];
    if (!change || change.repo !== "principles" || !teachingFile(change.file)) continue;
    var cluster = clusterOf[change.file];
    if (!cluster) continue;
    for (var s = 0; s < cluster.length; s++) {
      var file = cluster[s];
      if (file === change.file) continue;
      var key = "principles\n" + file + "\n" + JSON.stringify(change.path);
      var placed = teachingFile(file);
      var text = files["principles:" + file];
      if (typeof text !== "string") {
        return {
          ok: false,
          error: "The reused teaching file " + file + " is not loaded, so this save cannot keep the copies together.",
        };
      }
      var doc;
      try {
        doc = JSON.parse(text);
      } catch (err) {
        return { ok: false, error: "The reused teaching file " + file + " is not valid JSON." };
      }
      var got = valueAt(doc, change.path);
      if (!got.ok || typeof got.value !== "string") {
        return {
          ok: false,
          error: "The reused teaching file " + file + " does not have that field, so this save cannot keep the copies together.",
        };
      }
      if (seen[key]) {
        if (seen[key].before !== change.before || seen[key].after !== change.after) {
          return { ok: false, error: "Reused teaching copies have to stay the same. Those edits disagree." };
        }
        continue;
      }
      if (got.value !== change.before) {
        return {
          ok: false,
          error: "This field already differs in " + file + ". The derivation map owns that difference, so one save cannot change it here.",
        };
      }
      var copy = {
        repo: "principles",
        file: file,
        path: change.path,
        before: change.before,
        after: change.after,
        label: change.label,
        field: change.field,
        company: placed.company,
        companyName: "",
        principle: change.principle || "",
        principleName: change.principleName || change.principle || "",
        shared: false,
      };
      seen[key] = copy;
      out.push(copy);
    }
  }
  return { ok: true, changes: out };
}

module.exports = {
  needsMaps: needsMaps,
  teachingFile: teachingFile,
  groupsFrom: groupsFrom,
  valueAt: valueAt,
  expand: expand,
};
