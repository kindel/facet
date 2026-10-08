"use strict";

// Abuse guards in the same spirit as api/app-feedback:
// a honeypot field, and hard caps on what a request may carry.
// The feedback function does not rate limit. This one does, per IP,
// because a save opens a pull request.
// A session is a few dozen facets or questions, often across many
// principle files, sent as one save. 200 edits and 80 files cover
// that with room for a second field on the same row. The client
// duplicates these two numbers.

var MAX_BODY = 2 * 1024 * 1024;
var MAX_CHANGES = 200;
var MAX_FILES = 80;
var MAX_FILE = 700 * 1024;
var MAX_NAME = 200;
var MAX_NOTE = 2000;
var MAX_LABEL = 180;
var WINDOW_MS = 10 * 60 * 1000;
var MAX_SAVES = 8;
var MAX_DRY = 30;

var buckets = new Map();

function resetForTests() {
  buckets.clear();
}

function header(headers, name) {
  if (!headers) return "";
  var want = name.toLowerCase();
  if (typeof headers.get === "function") {
    var v = headers.get(name);
    return v == null ? "" : String(v);
  }
  var keys = Object.keys(headers);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === want) return headers[keys[i]] == null ? "" : String(headers[keys[i]]);
  }
  return "";
}

function clientIp(headers) {
  var fwd = header(headers, "x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim() || "unknown";
  return header(headers, "x-azure-clientip") || header(headers, "client-ip") || "unknown";
}

function clip(value, max) {
  return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
}

function checkSize(rawLength, body) {
  if (rawLength > MAX_BODY) return "This save is too large.";
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Send a JSON object.";
  var changes = body.changes;
  if (!Array.isArray(changes)) return "Changes must be a list.";
  if (changes.length > MAX_CHANGES) return "Too many edits in one save. Send at most " + MAX_CHANGES + ".";
  var files = body.files || {};
  if (typeof files !== "object" || Array.isArray(files)) return "Files must be an object.";
  var names = Object.keys(files);
  if (names.length > MAX_FILES) return "Too many files in one save.";
  for (var i = 0; i < names.length; i++) {
    var text = files[names[i]];
    if (typeof text !== "string") return "Each file must be text.";
    if (Buffer.byteLength(text) > MAX_FILE) return "A file in this save is too large.";
  }
  return "";
}

function honeypot(body) {
  return !!(body && String(body.website || "").trim());
}

function sweep(now) {
  var keys = Array.from(buckets.keys());
  for (var i = 0; i < keys.length; i++) {
    var stamps = buckets.get(keys[i]) || [];
    var live = false;
    for (var j = 0; j < stamps.length; j++) {
      if (now - stamps[j] < WINDOW_MS) {
        live = true;
        break;
      }
    }
    if (!live) buckets.delete(keys[i]);
  }
}

function rateLimit(ip, now, dryRun) {
  sweep(now);
  var key = (ip || "unknown") + (dryRun ? ":dry" : ":save");
  var prev = buckets.get(key) || [];
  var kept = [];
  for (var i = 0; i < prev.length; i++) {
    if (now - prev[i] < WINDOW_MS) kept.push(prev[i]);
  }
  var cap = dryRun ? MAX_DRY : MAX_SAVES;
  if (kept.length >= cap) {
    var oldest = kept[0];
    return { ok: false, retryAfter: Math.ceil((WINDOW_MS - (now - oldest)) / 1000) };
  }
  kept.push(now);
  buckets.set(key, kept);
  return { ok: true };
}

function changeBudget(changes) {
  var seen = {};
  var n = 0;
  for (var i = 0; i < changes.length; i++) {
    var one = changes[i];
    if (!one || typeof one.repo !== "string" || typeof one.file !== "string") continue;
    var id = one.repo + ":" + one.file;
    if (seen[id]) continue;
    seen[id] = true;
    n++;
  }
  if (n > MAX_FILES) return "Too many files in one save.";
  return "";
}

function fileTooBig(text) {
  return typeof text === "string" && Buffer.byteLength(text) > MAX_FILE;
}

function parseJson(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function donorsOf(doc) {
  var donors = Object.create(null);
  var companies = (doc && doc.companies) || [];
  for (var c = 0; c < companies.length; c++) {
    var principles = companies[c].principles || [];
    for (var p = 0; p < principles.length; p++) {
      var pr = principles[p];
      var count = pr && Array.isArray(pr.questions) ? pr.questions.length : 0;
      if (!count) continue;
      var facets = pr.facets || [];
      for (var f = 0; f < facets.length; f++) {
        if (!donors[facets[f]]) donors[facets[f]] = count;
      }
    }
  }
  return donors;
}

function mappedQuestionCount(doc, facetId) {
  var map = doc && doc.facetQuestions;
  var entry = map && map[facetId];
  if (!entry) return 0;
  var ids = Array.isArray(entry) ? entry : (entry.ids || []);
  var authored = Array.isArray(entry.authored) ? entry.authored : [];
  return ids.length + authored.length;
}

function visibleCount(pr, donors, doc) {
  var own = pr && Array.isArray(pr.questions) ? pr.questions.length : 0;
  if (own) return own;
  var facets = (pr && pr.facets) || [];
  for (var i = 0; i < facets.length; i++) {
    if (donors[facets[i]]) return donors[facets[i]];
    var mapped = mappedQuestionCount(doc, facets[i]);
    if (mapped) return mapped;
  }
  return 0;
}

function sharedDonor(doc, principle) {
  var facets = (principle && principle.facets) || [];
  var companies = (doc && doc.companies) || [];
  for (var c = 0; c < companies.length; c++) {
    var principles = companies[c].principles || [];
    for (var p = 0; p < principles.length; p++) {
      var pr = principles[p];
      if (!pr || !Array.isArray(pr.questions) || !pr.questions.length) continue;
      var theirs = pr.facets || [];
      for (var f = 0; f < facets.length; f++) {
        if (theirs.indexOf(facets[f]) !== -1) return companies[c].name || companies[c].id;
      }
    }
  }
  return "";
}

function principlesById(doc) {
  var out = Object.create(null);
  var companies = (doc && doc.companies) || [];
  for (var c = 0; c < companies.length; c++) {
    var principles = companies[c].principles || [];
    for (var p = 0; p < principles.length; p++) {
      var pr = principles[p];
      if (!pr || typeof pr.id !== "number") continue;
      out[companies[c].id + ":" + pr.id] = pr;
    }
  }
  return out;
}

function questionExists(doc, id) {
  var companies = (doc && doc.companies) || [];
  for (var c = 0; c < companies.length; c++) {
    var principles = companies[c].principles || [];
    for (var p = 0; p < principles.length; p++) {
      var questions = principles[p].questions || [];
      for (var q = 0; q < questions.length; q++) {
        if (questions[q] && questions[q].id === id) return true;
      }
    }
  }
  return false;
}

function coverageInfo(doc) {
  var generated = Object.create(null);
  var members = Object.create(null);
  var facets = (doc && doc.facets) || [];
  for (var i = 0; i < facets.length; i++) {
    var facet = facets[i];
    if (!facet || typeof facet.id !== "string") continue;
    var rows = facet.rows || [];
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (row && row.words === "generated" && row.under && !Object.prototype.hasOwnProperty.call(row, "principle")) {
        generated[facet.id] = true;
      }
    }
    var principles = facet.principles || [];
    for (var p = 0; p < principles.length; p++) {
      var pid = String(principles[p]);
      if (!members[pid]) members[pid] = [];
      members[pid].push(facet.id);
    }
  }
  return { generated: generated, members: members };
}

function covered(pid, info) {
  var facs = info.members[String(pid)] || [];
  for (var i = 0; i < facs.length; i++) if (info.generated[facs[i]]) return true;
  return false;
}

function facetIdList(doc) {
  var ids = [];
  var facets = (doc && doc.facets) || [];
  for (var i = 0; i < facets.length; i++) {
    if (facets[i] && typeof facets[i].id === "string") ids.push(facets[i].id);
  }
  return ids;
}

function linkMap(doc, fromFacets) {
  var map = Object.create(null);
  if (fromFacets) {
    var facets = (doc && doc.facets) || [];
    for (var i = 0; i < facets.length; i++) {
      var facet = facets[i];
      if (!facet || typeof facet.id !== "string") continue;
      var principles = facet.principles || [];
      for (var p = 0; p < principles.length; p++) {
        var raw = principles[p];
        if (typeof raw !== "number" || (raw | 0) !== raw) continue;
        var pid = String(raw);
        if (!map[pid]) map[pid] = [];
        map[pid].push(facet.id);
      }
    }
  } else {
    var companies = (doc && doc.companies) || [];
    for (var c = 0; c < companies.length; c++) {
      var list = companies[c].principles || [];
      for (var n = 0; n < list.length; n++) {
        if (!list[n] || typeof list[n].id !== "number") continue;
        map[String(list[n].id)] = (list[n].facets || []).slice();
      }
    }
  }
  var keys = Object.keys(map);
  for (var k = 0; k < keys.length; k++) map[keys[k]].sort();
  return map;
}

function sameList(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function collectFacetQuestionRefs(doc, into, where) {
  var linked = doc && doc.facetQuestions;
  if (!linked || typeof linked !== "object" || Array.isArray(linked)) return;
  Object.keys(linked).forEach(function (id) {
    if (typeof id !== "string" || !id) return;
    if (!into[id]) into[id] = [];
    if (into[id].indexOf(where) === -1) into[id].push(where);
  });
}

function collectRefs(doc, into, where) {
  if (!doc || typeof doc !== "object") return;
  var companies = doc.companies || [];
  for (var c = 0; c < companies.length; c++) {
    var principles = companies[c].principles || [];
    for (var p = 0; p < principles.length; p++) {
      var facets = principles[p].facets || [];
      for (var f = 0; f < facets.length; f++) {
        var id = facets[f];
        if (typeof id !== "string") continue;
        if (!into[id]) into[id] = [];
        into[id].push(where);
      }
    }
  }
  var pairs = doc.pairs || [];
  for (var i = 0; i < pairs.length; i++) {
    var listed = (pairs[i] && pairs[i].facets) || [];
    for (var n = 0; n < listed.length; n++) {
      if (typeof listed[n] !== "string") continue;
      if (!into[listed[n]]) into[listed[n]] = [];
      into[listed[n]].push(where);
    }
  }
}

function membershipChange(change) {
  if (!change || !change.op || change.op === "replace" || change.op === "move") return false;
  if (!Array.isArray(change.path) || !change.path.length) return false;
  if (change.file === "data/facets.json" && change.path.length === 1 && change.path[0] === "facets") return true;
  return change.path[change.path.length - 1] === "facets";
}

function review(beforeFiles, afterFiles, changes) {
  var errors = [];
  beforeFiles = beforeFiles || {};
  afterFiles = afterFiles || {};
  changes = changes || [];
  var touchesQuestions = false;
  var touchesFacetFile = false;
  var structuralFacet = false;
  for (var i = 0; i < changes.length; i++) {
    var change = changes[i];
    if (!change) continue;
    if (change.repo === "biq" && change.file === "data/questions.json") touchesQuestions = true;
    if (change.file === "data/facets.json") touchesFacetFile = true;
    if (membershipChange(change)) structuralFacet = true;
  }
  if (touchesQuestions || structuralFacet) {
    var beforeQ = parseJson(beforeFiles["biq:data/questions.json"]);
    var afterQ = parseJson(afterFiles["biq:data/questions.json"]);
    if (beforeQ && afterQ) {
      var beforeDonors = donorsOf(beforeQ);
      var afterDonors = donorsOf(afterQ);
      var beforeBy = principlesById(beforeQ);
      var afterBy = principlesById(afterQ);
      Object.keys(beforeBy).forEach(function (key) {
        var was = visibleCount(beforeBy[key], beforeDonors, beforeQ);
        var now = afterBy[key] ? visibleCount(afterBy[key], afterDonors, afterQ) : 0;
        if (was > 0 && now === 0) errors.push((beforeBy[key].name || key) + " would have no BIQ question.");
      });
      var seenIds = Object.create(null);
      (afterQ.companies || []).forEach(function (company) {
        var examples = company.examples !== false;
        var beforeCompany = null;
        (beforeQ.companies || []).forEach(function (item) {
          if (item && item.id === company.id) beforeCompany = item;
        });
        (company.principles || []).forEach(function (pr) {
          var beforePr = null;
          if (beforeCompany) {
            (beforeCompany.principles || []).forEach(function (item) {
              if (item && item.id === pr.id) beforePr = item;
            });
          }
          var beforeLen = beforePr && Array.isArray(beforePr.questions) ? beforePr.questions.length : 0;
          var afterLen = Array.isArray(pr.questions) ? pr.questions.length : 0;
          if (!examples && afterLen > beforeLen) {
            var donor = sharedDonor(beforeQ, beforePr || pr);
            var where = (company.name || company.id) + ", " + (pr.name || "this principle");
            if (donor) {
              errors.push(where + " shows the BIQ list shared from " + donor + ". Add the question there and include an example pack, so the shared list stays intact.");
            } else {
              errors.push(where + " does not store its own BIQ questions. Add the question on the company that stores the shared list, and include an example pack.");
            }
          }
          (pr.questions || []).forEach(function (q) {
            if (!q) return;
            if (!q.id) {
              if (examples) errors.push((company.name || company.id) + " keeps an example pack for every question, so a new question needs an id and a pack.");
              return;
            }
            if (seenIds[q.id]) errors.push("Question id " + q.id + " is already used.");
            seenIds[q.id] = true;
            if (!questionExists(beforeQ, q.id) && examples) {
              var pack = afterFiles["biq:data/examples/" + q.id + ".json"];
              var packDoc = typeof pack === "string" ? parseJson(pack) : null;
              if (!packDoc) {
                errors.push((company.name || company.id) + " keeps an example pack for every question. Include the pack file in this save.");
              } else if (packDoc.principle_id !== pr.id) {
                errors.push("The example pack for " + q.id + " belongs to a different principle.");
              } else if (packDoc.question && q.text && packDoc.question !== q.text) {
                errors.push("The example pack for " + q.id + " does not match the question text.");
              }
            }
          });
        });
      });
      var linked = (afterQ && afterQ.facetQuestions) || {};
      Object.keys(linked).forEach(function (facetId) {
        var entry = linked[facetId];
        var ids = Array.isArray(entry) ? entry : ((entry && entry.ids) || []);
        ids.forEach(function (id) {
          if (typeof id === "string" && !seenIds[id]) {
            errors.push("Question id " + id + " is still linked from " + facetId + ", so it cannot be removed.");
          }
        });
      });
    } else if (touchesQuestions) {
      errors.push("The question bank is not loaded, so this save cannot be checked.");
    }
  }
  if (touchesFacetFile || structuralFacet) {
    var beforeF = parseJson(beforeFiles["principles:data/facets.json"]);
    var afterF = parseJson(afterFiles["principles:data/facets.json"]);
    if (!beforeF || !afterF) {
      if (structuralFacet || touchesFacetFile) errors.push("The facet map is not loaded, so this save cannot be checked.");
    } else {
      var beforeInfo = coverageInfo(beforeF);
      var afterInfo = coverageInfo(afterF);
      Object.keys(beforeInfo.members).forEach(function (pid) {
        if (covered(pid, beforeInfo) && !covered(pid, afterInfo)) errors.push("Principle " + pid + " would have no calibration table.");
      });
      if (structuralFacet) {
        var afterIds = Object.create(null);
        facetIdList(afterF).forEach(function (id) { afterIds[id] = true; });
        var removed = facetIdList(beforeF).filter(function (id) { return !afterIds[id]; });
        var indexDoc = parseJson(afterFiles["principles:data/index.json"]);
        var questionDoc = parseJson(afterFiles["biq:data/questions.json"]);
        if (!indexDoc || !questionDoc) {
          errors.push("Adding or removing a facet needs the principle index and the question bank in the same save.");
        } else {
          var want = linkMap(afterF, true);
          var indexLinks = linkMap(indexDoc, false);
          var questionLinks = linkMap(questionDoc, false);
          var principleIds = Object.create(null);
          Object.keys(want).forEach(function (pid) { principleIds[pid] = true; });
          Object.keys(indexLinks).forEach(function (pid) { principleIds[pid] = true; });
          Object.keys(questionLinks).forEach(function (pid) { principleIds[pid] = true; });
          Object.keys(principleIds).forEach(function (pid) {
            if (!sameList(want[pid] || [], indexLinks[pid] || [])) errors.push("Principle " + pid + " facet list does not match the index.");
            if (!sameList(want[pid] || [], questionLinks[pid] || [])) errors.push("Principle " + pid + " facet list does not match the question bank.");
          });
          var refs = Object.create(null);
          collectRefs(indexDoc, refs, "the principle index");
          collectRefs(questionDoc, refs, "the question bank");
          collectFacetQuestionRefs(questionDoc, refs, "facet questions");
          var requiredMaps = parseJson(afterFiles["principles:data/maps/_list.json"]);
          if (!Array.isArray(requiredMaps) || !requiredMaps.length) {
            errors.push("The derivation map list is not loaded, so a facet change cannot be checked.");
          } else {
            var present = Object.create(null);
            requiredMaps.forEach(function (mapPath) {
              if (typeof mapPath !== "string" || mapPath.indexOf("data/maps/") !== 0 || mapPath.slice(-5) !== ".json") {
                errors.push("The derivation map list is not valid.");
                return;
              }
              var mapKey = "principles:" + mapPath;
              present[mapKey] = true;
              var mapText = afterFiles[mapKey];
              if (typeof mapText !== "string" || !mapText.trim()) {
                errors.push("Derivation map " + mapPath + " is not in this save.");
                return;
              }
              var mapDoc = parseJson(mapText);
              if (!mapDoc) {
                errors.push("Derivation map " + mapPath + " is not valid JSON.");
                return;
              }
              collectRefs(mapDoc, refs, mapPath);
              (mapDoc.pairs || []).forEach(function (pair) {
                if (!pair || typeof pair.sourceId !== "number") return;
                var listed = (pair.facets || []).slice().sort();
                if (!sameList(listed, want[String(pair.sourceId)] || [])) {
                  errors.push("Derivation map " + mapPath + " does not list the same facets as principle " + pair.sourceId + ".");
                }
              });
            });
            Object.keys(afterFiles).forEach(function (key) {
              if (key.indexOf("principles:data/maps/") !== 0 || key.slice(-5) !== ".json" || key.slice(-11) === "/_list.json") return;
              if (!present[key]) errors.push("Derivation map " + key.replace("principles:", "") + " is not in the repository map list.");
            });
          }
          removed.forEach(function (id) {
            var left = refs[id] || [];
            if (left.length) errors.push("Facet " + id + " is still referenced by " + left.join(", ") + ".");
          });
        }
      }
    }
  }
  var deletedCatalogs = Object.create(null);
  for (var d = 0; d < changes.length; d++) {
    var catalogDelete = changes[d];
    if (!catalogDelete || catalogDelete.op !== "delete" || catalogDelete.repo !== "principles") continue;
    var catalogName = /^data\/teaching\/([a-z0-9-]+)\/index\.json$/.exec(catalogDelete.file || "");
    if (catalogName) deletedCatalogs[catalogName[1]] = true;
  }
  for (var t = 0; t < changes.length; t++) {
    var removedTeaching = changes[t];
    if (!removedTeaching || removedTeaching.op !== "delete" || removedTeaching.repo !== "principles") continue;
    var teachingName = /^data\/teaching\/([a-z0-9-]+)\/([a-z0-9-]+)\.json$/.exec(removedTeaching.file || "");
    if (!teachingName || teachingName[2] === "index") continue;
    if (deletedCatalogs[teachingName[1]]) continue;
    var catalogText = afterFiles["principles:data/teaching/" + teachingName[1] + "/index.json"];
    if (typeof catalogText !== "string" || !catalogText.trim()) {
      errors.push("Removing " + teachingName[2] + " needs its teaching catalog in the same save.");
      continue;
    }
    var catalogDoc = parseJson(catalogText);
    var stillListed = false;
    var listedPrinciples = catalogDoc && catalogDoc.principles;
    if (Array.isArray(listedPrinciples)) {
      for (var p = 0; p < listedPrinciples.length; p++) {
        if (listedPrinciples[p] && listedPrinciples[p].slug === teachingName[2]) stillListed = true;
      }
    }
    if (stillListed) errors.push("Removing " + teachingName[2] + " still leaves it in the teaching catalog.");
  }
  for (var c = 0; c < changes.length; c++) {
    var createdTeaching = changes[c];
    if (!createdTeaching || createdTeaching.op !== "create" || createdTeaching.repo !== "principles") continue;
    var createdName = /^data\/teaching\/([a-z0-9-]+)\/([a-z0-9-]+)\.json$/.exec(createdTeaching.file || "");
    if (!createdName || createdName[2] === "index") continue;
    var createdCatalog = afterFiles["principles:data/teaching/" + createdName[1] + "/index.json"];
    if (typeof createdCatalog !== "string" || !createdCatalog.trim()) {
      errors.push("Adding " + createdName[2] + " needs its teaching catalog in the same save.");
      continue;
    }
    if (!catalogListsSlug(createdCatalog, createdName[2])) {
      errors.push("Adding " + createdName[2] + " needs a teaching catalog entry in the same save.");
    }
  }
  for (var a = 0; a < changes.length; a++) {
    var catalogChange = changes[a];
    if (!catalogChange || catalogChange.repo !== "principles") continue;
    var catalogFile = /^data\/teaching\/([a-z0-9-]+)\/index\.json$/.exec(catalogChange.file || "");
    if (!catalogFile) continue;
    var addedEntries = [];
    if (catalogChange.op === "insert" && catalogChange.value && catalogChange.value.slug) addedEntries.push(catalogChange.value.slug);
    if (catalogChange.op === "create" && catalogChange.value && Array.isArray(catalogChange.value.principles)) {
      catalogChange.value.principles.forEach(function (entry) {
        if (entry && entry.slug) addedEntries.push(entry.slug);
      });
    }
    for (var e = 0; e < addedEntries.length; e++) {
      var recordKey = "principles:data/teaching/" + catalogFile[1] + "/" + addedEntries[e] + ".json";
      var recordText = afterFiles[recordKey];
      if (typeof recordText !== "string" || !recordText.trim()) {
        errors.push("The teaching catalog lists " + addedEntries[e] + ", but that record is not in this save.");
      }
    }
  }
  var questionDocAfter = parseJson(afterFiles["biq:data/questions.json"]);
  for (var q = 0; q < changes.length; q++) {
    var packChange = changes[q];
    if (!packChange || packChange.op !== "create" || packChange.repo !== "biq") continue;
    var packName = /^data\/examples\/([0-9a-f]{8})\.json$/.exec(packChange.file || "");
    if (!packName) continue;
    if (!questionDocAfter) {
      errors.push("The example pack " + packName[1] + " needs the question bank in this save.");
      continue;
    }
    var packHit = findQuestion(questionDocAfter, packName[1]);
    if (!packHit) {
      errors.push("The example pack " + packName[1] + " does not match a question in this save.");
      continue;
    }
    var packValue = packChange.value || {};
    if (packValue.principle_id !== packHit.principle.id) {
      errors.push("The example pack for " + packName[1] + " belongs to a different principle.");
    } else if (packValue.question && packHit.question.text && packValue.question !== packHit.question.text) {
      errors.push("The example pack for " + packName[1] + " does not match the question text.");
    }
  }
  return errors;
}

function catalogListsSlug(text, slug) {
  var doc = parseJson(text);
  var list = doc && doc.principles;
  if (!Array.isArray(list)) return false;
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].slug === slug) return true;
  }
  return false;
}

function findQuestion(doc, id) {
  var companies = (doc && doc.companies) || [];
  for (var c = 0; c < companies.length; c++) {
    var principles = (companies[c] && companies[c].principles) || [];
    for (var p = 0; p < principles.length; p++) {
      var questions = (principles[p] && principles[p].questions) || [];
      for (var n = 0; n < questions.length; n++) {
        if (questions[n] && questions[n].id === id) return { principle: principles[p], question: questions[n] };
      }
    }
  }
  return null;
}

module.exports = {
  MAX_BODY: MAX_BODY,
  MAX_CHANGES: MAX_CHANGES,
  MAX_FILES: MAX_FILES,
  MAX_FILE: MAX_FILE,
  MAX_NAME: MAX_NAME,
  MAX_NOTE: MAX_NOTE,
  MAX_LABEL: MAX_LABEL,
  WINDOW_MS: WINDOW_MS,
  MAX_SAVES: MAX_SAVES,
  MAX_DRY: MAX_DRY,
  resetForTests: resetForTests,
  header: header,
  clientIp: clientIp,
  clip: clip,
  checkSize: checkSize,
  honeypot: honeypot,
  rateLimit: rateLimit,
  changeBudget: changeBudget,
  fileTooBig: fileTooBig,
  review: review,
  bucketCount: function () { return buckets.size; },
};
