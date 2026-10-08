"use strict";

// Place a principle token at a saved caret. A missing selection means the
// field never had focus, so the token is appended. A space is added only
// when the neighbor character is not already whitespace.

function isSpace(ch) {
  return typeof ch === "string" && ch.length === 1 && /\s/.test(ch);
}

function insertToken(text, selection, token) {
  var value = typeof text === "string" ? text : "";
  var start;
  var end;
  if (!selection || typeof selection.start !== "number" || typeof selection.end !== "number") {
    start = value.length;
    end = value.length;
  } else {
    start = selection.start;
    end = selection.end;
    if (end < start) {
      var swap = start;
      start = end;
      end = swap;
    }
    if (start < 0) start = 0;
    if (end < 0) end = 0;
    if (start > value.length) start = value.length;
    if (end > value.length) end = value.length;
  }
  var before = value.slice(0, start);
  var after = value.slice(end);
  var lead = before.length && !isSpace(before.charAt(before.length - 1)) ? " " : "";
  var trail = after.length && !isSpace(after.charAt(0)) ? " " : "";
  var chunk = String(token);
  var next = before + lead + chunk + trail + after;
  return {
    text: next,
    caret: before.length + lead.length + chunk.length,
  };
}

module.exports = {
  insertToken: insertToken,
};
