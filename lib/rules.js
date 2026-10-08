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
  if (spec.item === "facetRow" && value && typeof value.principle === "number" && !value.situation) {
    if (typeof value.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) return ["A source ref needs a kebab-case row id."];
    return [];
  }
  if (spec.item === "row" || spec.item === "facetRow") {
    if (!value || typeof value !== "object") return ["A calibration row needs a situation, under, just right, and over."];
    var rowErrors = [];
    if (typeof value.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) rowErrors.push("A row id has to be kebab-case.");
    ["situation", "under", "justRight", "over"].forEach(function (key) {
      if (!nonempty(value[key])) rowErrors.push("A calibration row needs " + key + ".");
      else rowErrors = rowErrors.concat(checkText(value[key], { sentences: key !== "situation" && value.words !== "quoted" }));
    });
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
      facetErrors = facetErrors.concat(checkItem(row, { item: "facetRow" }));
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

function checkList(change, spec) {
  spec = spec || {};
  if (!change || (change.op !== "insert" && change.op !== "create")) return [];
  if (change.op === "create" && spec.kind === "examplePack") return checkPack(change.value, change.file);
  if (change.op === "create") return structuralShape(change.value, change.file, true, spec);
  return checkItem(change.value, spec);
}

var ESSAY_BY_SLUG = Object.create(null);
var ESSAY_BY_ID = Object.create(null);
try {
  var essaySnap = require("../data/essay_slugs.json");
  if (essaySnap && essaySnap.by_slug) ESSAY_BY_SLUG = essaySnap.by_slug;
  if (essaySnap && essaySnap.by_id) ESSAY_BY_ID = essaySnap.by_id;
} catch (err) {}

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
    } else if (slugs && typeof slugs === "object" && slugs[dated[1]]) {
      slug = typeof slugs[dated[1]] === "string" ? slugs[dated[1]] : dated[1];
    } else if (!slugs && ESSAY_BY_SLUG[dated[1]]) {
      var mapped = ESSAY_BY_SLUG[dated[1]];
      slug = typeof mapped === "string" ? mapped : dated[1];
    }
  }
  if (!slug) {
    var postId = parsed.searchParams.get("p");
    var fromId = postId && ESSAY_BY_ID[postId];
    if (typeof fromId === "string" && fromId) slug = fromId;
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
        errors = errors.concat(checkItem(item, { item: "catalog" }));
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
