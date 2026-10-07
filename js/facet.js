/* Facet. Hosted at /kld/apps/facet/ on kindel.com. The save function name stays editor-save.
   Facet rows and record rows: kindel/principles data/facets.json and data/<company>/<slug>.json.
   Teaching and further reading: data/teaching/<company>/.
   BIQ questions: kindel/biq data/questions.json, text only. Ids stay put.
   Concrete questions: the deepen list in data/teaching/<company>/<slug>.json. */
(function () {
  "use strict";

  var RAW = {
    principles: "https://raw.githubusercontent.com/kindel/principles/main/",
    biq: "https://raw.githubusercontent.com/kindel/biq/main/",
  };
  var TYPES = [
    { id: "facets", label: "Facets" },
    { id: "questions", label: "BIQ Questions" },
    { id: "concrete", label: "Concrete questions" },
    { id: "teaching", label: "Teaching" },
    { id: "reading", label: "Reading" },
    { id: "all", label: "All" },
  ];
  var SENTENCE = /(?<=[.!?])["')\]]*\s+/;
  var LP_OK = /^\{lp:[a-z0-9]+(?:-[a-z0-9]+)*\}$/;
  var PENDING_KEY = "kld-editor-pending-v1";
  var RECENT_KEY = "kld-editor-recent-v1";
  var MAX_CHANGES = 200;
  var MAX_FILES = 80;
  var RECENT_MAX = 8;

  var S = {
    files: {},
    companies: [],
    byId: {},
    items: [],
    filters: readFilters(),
    pending: {},
    name: "",
    note: "",
    result: null,
    saving: false,
    error: "",
    progress: "Loading the content.",
    ready: false,
    narrow: false,
    restored: 0,
    restoredStale: 0,
    pendingOpen: false,
  };

  var root = document.getElementById("kld-editor");
  if (!root) return;

  function readFilters() {
    var u = new URL(window.location.href);
    function list(name) {
      var raw = u.searchParams.get(name) || "";
      return raw ? raw.split(",").filter(Boolean) : [];
    }
    var type = u.searchParams.get("type") || "facets";
    if (!TYPES.some(function (t) { return t.id === type; })) type = "facets";
    var group = u.searchParams.get("group");
    if (group !== "none" && group !== "company" && group !== "principle") group = "principle";
    var view = u.searchParams.get("view") === "drill" ? "drill" : "list";
    return {
      type: type,
      companies: list("c"),
      principles: list("p").map(function (n) { return String(n); }),
      q: u.searchParams.get("q") || "",
      group: group,
      view: view,
      item: u.searchParams.get("item") || "",
      oc: u.searchParams.get("oc") || "",
      op: u.searchParams.get("op") || "",
      dryrun: u.searchParams.get("dryrun") === "1",
    };
  }

  function writeFilters(push) {
    var u = new URL(window.location.href);
    var f = S.filters;
    function set(name, value) {
      if (value) u.searchParams.set(name, value);
      else u.searchParams.delete(name);
    }
    set("type", f.type === "facets" ? "" : f.type);
    set("c", f.companies.join(","));
    set("p", f.principles.join(","));
    set("q", f.q);
    set("group", f.group === "principle" ? "" : f.group);
    set("view", f.view === "drill" ? "drill" : "");
    set("item", f.item);
    set("oc", f.view === "drill" ? f.oc : "");
    set("op", f.view === "drill" ? f.op : "");
    set("dryrun", f.dryrun ? "1" : "");
    var next = u.pathname + u.search;
    if (push) history.pushState({}, "", next);
    else history.replaceState({}, "", next);
  }

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === "class") node.className = attrs[key];
        else node.setAttribute(key, attrs[key]);
      });
    }
    if (text != null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function clip(text, n) {
    var s = String(text || "").replace(/\s+/g, " ").trim();
    if (s.length <= n) return s;
    return s.slice(0, n - 1) + "…";
  }

  function sentenceCount(text) {
    var parts = String(text || "").trim().split(SENTENCE);
    var n = 0;
    for (var i = 0; i < parts.length; i++) if (parts[i].trim()) n++;
    return n;
  }

  function checkText(value, spec) {
    var errors = [];
    var text = typeof value === "string" ? value : "";
    spec = spec || {};
    if (!text.trim()) errors.push("This field cannot be empty.");
    if (text.indexOf("\u2014") !== -1) errors.push("Replace the em dash before saving.");
    if (text.indexOf("---") !== -1) errors.push("Replace --- before saving.");
    if (text.indexOf("\u2013") !== -1 && !spec.allowEnDash) errors.push("Replace the en dash before saving.");
    if (text.length > 8000) errors.push("This field is too long.");
    if (spec.sentences) {
      var n = sentenceCount(text);
      if (n < 1 || n > 3) errors.push("Use one to three sentences (" + n + " now).");
    }
    if (spec.questionMark && !/\?\s*$/.test(text.trim())) errors.push("End this question with ?");
    if (spec.url && !/^https?:\/\/\S+$/.test(text.trim())) errors.push("Use an http or https URL.");
    if (spec.tokens) {
      var linkAt = 0;
      while (linkAt < text.length) {
        var open = text.indexOf("{lp:", linkAt);
        if (open === -1) break;
        var close = text.indexOf("}", open);
        var token = close === -1 ? text.slice(open) : text.slice(open, close + 1);
        if (!LP_OK.test(token)) {
          errors.push("Principle links look like {lp:ownership}.");
          break;
        }
        linkAt = close + 1;
      }
      if (spec.slugs) {
        var seen = {};
        var re = /\{lp:([a-z0-9]+(?:-[a-z0-9]+)*)\}/g;
        var m;
        while ((m = re.exec(text))) {
          if (spec.slugs.indexOf(m[1]) === -1 && !seen[m[1]]) {
            seen[m[1]] = true;
            errors.push("Unknown principle link {lp:" + m[1] + "}.");
          }
        }
      }
    }
    return errors;
  }

  function fieldSpec(item, field) {
    return {
      sentences: !!field.sentences && item.words !== "quoted",
      questionMark: !!field.questionMark,
      url: !!field.url,
      allowEnDash: !!field.allowEnDash,
      tokens: !!field.tokens,
      slugs: field.tokens ? slugsFor(item.company) : null,
    };
  }

  function slugsFor(company) {
    var co = S.companies.filter(function (c) { return c.id === company; })[0];
    if (!co) return [];
    return co.principles.map(function (p) { return p.slug; });
  }

  function currentValue(item, field) {
    var hit = S.pending[changeId(item, field)];
    if (!hit || hit.stale) return field.value;
    return hit.after;
  }

  function changeId(item, field) {
    return item.repo + "\n" + item.file + "\n" + JSON.stringify(field.path);
  }

  function itemById(id) {
    for (var i = 0; i < S.items.length; i++) if (S.items[i].id === id) return S.items[i];
    return null;
  }

  function pendingList() {
    return Object.keys(S.pending).map(function (key) { return S.pending[key]; });
  }

  function fieldByPath(item, path) {
    var want = JSON.stringify(path);
    for (var i = 0; i < item.fields.length; i++) {
      if (JSON.stringify(item.fields[i].path) === want) return item.fields[i];
    }
    return null;
  }

  function placeOf(item) {
    if (item.kind === "facet" && item.tags && item.tags.length > 1) {
      var facet = item.kicker || "Facet";
      return { company: "", companyName: "", principle: facet, principleName: facet, shared: true };
    }
    var tag = (item.tags && item.tags[0]) || {};
    var companyId = item.company || tag.companyId || "";
    var companyName = tag.companyName || "";
    if (companyId) {
      for (var i = 0; i < S.companies.length; i++) {
        if (S.companies[i].id === companyId) {
          companyName = S.companies[i].name;
          break;
        }
      }
    }
    var principleName = item.principleName || tag.principleName || "";
    return {
      company: companyId,
      companyName: companyName,
      principle: principleName,
      principleName: principleName,
      shared: false,
    };
  }

  function changeErrors(change) {
    if (change.stale) return ["Stale. The text changed, so the current text is shown. Undo this edit, then edit again."];
    var item = itemById(change.itemId);
    if (!item) return ["That edit is no longer on the page. Undo it."];
    var field = fieldByPath(item, change.path);
    if (!field) return ["That field is not editable."];
    return checkText(change.after, fieldSpec(item, field));
  }

  function hasErrors() {
    return pendingList().some(function (change) {
      return !change.stale && changeErrors(change).length;
    });
  }

  function saveableList() {
    return pendingList().filter(function (change) {
      return !change.stale && !changeErrors(change).length;
    });
  }

  function fileCount(list) {
    var seen = {};
    var n = 0;
    list.forEach(function (change) {
      var id = change.repo + ":" + change.file;
      if (seen[id]) return;
      seen[id] = true;
      n++;
    });
    return n;
  }

  function batchError(list) {
    if (list.length > MAX_CHANGES) return "This batch has " + list.length + " edits. Save at most " + MAX_CHANGES + " at a time.";
    var files = fileCount(list);
    if (files > MAX_FILES) return "This batch touches " + files + " files. Save at most " + MAX_FILES + " at a time.";
    return "";
  }

  function restoredCopy() {
    var n = S.restored;
    if (!n) return "";
    var line = n + " unsaved edit" + (n === 1 ? "" : "s") + " restored.";
    if (S.restoredStale) {
      line += " " + S.restoredStale + (S.restoredStale === 1 ? " is stale." : " are stale.");
      line += " The current text is shown.";
    }
    return line;
  }

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {}
  }

  function storageDrop(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (err) {}
  }

  function persistPending() {
    var edits = {};
    var files = {};
    pendingList().forEach(function (change) {
      edits[change.id] = {
        id: change.id,
        itemId: change.itemId,
        label: change.label,
        field: change.field,
        repo: change.repo,
        file: change.file,
        path: change.path,
        before: change.before,
        after: change.after,
        company: change.company || "",
        companyName: change.companyName || "",
        principle: change.principle || "",
        principleName: change.principleName || "",
        shared: !!change.shared,
        sha: change.sha || "",
      };
      if (change.sha) files[change.repo + ":" + change.file] = change.sha;
    });
    if (!Object.keys(edits).length) {
      storageDrop(PENDING_KEY);
      return;
    }
    storageSet(PENDING_KEY, JSON.stringify({ v: 1, files: files, edits: edits }));
  }

  function readRecent() {
    var data;
    try {
      data = JSON.parse(storageGet(RECENT_KEY) || "[]");
    } catch (err) {
      return [];
    }
    if (!Array.isArray(data)) return [];
    return data.filter(function (item) {
      return item && typeof item.url === "string" && /^https:\/\/github\.com\//.test(item.url);
    }).slice(0, RECENT_MAX);
  }

  function rememberPulls(pulls) {
    var next = [];
    (pulls || []).forEach(function (pull) {
      if (!pull || typeof pull.url !== "string" || !/^https:\/\/github\.com\//.test(pull.url)) return;
      next.push({
        url: pull.url,
        repo: String(pull.repo || "").replace(/[^\w./-]/g, "").slice(0, 80),
        number: pull.number || "",
        at: new Date().toISOString(),
      });
    });
    if (!next.length) return;
    var prev = readRecent().filter(function (item) {
      return !next.some(function (one) { return one.url === item.url; });
    });
    storageSet(RECENT_KEY, JSON.stringify(next.concat(prev).slice(0, RECENT_MAX)));
  }

  // Concrete questions used to live on the Teaching tab as teach:<company>:<principle>:deepen-<index>.
  function migrateItemId(id) {
    var match = /^teach:([^:]+):([^:]+):deepen-(\d+)$/.exec(String(id || ""));
    if (!match) return id || "";
    return "concrete:" + match[1] + ":" + match[2] + ":" + match[3];
  }

  function restorePending() {
    var raw = storageGet(PENDING_KEY);
    if (!raw) return;
    var data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return;
    }
    if (!data || typeof data.edits !== "object" || !data.edits) return;
    var ids = Object.keys(data.edits);
    var n = 0;
    var staleN = 0;
    var migrated = false;
    for (var i = 0; i < ids.length && n < MAX_CHANGES; i++) {
      var saved = data.edits[ids[i]];
      if (!saved || typeof saved !== "object") continue;
      if (typeof saved.repo !== "string" || typeof saved.file !== "string" || !Array.isArray(saved.path)) continue;
      if (saved.path.length < 1 || saved.path.length > 8) continue;
      if (typeof saved.before !== "string" || typeof saved.after !== "string") continue;
      if (saved.before.length > 16000 || saved.after.length > 16000) continue;
      var itemId = migrateItemId(saved.itemId);
      var item = itemById(itemId);
      if (!item) {
        item = itemById(saved.itemId);
        itemId = saved.itemId;
      }
      var moved = !!(item && saved.itemId !== item.id);
      var field = item ? fieldByPath(item, saved.path) : null;
      var current = field ? field.value : null;
      // The file SHA records which version this edit was made against.
      // Stale means this field's own text moved. The same words in a newer
      // file still apply, and the current text is what the editor shows.
      var stale = current == null || current !== saved.before;
      var id = item && field ? changeId(item, field) : String(saved.id || ids[i]);
      if (!id || S.pending[id]) continue;
      if (stale) staleN++;
      if (moved) migrated = true;
      S.pending[id] = {
        id: id,
        itemId: item ? item.id : saved.itemId,
        label: moved ? item.title : (saved.label || (item ? item.title : "Edit")),
        field: moved && field ? field.label : (saved.field || (field ? field.label : "Field")),
        repo: saved.repo,
        file: saved.file,
        path: saved.path,
        before: saved.before,
        after: saved.after,
        company: saved.company || "",
        companyName: saved.companyName || "",
        principle: saved.principle || "",
        principleName: saved.principleName || "",
        shared: !!saved.shared,
        sha: typeof saved.sha === "string" ? saved.sha : "",
        stale: stale,
      };
      n++;
    }
    if (n) {
      S.restored = n;
      S.restoredStale = staleN;
    }
    if (migrated) persistPending();
  }

  async function gitBlobSha(text) {
    if (!window.crypto || !window.crypto.subtle || !window.TextEncoder) return "";
    var bytes = new TextEncoder().encode(text);
    var header = new TextEncoder().encode("blob " + bytes.length + "\0");
    var buf = new Uint8Array(header.length + bytes.length);
    buf.set(header, 0);
    buf.set(bytes, header.length);
    var digest = await window.crypto.subtle.digest("SHA-1", buf);
    var view = new Uint8Array(digest);
    var hex = "";
    for (var i = 0; i < view.length; i++) {
      var b = view[i].toString(16);
      hex += b.length === 1 ? "0" + b : b;
    }
    return hex;
  }

  async function stampShas() {
    var keys = Object.keys(S.files);
    for (var i = 0; i < keys.length; i++) {
      try {
        S.files[keys[i]].sha = await gitBlobSha(S.files[keys[i]].text);
      } catch (err) {
        S.files[keys[i]].sha = "";
      }
    }
  }

  function valueAt(node, path) {
    var cur = node;
    for (var i = 0; i < path.length; i++) {
      var step = path[i];
      if (cur == null) return undefined;
      if (typeof step === "string" || typeof step === "number") {
        cur = cur[step];
        continue;
      }
      if (!step || typeof step !== "object" || !Array.isArray(cur)) return undefined;
      var keys = Object.keys(step);
      var found = null;
      for (var n = 0; n < cur.length; n++) {
        var ok = cur[n] && typeof cur[n] === "object";
        for (var k = 0; ok && k < keys.length; k++) {
          if (cur[n][keys[k]] !== step[keys[k]]) ok = false;
        }
        if (ok) {
          found = cur[n];
          break;
        }
      }
      if (!found) return undefined;
      cur = found;
    }
    return cur;
  }

  function applyLocal(change) {
    var file = S.files[change.repo + ":" + change.file];
    if (!file || !Array.isArray(change.path)) return;
    var from = JSON.stringify(change.before);
    var to = JSON.stringify(change.after);
    var positions = [];
    var at = 0;
    while (at <= file.text.length) {
      var found = file.text.indexOf(from, at);
      if (found === -1) break;
      positions.push(found);
      at = found + from.length;
    }
    var chosen = -1;
    var nextText = "";
    for (var i = 0; i < positions.length; i++) {
      var trial = file.text.slice(0, positions[i]) + to + file.text.slice(positions[i] + from.length);
      var parsed;
      try { parsed = JSON.parse(trial); } catch (err) { continue; }
      if (valueAt(parsed, change.path) !== change.after) continue;
      if (chosen !== -1) return;
      chosen = i;
      nextText = trial;
    }
    if (chosen === -1) return;
    file.text = nextText;
    file.json = JSON.parse(nextText);
    var item = itemById(change.itemId);
    var field = item ? fieldByPath(item, change.path) : null;
    if (field) field.value = change.after;
    gitBlobSha(file.text).then(function (sha) { file.sha = sha; }).catch(function () {});
  }

  async function fetchText(url) {
    var res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      var err = new Error(res.status + " " + url);
      err.status = res.status;
      throw err;
    }
    return res.text();
  }

  function keep(repo, file, text) {
    var key = repo + ":" + file;
    S.files[key] = { repo: repo, file: file, text: text, json: JSON.parse(text) };
    return S.files[key];
  }

  async function pool(jobs, limit) {
    var cursor = 0;
    var done = 0;
    async function worker() {
      while (cursor < jobs.length) {
        var job = jobs[cursor++];
        await job();
        done++;
        S.progress = "Loading " + done + " of " + jobs.length + ".";
        var status = document.getElementById("ed-status");
        if (status) status.textContent = S.progress;
      }
    }
    var workers = [];
    for (var n = 0; n < limit; n++) workers.push(worker());
    await Promise.all(workers);
  }

  function tagFor(companyId, principleId, sortOverride) {
    var meta = S.byId[principleId];
    if (!meta) return null;
    return {
      companyId: companyId || meta.companyId,
      companyName: meta.companyName,
      companyIndex: meta.companyIndex,
      principleId: meta.id,
      principleName: meta.name,
      slug: meta.slug,
      sort: sortOverride == null ? meta.sort : sortOverride,
    };
  }

  function addField(item, key, label, path, value, flags) {
    var field = {
      key: key,
      label: label,
      path: path,
      value: value == null ? "" : String(value),
    };
    if (flags) Object.keys(flags).forEach(function (name) { field[name] = flags[name]; });
    item.fields.push(field);
  }

  function baseItem(over) {
    return Object.assign({
      tags: [],
      fields: [],
      text: "",
      title: "",
      sub: "",
      kicker: "",
      words: "",
      shared: false,
      note: "",
      definition: "",
      order: 0,
    }, over);
  }

  function buildItems() {
    var items = [];
    var index = S.files["principles:data/index.json"].json;
    var facets = S.files["principles:data/facets.json"].json;
    var questions = S.files["biq:data/questions.json"].json;
    S.companies = index.companies || [];
    S.byId = {};
    S.companies.forEach(function (co, companyIndex) {
      (co.principles || []).forEach(function (pr) {
        S.byId[pr.id] = {
          id: pr.id,
          slug: pr.slug,
          name: pr.name,
          sort: pr.sort,
          file: pr.file,
          companyId: co.id,
          companyName: co.name,
          companyIndex: companyIndex,
          facets: pr.facets || [],
        };
      });
    });

    (facets.facets || []).forEach(function (facet) {
      var tags = (facet.principles || []).map(function (id) { return tagFor(null, id); }).filter(Boolean);
      tags.sort(function (a, b) {
        if (a.companyIndex !== b.companyIndex) return a.companyIndex - b.companyIndex;
        return a.sort - b.sort;
      });
      (facet.rows || []).forEach(function (row, rowIndex) {
        if (!row || !row.situation || !row.id) return;
        if (row.words !== "generated") return;
        var item = baseItem({
          id: "facet:" + facet.id + ":" + row.id,
          type: "facets",
          kind: "facet",
          title: row.situation,
          text: row.justRight || "",
          sub: "Under: " + clip(row.under, 90) + "  Over: " + clip(row.over, 90),
          kicker: facet.label || facet.id,
          tags: tags,
          shared: tags.length > 1,
          words: row.words || "",
          note: tags.length > 1 ? "This row is shared. One edit changes it for every principle tagged here." : "",
          repo: "principles",
          file: "data/facets.json",
          order: 1000 + rowIndex,
        });
        ["situation", "under", "justRight", "over"].forEach(function (key) {
          var label = key === "justRight" ? "Just right" : key.charAt(0).toUpperCase() + key.slice(1);
          addField(item, key, label, ["facets", { id: facet.id }, "rows", { id: row.id }, key], row[key], {
            sentences: key !== "situation",
            multiline: key !== "situation",
          });
        });
        items.push(item);
      });
    });

    S.companies.forEach(function (co) {
      (co.principles || []).forEach(function (pr) {
        var rec = S.files["principles:" + pr.file];
        if (!rec) return;
        var tag = tagFor(co.id, pr.id);
        (rec.json.rows || []).forEach(function (row, rowIndex) {
          if (!row || !row.id) return;
          var words = row.words || "authored";
          var item = baseItem({
            id: "row:" + co.id + ":" + pr.id + ":" + row.id,
            type: "facets",
            kind: "row",
            title: row.situation || row.id,
            text: row.justRight || "",
            sub: "Under: " + clip(row.under, 90) + "  Over: " + clip(row.over, 90),
            kicker: words === "quoted" ? "Record row, quoted" : "Record row",
            tags: tag ? [tag] : [],
            words: words,
            note: words === "quoted" ? "Quoted from the company. Edit it only to fix a transcription error. An em dash is still rejected." : "",
            definition: rec.json.definition || "",
            company: co.id,
            repo: "principles",
            file: pr.file,
            order: rowIndex,
          });
          ["situation", "under", "justRight", "over"].forEach(function (key) {
            var label = key === "justRight" ? "Just right" : key.charAt(0).toUpperCase() + key.slice(1);
            addField(item, key, label, ["rows", { id: row.id }, key], row[key], {
              sentences: key !== "situation",
              multiline: key !== "situation",
            });
          });
          items.push(item);
        });
      });
    });

    var donor = {};
    (questions.companies || []).forEach(function (co) {
      (co.principles || []).forEach(function (pr) {
        var qs = pr.questions || [];
        if (!qs.length) return;
        (pr.facets || []).forEach(function (facetId) {
          if (!donor[facetId]) donor[facetId] = { companyId: co.id, principleId: pr.id, questions: qs };
        });
      });
    });
    var inherited = {};
    (questions.companies || []).forEach(function (co) {
      (co.principles || []).forEach(function (pr) {
        if ((pr.questions || []).length) return;
        (pr.facets || []).forEach(function (facetId) {
          var src = donor[facetId];
          if (!src) return;
          src.questions.forEach(function (q) {
            var key = q.id || q.text;
            if (!inherited[key]) inherited[key] = [];
            var tag = tagFor(co.id, pr.id);
            if (tag) inherited[key].push(tag);
          });
        });
      });
    });
    (questions.companies || []).forEach(function (co) {
      (co.principles || []).forEach(function (pr) {
        (pr.questions || []).forEach(function (q, qi) {
          if (!q || !q.text) return;
          var stored = tagFor(co.id, pr.id);
          var extra = inherited[q.id || q.text] || [];
          var tags = [];
          var seen = {};
          [stored].concat(extra).forEach(function (tag) {
            if (!tag) return;
            var key = tag.companyId + ":" + tag.principleId;
            if (seen[key]) return;
            seen[key] = true;
            tags.push(tag);
          });
          tags.sort(function (a, b) {
            if (a.companyIndex !== b.companyIndex) return a.companyIndex - b.companyIndex;
            return a.sort - b.sort;
          });
          var step = q.id ? { id: q.id } : qi;
          var item = baseItem({
            id: "question:" + (q.id || co.id + ":" + pr.id + ":" + qi),
            type: "questions",
            kind: "question",
            title: q.text,
            text: q.text,
            kicker: q.manager ? "BIQ manager question" : "BIQ question",
            tags: tags,
            shared: extra.length > 0,
            note: extra.length ? "Stored on " + co.name + ", " + pr.name + ". Other principles show it through a shared facet. The question id stays put, so example packs keep their link." : "The question id stays put, so example packs keep their link.",
            company: co.id,
            principleName: pr.name,
            repo: "biq",
            file: "data/questions.json",
            order: qi,
          });
          addField(item, "text", "BIQ question", ["companies", { id: co.id }, "principles", { id: pr.id }, "questions", step, "text"], q.text, { multiline: true });
          items.push(item);
        });
      });
    });

    S.companies.forEach(function (co) {
      var catalogKey = "principles:data/teaching/" + co.id + "/index.json";
      var catalog = S.files[catalogKey];
      if (!catalog) return;
      (catalog.json.principles || []).forEach(function (entry) {
        var file = "data/teaching/" + co.id + "/" + (entry.file || entry.slug + ".json");
        var doc = S.files["principles:" + file];
        if (!doc) return;
        var tag = tagFor(co.id, entry.id);
        var body = doc.json;
        function teach(id, title, text, fields, order) {
          items.push(baseItem({
            id: "teach:" + co.id + ":" + entry.id + ":" + id,
            type: "teaching",
            kind: "teaching",
            title: title,
            text: text,
            kicker: "Teaching",
            tags: tag ? [tag] : [],
            company: co.id,
            definition: "",
            repo: "principles",
            file: file,
            order: order,
            fields: fields,
          }));
        }
        (body.why || []).forEach(function (para, i) {
          var item = [];
          var holder = { fields: item };
          addField(holder, "why", "Why", ["why", i], para, { multiline: true, tokens: true });
          teach("why-" + i, "Why", para, holder.fields, i);
        });
        if (body.calibrationIntro) {
          var intro = { fields: [] };
          addField(intro, "intro", "How to read the rows", ["calibrationIntro"], body.calibrationIntro, { multiline: true, tokens: true });
          teach("intro", "How to read the rows", body.calibrationIntro, intro.fields, 20);
        }
        (body.examples || []).forEach(function (ex, i) {
          var holder = { fields: [] };
          addField(holder, "title", "Title", ["examples", i, "title"], ex.title, {});
          addField(holder, "body", "Example", ["examples", i, "body"], ex.body, { multiline: true, tokens: true });
          teach("example-" + i, ex.title || "Example", ex.body || "", holder.fields, 30 + i);
        });
        if (body.looksLike) {
          ["individual", "manager"].forEach(function (role, i) {
            var holder = { fields: [] };
            var label = role === "individual" ? "Looks like, individual" : "Looks like, manager";
            addField(holder, role, label, ["looksLike", role], body.looksLike[role], { multiline: true, tokens: true });
            teach("looks-" + role, label, body.looksLike[role] || "", holder.fields, 40 + i);
          });
        }
        (body.deepen || []).forEach(function (q, i) {
          var holder = { fields: [] };
          addField(holder, "deepen", "Concrete question", ["deepen", i], q, { multiline: true, tokens: true, questionMark: true });
          items.push(baseItem({
            id: "concrete:" + co.id + ":" + entry.id + ":" + i,
            type: "concrete",
            kind: "concrete",
            title: q,
            text: q,
            kicker: "Concrete question",
            tags: tag ? [tag] : [],
            company: co.id,
            repo: "principles",
            file: file,
            order: i,
            fields: holder.fields,
          }));
        });
        (body.related || []).forEach(function (rel, i) {
          var holder = { fields: [] };
          addField(holder, "note", "Related", ["related", i, "note"], rel.note, { multiline: true, tokens: true });
          var name = rel.id;
          var linked = (co.principles || []).filter(function (p) { return p.slug === rel.id; })[0];
          if (linked) name = linked.name;
          teach("related-" + i, "Related: " + name, rel.note || "", holder.fields, 70 + i);
        });
        (body.blog || []).forEach(function (post, i) {
          var holder = { fields: [] };
          addField(holder, "title", "Title", ["blog", i, "title"], post.title, { allowEnDash: true });
          addField(holder, "url", "URL", ["blog", i, "url"], post.url, { url: true });
          addField(holder, "note", "Note", ["blog", i, "note"], post.note, { multiline: true });
          items.push(baseItem({
            id: "read:" + co.id + ":" + entry.id + ":" + i,
            type: "reading",
            kind: "reading",
            title: post.title || "Further reading",
            text: post.note || post.url || "",
            kicker: "Further reading",
            tags: tag ? [tag] : [],
            company: co.id,
            repo: "principles",
            file: file,
            order: i,
            fields: holder.fields,
          }));
        });
      });
      (catalog.json.blog || []).forEach(function (post, i) {
        var holder = { fields: [] };
        addField(holder, "title", "Title", ["blog", i, "title"], post.title, { allowEnDash: true });
        addField(holder, "url", "URL", ["blog", i, "url"], post.url, { url: true });
        addField(holder, "note", "Note", ["blog", i, "note"], post.note, { multiline: true });
        var setTag = {
          companyId: co.id,
          companyName: co.name,
          companyIndex: S.companies.indexOf(co),
          principleId: 0,
          principleName: "The set",
          sort: 999,
        };
        items.push(baseItem({
          id: "read:" + co.id + ":index:" + i,
          type: "reading",
          kind: "reading",
          title: post.title || "Further reading",
          text: post.note || "",
          kicker: "Further reading for the set",
          tags: [setTag],
          company: co.id,
          repo: "principles",
          file: "data/teaching/" + co.id + "/index.json",
          order: 100 + i,
          fields: holder.fields,
        }));
      });
    });

    items.forEach(function (item) {
      item.tags.sort(function (a, b) {
        if (a.companyIndex !== b.companyIndex) return a.companyIndex - b.companyIndex;
        return a.sort - b.sort;
      });
    });
    items.sort(function (a, b) {
      var ta = a.tags[0] || { companyIndex: 99, sort: 999 };
      var tb = b.tags[0] || { companyIndex: 99, sort: 999 };
      if (ta.companyIndex !== tb.companyIndex) return ta.companyIndex - tb.companyIndex;
      if (ta.sort !== tb.sort) return ta.sort - tb.sort;
      if (a.order !== b.order) return a.order - b.order;
      return String(a.title).localeCompare(String(b.title));
    });
    S.items = items;
  }

  function matches(item) {
    var f = S.filters;
    if (f.type !== "all" && item.type !== f.type) return false;
    if (f.companies.length && !item.tags.some(function (tag) { return f.companies.indexOf(tag.companyId) !== -1; })) return false;
    if (f.principles.length && !item.tags.some(function (tag) { return f.principles.indexOf(String(tag.principleId)) !== -1; })) return false;
    if (!f.q) return true;
    var hay = [item.title, item.text, item.kicker, item.sub].concat(item.tags.map(function (tag) {
      return tag.companyName + " " + tag.principleName;
    })).concat(item.fields.map(function (field) { return currentValue(item, field); })).join("\n").toLowerCase();
    return hay.indexOf(f.q.toLowerCase()) !== -1;
  }

  function visible() {
    return S.items.filter(matches);
  }

  function previewHtml(text, tokens, company) {
    var html = String(text || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
    if (tokens) {
      var names = {};
      slugsFor(company).forEach(function (slug) {
        var co = S.companies.filter(function (c) { return c.id === company; })[0];
        var pr = co && co.principles.filter(function (p) { return p.slug === slug; })[0];
        names[slug] = pr ? pr.name : slug;
      });
      html = html.replace(/\{lp:([a-z0-9]+(?:-[a-z0-9]+)*)\}/g, function (all, slug) {
        var label = names[slug] || all;
        return "<a>" + label + "</a>";
      });
    }
    html = html.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, function (_, label, url) {
      return '<a href="' + url + '" rel="noopener noreferrer">' + label + "</a>";
    });
    return html.replace(/\n/g, "<br>");
  }

  function renderTags(parent, item) {
    var wrap = el("span", { class: "ed-tags" });
    item.tags.forEach(function (tag) {
      wrap.appendChild(el("span", { class: "ed-tag is-co" }, tag.companyName));
      if (tag.principleName) wrap.appendChild(el("span", { class: "ed-tag" }, tag.principleName));
    });
    parent.appendChild(wrap);
  }

  function itemPending(item) {
    var hit = null;
    for (var i = 0; i < item.fields.length; i++) {
      var one = S.pending[changeId(item, item.fields[i])];
      if (!one) continue;
      hit = one;
      if (one.stale) return one;
    }
    return hit;
  }

  function listLabel(item) {
    var key = "";
    if (item.kind === "question") key = "text";
    else if (item.kind === "concrete") key = "deepen";
    else if (item.kind === "facet" || item.kind === "row") key = "situation";
    else if (item.kind === "reading") key = "title";
    if (key) {
      for (var i = 0; i < item.fields.length; i++) {
        if (item.fields[i].key === key) return currentValue(item, item.fields[i]) || item.title || "";
      }
    }
    return item.title || "";
  }

  function listWhere(item) {
    var tags = item.tags || [];
    var primary = tags[0];
    if (item.company) {
      var owned = tags.filter(function (tag) { return tag.companyId === item.company; })[0];
      if (owned) primary = owned;
    }
    if (item.shared && item.kind === "facet") {
      var facetName = item.kicker || (primary && primary.principleName) || "";
      return facetName ? "Shared · " + facetName : "Shared";
    }
    if (!primary) return "";
    var parts = [];
    if (primary.companyName) parts.push(primary.companyName);
    if (primary.principleName) parts.push(primary.principleName);
    var line = parts.join(" · ");
    if (tags.length > 1) line += " +" + (tags.length - 1);
    return line;
  }

  function renderRow(item) {
    var on = item.id === S.filters.item;
    var btn = el("button", {
      class: "ed-row" + (on ? " is-on" : ""),
      type: "button",
      "data-item": item.id,
      "aria-current": on ? "true" : "false",
    });
    btn.appendChild(el("span", { class: "ed-row-label" }, listLabel(item)));
    var hit = itemPending(item);
    if (hit) {
      btn.appendChild(el("span", {
        class: "ed-dot" + (hit.stale ? " is-stale" : ""),
        role: "img",
        "aria-label": hit.stale ? "Stale edit" : "Pending edit",
      }));
    }
    var where = listWhere(item);
    if (where) btn.appendChild(el("span", { class: "ed-row-where" }, where));
    return btn;
  }

  function renderList() {
    var pane = document.getElementById("ed-list");
    if (!pane) return;
    var top = pane.scrollTop;
    clear(pane);
    var rows = visible();
    var count = el("p", { class: "ed-count" }, rows.length + (rows.length === 1 ? " item" : " items"));
    pane.appendChild(count);
    if (!rows.length) {
      pane.appendChild(el("p", { class: "ed-empty" }, "Nothing matches these filters."));
      pane.scrollTop = top;
      return;
    }
    if (S.filters.view === "drill") {
      renderDrill(pane, rows);
      pane.scrollTop = top;
      return;
    }
    if (S.filters.group === "none") {
      rows.forEach(function (item) { pane.appendChild(renderRow(item)); });
      pane.scrollTop = top;
      return;
    }
    var groups = [];
    var index = {};
    rows.forEach(function (item) {
      var tags = item.tags.length ? item.tags : [{ companyName: "Unmapped", principleName: "", companyIndex: 99, sort: 0, principleId: 0, companyId: "" }];
      var used = S.filters.group === "company" ? tags : tags;
      var seen = {};
      used.forEach(function (tag) {
        if (S.filters.companies.length && S.filters.companies.indexOf(tag.companyId) === -1) return;
        if (S.filters.group === "principle" && S.filters.principles.length && S.filters.principles.indexOf(String(tag.principleId)) === -1) return;
        var key = S.filters.group === "company" ? tag.companyId : tag.companyId + ":" + tag.principleId;
        if (seen[key]) return;
        seen[key] = true;
        if (!index[key]) {
          index[key] = {
            key: key,
            title: S.filters.group === "company" ? tag.companyName : tag.principleName + " · " + tag.companyName,
            companyIndex: tag.companyIndex,
            sort: tag.sort,
            items: [],
          };
          groups.push(index[key]);
        }
        index[key].items.push(item);
      });
    });
    groups.sort(function (a, b) {
      if (a.companyIndex !== b.companyIndex) return a.companyIndex - b.companyIndex;
      return a.sort - b.sort;
    });
    groups.forEach(function (group) {
      pane.appendChild(el("h2", { class: "ed-group" }, group.title));
      group.items.forEach(function (item) { pane.appendChild(renderRow(item)); });
    });
    pane.scrollTop = top;
  }

  function renderDrill(pane, rows) {
    S.companies.forEach(function (co) {
      if (S.filters.companies.length && S.filters.companies.indexOf(co.id) === -1) return;
      var principles = (co.principles || []).filter(function (pr) {
        if (S.filters.principles.length && S.filters.principles.indexOf(String(pr.id)) === -1) return false;
        return rows.some(function (item) {
          return item.tags.some(function (tag) { return tag.principleId === pr.id; });
        });
      });
      if (!principles.length) return;
      var openCo = S.filters.oc === co.id;
      var coBtn = el("button", { class: "ed-node" + (openCo ? " is-on" : ""), type: "button", "data-oc": co.id }, co.name);
      pane.appendChild(coBtn);
      if (!openCo) return;
      principles.forEach(function (pr) {
        var openPr = S.filters.op === String(pr.id);
        var prBtn = el("button", { class: "ed-node ed-principle" + (openPr ? " is-on" : ""), type: "button", "data-op": String(pr.id), "data-oc": co.id }, pr.name);
        pane.appendChild(prBtn);
        if (!openPr) return;
        var kids = el("div", { class: "ed-kids" });
        rows.filter(function (item) {
          return item.tags.some(function (tag) { return tag.principleId === pr.id; });
        }).forEach(function (item) { kids.appendChild(renderRow(item)); });
        pane.appendChild(kids);
      });
    });
  }

  function renderEditor() {
    var pane = document.getElementById("ed-editor");
    if (!pane) return;
    clear(pane);
    if (S.narrow) pane.appendChild(el("button", { class: "ed-back", type: "button", id: "ed-back" }, "Back to the list"));
    var item = itemById(S.filters.item);
    if (!item) {
      pane.appendChild(el("p", { class: "ed-empty" }, "Select a row to edit it."));
      return;
    }
    if (item.kicker) pane.appendChild(el("p", { class: "ed-kicker" }, item.kicker));
    pane.appendChild(el("h2", { class: "ed-text" }, item.title));
    renderTags(pane, item);
    var staleOnItem = item.fields.some(function (field) {
      var hit = S.pending[changeId(item, field)];
      return hit && hit.stale;
    });
    if (staleOnItem) {
      pane.appendChild(el("p", { class: "ed-warn", id: "ed-stale" }, "This edit is stale. The text changed since you wrote it. The current text is shown."));
    }
    if (item.note) pane.appendChild(el("p", { class: "ed-banner" }, item.note));
    if (item.definition) pane.appendChild(el("p", { class: "ed-def" }, item.definition));
    item.fields.forEach(function (field, index) {
      var value = currentValue(item, field);
      pane.appendChild(el("label", { class: "ed-label", for: "ed-field-" + index }, field.label));
      var input;
      if (field.multiline) {
        input = el("textarea", { class: "ed-area", id: "ed-field-" + index, "data-field": String(index), spellcheck: "true", lang: "en", rows: "5" });
        input.value = value;
      } else {
        input = el("input", { class: "ed-input", id: "ed-field-" + index, "data-field": String(index), spellcheck: "true", lang: "en", type: field.url ? "url" : "text" });
        input.value = value;
      }
      pane.appendChild(input);
      var warn = el("p", { class: "ed-field-error", id: "ed-warn-" + index, "data-warn": String(index) });
      var errors = checkText(value, fieldSpec(item, field));
      var staleHit = S.pending[changeId(item, field)];
      if (staleHit && staleHit.stale) errors = ["This edit is stale. The text changed since you wrote it. The current text is shown."].concat(errors);
      warn.hidden = !errors.length;
      warn.textContent = errors[0] || "";
      input.setAttribute("aria-describedby", "ed-warn-" + index);
      input.setAttribute("aria-invalid", errors.length ? "true" : "false");
      pane.appendChild(warn);
      if (field.url) {
        var link = el("a", { href: /^https?:\/\//.test(value) ? value : "https://kindel.com/", rel: "noopener noreferrer", "data-preview": String(index) }, value || "Link preview");
        var preview = el("p", { class: "ed-preview" });
        preview.appendChild(link);
        pane.appendChild(preview);
      } else if (field.tokens || /\{lp:|\[[^\]\n]+\]\(https?:\/\//.test(value)) {
        var box = el("div", { class: "ed-preview", "data-preview": String(index) });
        box.innerHTML = previewHtml(value, field.tokens, item.company);
        pane.appendChild(box);
      } else {
        var quiet = el("div", { class: "ed-preview", "data-preview": String(index) });
        quiet.hidden = true;
        pane.appendChild(quiet);
      }
      if (field.tokens && item.company) {
        var picker = el("select", { class: "ed-select ed-insert", "data-insert": String(index), "aria-label": "Insert a principle link in " + field.label });
        picker.appendChild(el("option", { value: "" }, "Insert a principle link"));
        slugsFor(item.company).forEach(function (slug) {
          var co = S.companies.filter(function (c) { return c.id === item.company; })[0];
          var pr = co.principles.filter(function (p) { return p.slug === slug; })[0];
          picker.appendChild(el("option", { value: slug }, pr ? pr.name : slug));
        });
        pane.appendChild(picker);
      }
    });
    if (S.result) renderResult(pane);
  }

  function renderResult(parent) {
    var box = el("div", { class: "ed-result", id: "ed-result" });
    var result = S.result;
    if (result.error) {
      var openedEarly = result.opened || [];
      box.appendChild(el("h2", {}, openedEarly.length ? "Part of this save opened a pull request" : "Save did not open a pull request"));
      box.appendChild(el("p", {}, result.error));
      openedEarly.forEach(function (pull) {
        var title = el("p", {});
        title.appendChild(document.createTextNode((pull.repo || "Repo") + ": "));
        if (pull.url) title.appendChild(el("a", { href: pull.url, rel: "noopener noreferrer" }, pull.url));
        box.appendChild(title);
      });
      if (openedEarly.length) {
        box.appendChild(el("p", {}, "Those edits were removed from the pending list. The edits that did not open a pull request are still pending. Save again to retry them."));
      }
      parent.appendChild(box);
      return;
    }
    box.appendChild(el("h2", {}, result.dryRun ? "Dry run" : "Pull request opened"));
    if (result.dryRun) {
      var note = result.tokenConfigured
        ? "Nothing was written. This is the branch, the patch, and the pull request text."
        : "EDITOR_GITHUB_TOKEN is not configured. Nothing was written. This preview uses the file text loaded in the page.";
      box.appendChild(el("p", {}, note));
    }
    (result.pulls || []).forEach(function (pull) {
      var title = el("p", {});
      if (pull.url) {
        title.appendChild(document.createTextNode(pull.repo + ": "));
        title.appendChild(el("a", { href: pull.url, rel: "noopener noreferrer" }, pull.url));
      } else {
        title.textContent = pull.repo + "  " + pull.branch + "  onto " + pull.base;
      }
      box.appendChild(title);
      (pull.files || []).forEach(function (file) {
        box.appendChild(el("p", { class: "ed-kicker" }, file.path));
        box.appendChild(el("pre", {}, file.patch || ""));
      });
      box.appendChild(el("p", { class: "ed-kicker" }, "Pull request text"));
      box.appendChild(el("pre", {}, pull.body || ""));
    });
    parent.appendChild(box);
  }

  function renderRecent(parent) {
    var recent = readRecent();
    if (!recent.length) return;
    var box = el("div", { class: "ed-recent", id: "ed-recent" });
    box.appendChild(el("h2", { class: "ed-text" }, "Your recent submissions"));
    var ul = el("ul", {});
    recent.forEach(function (item) {
      var li = el("li", {});
      var label = item.repo || item.url;
      if (item.number) label += " #" + item.number;
      li.appendChild(el("a", { href: item.url, rel: "noopener noreferrer" }, label));
      ul.appendChild(li);
    });
    box.appendChild(ul);
    parent.appendChild(box);
  }

  function focusables(node) {
    if (!node || node.hidden) return [];
    return Array.prototype.filter.call(
      node.querySelectorAll("button, a[href], input, select, textarea"),
      function (item) {
        return !item.disabled && item.tabIndex >= 0 && !item.closest("[hidden]");
      }
    );
  }

  function pendingButtonText(shown) {
    return shown + " pending " + (S.pendingOpen ? "\u25B4" : "\u25BE");
  }

  function setPendingOpen(open, focusMode) {
    S.pendingOpen = !!open;
    renderPending();
    var panel = document.getElementById("ed-pending-panel");
    var toggle = document.getElementById("ed-pending-toggle");
    if (S.pendingOpen && focusMode === "inside" && panel) {
      var items = focusables(panel);
      if (items.length) items[0].focus();
    }
    if (!S.pendingOpen && focusMode === "toggle" && toggle) toggle.focus();
  }

  function renderToolbar() {
    var bar = el("div", { class: "ed-toolbar", id: "ed-toolbar" });
    var wrap = el("div", { class: "ed-pending-wrap", id: "ed-pending-wrap" });
    wrap.appendChild(el("button", {
      type: "button",
      class: "ed-pending-toggle",
      id: "ed-pending-toggle",
      "aria-expanded": "false",
      "aria-controls": "ed-pending-panel",
      "aria-haspopup": "dialog",
    }, pendingButtonText(0)));
    var panel = el("div", {
      id: "ed-pending-panel",
      class: "ed-pending-panel",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "ed-pending-title",
    });
    panel.hidden = true;
    wrap.appendChild(panel);
    bar.appendChild(wrap);
    var save = el("button", { class: "ed-save", type: "button", id: "ed-save" }, "Save");
    save.disabled = true;
    bar.appendChild(save);
    return bar;
  }

  function renderPending() {
    var toggle = document.getElementById("ed-pending-toggle");
    var panel = document.getElementById("ed-pending-panel");
    var save = document.getElementById("ed-save");
    var wrap = document.getElementById("ed-pending-wrap");
    if (!toggle || !panel || !save) return;
    var active = document.activeElement;
    var keepId = active && panel.contains(active) && active.id ? active.id : "";
    var list = pendingList();
    var saveable = saveableList();
    var over = batchError(saveable);
    var n = list.filter(function (change) { return !change.stale; }).length;
    toggle.textContent = pendingButtonText(list.length);
    toggle.setAttribute("aria-label", list.length + " pending");
    toggle.setAttribute("aria-expanded", S.pendingOpen ? "true" : "false");
    if (wrap) wrap.classList.toggle("is-open", S.pendingOpen);
    panel.hidden = !S.pendingOpen;
    clear(panel);
    panel.appendChild(el("h2", { class: "ed-text", id: "ed-pending-title" }, "Pending changes"));
    if (list.length) {
      panel.appendChild(el("button", { class: "ed-discard", type: "button", id: "ed-discard" }, "Discard all"));
    }
    var changes = el("div", { class: "ed-pending-list" });
    if (!list.length) changes.appendChild(el("p", { class: "ed-empty" }, "No pending changes."));
    list.forEach(function (change) {
      var row = el("div", { class: "ed-change" + (change.stale ? " is-stale" : "") });
      var jump = el("button", { type: "button", class: "ed-jump", "data-jump": change.itemId });
      jump.appendChild(el("strong", {}, change.label));
      var where = change.companyName || "";
      if (change.principleName) where = where ? where + ", " + change.principleName : change.principleName;
      if (change.shared) where = where ? "Shared, " + where : "Shared";
      var meta = (where ? where + " · " : "") + change.field;
      jump.appendChild(el("span", { class: "ed-kicker" }, meta));
      if (change.stale) jump.appendChild(el("span", { class: "ed-flag" }, "Stale"));
      var errors = changeErrors(change);
      if (errors.length) jump.appendChild(el("span", { class: "ed-field-error" }, errors[0]));
      row.appendChild(jump);
      row.appendChild(el("button", { type: "button", "data-undo": change.id }, "Undo"));
      changes.appendChild(row);
    });
    panel.appendChild(changes);
    var staleN = list.filter(function (change) { return change.stale; }).length;
    if (staleN) {
      panel.appendChild(el("p", { class: "ed-banner" }, "Stale edits stay in the list and are not part of this save."));
    }
    if (over) panel.appendChild(el("p", { class: "ed-field-error" }, over));

    var metaBox = el("div", { class: "ed-meta" });
    var name = el("input", { class: "ed-input", id: "ed-name", spellcheck: "true", lang: "en", placeholder: "Your name, optional", "aria-label": "Your name, optional", autocomplete: "name" });
    name.value = S.name;
    metaBox.appendChild(name);
    var note = el("textarea", { class: "ed-area", id: "ed-note", spellcheck: "true", lang: "en", rows: "2", placeholder: "Note for the pull request, optional", "aria-label": "Note for the pull request, optional" });
    note.value = S.note;
    metaBox.appendChild(note);
    var honey = el("input", { class: "ed-honeypot", name: "website", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" });
    metaBox.appendChild(honey);
    panel.appendChild(metaBox);

    var check = el("label", { class: "ed-check" });
    var box = el("input", { type: "checkbox", id: "ed-dry" });
    box.checked = S.filters.dryrun;
    check.appendChild(box);
    check.appendChild(document.createTextNode(" Dry run"));
    panel.appendChild(check);

    save.textContent = (S.filters.dryrun ? "Preview pull request" : "Save") + (n ? " (" + n + ")" : "");
    save.disabled = S.saving || !saveable.length || hasErrors() || !!over;
    if (keepId && S.pendingOpen) {
      var again = document.getElementById(keepId);
      if (again) again.focus();
    }
  }

  function refreshRecent() {
    var old = document.getElementById("ed-recent");
    if (old) old.remove();
    var app = document.getElementById("ed-app");
    if (!app) return;
    var host = document.createElement("div");
    renderRecent(host);
    if (!host.firstChild) return;
    var panes = app.querySelector(".ed-panes");
    if (panes) app.insertBefore(host.firstChild, panes);
    else app.appendChild(host.firstChild);
  }

  function syncTypeButtons() {
    root.querySelectorAll("[data-type]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-type") === S.filters.type ? "true" : "false");
    });
    root.querySelectorAll("[data-view]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-view") === S.filters.view ? "true" : "false");
    });
  }

  function renderShell() {
    clear(root);
    var app = el("div", { class: "ed-app", id: "ed-app" });
    app.appendChild(renderToolbar());
    var filters = el("div", { class: "ed-filters" });
    var types = el("div", { class: "ed-types", role: "group", "aria-label": "Content type" });
    TYPES.forEach(function (type) {
      types.appendChild(el("button", { type: "button", "data-type": type.id, "aria-pressed": type.id === S.filters.type ? "true" : "false" }, type.label));
    });
    filters.appendChild(types);
    var search = el("input", { class: "ed-search", id: "ed-search", type: "search", placeholder: "Search", "aria-label": "Search", spellcheck: "true" });
    search.value = S.filters.q;
    filters.appendChild(search);

    filters.appendChild(filterMenu("company", "Companies", S.companies.map(function (co) {
      return { id: co.id, label: co.name };
    })));
    var principles = [];
    S.companies.forEach(function (co) {
      if (S.filters.companies.length && S.filters.companies.indexOf(co.id) === -1) return;
      (co.principles || []).forEach(function (pr) {
        principles.push({ id: String(pr.id), label: pr.name + " · " + co.name });
      });
    });
    filters.appendChild(filterMenu("principle", "Principles", principles));

    var group = el("select", { class: "ed-select", id: "ed-group", "aria-label": "Group" });
    [["principle", "Group by principle"], ["company", "Group by company"], ["none", "No grouping"]].forEach(function (pair) {
      var opt = el("option", { value: pair[0] }, pair[1]);
      if (S.filters.group === pair[0]) opt.selected = true;
      group.appendChild(opt);
    });
    filters.appendChild(group);
    var views = el("div", { class: "ed-view", role: "group", "aria-label": "View" });
    views.appendChild(el("button", { type: "button", "data-view": "list", "aria-pressed": S.filters.view === "list" ? "true" : "false" }, "List"));
    views.appendChild(el("button", { type: "button", "data-view": "drill", "aria-pressed": S.filters.view === "drill" ? "true" : "false" }, "By company"));
    filters.appendChild(views);
    app.appendChild(filters);
    app.appendChild(el("p", { id: "ed-status", class: "ed-count" }, S.ready ? "" : S.progress));
    if (S.restored) app.appendChild(el("p", { class: "ed-restored", id: "ed-restored" }, restoredCopy()));
    renderRecent(app);
    var panes = el("div", { class: "ed-panes" });
    panes.appendChild(el("section", { class: "ed-list-pane", id: "ed-list", "aria-label": "Content" }));
    panes.appendChild(el("section", { class: "ed-editor-pane", id: "ed-editor", "aria-label": "Editor" }));
    app.appendChild(panes);
    root.appendChild(app);
    applyNarrow();
  }

  function filterMenu(kind, label, options) {
    var details = el("details", { class: "ed-details" });
    var selected = kind === "company" ? S.filters.companies : S.filters.principles;
    var summary = el("summary", {}, label + (selected.length ? " (" + selected.length + ")" : ""));
    details.appendChild(summary);
    var menu = el("div", { class: "ed-menu" });
    options.forEach(function (opt) {
      var row = el("label", {});
      var attrs = { type: "checkbox" };
      attrs["data-" + kind] = opt.id;
      var box = el("input", attrs);
      box.checked = selected.indexOf(opt.id) !== -1;
      row.appendChild(box);
      row.appendChild(document.createTextNode(" " + opt.label));
      menu.appendChild(row);
    });
    details.appendChild(menu);
    return details;
  }

  function applyNarrow() {
    S.narrow = window.matchMedia("(max-width: 800px)").matches;
    var app = document.getElementById("ed-app");
    if (!app) return;
    app.classList.toggle("is-detail", S.narrow && !!S.filters.item);
  }

  function paint() {
    writeFilters(false);
    renderShell();
    renderList();
    renderEditor();
    renderPending();
    applyNarrow();
  }

  function openItem(id, push) {
    var item = itemById(id);
    if (!item) return;
    if (S.filters.type !== "all" && item.type !== S.filters.type) S.filters.type = item.type;
    S.filters.item = item.id;
    S.result = null;
    writeFilters(!!push);
    if (S.pendingOpen) S.pendingOpen = false;
    renderList();
    renderEditor();
    renderPending();
    syncTypeButtons();
    applyNarrow();
    if (S.narrow) window.scrollTo(0, 0);
  }

  function onField(input) {
    var item = itemById(S.filters.item);
    if (!item) return;
    var field = item.fields[Number(input.getAttribute("data-field"))];
    if (!field) return;
    var after = input.value;
    var id = changeId(item, field);
    if (after === field.value) delete S.pending[id];
    else {
      var place = placeOf(item);
      var stored = S.files[item.repo + ":" + item.file];
      S.pending[id] = {
        id: id,
        itemId: item.id,
        label: item.title,
        field: field.label,
        repo: item.repo,
        file: item.file,
        path: field.path,
        before: field.value,
        after: after,
        company: place.company,
        companyName: place.companyName,
        principle: place.principleName,
        principleName: place.principleName,
        shared: place.shared,
        sha: stored && stored.sha ? stored.sha : "",
        stale: false,
      };
    }
    persistPending();
    var errors = checkText(after, fieldSpec(item, field));
    var warn = root.querySelector('[data-warn="' + input.getAttribute("data-field") + '"]');
    if (warn) {
      warn.hidden = !errors.length;
      warn.textContent = errors[0] || "";
    }
    input.setAttribute("aria-invalid", errors.length ? "true" : "false");
    var preview = root.querySelector('[data-preview="' + input.getAttribute("data-field") + '"]');
    if (preview) {
      if (field.url) {
        preview.textContent = after || "Link preview";
        if (preview.tagName === "A") preview.setAttribute("href", /^https?:\/\//.test(after) ? after : "https://kindel.com/");
      } else {
        var show = !!field.tokens || /\{lp:|\[[^\]\n]+\]\(https?:\/\//.test(after);
        preview.hidden = !show;
        if (show) preview.innerHTML = previewHtml(after, field.tokens, item.company);
      }
    }
    renderList();
    renderPending();
  }

  function dropOpened(opened) {
    var done = {};
    (opened || []).forEach(function (pull) {
      var key = pull.repoKey || String(pull.repo || "").replace(/^kindel\//, "");
      if (key) done[key] = true;
    });
    Object.keys(S.pending).forEach(function (id) {
      if (done[S.pending[id].repo]) delete S.pending[id];
    });
    persistPending();
  }

  function finishPending() {
    if (!pendingList().length) {
      S.restored = 0;
      S.restoredStale = 0;
      var banner = document.getElementById("ed-restored");
      if (banner) banner.remove();
    }
  }

  async function save() {
    var changes = saveableList();
    if (!changes.length || hasErrors() || batchError(changes) || S.saving) return;
    S.saving = true;
    renderPending();
    var files = {};
    var slugs = {};
    changes.forEach(function (change) {
      var key = change.repo + ":" + change.file;
      if (S.files[key]) files[key] = S.files[key].text;
      var item = itemById(change.itemId);
      if (item && item.company) slugs[item.company] = slugsFor(item.company);
    });
    var honey = root.querySelector("[name=website]");
    try {
      var res = await fetch("/api/editor-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dryRun: S.filters.dryrun,
          website: honey ? honey.value : "",
          name: S.name,
          note: S.note,
          changes: changes.map(function (change) {
            return {
              repo: change.repo,
              file: change.file,
              path: change.path,
              before: change.before,
              after: change.after,
              label: change.label,
              field: change.field,
              company: change.company || "",
              companyName: change.companyName || "",
              principle: change.principleName || "",
              principleName: change.principleName || "",
              shared: !!change.shared,
            };
          }),
          files: files,
          slugs: slugs,
        }),
      });
      var data = {};
      try { data = await res.json(); } catch (err) { data = { error: "The save service did not return JSON." }; }
      if (!res.ok) {
        S.result = { error: data.error || "Save failed.", opened: data.opened || [] };
        var openedRepos = {};
        (data.opened || []).forEach(function (pull) {
          var key = pull.repoKey || String(pull.repo || "").replace(/^kindel\//, "");
          if (key) openedRepos[key] = true;
        });
        changes.forEach(function (change) {
          if (openedRepos[change.repo]) applyLocal(change);
        });
        dropOpened(data.opened);
        rememberPulls(data.opened);
        finishPending();
      } else if (data.pulls) {
        S.result = data;
        if (data.created) {
          changes.forEach(applyLocal);
          changes.forEach(function (change) { delete S.pending[change.id]; });
          persistPending();
          rememberPulls(data.pulls);
          finishPending();
        }
      } else {
        S.result = { error: "Save did not return a pull request." };
      }
    } catch (err) {
      S.result = { error: "Could not reach the save service." };
    }
    S.saving = false;
    refreshRecent();
    renderList();
    renderEditor();
    renderPending();
    var result = document.getElementById("ed-result");
    if (result) result.scrollIntoView({ block: "nearest" });
  }

  root.addEventListener("click", function (event) {
    if (event.target.closest("#ed-pending-toggle")) {
      var opening = !S.pendingOpen;
      setPendingOpen(opening, opening ? "inside" : "toggle");
      return;
    }
    var type = event.target.closest("[data-type]");
    if (type) {
      S.filters.type = type.getAttribute("data-type");
      writeFilters(false);
      syncTypeButtons();
      renderList();
      return;
    }
    var view = event.target.closest("[data-view]");
    if (view) {
      S.filters.view = view.getAttribute("data-view");
      writeFilters(false);
      syncTypeButtons();
      renderList();
      return;
    }
    var oc = event.target.closest("[data-oc]");
    if (oc && !event.target.closest("[data-item]") && !event.target.closest("[data-op]")) {
      var id = oc.getAttribute("data-oc");
      S.filters.oc = S.filters.oc === id ? "" : id;
      writeFilters(false);
      renderList();
      return;
    }
    var op = event.target.closest("[data-op]");
    if (op && !event.target.closest("[data-item]")) {
      S.filters.oc = op.getAttribute("data-oc") || S.filters.oc;
      var pid = op.getAttribute("data-op");
      S.filters.op = S.filters.op === pid ? "" : pid;
      writeFilters(false);
      renderList();
      return;
    }
    var itemBtn = event.target.closest("[data-item]");
    if (itemBtn) {
      openItem(itemBtn.getAttribute("data-item"), true);
      return;
    }
    if (event.target.id === "ed-back") {
      S.filters.item = "";
      writeFilters(true);
      renderList();
      renderEditor();
      applyNarrow();
      window.scrollTo(0, 0);
      return;
    }
    var undo = event.target.closest("[data-undo]");
    if (undo) {
      delete S.pending[undo.getAttribute("data-undo")];
      persistPending();
      finishPending();
      renderEditor();
      renderPending();
      renderList();
      if (S.pendingOpen) {
        var afterUndo = focusables(document.getElementById("ed-pending-panel"));
        if (afterUndo.length) afterUndo[0].focus();
      }
      return;
    }
    var jump = event.target.closest("[data-jump]");
    if (jump) {
      openItem(jump.getAttribute("data-jump"), true);
      return;
    }
    if (event.target.id === "ed-discard") {
      if (!pendingList().length) return;
      if (!window.confirm("Discard all unsaved edits?")) return;
      S.pending = {};
      S.restored = 0;
      S.restoredStale = 0;
      persistPending();
      var banner = document.getElementById("ed-restored");
      if (banner) banner.remove();
      renderEditor();
      renderPending();
      renderList();
      if (S.pendingOpen) {
        var afterDiscard = focusables(document.getElementById("ed-pending-panel"));
        if (afterDiscard.length) afterDiscard[0].focus();
      }
      return;
    }
    if (event.target.id === "ed-save") save();
  });

  root.addEventListener("input", function (event) {
    if (event.target.id === "ed-search") {
      S.filters.q = event.target.value;
      writeFilters(false);
      renderList();
      return;
    }
    if (event.target.id === "ed-name") {
      S.name = event.target.value;
      return;
    }
    if (event.target.id === "ed-note") {
      S.note = event.target.value;
      return;
    }
    if (event.target.hasAttribute("data-field")) onField(event.target);
  });

  root.addEventListener("change", function (event) {
    if (event.target.id === "ed-group") {
      var group = event.target.value;
      if (group !== "none" && group !== "company" && group !== "principle") group = "principle";
      S.filters.group = group;
      writeFilters(false);
      renderList();
      return;
    }
    if (event.target.id === "ed-dry") {
      S.filters.dryrun = event.target.checked;
      writeFilters(false);
      renderPending();
      return;
    }
    if (event.target.hasAttribute("data-company") || event.target.hasAttribute("data-principle")) {
      var kind = event.target.hasAttribute("data-company") ? "companies" : "principles";
      var attr = kind === "companies" ? "data-company" : "data-principle";
      var id = event.target.getAttribute(attr);
      var list = S.filters[kind];
      if (event.target.checked) {
        if (list.indexOf(id) === -1) list.push(id);
      } else {
        S.filters[kind] = list.filter(function (value) { return value !== id; });
      }
      writeFilters(false);
      paint();
      return;
    }
    var insert = event.target.getAttribute("data-insert");
    if (insert && event.target.value) {
      var input = document.getElementById("ed-field-" + insert);
      if (input) {
        var token = "{lp:" + event.target.value + "}";
        input.value = input.value ? input.value.replace(/\s*$/, " ") + token : token;
        onField(input);
      }
      event.target.value = "";
    }
  });

  root.addEventListener("keydown", function (event) {
    if (!S.pendingOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setPendingOpen(false, "toggle");
      return;
    }
    if (event.key !== "Tab") return;
    var panel = document.getElementById("ed-pending-panel");
    var items = focusables(panel);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    var first = items[0];
    var last = items[items.length - 1];
    var active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !panel.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !panel.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  });

  document.addEventListener("mousedown", function (event) {
    if (!S.pendingOpen) return;
    var panel = document.getElementById("ed-pending-panel");
    var toggle = document.getElementById("ed-pending-toggle");
    if (panel && panel.contains(event.target)) return;
    if (toggle && (toggle === event.target || toggle.contains(event.target))) return;
    setPendingOpen(false);
  });

  window.addEventListener("popstate", function () {
    S.filters = readFilters();
    S.pendingOpen = false;
    paint();
  });
  window.addEventListener("resize", applyNarrow);

  async function load() {
    renderShell();
    try {
      keep("principles", "data/index.json", await fetchText(RAW.principles + "data/index.json"));
      keep("principles", "data/facets.json", await fetchText(RAW.principles + "data/facets.json"));
      keep("biq", "data/questions.json", await fetchText(RAW.biq + "data/questions.json"));
      var index = S.files["principles:data/index.json"].json;
      var jobs = [];
      (index.companies || []).forEach(function (co) {
        (co.principles || []).forEach(function (pr) {
          jobs.push(async function () {
            keep("principles", pr.file, await fetchText(RAW.principles + pr.file));
          });
        });
        jobs.push(async function () {
          var file = "data/teaching/" + co.id + "/index.json";
          try {
            var text = await fetchText(RAW.principles + file);
            keep("principles", file, text);
          } catch (err) {
            if (err.status !== 404) throw err;
          }
        });
      });
      await pool(jobs, 8);
      var more = [];
      Object.keys(S.files).forEach(function (key) {
        if (key.indexOf("principles:data/teaching/") !== 0 || key.slice(-11) !== "/index.json") return;
        var catalog = S.files[key].json;
        var company = key.split("/")[2];
        (catalog.principles || []).forEach(function (entry) {
          var file = "data/teaching/" + company + "/" + (entry.file || entry.slug + ".json");
          more.push(async function () {
            keep("principles", file, await fetchText(RAW.principles + file));
          });
        });
      });
      if (more.length) await pool(more, 8);
      buildItems();
      await stampShas();
      restorePending();
      S.ready = true;
      S.progress = "";
      paint();
    } catch (err) {
      S.error = "Could not load the content from GitHub. " + (err && err.message ? err.message : "");
      var status = document.getElementById("ed-status");
      if (status) status.textContent = S.error;
    }
  }

  load();
})();
