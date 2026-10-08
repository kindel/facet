"use strict";

// A source company can reuse a target company's teaching. The principles
// validator requires those copies to match, except for an allowlisted
// sentence and a slug rename. One Facet edit has to land on every copy
// that still has the same text. A slug rename is rewritten into the copy
// so each company keeps its own principle slug. A chain of maps is
// translated one hop at a time through the shared source. A path step
// that names a principle slug, such as a related note selected by id,
// is translated the same way before the destination file is read.
// Another field in the file can differ. The field that already differs
// is refused, because saving one side would fail the principles validator.

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
  var slugOf = Object.create(null);
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
  var parent = Object.create(null);
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
  var groups = Object.create(null);
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

function companyRenames(indexDoc, mapDocs) {
  var slugOf = Object.create(null);
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
  var rules = [];
  var docs = mapDocs || [];
  for (var m = 0; m < docs.length; m++) {
    var doc = docs[m];
    if (!doc || typeof doc.source !== "string" || typeof doc.target !== "string") continue;
    var pairs = doc.pairs || [];
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i];
      var targetIds = pair && pair.targetIds;
      if (!pair || typeof pair.sourceSlug !== "string" || !Array.isArray(targetIds) || targetIds.length !== 1) {
        continue;
      }
      var targetSlug = slugOf[doc.target + ":" + targetIds[0]];
      if (!targetSlug || targetSlug === pair.sourceSlug) continue;
      rules.push({
        source: doc.source,
        target: doc.target,
        sourceSlug: pair.sourceSlug,
        targetSlug: targetSlug,
      });
    }
  }
  return rules;
}

function linkCompanies(neighbors, a, b) {
  if (!a || !b || a === b) return;
  if (!neighbors[a]) neighbors[a] = [];
  if (!neighbors[b]) neighbors[b] = [];
  if (neighbors[a].indexOf(b) === -1) neighbors[a].push(b);
  if (neighbors[b].indexOf(a) === -1) neighbors[b].push(a);
}

function companyPath(fromCompany, toCompany, mapDocs, rules) {
  if (fromCompany === toCompany) return [fromCompany];
  var neighbors = Object.create(null);
  var docs = mapDocs || [];
  for (var m = 0; m < docs.length; m++) {
    var doc = docs[m];
    if (!doc) continue;
    linkCompanies(neighbors, doc.source, doc.target);
  }
  var list = rules || [];
  for (var i = 0; i < list.length; i++) linkCompanies(neighbors, list[i].source, list[i].target);
  var parent = Object.create(null);
  parent[fromCompany] = fromCompany;
  var queue = [fromCompany];
  var q = 0;
  while (q < queue.length) {
    var cur = queue[q++];
    if (cur === toCompany) break;
    var nexts = neighbors[cur] || [];
    for (var n = 0; n < nexts.length; n++) {
      if (parent[nexts[n]]) continue;
      parent[nexts[n]] = cur;
      queue.push(nexts[n]);
    }
  }
  if (!parent[toCompany]) return null;
  var path = [];
  var walk = toCompany;
  while (walk !== fromCompany) {
    path.push(walk);
    walk = parent[walk];
  }
  path.push(fromCompany);
  path.reverse();
  return path;
}

function directTranslate(text, fromCompany, toCompany, rules) {
  if (typeof text !== "string" || fromCompany === toCompany) return text;
  var reps = [];
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    if (fromCompany === rule.target && toCompany === rule.source) {
      reps.push([rule.targetSlug, rule.sourceSlug]);
    } else if (fromCompany === rule.source && toCompany === rule.target) {
      reps.push([rule.sourceSlug, rule.targetSlug]);
    }
  }
  reps.sort(function (a, b) { return b[0].length - a[0].length; });
  for (var r = 0; r < reps.length; r++) {
    if (!reps[r][0]) continue;
    text = text.split(reps[r][0]).join(reps[r][1]);
  }
  return text;
}

function translate(text, fromCompany, toCompany, rules, mapDocs) {
  if (typeof text !== "string" || fromCompany === toCompany) return text;
  var path = companyPath(fromCompany, toCompany, mapDocs, rules);
  if (!path) return text;
  var out = text;
  for (var hop = 0; hop < path.length - 1; hop++) {
    out = directTranslate(out, path[hop], path[hop + 1], rules);
  }
  return out;
}

function translatePath(path, fromCompany, toCompany, rules, mapDocs) {
  if (!Array.isArray(path) || fromCompany === toCompany) return path;
  var out = [];
  for (var i = 0; i < path.length; i++) {
    var step = path[i];
    if (!step || typeof step !== "object" || Array.isArray(step) || typeof step.id !== "string") {
      out.push(step);
      continue;
    }
    var nextId = translate(step.id, fromCompany, toCompany, rules, mapDocs);
    if (nextId === step.id) {
      out.push(step);
      continue;
    }
    var copy = {};
    var keys = Object.keys(step);
    for (var k = 0; k < keys.length; k++) copy[keys[k]] = step[keys[k]];
    copy.id = nextId;
    out.push(copy);
  }
  return out;
}

function project(changes, indexDoc, mapDocs) {
  var groups = groupsFrom(indexDoc, mapDocs);
  var clusterOf = Object.create(null);
  Object.keys(groups).forEach(function (root) {
    var cluster = groups[root];
    for (var i = 0; i < cluster.length; i++) clusterOf[cluster[i]] = cluster;
  });
  var changeKeys = Object.create(null);
  var fileKeys = Object.create(null);
  var changeCount = 0;
  function add(repo, file, path) {
    if (!repo || !file) return;
    fileKeys[repo + ":" + file] = true;
    var key = repo + "\n" + file + "\n" + JSON.stringify(path);
    if (changeKeys[key]) return;
    changeKeys[key] = true;
    changeCount++;
  }
  var list = changes || [];
  for (var c = 0; c < list.length; c++) {
    var change = list[c];
    if (!change) continue;
    add(change.repo, change.file, change.path);
    if (change.repo !== "principles" || !teachingFile(change.file)) continue;
    var cluster = clusterOf[change.file];
    if (!cluster) continue;
    for (var s = 0; s < cluster.length; s++) {
      if (cluster[s] === change.file) continue;
      add("principles", cluster[s], change.path);
    }
  }
  return { changes: changeCount, files: Object.keys(fileKeys).length };
}

function expand(changes, indexDoc, mapDocs, files) {
  var groups = groupsFrom(indexDoc, mapDocs);
  var rules = companyRenames(indexDoc, mapDocs);
  var clusterOf = Object.create(null);
  Object.keys(groups).forEach(function (root) {
    var cluster = groups[root];
    for (var i = 0; i < cluster.length; i++) clusterOf[cluster[i]] = cluster;
  });
  var out = changes.slice();
  var seen = Object.create(null);
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
      var fromCompany = teachingFile(change.file).company;
      var destPath = translatePath(change.path, fromCompany, placed.company, rules, mapDocs);
      var key = "principles\n" + file + "\n" + JSON.stringify(destPath);
      var got = valueAt(doc, destPath);
      if (!got.ok || typeof got.value !== "string") {
        return {
          ok: false,
          error: "The reused teaching file " + file + " does not have that field, so this save cannot keep the copies together.",
        };
      }
      var expected = translate(change.before, fromCompany, placed.company, rules, mapDocs);
      var next = translate(change.after, fromCompany, placed.company, rules, mapDocs);
      if (seen[key]) {
        if (seen[key].before !== expected || seen[key].after !== next) {
          return { ok: false, error: "Reused teaching copies have to stay the same. Those edits disagree." };
        }
        continue;
      }
      if (got.value !== expected) {
        return {
          ok: false,
          error: "This field already differs in " + file + ". The derivation map owns that difference, so one save cannot change it here.",
        };
      }
      var copy = {
        repo: "principles",
        file: file,
        path: destPath,
        before: expected,
        after: next,
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
  translatePath: translatePath,
  expand: expand,
  project: project,
};
