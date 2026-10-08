"use strict";

function sameValue(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a == null || b == null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === "object") {
    var ak = Object.keys(a);
    if (ak.length !== Object.keys(b).length) return false;
    for (var k = 0; k < ak.length; k++) {
      if (!Object.prototype.hasOwnProperty.call(b, ak[k]) || !sameValue(a[ak[k]], b[ak[k]])) return false;
    }
    return true;
  }
  return false;
}

// A source company can reuse a target company's teaching. The principles
// validator requires those copies to match, except for an allowlisted
// sentence and a slug rename. One Facet edit has to land on every copy
// that still has the same text. A slug rename is rewritten into the copy
// so each company keeps its own principle slug. A catalog insert that
// already matches is left in place. A catalog move keeps the destination
// company's id. Later list edits in the same batch see each list after
// the earlier edits. A chain of maps is translated one hop at a time
// through the shared source. A path step
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
  var base = (change.repo || "") + "\n" + (change.file || "") + "\n" + JSON.stringify(change.path || []);
  if (change.op && change.op !== "replace") {
    return base + "\n" + change.op + "\n" + String(change.index) + "\n" + String(change.to) + "\n" + String(change.seq == null ? "" : change.seq);
  }
  return base;
}

function translateValue(value, fromCompany, toCompany, rules, mapDocs) {
  if (typeof value === "string") return translate(value, fromCompany, toCompany, rules, mapDocs);
  if (Array.isArray(value)) {
    return value.map(function (item) { return translateValue(item, fromCompany, toCompany, rules, mapDocs); });
  }
  if (value && typeof value === "object") {
    var out = {};
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) out[keys[i]] = translateValue(value[keys[i]], fromCompany, toCompany, rules, mapDocs);
    return out;
  }
  return value;
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

function destinationNames(indexDoc, companyId, slug) {
  var companyName = "";
  var principleName = "";
  var companies = (indexDoc && indexDoc.companies) || [];
  for (var c = 0; c < companies.length; c++) {
    var company = companies[c];
    if (!company || company.id !== companyId) continue;
    if (typeof company.name === "string") companyName = company.name;
    var principles = company.principles || [];
    for (var p = 0; p < principles.length; p++) {
      var rec = principles[p];
      if (!rec || rec.slug !== slug) continue;
      if (typeof rec.name === "string") principleName = rec.name;
      break;
    }
    break;
  }
  return { companyName: companyName, principleName: principleName };
}

function principleBySlug(indexDoc, company, slug) {
  var companies = (indexDoc && indexDoc.companies) || [];
  for (var c = 0; c < companies.length; c++) {
    if (!companies[c] || companies[c].id !== company) continue;
    var principles = companies[c].principles || [];
    for (var p = 0; p < principles.length; p++) {
      if (principles[p] && principles[p].slug === slug) return principles[p];
    }
  }
  return null;
}

// A teaching catalog entry carries the company's own principle id.
// The reused copy is the same slug after translation, at that company's index.
function catalogSibling(change, doc, file, placed, indexDoc, fromCompany, rules, mapDocs, names, principleLabel) {
  var list = doc && Array.isArray(doc.principles) ? doc.principles : null;
  if (!list) return { error: "The reused teaching file " + file + " does not have that list, so this save cannot keep the copies together." };
  var rawSlug = (change.op === "remove" || change.op === "move") ? change.before && change.before.slug : change.value && change.value.slug;
  if (typeof rawSlug !== "string") return { error: "That teaching catalog entry has no slug." };
  var slug = translate(rawSlug, fromCompany, placed.company, rules, mapDocs);
  var found = -1;
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].slug === slug) found = i;
  }
  var copy = {
    op: change.op,
    repo: "principles",
    file: file,
    path: ["principles"],
    seq: change.seq,
    label: change.label,
    field: change.field,
    company: placed.company,
    companyName: names.companyName,
    principle: principleLabel,
    principleName: principleLabel,
    shared: false,
  };
  if (change.op === "remove") {
    if (found === -1) return { skip: true };
    copy.index = found;
    copy.before = cloneJson(list[found]);
    return { key: changeKey(copy), change: copy };
  }
  if (change.op === "move") {
    if (found === -1) return { error: "The reused teaching catalog " + file + " is missing " + slug + "." };
    // The sibling can already sit at the destination index. Emitting that move
    // is a no-op, and the allowlist rejects a move that does not change order.
    if (found === change.to) return { skip: true };
    if (typeof change.to !== "number" || change.to < 0 || change.to >= list.length) {
      return { error: "The reused teaching file " + file + " does not have the same list, so this save cannot keep the copies together." };
    }
    copy.index = found;
    copy.to = change.to;
    copy.before = cloneJson(list[found]);
    return { key: changeKey(copy), change: copy };
  }
  var rec = principleBySlug(indexDoc, placed.company, slug);
  if (!rec || typeof rec.id !== "number") return { error: "The reused teaching file " + file + " has no principle named " + slug + "." };
  var want = { id: rec.id, slug: slug, file: slug + ".json" };
  if (found !== -1) {
    if (sameValue(list[found], want)) return { skip: true };
    return { error: "This teaching record is already in " + file + ", and it does not match." };
  }
  if (typeof change.index !== "number" || change.index < 0) {
    return { error: "The reused teaching file " + file + " does not have the same list, so this save cannot keep the copies together." };
  }
  copy.index = change.index > list.length ? list.length : change.index;
  copy.value = want;
  return { key: changeKey(copy), change: copy };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyStructural(doc, change) {
  if (!doc || typeof doc !== "object" || !change) return;
  if (change.op !== "insert" && change.op !== "remove" && change.op !== "move") return;
  var listed = valueAt(doc, change.path);
  if (!listed.ok || !Array.isArray(listed.value)) return;
  var arr = listed.value;
  var index = change.index;
  if (change.op === "remove") {
    if (typeof index === "number" && index >= 0 && index < arr.length) arr.splice(index, 1);
    return;
  }
  if (change.op === "insert") {
    if (typeof index !== "number" || index < 0 || index > arr.length || change.value === undefined) return;
    arr.splice(index, 0, cloneJson(change.value));
    return;
  }
  if (typeof index !== "number" || index < 0 || index >= arr.length) return;
  var moved = arr.splice(index, 1)[0];
  var to = change.to;
  if (typeof to !== "number" || to < 0) to = 0;
  if (to > arr.length) to = arr.length;
  arr.splice(to, 0, moved);
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
  // A generated copy has to land before any later edit of that same file.
  // Appending every copy after the whole batch reverses that order.
  var tails = [];
  function placeAfter(source, copy) {
    var anchor = source;
    for (var i = 0; i < tails.length; i++) {
      if (tails[i].source === source) anchor = tails[i].copy;
    }
    var at = out.indexOf(anchor);
    if (at < 0) out.push(copy);
    else out.splice(at + 1, 0, copy);
    var stored = false;
    for (var k = 0; k < tails.length; k++) {
      if (tails[k].source === source) {
        tails[k].copy = copy;
        stored = true;
      }
    }
    if (!stored) tails.push({ source: source, copy: copy });
  }
  var liveDocs = Object.create(null);
  var applied = Object.create(null);
  var removedFiles = Object.create(null);
  function liveDoc(file, text) {
    if (Object.prototype.hasOwnProperty.call(liveDocs, file)) return liveDocs[file];
    if (typeof text !== "string" || !text.trim()) {
      liveDocs[file] = null;
      return null;
    }
    try {
      liveDocs[file] = JSON.parse(text);
    } catch (err) {
      liveDocs[file] = false;
    }
    return liveDocs[file];
  }
  function projectOnto(file, change) {
    if (!change) return;
    var mark = file + "\0" + changeKey(change);
    if (applied[mark]) return;
    applied[mark] = true;
    if (change.op === "delete") {
      liveDocs[file] = null;
      removedFiles[file] = true;
      return;
    }
    if (change.op === "create") {
      liveDocs[file] = change.value && typeof change.value === "object" ? cloneJson(change.value) : change.value;
      return;
    }
    var projected = liveDocs[file];
    if (projected && typeof projected === "object") applyStructural(projected, change);
  }
  for (var n = 0; n < changes.length; n++) {
    var original = changes[n];
    if (!original || original.repo !== "principles") continue;
    seen[changeKey(original)] = original;
  }
  for (var c = 0; c < changes.length; c++) {
    var change = changes[c];
    if (!change || change.repo !== "principles" || !teachingFile(change.file)) continue;
    liveDoc(change.file, files["principles:" + change.file]);
    projectOnto(change.file, change);
    var cluster = clusterOf[change.file];
    if (!cluster) continue;
    for (var s = 0; s < cluster.length; s++) {
      var file = cluster[s];
      if (file === change.file) continue;
      var placed = teachingFile(file);
      var text = files["principles:" + file];
      var doc = liveDoc(file, text);
      if (doc === false) return { ok: false, error: "The reused teaching file " + file + " is not valid JSON." };
      if (doc == null && change.op !== "create") {
        if (change.op === "delete" && removedFiles[file]) continue;
        return {
          ok: false,
          error: "The reused teaching file " + file + " is not loaded, so this save cannot keep the copies together.",
        };
      }
      var fromCompany = teachingFile(change.file).company;
      var destPath = translatePath(change.path, fromCompany, placed.company, rules, mapDocs);
      var names = destinationNames(indexDoc, placed.company, placed.slug);
      var principleLabel = names.principleName || placed.slug;
      if (placed.slug === "index") principleLabel = change.principleName || change.principle || "The set";
      if (change.op === "insert" || change.op === "remove" || change.op === "move" || change.op === "create" || change.op === "delete") {
        if (placed.slug === "index" && Array.isArray(destPath) && destPath.length === 1 && destPath[0] === "principles" && (change.op === "insert" || change.op === "remove" || change.op === "move")) {
          var cataloged = catalogSibling(change, doc, file, placed, indexDoc, fromCompany, rules, mapDocs, names, principleLabel);
          if (cataloged.error) return { ok: false, error: cataloged.error };
          if (!cataloged.skip) {
            if (seen[cataloged.key]) {
              var priorCat = seen[cataloged.key];
              if (!sameValue(priorCat.before, cataloged.change.before) || !sameValue(priorCat.value, cataloged.change.value) || priorCat.index !== cataloged.change.index) {
                return { ok: false, error: "Reused teaching copies have to stay the same. Those edits disagree." };
              }
            } else {
              seen[cataloged.key] = cataloged.change;
              placeAfter(change, cataloged.change);
              projectOnto(file, cataloged.change);
            }
          }
          continue;
        }
        var listKey = changeKey({
          repo: "principles",
          file: file,
          path: destPath,
          op: change.op,
          index: change.index,
          to: change.to,
          seq: change.seq,
        });
        if (change.op === "delete") {
          if (doc == null) continue;
          if (seen[listKey]) continue;
          seen[listKey] = true;
          var deletion = {
            op: "delete",
            repo: "principles",
            file: file,
            path: [],
            label: change.label,
            field: change.field,
            company: placed.company,
            companyName: names.companyName,
            principle: principleLabel,
            principleName: principleLabel,
            shared: false,
          };
          placeAfter(change, deletion);
          projectOnto(file, deletion);
          continue;
        }
        if (change.op === "create") {
          if (placed.slug === "index") {
            if (doc && typeof doc === "object") {
              var entries = change.value && Array.isArray(change.value.principles) ? change.value.principles : [];
              for (var e = 0; e < entries.length; e++) {
                var cataloged = catalogSibling({
                  op: "insert",
                  value: entries[e],
                  index: Array.isArray(doc.principles) ? doc.principles.length : 0,
                  seq: change.seq,
                  label: change.label,
                  field: change.field,
                }, doc, file, placed, indexDoc, fromCompany, rules, mapDocs, names, principleLabel);
                if (cataloged.error) return { ok: false, error: cataloged.error };
                if (cataloged.skip) continue;
                if (seen[cataloged.key]) continue;
                seen[cataloged.key] = cataloged.change;
                placeAfter(change, cataloged.change);
                projectOnto(file, cataloged.change);
              }
              continue;
            }
            var createdCatalog = translateValue(change.value, fromCompany, placed.company, rules, mapDocs);
            if (!createdCatalog || typeof createdCatalog !== "object" || Array.isArray(createdCatalog)) {
              return { ok: false, error: "The reused teaching file " + file + " cannot be created from that catalog." };
            }
            createdCatalog = cloneJson(createdCatalog);
            var catalogEntries = Array.isArray(createdCatalog.principles) ? createdCatalog.principles : [];
            var retargeted = [];
            for (var r = 0; r < catalogEntries.length; r++) {
              var entrySlug = catalogEntries[r] && catalogEntries[r].slug;
              var entryRec = principleBySlug(indexDoc, placed.company, entrySlug);
              if (!entryRec || typeof entryRec.id !== "number") {
                return { ok: false, error: "The reused teaching file " + file + " has no principle named " + entrySlug + "." };
              }
              retargeted.push({ id: entryRec.id, slug: entrySlug, file: entrySlug + ".json" });
            }
            createdCatalog.principles = retargeted;
            if (seen[listKey]) continue;
            seen[listKey] = true;
            var catalogCreation = {
              op: "create",
              repo: "principles",
              file: file,
              path: [],
              value: createdCatalog,
              label: change.label,
              field: change.field,
              company: placed.company,
              companyName: names.companyName,
              principle: principleLabel,
              principleName: principleLabel,
              shared: false,
            };
            placeAfter(change, catalogCreation);
            projectOnto(file, catalogCreation);
            continue;
          }
          var created = translateValue(change.value, fromCompany, placed.company, rules, mapDocs);
          if (!created || typeof created !== "object" || Array.isArray(created)) {
            return { ok: false, error: "The reused teaching file " + file + " cannot be created from that record." };
          }
          var recordRec = principleBySlug(indexDoc, placed.company, placed.slug);
          if (!recordRec || typeof recordRec.id !== "number") {
            return { ok: false, error: "The reused teaching file " + file + " has no principle named " + placed.slug + "." };
          }
          created = cloneJson(created);
          created.id = recordRec.id;
          created.slug = placed.slug;
          if (doc && typeof doc === "object") {
            if (!sameValue(doc, created)) {
              return { ok: false, error: "This teaching record already differs in " + file + ". The derivation map owns that difference, so one save cannot change it here." };
            }
            continue;
          }
          if (seen[listKey]) continue;
          seen[listKey] = true;
          var creation = {
            op: "create",
            repo: "principles",
            file: file,
            path: [],
            value: created,
            label: change.label,
            field: change.field,
            company: placed.company,
            companyName: names.companyName,
            principle: principleLabel,
            principleName: principleLabel,
            shared: false,
          };
          placeAfter(change, creation);
          projectOnto(file, creation);
          continue;
        }
        var listed = valueAt(doc, destPath);
        if (!listed.ok || !Array.isArray(listed.value)) {
          return { ok: false, error: "The reused teaching file " + file + " does not have that list, so this save cannot keep the copies together." };
        }
        var expectedEntry = translateValue(change.before, fromCompany, placed.company, rules, mapDocs);
        if ((change.op === "remove" || change.op === "move") && !sameValue(listed.value[change.index], expectedEntry)) {
          return { ok: false, error: "This list already differs in " + file + ". The derivation map owns that difference, so one save cannot change it here." };
        }
        if (change.op === "insert" && (change.index > listed.value.length || change.index < 0)) {
          return { ok: false, error: "The reused teaching file " + file + " does not have the same list, so this save cannot keep the copies together." };
        }
        if (seen[listKey]) {
          var prior = seen[listKey];
          var nextValue = translateValue(change.value, fromCompany, placed.company, rules, mapDocs);
          if (!sameValue(prior.value, nextValue) || !sameValue(prior.before, expectedEntry) || prior.to !== change.to) {
            return { ok: false, error: "Reused teaching copies have to stay the same. Those edits disagree." };
          }
          continue;
        }
        var listCopy = {
          op: change.op,
          repo: "principles",
          file: file,
          path: destPath,
          index: change.index,
          to: change.to,
          seq: change.seq,
          before: expectedEntry,
          value: translateValue(change.value, fromCompany, placed.company, rules, mapDocs),
          label: change.label,
          field: change.field,
          company: placed.company,
          companyName: names.companyName,
          principle: principleLabel,
          principleName: principleLabel,
          shared: false,
        };
        seen[listKey] = listCopy;
        placeAfter(change, listCopy);
        projectOnto(file, listCopy);
        continue;
      }
      var key = changeKey({ repo: "principles", file: file, path: destPath });
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
      var names = destinationNames(indexDoc, placed.company, placed.slug);
      var principleLabel = names.principleName || placed.slug;
      if (placed.slug === "index") principleLabel = change.principleName || change.principle || "The set";
      var copy = {
        repo: "principles",
        file: file,
        path: destPath,
        before: expected,
        after: next,
        label: change.label,
        field: change.field,
        company: placed.company,
        companyName: names.companyName,
        principle: principleLabel,
        principleName: principleLabel,
        shared: false,
      };
      seen[key] = copy;
      placeAfter(change, copy);
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
