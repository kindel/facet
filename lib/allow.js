"use strict";

// Server-side allowlist. The client does not get to choose a path
// outside these shapes, and a new file is never created.

var COMPANIES = {
  generic: true,
  amazon: true,
  arm: true,
  coupang: true,
  "delivery-hero": true,
  gitlab: true,
  dawn: true,
  toyota: true,
};

var SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var QID = /^[0-9a-f]{8}$/;
var RECORD_FIELDS = { situation: true, under: true, justRight: true, over: true };
var BLOG_FIELDS = { title: true, url: true, note: true };
var CALIBRATION = { under: true, justRight: true, over: true };

function isSlug(value) {
  return typeof value === "string" && SLUG.test(value);
}

function isIndex(value) {
  return typeof value === "number" && value >= 0 && (value | 0) === value && value < 500;
}

function isIdStep(step, kind) {
  if (!step || typeof step !== "object" || Array.isArray(step)) return false;
  if (Object.keys(step).length !== 1 || !Object.prototype.hasOwnProperty.call(step, "id")) return false;
  if (kind === "slug") return isSlug(step.id);
  if (kind === "qid") return typeof step.id === "string" && QID.test(step.id);
  if (kind === "num") return typeof step.id === "number" && step.id > 0 && step.id < 20000 && (step.id | 0) === step.id;
  return false;
}

function isUrlStep(step) {
  if (!step || typeof step !== "object" || Array.isArray(step)) return false;
  if (Object.keys(step).length !== 1 || !Object.prototype.hasOwnProperty.call(step, "url")) return false;
  return typeof step.url === "string" && step.url.length > 0 && step.url.length < 500 && step.url.indexOf("\n") === -1;
}

function fileSafe(file) {
  if (typeof file !== "string" || !file || file.length > 180) return false;
  if (file.indexOf("..") !== -1 || file.indexOf("\\") !== -1 || file.charAt(0) === "/") return false;
  if (!/^[a-z0-9./-]+$/.test(file)) return false;
  return true;
}

function recordFile(file) {
  var m = /^data\/([a-z0-9-]+)\/([a-z0-9-]+)\.json$/.exec(file);
  if (!m || !COMPANIES[m[1]] || !isSlug(m[2])) return null;
  return { company: m[1], slug: m[2] };
}

function teachingFile(file) {
  var m = /^data\/teaching\/([a-z0-9-]+)\/([a-z0-9-]+)\.json$/.exec(file);
  if (!m || !COMPANIES[m[1]] || !isSlug(m[2])) return null;
  return { company: m[1], slug: m[2] };
}

function blogPath(path) {
  if (path.length !== 3 || path[0] !== "blog" || !BLOG_FIELDS[path[2]]) return null;
  if (!(isIndex(path[1]) || isUrlStep(path[1]))) return null;
  return {
    kind: "reading",
    field: path[2],
    allowEnDash: path[2] === "title",
    url: path[2] === "url",
  };
}

function teachingProse(path) {
  if (path.length === 2 && path[0] === "why" && isIndex(path[1])) {
    return { kind: "teaching", field: "why", tokens: true };
  }
  if (path.length === 1 && path[0] === "calibrationIntro") {
    return { kind: "teaching", field: "calibrationIntro", tokens: true };
  }
  if (path.length === 3 && path[0] === "examples" && isIndex(path[1]) && (path[2] === "title" || path[2] === "body")) {
    return { kind: "teaching", field: path[2], tokens: path[2] === "body" };
  }
  if (path.length === 2 && path[0] === "looksLike" && (path[1] === "individual" || path[1] === "manager")) {
    return { kind: "teaching", field: path[1], tokens: true };
  }
  if (path.length === 2 && path[0] === "deepen" && isIndex(path[1])) {
    return { kind: "teaching", field: "deepen", tokens: true, questionMark: true };
  }
  if (path.length === 3 && path[0] === "related" && path[2] === "note" && (isIndex(path[1]) || isIdStep(path[1], "slug"))) {
    return { kind: "teaching", field: "note", tokens: true };
  }
  return blogPath(path);
}

function classify(repo, file, path) {
  if (repo !== "principles" && repo !== "biq") return null;
  if (!fileSafe(file) || !Array.isArray(path) || path.length < 1 || path.length > 8) return null;
  if (repo === "biq") {
    if (file !== "data/questions.json") return null;
    if (
      path.length === 7 &&
      path[0] === "companies" &&
      isIdStep(path[1], "slug") &&
      COMPANIES[path[1].id] &&
      path[2] === "principles" &&
      isIdStep(path[3], "num") &&
      path[4] === "questions" &&
      (isIdStep(path[5], "qid") || isIndex(path[5])) &&
      path[6] === "text"
    ) {
      return { kind: "question", field: "text" };
    }
    return null;
  }
  if (file === "data/facets.json") {
    if (
      path.length === 5 &&
      path[0] === "facets" &&
      isIdStep(path[1], "slug") &&
      path[2] === "rows" &&
      isIdStep(path[3], "slug") &&
      RECORD_FIELDS[path[4]]
    ) {
      return {
        kind: "facet",
        field: path[4],
        requireGenerated: true,
        sentences: !!CALIBRATION[path[4]],
      };
    }
    return null;
  }
  var teaching = teachingFile(file);
  if (teaching) {
    var prose = teaching.slug === "index" ? blogPath(path) : teachingProse(path);
    if (!prose) return null;
    prose.company = teaching.company;
    return prose;
  }
  var record = recordFile(file);
  if (!record) return null;
  if (path.length === 3 && path[0] === "rows" && isIdStep(path[1], "slug") && RECORD_FIELDS[path[2]]) {
    return {
      kind: "row",
      field: path[2],
      sentences: !!CALIBRATION[path[2]],
      company: record.company,
    };
  }
  return null;
}

function assess(change) {
  if (!change || typeof change !== "object") return { ok: false, error: "Each edit must be an object." };
  var spec = classify(change.repo, change.file, change.path);
  if (!spec) return { ok: false, error: "That file or field cannot be edited." };
  if (typeof change.before !== "string" || typeof change.after !== "string") {
    return { ok: false, error: "Edits must replace text with text." };
  }
  if (change.before === change.after) return { ok: false, error: "That edit does not change anything." };
  return { ok: true, spec: spec };
}

function pathKey(change) {
  return change.repo + "\n" + change.file + "\n" + JSON.stringify(change.path);
}

module.exports = {
  COMPANIES: COMPANIES,
  classify: classify,
  assess: assess,
  pathKey: pathKey,
};
