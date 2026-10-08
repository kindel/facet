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

function validIndex(value, max) {
  return typeof value === "number" && value >= 0 && (value | 0) === value && value <= max && value < 500;
}

function readArray(text, path) {
  var span = locate(text, path);
  if (text[span.start] !== "[") throw fail("NOT_LIST", "that field is not a list");
  var elements = [];
  var k = span.start + 1;
  while (k < text.length) {
    var leadStart = k;
    k = skipWs(text, k);
    if (text[k] === "]") {
      return { start: span.start, end: span.end, close: k, elements: elements };
    }
    var valueStart = k;
    var valueEnd = skipValue(text, k);
    var after = skipWs(text, valueEnd);
    var commaStart = -1;
    var commaEnd = -1;
    if (text[after] === ",") {
      commaStart = after;
      commaEnd = after + 1;
      k = commaEnd;
    } else {
      k = valueEnd;
    }
    elements.push({
      leadStart: leadStart,
      valueStart: valueStart,
      valueEnd: valueEnd,
      commaStart: commaStart,
      commaEnd: commaEnd,
      value: JSON.parse(text.slice(valueStart, valueEnd)),
    });
  }
  throw fail("PARSE", "unterminated list");
}

function elementGap(text, info) {
  var els = info.elements;
  var i;
  for (i = 0; i < els.length; i++) {
    var lead = text.slice(els[i].leadStart, els[i].valueStart);
    if (lead.indexOf("\n") !== -1) return lead;
  }
  for (i = 0; i < els.length; i++) {
    var raw = text.slice(els[i].leadStart, els[i].valueStart);
    if (raw) return raw;
  }
  return "";
}

function emptyGap(text, info) {
  var interior = text.slice(info.start + 1, info.close);
  var nl = interior.lastIndexOf("\n");
  if (nl === -1) return "";
  return "\n" + interior.slice(nl + 1) + "  ";
}

function indentOf(gap) {
  var nl = gap.lastIndexOf("\n");
  if (nl === -1) return "";
  return gap.slice(nl + 1);
}

function encodeValue(value, indent) {
  if (value === undefined) throw fail("PARSE", "the new entry is missing");
  var raw = JSON.stringify(value, null, 2);
  if (!raw || raw.indexOf("\n") === -1) return raw;
  var lines = raw.split("\n");
  for (var i = 1; i < lines.length; i++) lines[i] = indent + lines[i];
  return lines.join("\n");
}

function spliceText(text, start, end, insert) {
  return text.slice(0, start) + insert + text.slice(end);
}

function removeAt(text, path, index, before) {
  var info = readArray(text, path);
  if (!validIndex(index, info.elements.length - 1)) throw fail("NOT_FOUND", "list entry not found");
  var el = info.elements[index];
  if (!sameValue(el.value, before)) {
    throw fail("CONFLICT", "the file no longer has the entry this edit started from");
  }
  if (info.elements.length === 1) {
    var interior = text.slice(info.start + 1, info.close);
    var nl = interior.lastIndexOf("\n");
    if (nl === -1) return spliceText(text, info.start + 1, info.close, "");
    return spliceText(text, info.start + 1, info.close, interior.slice(nl));
  }
  if (index === info.elements.length - 1) {
    var prev = info.elements[index - 1];
    if (prev.commaStart < 0) throw fail("PARSE", "expected a comma");
    return spliceText(text, prev.commaStart, el.valueEnd, "");
  }
  if (el.commaEnd < 0) throw fail("PARSE", "expected a comma");
  var end = el.commaEnd;
  var lead = text.slice(el.leadStart, el.valueStart);
  if (index === 0 && lead.indexOf("\n") === -1) {
    while (end < text.length && (text[end] === " " || text[end] === "\t")) end++;
  }
  return spliceText(text, el.leadStart, end, "");
}

function insertRaw(text, path, index, raw) {
  var info = readArray(text, path);
  if (!validIndex(index, info.elements.length)) throw fail("NOT_FOUND", "list entry not found");
  if (!info.elements.length) {
    var blank = emptyGap(text, info);
    if (!blank) return spliceText(text, info.start + 1, info.close, raw);
    return spliceText(text, info.start + 1, info.start + 1, blank + raw);
  }
  var gap = elementGap(text, info);
  var last = info.elements[info.elements.length - 1];
  if (index < info.elements.length) {
    var el = info.elements[index];
    var piece = gap.indexOf("\n") === -1 && index === 0 ? raw + "," + gap : gap + raw + ",";
    return spliceText(text, el.leadStart, el.leadStart, piece);
  }
  if (last.commaStart >= 0) return spliceText(text, last.commaEnd, last.commaEnd, gap + raw + ",");
  return spliceText(text, last.valueEnd, last.valueEnd, "," + gap + raw);
}

function insertAt(text, path, index, value) {
  var info = readArray(text, path);
  var gap = info.elements.length ? elementGap(text, info) : emptyGap(text, info);
  return insertRaw(text, path, index, encodeValue(value, indentOf(gap)));
}

function moveAt(text, path, from, to, before) {
  var info = readArray(text, path);
  if (!validIndex(from, info.elements.length - 1) || !validIndex(to, info.elements.length - 1)) {
    throw fail("NOT_FOUND", "list entry not found");
  }
  if (from === to) throw fail("CONFLICT", "that move does not change the order");
  var raw = text.slice(info.elements[from].valueStart, info.elements[from].valueEnd);
  return insertRaw(removeAt(text, path, from, before), path, to, raw);
}

function applyOne(text, edit) {
  if (!edit || typeof edit !== "object") throw fail("PARSE", "each edit must be an object");
  var op = edit.op || "replace";
  if (op === "replace") return applyPatch(text, edit.path, edit.before, edit.after).text;
  if (op === "insert") return insertAt(text, edit.path, edit.index, edit.value);
  if (op === "remove") return removeAt(text, edit.path, edit.index, edit.before);
  if (op === "move") return moveAt(text, edit.path, edit.index, edit.to, edit.before);
  throw fail("PARSE", "unknown edit");
}

function applyPatches(text, patches) {
  var next = text;
  for (var i = 0; i < patches.length; i++) next = applyOne(next, patches[i]);
  JSON.parse(next);
  return next;
}

module.exports = {
  locate: locate,
  applyPatch: applyPatch,
  applyPatches: applyPatches,
  insertAt: insertAt,
  removeAt: removeAt,
  moveAt: moveAt,
  sameValue: sameValue,
};
