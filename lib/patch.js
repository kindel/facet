"use strict";

// Surgical JSON edits. Only the addressed string token is rewritten.
// Every other byte in the file stays as it was.

function skipWs(text, i) {
  while (i < text.length) {
    var c = text[i];
    if (c !== " " && c !== "\n" && c !== "\r" && c !== "\t") break;
    i++;
  }
  return i;
}

function readString(text, i) {
  if (text[i] !== '"') {
    var err = new Error("expected a string");
    err.code = "PARSE";
    throw err;
  }
  var start = i;
  i++;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += text[i + 1] === "u" ? 6 : 2;
      continue;
    }
    if (text[i] === '"') {
      var end = i + 1;
      return { start: start, end: end, value: JSON.parse(text.slice(start, end)) };
    }
    i++;
  }
  var bad = new Error("unterminated string");
  bad.code = "PARSE";
  throw bad;
}

function skipContainer(text, i, open, close) {
  if (text[i] !== open) {
    var err = new Error("expected " + open);
    err.code = "PARSE";
    throw err;
  }
  var depth = 0;
  var inStr = false;
  for (var k = i; k < text.length; k++) {
    var c = text[k];
    if (inStr) {
      if (c === "\\") {
        k++;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return k + 1;
    }
  }
  var bad = new Error("unterminated value");
  bad.code = "PARSE";
  throw bad;
}

function skipValue(text, i) {
  i = skipWs(text, i);
  var c = text[i];
  if (c === '"') return readString(text, i).end;
  if (c === "{") return skipContainer(text, i, "{", "}");
  if (c === "[") return skipContainer(text, i, "[", "]");
  var m = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
  if (!m) {
    var err = new Error("expected a value");
    err.code = "PARSE";
    throw err;
  }
  return i + m[0].length;
}

function fail(code, message) {
  var err = new Error(message);
  err.code = code;
  return err;
}

function stepMatches(text, at, step, index) {
  at = skipWs(text, at);
  if (typeof step === "number") return step === index;
  if (!step || typeof step !== "object" || Array.isArray(step)) return false;
  if (text[at] !== "{") return false;
  var end = skipValue(text, at);
  var obj = JSON.parse(text.slice(at, end));
  var keys = Object.keys(step);
  if (!keys.length) return false;
  for (var n = 0; n < keys.length; n++) {
    if (obj[keys[n]] !== step[keys[n]]) return false;
  }
  return true;
}

function locate(text, path, i) {
  if (!Array.isArray(path)) throw fail("PARSE", "path must be an array");
  if (i == null) i = 0;
  i = skipWs(text, i);
  if (!path.length) {
    var end = skipValue(text, i);
    return { start: i, end: end, value: JSON.parse(text.slice(i, end)) };
  }
  var step = path[0];
  var rest = path.slice(1);
  if (text[i] === "{") {
    if (typeof step !== "string") throw fail("PARSE", "expected an object key");
    var j = i + 1;
    while (j < text.length) {
      j = skipWs(text, j);
      if (text[j] === "}") break;
      var key = readString(text, j);
      j = skipWs(text, key.end);
      if (text[j] !== ":") throw fail("PARSE", "expected a colon");
      j++;
      if (key.value === step) return locate(text, rest, j);
      j = skipValue(text, j);
      j = skipWs(text, j);
      if (text[j] === ",") {
        j++;
        continue;
      }
      if (text[j] === "}") break;
      throw fail("PARSE", "expected a comma");
    }
    throw fail("NOT_FOUND", "key not found: " + step);
  }
  if (text[i] === "[") {
    var k = i + 1;
    var index = 0;
    while (k < text.length) {
      k = skipWs(text, k);
      if (text[k] === "]") break;
      if (stepMatches(text, k, step, index)) return locate(text, rest, k);
      k = skipValue(text, k);
      index++;
      k = skipWs(text, k);
      if (text[k] === ",") {
        k++;
        continue;
      }
      if (text[k] === "]") break;
      throw fail("PARSE", "expected a comma");
    }
    throw fail("NOT_FOUND", "list entry not found");
  }
  throw fail("PARSE", "cannot walk into that value");
}

function applyPatch(text, path, before, after) {
  var span = locate(text, path);
  if (typeof span.value !== "string") throw fail("NOT_STRING", "that field is not text");
  if (span.value !== before) throw fail("CONFLICT", "the file no longer has the text this edit started from");
  var encoded = JSON.stringify(after);
  return {
    text: text.slice(0, span.start) + encoded + text.slice(span.end),
    start: span.start,
    end: span.end,
  };
}

function applyPatches(text, patches) {
  var next = text;
  for (var i = 0; i < patches.length; i++) {
    var applied = applyPatch(next, patches[i].path, patches[i].before, patches[i].after);
    next = applied.text;
  }
  JSON.parse(next);
  return next;
}

module.exports = {
  locate: locate,
  applyPatch: applyPatch,
  applyPatches: applyPatches,
};
