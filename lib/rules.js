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
    var seen = {};
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
  var seen = {};
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

module.exports = {
  SENTENCE: SENTENCE,
  MAX_FIELD: MAX_FIELD,
  sentenceCount: sentenceCount,
  checkText: checkText,
  teachingLinks: teachingLinks,
};
