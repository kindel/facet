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
  bucketCount: function () { return buckets.size; },
};
