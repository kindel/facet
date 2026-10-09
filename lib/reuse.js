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

function isBlogPath(path) {
  return Array.isArray(path) && path.length >= 1 && path[0] === "blog";
}

function blogIndex(path) {
  if (!isBlogPath(path) || typeof path[1] !== "number") return -1;
  return path[1];
}

function blogPrefix(shorter, longer) {
  if (!Array.isArray(shorter) || !Array.isArray(longer) || !shorter.length || longer.length < shorter.length) return false;
  return sameValue(shorter, longer.slice(0, shorter.length));
}

function blogSharedLen(sourceList, destList) {
  if (!Array.isArray(sourceList) || !Array.isArray(destList)) return -1;
  if (sameValue(sourceList, destList)) return destList.length;
  if (destList.length <= sourceList.length && blogPrefix(destList, sourceList)) return destList.length;
  if (sourceList.length <= destList.length && blogPrefix(sourceList, destList)) return sourceList.length;
  return -1;
}

function isDownstream(fromCompany, toCompany, mapDocs) {
  var docs = mapDocs || [];
  var seen = Object.create(null);
  var queue = [fromCompany];
  seen[fromCompany] = true;
  while (queue.length) {
    var cur = queue.shift();
    for (var i = 0; i < docs.length; i++) {
      var m = docs[i];
      if (!m || m.source !== cur || typeof m.target !== "string") continue;
      if (m.target === toCompany) return true;
      if (seen[m.target]) continue;
      seen[m.target] = true;
      queue.push(m.target);
    }
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
// the earlier edits. The same list edit from two companies is copied
// once onto a third. An edit one company repeats is copied for each
// repeat. A file deletion or a whole-file create that the caller already
// sent for that copy is not emitted again. A chain of maps is translated
// one hop at a time through the shared source. A path step
// that names a principle slug, such as a related note selected by id,
// is translated the same way before the destination file is read.
// Another field in the file can differ. The field that already differs
// is refused, because saving one side would fail the principles validator.
// A reused list is compared before an insert, remove, or move, after slug
// translation. A list that already differs is refused the same way, except
// Further reading: the source set may append entries after the copied
// prefix. Extra entries stay on that set. A save can add, remove, or
// edit them without copying to a downstream company, including one
// reached through a chain of maps. An append on a target still copies
// upstream.

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

// changeKey keeps seq so repeated edits stay in order.
// sameListEdit ignores seq. It decides whether a destination already
// has this copy, from the caller or from an earlier company in the group.

function sameListEdit(a, b) {
  if (!a || !b || !a.op || a.op === "replace" || a.op !== b.op) return false;
  if ((a.repo || "") !== (b.repo || "") || (a.file || "") !== (b.file || "")) return false;
  if (JSON.stringify(a.path || []) !== JSON.stringify(b.path || [])) return false;
  if (a.index !== b.index || a.to !== b.to) return false;
  return sameValue(a.before, b.before) && sameValue(a.value, b.value);
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
  // Structural edits keep seq in the projected count. Replacements stay one per path.
  function add(change) {
    if (!change || !change.repo || !change.file) return;
    fileKeys[change.repo + ":" + change.file] = true;
    var key = changeKey(change);
    if (changeKeys[key]) return;
    changeKeys[key] = true;
    changeCount++;
  }
  var list = changes || [];
  for (var c = 0; c < list.length; c++) {
    var change = list[c];
    if (!change) continue;
    add(change);
    if (change.repo !== "principles" || !teachingFile(change.file)) continue;
    var cluster = clusterOf[change.file];
    if (!cluster) continue;
    for (var s = 0; s < cluster.length; s++) {
      if (cluster[s] === change.file) continue;
      add({
        repo: "principles",
        file: cluster[s],
        path: change.path,
        op: change.op,
        index: change.index,
        to: change.to,
        seq: change.seq,
      });
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

// Catalogs can list the same principle at different indexes. A caller insert
// of the translated entry covers the generated copy. A second insert would
// duplicate the principle. Two caller positions, or a different entry for
// that slug, are refused.
function callerCatalogInsert(copy, list) {
  if (!copy || copy.op !== "insert" || !copy.value || typeof copy.value.slug !== "string") return null;
  var path = JSON.stringify(copy.path || []);
  if (path !== JSON.stringify(["principles"])) return null;
  var found = null;
  for (var i = 0; i < list.length; i++) {
    var one = list[i];
    if (!one || one.op !== "insert") continue;
    if ((one.repo || "") !== (copy.repo || "") || one.file !== copy.file) continue;
    if (JSON.stringify(one.path || []) !== path) continue;
    if (!one.value || one.value.slug !== copy.value.slug) continue;
    if (found) return { conflict: true };
    found = one;
  }
  return found ? { change: found } : null;
}

function alignCatalogInsert(cataloged, list) {
  if (!cataloged || !cataloged.change || cataloged.change.op !== "insert") return "";
  var placed = callerCatalogInsert(cataloged.change, list);
  if (!placed) return "";
  var slug = cataloged.change.value.slug;
  var file = cataloged.change.file;
  if (placed.conflict) return "The reused teaching catalog " + file + " inserts " + slug + " at two positions.";
  if (!sameValue(placed.change.value, cataloged.change.value)) {
    return "The reused teaching catalog " + file + " already inserts " + slug + ", and that entry does not match.";
  }
  cataloged.change.index = placed.change.index;
  cataloged.key = changeKey(cataloged.change);
  return "";
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
  var generated = [];
  function copyCovered(copy, sourceChange) {
    if (!sameListEdit(copy, copy)) return false;
    var need = 0;
    var found = false;
    for (var i = 0; i < changes.length; i++) {
      if (!sameListEdit(changes[i], sourceChange)) continue;
      need++;
      if (changes[i] === sourceChange) {
        found = true;
        break;
      }
    }
    if (!found) need++;
    var have = 0;
    for (var j = 0; j < changes.length; j++) if (sameListEdit(changes[j], copy)) have++;
    for (var g = 0; g < generated.length; g++) if (sameListEdit(generated[g], copy)) have++;
    return have >= need;
  }
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
  // A caller edit later in the batch can already cover this copy.
  // Project that edit and place it with the source edit. A later edit of the
  // same list compares the sibling after the copy, and the saved order applies
  // the copy before that later edit. The caller's own seq is the applied mark,
  // so the later pass does not splice the same edit again.
  function adoptCovered(source, copy) {
    var covered = null;
    for (var i = 0; i < changes.length; i++) {
      if (!sameListEdit(changes[i], copy)) continue;
      if (applied[copy.file + "\0" + changeKey(changes[i])]) continue;
      covered = changes[i];
      break;
    }
    if (!covered) return;
    var fromAt = out.indexOf(covered);
    var sourceAt = out.indexOf(source);
    // The caller's index assumes earlier edits of this same list already ran.
    // Moving the insert ahead of those edits applies that index too soon.
    if (fromAt > sourceAt && sourceAt >= 0) {
      var path = JSON.stringify(covered.path || []);
      for (var j = sourceAt + 1; j < fromAt; j++) {
        var mid = out[j];
        if (!mid || mid === covered) continue;
        if ((mid.repo || "") !== (covered.repo || "") || mid.file !== covered.file) continue;
        if (JSON.stringify(mid.path || []) !== path) continue;
        if (mid.op === "insert" || mid.op === "remove" || mid.op === "move") return;
      }
    }
    if (fromAt >= 0) out.splice(fromAt, 1);
    placeAfter(source, covered);
    projectOnto(copy.file, covered);
  }
  for (var n = 0; n < changes.length; n++) {
    var original = changes[n];
    if (!original || original.repo !== "principles") continue;
    seen[changeKey(original)] = original;
  }
  for (var c = 0; c < changes.length; c++) {
    var change = changes[c];
    if (!change || change.repo !== "principles" || !teachingFile(change.file)) continue;
    var sourceDoc = liveDoc(change.file, files["principles:" + change.file]);
    var sourceList = null;
    if (change.op === "insert" || change.op === "remove" || change.op === "move") {
      var sourceGot = valueAt(sourceDoc, change.path);
      if (sourceGot.ok && Array.isArray(sourceGot.value)) sourceList = cloneJson(sourceGot.value);
    }
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
          if (cataloged.skip) continue;
          var catalogAlign = alignCatalogInsert(cataloged, changes);
          if (catalogAlign) return { ok: false, error: catalogAlign };
          if (copyCovered(cataloged.change, change)) {
            adoptCovered(change, cataloged.change);
            continue;
          }
          if (seen[cataloged.key]) {
            var priorCat = seen[cataloged.key];
            if (!sameValue(priorCat.before, cataloged.change.before) || !sameValue(priorCat.value, cataloged.change.value) || priorCat.index !== cataloged.change.index) {
              return { ok: false, error: "Reused teaching copies have to stay the same. Those edits disagree." };
            }
          } else {
            seen[cataloged.key] = cataloged.change;
            generated.push(cataloged.change);
            placeAfter(change, cataloged.change);
            projectOnto(file, cataloged.change);
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
          if (copyCovered(deletion, change)) continue;
          if (seen[listKey]) continue;
          seen[listKey] = deletion;
          generated.push(deletion);
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
                var catalogAlign = alignCatalogInsert(cataloged, changes);
                if (catalogAlign) return { ok: false, error: catalogAlign };
                if (copyCovered(cataloged.change, change)) {
                  adoptCovered(change, cataloged.change);
                  continue;
                }
                if (seen[cataloged.key]) continue;
                seen[cataloged.key] = cataloged.change;
                generated.push(cataloged.change);
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
            if (copyCovered(catalogCreation, change)) continue;
            if (seen[listKey]) continue;
            seen[listKey] = catalogCreation;
            generated.push(catalogCreation);
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
          if (copyCovered(creation, change)) continue;
          if (seen[listKey]) continue;
          seen[listKey] = creation;
          generated.push(creation);
          placeAfter(change, creation);
          projectOnto(file, creation);
          continue;
        }
        var expectedEntry = translateValue(change.before, fromCompany, placed.company, rules, mapDocs);
        var nextValue = translateValue(change.value, fromCompany, placed.company, rules, mapDocs);
        var listCopy = {
          op: change.op,
          repo: "principles",
          file: file,
          path: destPath,
          index: change.index,
          to: change.to,
          seq: change.seq,
          before: expectedEntry,
          value: nextValue,
          label: change.label,
          field: change.field,
          company: placed.company,
          companyName: names.companyName,
          principle: principleLabel,
          principleName: principleLabel,
          shared: false,
        };
        // Both companies can send this same edit while the lists already differ.
        // Compare before the covered-copy path, or that path accepts the divergence.
        var listed = valueAt(doc, destPath);
        if ((change.op === "insert" || change.op === "remove" || change.op === "move") && listed.ok && Array.isArray(listed.value)) {
          if (!sourceList) {
            return { ok: false, error: "The reused teaching file " + file + " does not have the same list, so this save cannot keep the copies together." };
          }
          var translatedList = translateValue(sourceList, fromCompany, placed.company, rules, mapDocs);
          var sharedLen = isBlogPath(destPath) ? blogSharedLen(translatedList, listed.value) : -1;
          if (sharedLen >= 0 && isBlogPath(destPath) && isDownstream(fromCompany, placed.company, mapDocs)) {
            if (change.op === "move") {
              var fromExtra = change.index >= sharedLen;
              var toExtra = change.to >= sharedLen;
              if (fromExtra !== toExtra) {
                return { ok: false, error: "Further reading extras cannot move across the copied prefix." };
              }
            }
            if (change.index >= sharedLen) {
              continue;
            }
          }
          if (!sameValue(translatedList, listed.value) && sharedLen < 0) {
            return { ok: false, error: "This list already differs in " + file + ". The derivation map owns that difference, so one save cannot change it here." };
          }
        }
        if (copyCovered(listCopy, change)) {
          adoptCovered(change, listCopy);
          continue;
        }
        if (!listed.ok || !Array.isArray(listed.value)) {
          return { ok: false, error: "The reused teaching file " + file + " does not have that list, so this save cannot keep the copies together." };
        }
        if ((change.op === "remove" || change.op === "move") && !sameValue(listed.value[change.index], expectedEntry)) {
          return { ok: false, error: "This list already differs in " + file + ". The derivation map owns that difference, so one save cannot change it here." };
        }
        if (change.op === "insert" && (change.index > listed.value.length || change.index < 0)) {
          return { ok: false, error: "The reused teaching file " + file + " does not have the same list, so this save cannot keep the copies together." };
        }
        if (seen[listKey]) {
          var prior = seen[listKey];
          if (!sameValue(prior.value, nextValue) || !sameValue(prior.before, expectedEntry) || prior.to !== change.to) {
            return { ok: false, error: "Reused teaching copies have to stay the same. Those edits disagree." };
          }
          continue;
        }
        seen[listKey] = listCopy;
        generated.push(listCopy);
        placeAfter(change, listCopy);
        projectOnto(file, listCopy);
        continue;
      }
      var key = changeKey({ repo: "principles", file: file, path: destPath });
      var got = valueAt(doc, destPath);
      if (!got.ok || typeof got.value !== "string") {
        var extraAt = blogIndex(destPath);
        if (extraAt >= 0 && sourceDoc && typeof sourceDoc === "object") {
          var destBlog = valueAt(doc, ["blog"]);
          var srcBlog = valueAt(sourceDoc, ["blog"]);
          if (destBlog.ok && srcBlog.ok && Array.isArray(destBlog.value) && Array.isArray(srcBlog.value)) {
            var srcTranslated = translateValue(srcBlog.value, fromCompany, placed.company, rules, mapDocs);
            if (srcTranslated.length > destBlog.value.length
                && blogPrefix(destBlog.value, srcTranslated)
                && extraAt >= destBlog.value.length
                && isDownstream(fromCompany, placed.company, mapDocs)) {
              continue;
            }
          }
        }
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
