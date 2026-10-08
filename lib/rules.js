"use strict";

// Validator-equivalent checks for one edited string.
// Sentence breaks match principles scripts/validate.py:
// a terminal mark, optional closing quote or bracket, then whitespace.

var SENTENCE = /(?<=[.!?])["')\]]*\s+/;
var LP_TOKEN = /\{lp:([a-z0-9]+(?:-[a-z0-9]+)*)\}/g;
var LP_OK = /^\{lp:[a-z0-9]+(?:-[a-z0-9]+)*\}$/;
var MAX_FIELD = 8000;

function sentenceCount(text) {
  var parts = String(text || "").trim().split(SENTENCE);
  var n = 0;
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].trim()) n++;
  }
  return n;
}

function malformedLinks(text) {
  var i = 0;
  while (i < text.length) {
    var at = text.indexOf("{lp:", i);
    if (at === -1) return [];
    var close = text.indexOf("}", at);
    var token = close === -1 ? text.slice(at) : text.slice(at, close + 1);
    if (!LP_OK.test(token)) return ["Principle links look like {lp:ownership}."];
    i = close + 1;
  }
  return [];
}

function checkText(value, spec) {
  var errors = [];
  var text = typeof value === "string" ? value : "";
  spec = spec || {};
  if (!text.trim()) errors.push("This field cannot be empty.");
  if (text.indexOf("\u2014") !== -1) errors.push("Replace the em dash before saving.");
  if (text.indexOf("---") !== -1) errors.push("Replace --- before saving.");
  var titleException = spec.allowEnDash === true;
  if (text.indexOf("\u2013") !== -1 && !titleException) errors.push("Replace the en dash before saving.");
  if (text.length > MAX_FIELD) errors.push("This field is too long.");
  if (spec.sentences) {
    var n = sentenceCount(text);
    if (n < 1 || n > 3) errors.push("Use one to three sentences (" + n + " now).");
  }
  if (spec.questionMark && !/\?\s*$/.test(text.trim())) errors.push("End this question with ?");
  if (spec.url && !/^https?:\/\/\S+$/.test(text.trim())) errors.push("Use an http or https URL.");
  if (spec.tokens) {
    var seen = Object.create(null);
    var badLinks = malformedLinks(text);
    if (badLinks.length) errors.push(badLinks[0]);
    LP_TOKEN.lastIndex = 0;
    var m;
    while ((m = LP_TOKEN.exec(text))) {
      if (spec.slugs && spec.slugs.indexOf(m[1]) === -1 && !seen[m[1]]) {
        seen[m[1]] = true;
        errors.push("Unknown principle link {lp:" + m[1] + "}.");
      }
    }
  }
  return errors;
}

var TEACH_PROSE = ["why", "calibrationIntro", "examples", "looksLike", "deepen"];

function walkStrings(value, out) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) {
    for (var i = 0; i < value.length; i++) walkStrings(value[i], out);
  } else if (value && typeof value === "object") {
    var keys = Object.keys(value);
    for (var k = 0; k < keys.length; k++) walkStrings(value[keys[k]], out);
  }
}

function teachingLinks(doc, slugs, relatedRequired) {
  var errors = [];
  if (!doc || !Array.isArray(slugs)) return errors;
  var related = [];
  var rels = doc.related || [];
  for (var i = 0; i < rels.length; i++) {
    if (rels[i] && slugs.indexOf(rels[i].id) !== -1) related.push(rels[i].id);
  }
  var texts = [];
  if (relatedRequired) {
    for (var p = 0; p < TEACH_PROSE.length; p++) {
      if (doc[TEACH_PROSE[p]] != null) walkStrings(doc[TEACH_PROSE[p]], texts);
    }
    var notes = doc.related || [];
    for (var n = 0; n < notes.length; n++) {
      if (notes[n] && typeof notes[n].note === "string") texts.push(notes[n].note);
    }
    var posts = doc.blog || [];
    for (var b = 0; b < posts.length; b++) {
      if (posts[b] && typeof posts[b].note === "string") texts.push(posts[b].note);
    }
  } else {
    walkStrings(doc, texts);
  }
  var seen = Object.create(null);
  var re = /\{lp:([a-z0-9]+(?:-[a-z0-9]+)*)\}/g;
  for (var t = 0; t < texts.length; t++) {
    var badLinks = malformedLinks(texts[t]);
    if (badLinks.length) {
      errors.push(badLinks[0]);
      continue;
    }
    re.lastIndex = 0;
    var match;
    while ((match = re.exec(texts[t]))) {
      if (seen[match[1]]) continue;
      seen[match[1]] = true;
      if (slugs.indexOf(match[1]) === -1) errors.push("Unknown principle link {lp:" + match[1] + "}.");
      else if (relatedRequired && related.indexOf(match[1]) === -1) errors.push("{lp:" + match[1] + "} is missing from related.");
    }
  }
  return errors;
}

var UNPUBLISHED = { generic: true };
var WORDS = Object.assign(Object.create(null), { quoted: true, authored: true, generated: true });

function knownWords(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(WORDS, value);
}

function nonempty(value) {
  return typeof value === "string" && !!value.trim();
}

function dashErrors(text, allowEnDash) {
  return checkText(text, { allowEnDash: !!allowEnDash }).filter(function (error) {
    return /dash|---/.test(error);
  });
}

function checkBlogItem(value, opts) {
  var errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["A reading link needs a title, an https URL, and a note."];
  if (!nonempty(value.title)) errors.push("A reading link needs a title.");
  else errors = errors.concat(dashErrors(value.title, true));
  if (!nonempty(value.url) || !/^https:\/\/\S+$/.test(value.url.trim())) errors.push("A reading link needs an https URL.");
  else if (!opts || !opts.existing) {
    // The whole-file check passes existing:true. The corpus already uses some
    // dated essay permalinks, and a later edit must not fail on those.
    var essay = essayUrlError(value.url);
    if (essay) errors.push(essay);
  }
  if (!nonempty(value.note)) errors.push("A reading link needs a note.");
  else errors = errors.concat(checkText(value.note, { tokens: true }));
  return errors;
}

// Same slug as principles scripts/validate.py: lowercase, "&" becomes "and",
// then every other run of non-letters becomes one hyphen.
function facetSlug(label) {
  return String(label || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function checkItem(value, spec) {
  spec = spec || {};
  if (spec.item === "string") {
    if (typeof value !== "string") return ["This entry has to be text."];
    return checkText(value, spec);
  }
  if (spec.item === "slug") {
    if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) return ["A facet id has to be kebab-case."];
    return [];
  }
  if (spec.item === "blog") return checkBlogItem(value);
  if (spec.item === "example") {
    if (!value || typeof value !== "object") return ["An example needs a title and a body."];
    var errors = [];
    if (!nonempty(value.title)) errors.push("An example needs a title.");
    else errors = errors.concat(checkText(value.title, {}));
    if (!nonempty(value.body)) errors.push("An example needs a body.");
    else errors = errors.concat(checkText(value.body, { tokens: true, slugs: spec.slugs }));
    return errors;
  }
  if (spec.item === "related") {
    if (!value || typeof value !== "object") return ["A related note needs a principle and a note."];
    var relatedErrors = [];
    if (typeof value.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) relatedErrors.push("A related note needs a principle id.");
    else if (spec.slugs && spec.slugs.indexOf(value.id) === -1) relatedErrors.push("Unknown principle link " + value.id + ".");
    if (!nonempty(value.note)) relatedErrors.push("A related note needs a note.");
    else relatedErrors = relatedErrors.concat(checkText(value.note, { tokens: true, slugs: spec.slugs }));
    return relatedErrors;
  }
  if (spec.item === "facetRow" && isSourceRef(value)) return sourceRefErrors(value, spec.facetPrinciples, spec.rowsByPrinciple);
  if (spec.item === "row" || spec.item === "facetRow") {
    if (!value || typeof value !== "object") return ["A calibration row needs a situation, under, just right, and over."];
    var rowErrors = [];
    if (typeof value.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) rowErrors.push("A row id has to be kebab-case.");
    ["situation", "under", "justRight", "over"].forEach(function (key) {
      if (!nonempty(value[key])) rowErrors.push("A calibration row needs " + key + ".");
      else rowErrors = rowErrors.concat(checkText(value[key], { sentences: key !== "situation" && value.words !== "quoted" }));
    });
    if (spec.item === "row" && Object.prototype.hasOwnProperty.call(value, "words") && !knownWords(value.words)) {
      rowErrors.push("A calibration row's words must be quoted, authored, or generated.");
    }
    if (spec.item === "facetRow") {
      var generated = value.words === "generated" && !Object.prototype.hasOwnProperty.call(value, "principle");
      var source = typeof value.principle === "number" && !Object.prototype.hasOwnProperty.call(value, "situation");
      if (!generated && !source) rowErrors.push("A facet row is either a generated row or a source ref.");
      if (generated && value.words !== "generated") rowErrors.push("A generated row has to say so.");
    }
    return rowErrors;
  }
  if (spec.item === "question") {
    if (!value || typeof value !== "object") return ["A BIQ question needs its text."];
    var questionErrors = [];
    if (!nonempty(value.text)) questionErrors.push("A BIQ question needs its text.");
    else questionErrors = questionErrors.concat(checkText(value.text, { questionMark: true }));
    if (value.id != null && !/^[0-9a-f]{8}$/.test(value.id)) questionErrors.push("A question id has to be eight hex characters.");
    if (value.manager != null && typeof value.manager !== "boolean") questionErrors.push("Manager has to be yes or no.");
    return questionErrors;
  }
  if (spec.item === "catalog") {
    if (!value || typeof value !== "object") return ["A teaching record needs an id, a slug, and a file."];
    var catalogErrors = [];
    if (typeof value.id !== "number" || (value.id | 0) !== value.id) catalogErrors.push("A teaching record needs a numeric id.");
    if (typeof value.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug)) catalogErrors.push("A teaching record needs a kebab-case slug.");
    if (value.file !== value.slug + ".json") catalogErrors.push("A teaching record's file has to match its slug.");
    var catalogRecords = spec.records;
    if (!catalogRecords || typeof catalogRecords !== "object") {
      catalogErrors.push("The principle list for this company is missing, so this save cannot be checked.");
    } else if (typeof value.slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug)) {
      if (!Object.hasOwn(catalogRecords, value.slug)) catalogErrors.push("This company has no principle named " + value.slug + ".");
      else if (typeof value.id === "number" && (value.id | 0) === value.id && catalogRecords[value.slug] !== value.id) {
        catalogErrors.push("This teaching record's id does not match the principle.");
      }
    }
    return catalogErrors;
  }
  if (spec.item === "facet") {
    if (!value || typeof value !== "object") return ["A facet needs an id, a label, principles, and rows."];
    var facetErrors = [];
    if (typeof value.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) facetErrors.push("A facet id has to be kebab-case.");
    if (!nonempty(value.label)) facetErrors.push("A facet needs a label.");
    else if (value.id !== facetSlug(value.label)) facetErrors.push("A facet id has to be the slug of its label.");
    if (!Array.isArray(value.principles) || !value.principles.length) facetErrors.push("A facet needs at least one principle.");
    else if ((value.principles || []).some(function (pid) { return typeof pid !== "number" || (pid | 0) !== pid; })) {
      facetErrors.push("A facet principle has to be a numeric id.");
    }
    if (!Array.isArray(value.rows) || !value.rows.length) facetErrors.push("A facet needs at least one row.");
    var generated = false;
    (value.rows || []).forEach(function (row) {
      facetErrors = facetErrors.concat(checkItem(row, {
        item: "facetRow",
        facetPrinciples: value.principles,
        rowsByPrinciple: spec.rowsByPrinciple,
      }));
      if (row && row.words === "generated" && !Object.prototype.hasOwnProperty.call(row, "principle")) generated = true;
    });
    if (!generated) facetErrors.push("A facet needs a generated calibration row so every principle keeps a table.");
    return facetErrors;
  }
  return ["That entry cannot be added."];
}

function checkPack(doc, file) {
  var errors = [];
  var name = /^data\/examples\/([0-9a-f]{8})\.json$/.exec(file || "");
  if (!name) errors.push("An example pack file has to be named with the question id.");
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return ["An example pack needs the question and its principle."];
  if (typeof doc.principle_id !== "number" || (doc.principle_id | 0) !== doc.principle_id) errors.push("An example pack needs a principle id.");
  if (!nonempty(doc.principle)) errors.push("An example pack needs the principle name.");
  if (!nonempty(doc.question)) errors.push("An example pack needs the question text.");
  else errors = errors.concat(checkText(doc.question, { questionMark: true }));
  if (doc.levels != null && (typeof doc.levels !== "object" || Array.isArray(doc.levels))) {
    errors.push("Example levels have to be an object.");
  }
  walkDashes(doc, "", errors);
  return errors;
}

function isSourceRef(value) {
  return !!(value && typeof value === "object" && typeof value.principle === "number" && (value.principle | 0) === value.principle && !Object.prototype.hasOwnProperty.call(value, "situation"));
}

function sourceRefErrors(value, principles, rowsByPrinciple) {
  if (typeof value.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) return ["A source ref needs a kebab-case row id."];
  var pid = value.principle;
  var listed = Array.isArray(principles) && principles.indexOf(pid) !== -1;
  if (!listed) return ["This source ref names a principle this facet does not list."];
  if (!rowsByPrinciple || typeof rowsByPrinciple !== "object" || !Object.hasOwn(rowsByPrinciple, String(pid))) {
    return ["The principle record is not loaded, so this source ref cannot be checked."];
  }
  if (!Object.hasOwn(rowsByPrinciple[String(pid)], value.id)) return ["This source ref does not match a row on that principle."];
  return [];
}

function sourceRefsIn(value, spec) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.rows)) {
    var errors = [];
    value.rows.forEach(function (row) {
      if (!isSourceRef(row)) return;
      errors = errors.concat(sourceRefErrors(row, value.principles, spec && spec.rowsByPrinciple));
    });
    return errors;
  }
  if (isSourceRef(value)) return sourceRefErrors(value, spec && spec.facetPrinciples, spec && spec.rowsByPrinciple);
  return [];
}

function facetSourceError(facet, rowsByPrinciple) {
  if (!facet || typeof facet !== "object") return "";
  var rows = Array.isArray(facet.rows) ? facet.rows : [];
  if (!rows.length) return "";
  var sources = 0;
  for (var i = 0; i < rows.length; i++) if (isSourceRef(rows[i])) sources++;
  if (sources) return "";
  var label = typeof facet.id === "string" && facet.id ? facet.id : "this facet";
  if (!rowsByPrinciple || typeof rowsByPrinciple !== "object") {
    return "The principle record is not loaded, so this save cannot be checked.";
  }
  var listed = Array.isArray(facet.principles) ? facet.principles : [];
  var known = 0;
  var missing = false;
  var withRows = false;
  for (var p = 0; p < listed.length; p++) {
    var pid = listed[p];
    if (typeof pid !== "number" || (pid | 0) !== pid) continue;
    var key = String(pid);
    if (!Object.hasOwn(rowsByPrinciple, key)) {
      missing = true;
      continue;
    }
    known++;
    var set = rowsByPrinciple[key];
    if (set && typeof set === "object" && Object.keys(set).length) withRows = true;
  }
  if (withRows) return "Facet " + label + " needs at least one source ref.";
  if (missing) return "The principle record is not loaded, so this save cannot be checked.";
  if (!known) return "Facet " + label + " needs at least one source ref.";
  return "";
}

function isInlineFacetRow(row) {
  return !!(row && (
    Object.prototype.hasOwnProperty.call(row, "situation") ||
    Object.prototype.hasOwnProperty.call(row, "under") ||
    Object.prototype.hasOwnProperty.call(row, "justRight") ||
    Object.prototype.hasOwnProperty.call(row, "over")
  ));
}

// Same identities as the principles validator: generated ids stand alone,
// source refs are unique per principle and id, and the two sets do not share an id.
function facetRowIdentityErrors(facet) {
  if (!facet || typeof facet !== "object" || !Array.isArray(facet.rows)) return [];
  var errors = [];
  var seenGenerated = Object.create(null);
  var seenRefs = Object.create(null);
  var refIds = Object.create(null);
  var generatedIds = Object.create(null);
  for (var i = 0; i < facet.rows.length; i++) {
    var row = facet.rows[i];
    if (!row || typeof row !== "object") continue;
    var rid = row.id;
    if (typeof rid !== "string" || !rid) continue;
    if (isInlineFacetRow(row)) {
      if (Object.hasOwn(seenGenerated, rid)) errors.push("Row id " + rid + " is already used.");
      else if (Object.hasOwn(refIds, rid)) errors.push("Generated row id " + rid + " reuses a source ref id.");
      else {
        seenGenerated[rid] = true;
        generatedIds[rid] = true;
      }
      continue;
    }
    var refKey = String(row.principle) + "\0" + rid;
    if (Object.hasOwn(seenRefs, refKey)) errors.push("Source ref " + row.principle + "/" + rid + " is already used.");
    else if (Object.hasOwn(generatedIds, rid)) errors.push("Source ref " + row.principle + "/" + rid + " reuses a generated row id.");
    else {
      seenRefs[refKey] = true;
      refIds[rid] = true;
    }
  }
  return errors;
}

function checkList(change, spec) {
  spec = spec || {};
  if (!change) return [];
  if (change.op === "move") {
    if (spec.item !== "facet" && spec.item !== "facetRow") return [];
    return sourceRefsIn(change.before, spec);
  }
  if (change.op !== "insert" && change.op !== "create") return [];
  if (change.op === "create" && spec.kind === "examplePack") return checkPack(change.value, change.file);
  if (change.op === "create") return structuralShape(change.value, change.file, true, spec);
  return checkItem(change.value, spec);
}

function copyOwn(source) {
  var out = Object.create(null);
  if (!source || typeof source !== "object") return out;
  Object.keys(source).forEach(function (key) {
    out[key] = source[key];
  });
  return out;
}

var ESSAY_BY_SLUG = Object.create(null);
var ESSAY_BY_ID = Object.create(null);
try {
  var essaySnap = require("../data/essay_slugs.json");
  if (essaySnap && essaySnap.by_slug) ESSAY_BY_SLUG = copyOwn(essaySnap.by_slug);
  if (essaySnap && essaySnap.by_id) ESSAY_BY_ID = copyOwn(essaySnap.by_id);
} catch (err) {}

function slugFromMap(map, key) {
  if (!map || typeof map !== "object" || typeof key !== "string" || !Object.hasOwn(map, key)) return "";
  var value = map[key];
  if (typeof value === "string" && value) return value;
  if (value) return key;
  return "";
}

function essayUrlError(url, slugs) {
  if (typeof url !== "string") return "";
  var parsed;
  try {
    parsed = new URL(url.trim());
  } catch (err) {
    return "";
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "blog.kindel.com") return "";
  var dated = /^\/\d{4}\/\d{2}\/\d{2}\/([a-z0-9-]+)\/?$/.exec(parsed.pathname);
  var slug = "";
  if (dated) {
    if (Array.isArray(slugs)) {
      if (slugs.indexOf(dated[1]) !== -1) slug = dated[1];
    } else if (slugs && typeof slugs === "object") {
      slug = slugFromMap(slugs, dated[1]);
    } else if (!slugs) {
      slug = slugFromMap(ESSAY_BY_SLUG, dated[1]);
    }
  }
  if (!slug) {
    var postId = parsed.searchParams.get("p");
    if (postId && Object.hasOwn(ESSAY_BY_ID, postId)) {
      var fromId = ESSAY_BY_ID[postId];
      if (typeof fromId === "string" && fromId) slug = fromId;
    }
  }
  if (!slug) return "";
  return "This essay has to use https://kindel.com/essays/" + slug + "/.";
}

function walkDashes(value, path, errors) {
  if (typeof value === "string") {
    var title = path.indexOf(".blog") !== -1 && path.slice(-6) === ".title";
    dashErrors(value, title).forEach(function (error) {
      if (errors.indexOf(error) === -1) errors.push(error);
    });
    return;
  }
  if (Array.isArray(value)) {
    for (var i = 0; i < value.length; i++) walkDashes(value[i], path + "[" + i + "]", errors);
    return;
  }
  if (value && typeof value === "object") {
    var keys = Object.keys(value);
    for (var k = 0; k < keys.length; k++) walkDashes(value[keys[k]], path + "." + keys[k], errors);
  }
}

function structuralShape(doc, file, fresh, spec) {
  var errors = [];
  if (!doc || typeof doc !== "object") return ["That file is not valid JSON."];
  if (file === "data/facets.json") {
    var seenFacet = Object.create(null);
    var facetList = Array.isArray(doc.facets) ? doc.facets : [];
    var rowMap = spec && spec.rowsByPrinciple;
    facetList.forEach(function (facet) {
      if (!facet || typeof facet.id !== "string" || !facet.id) return;
      if (Object.hasOwn(seenFacet, facet.id)) errors.push("Facet id " + facet.id + " is already used.");
      seenFacet[facet.id] = true;
    });
    facetList.forEach(function (facet) {
      var sourceError = facetSourceError(facet, rowMap);
      if (sourceError) errors.push(sourceError);
      facetRowIdentityErrors(facet).forEach(function (error) {
        if (errors.indexOf(error) === -1) errors.push(error);
      });
    });
    return errors;
  }
  var teaching = /^data\/teaching\/([a-z0-9-]+)\/([a-z0-9-]+)\.json$/.exec(file || "");
  if (teaching && teaching[2] !== "index") {
    var why = doc.why;
    if (!Array.isArray(why) || why.length < 3 || why.length > 6 || !why.every(nonempty)) {
      errors.push("Why must stay between 3 and 6 paragraphs.");
    }
    if (!nonempty(doc.calibrationIntro)) errors.push("The calibration intro cannot be empty.");
    var examples = doc.examples;
    if (!Array.isArray(examples) || examples.length < 2 || examples.length > 4) errors.push("Examples must stay between 2 and 4.");
    var looks = doc.looksLike;
    if (!looks || !nonempty(looks.individual) || !nonempty(looks.manager)) errors.push("Looks like needs an individual and a manager.");
    var deepen = doc.deepen;
    if (!Array.isArray(deepen) || deepen.length < 6 || deepen.length > 12 || !deepen.every(nonempty)) {
      errors.push("Concrete questions must stay between 6 and 12.");
    } else if (deepen.some(function (line) { return !/\?\s*$/.test(String(line).trim()); })) {
      errors.push("Each concrete question must end with ?");
    }
    if (!Array.isArray(doc.related) || doc.related.length < 2) errors.push("Related needs at least two principles.");
    if (!Array.isArray(doc.blog) || !doc.blog.length) errors.push("Further reading cannot be empty.");
    else doc.blog.forEach(function (item) { errors = errors.concat(checkBlogItem(item, fresh ? undefined : { existing: true })); });
    if (fresh) {
      if (typeof doc.id !== "number" || (doc.id | 0) !== doc.id) errors.push("A teaching record needs a numeric id.");
      if (doc.slug !== teaching[2]) errors.push("A teaching record's slug has to match its file.");
      var records = spec && spec.records;
      if (!records || typeof records !== "object") {
        errors.push("The principle list for this company is missing, so this save cannot be checked.");
      } else if (!Object.prototype.hasOwnProperty.call(records, teaching[2])) {
        errors.push("This company has no principle named " + teaching[2] + ".");
      } else if (typeof doc.id === "number" && (doc.id | 0) === doc.id && records[teaching[2]] !== doc.id) {
        errors.push("This teaching record's id does not match the principle.");
      }
      var linkSpec = { tokens: true, slugs: spec && spec.slugs };
      (Array.isArray(why) ? why : []).forEach(function (line) {
        errors = errors.concat(checkItem(line, Object.assign({ item: "string" }, linkSpec)));
      });
      (Array.isArray(examples) ? examples : []).forEach(function (item) {
        errors = errors.concat(checkItem(item, { item: "example", slugs: spec && spec.slugs }));
      });
      (Array.isArray(doc.related) ? doc.related : []).forEach(function (item) {
        errors = errors.concat(checkItem(item, Object.assign({ item: "related" }, linkSpec)));
      });
      (Array.isArray(deepen) ? deepen : []).forEach(function (line) {
        errors = errors.concat(checkItem(line, Object.assign({ item: "string", questionMark: true }, linkSpec)));
      });
    }
    walkDashes(doc, "", errors);
    return errors;
  }
  if (teaching && teaching[2] === "index") {
    if (!Array.isArray(doc.principles) || !doc.principles.length) errors.push("The teaching catalog cannot be empty.");
    else if (fresh) {
      doc.principles.forEach(function (item) {
        errors = errors.concat(checkItem(item, { item: "catalog", records: spec && spec.records }));
      });
    }
    if (!Array.isArray(doc.blog) || !doc.blog.length) errors.push("Further reading cannot be empty.");
    else doc.blog.forEach(function (item) { errors = errors.concat(checkBlogItem(item, fresh ? undefined : { existing: true })); });
    return errors;
  }
  var record = /^data\/([a-z0-9-]+)\/([a-z0-9-]+)\.json$/.exec(file || "");
  if (record && record[1] !== "teaching" && record[1] !== "maps" && Array.isArray(doc.rows)) {
    if (!doc.rows.length && !UNPUBLISHED[record[1]]) errors.push("This principle needs at least one calibration row.");
    var marked = doc.rows.filter(function (row) { return row && Object.prototype.hasOwnProperty.call(row, "words"); });
    if (marked.length && marked.length !== doc.rows.length) errors.push("Mark every calibration row with words, or none of them.");
    marked.forEach(function (row) {
      if (!knownWords(row.words)) errors.push("A calibration row's words must be quoted, authored, or generated.");
    });
    var seenRow = Object.create(null);
    for (var rowIndex = 0; rowIndex < doc.rows.length; rowIndex++) {
      var row = doc.rows[rowIndex];
      if (!row || typeof row.id !== "string" || !row.id) continue;
      if (Object.hasOwn(seenRow, row.id)) errors.push("Row id " + row.id + " is already used.");
      seenRow[row.id] = true;
    }
  }
  return errors;
}

module.exports = {
  SENTENCE: SENTENCE,
  MAX_FIELD: MAX_FIELD,
  sentenceCount: sentenceCount,
  checkText: checkText,
  teachingLinks: teachingLinks,
  checkList: checkList,
  checkItem: checkItem,
  essayUrlError: essayUrlError,
  structuralShape: structuralShape,
};
