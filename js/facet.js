/* Facet. Hosted at /kld/apps/facet/ on kindel.com. The save function name stays editor-save.
   Facet rows and record rows: kindel/principles data/facets.json and data/<company>/<slug>.json.
   Teaching and further reading: data/teaching/<company>/.
   BIQ questions: kindel/biq data/questions.json. A company that stores questions
   gets a new id and a stub example pack. A shared list stays empty.
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

  function essayHref(href) {
    var api = typeof window !== "undefined" ? window.kindelEssayLinks : null;
    var cat = typeof window !== "undefined" ? window.KINDEL_ESSAY_CATALOG : null;
    if (!api || !cat || typeof api.rewriteHref !== "function") return href;
    var next = api.rewriteHref(href, cat);
    if (typeof next === "string" && next.indexOf("/essays/") === 0) return "https://kindel.com" + next;
    return next;
  }

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
    maps: [],
    mapsNote: "",
    draft: null,
    notice: "",
    addButtons: [],
    lists: [],
    listByKey: Object.create(null),
    teachingAdds: [],
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
    var rawItem = u.searchParams.get("item") || "";
    var item = migrateItemId(rawItem);
    if (item !== rawItem && type === "teaching") type = "concrete";
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
      item: item,
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
        var seen = Object.create(null);
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
    var base = S.base || [];
    for (var b = 0; b < base.length; b++) if (base[b].id === id) return base[b];
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

  function relatedIdsFor(item) {
    if (!item || item.repo !== "principles") return null;
    if (item.file.indexOf("data/teaching/") !== 0) return null;
    if (item.file.slice(-11) === "/index.json") return null;
    var stored = S.files[item.repo + ":" + item.file];
    if (!stored || !stored.json || !Array.isArray(stored.json.related)) return [];
    var ids = [];
    stored.json.related.forEach(function (rel) {
      if (rel && typeof rel.id === "string") ids.push(rel.id);
    });
    return ids;
  }

  function principleName(company, slug) {
    var co = S.companies.filter(function (c) { return c.id === company; })[0];
    var pr = co && (co.principles || []).filter(function (p) { return p.slug === slug; })[0];
    return pr && pr.name ? pr.name : slug;
  }

  function missingRelatedErrors(item, text) {
    var related = relatedIdsFor(item);
    if (!related || String(text || "").indexOf("{lp:") === -1) return [];
    var errors = [];
    var seen = Object.create(null);
    var re = /\{lp:([a-z0-9]+(?:-[a-z0-9]+)*)\}/g;
    var match;
    var slugs = slugsFor(item.company);
    while ((match = re.exec(text))) {
      var slug = match[1];
      if (seen[slug]) continue;
      seen[slug] = true;
      if (slugs.indexOf(slug) === -1) continue;
      if (related.indexOf(slug) === -1) {
        errors.push(principleName(item.company, slug) + " is missing from Related. Add it there, or take the link out, before saving.");
      }
    }
    return errors;
  }

  function fieldErrors(item, field, text) {
    return checkText(text, fieldSpec(item, field)).concat(missingRelatedErrors(item, text));
  }

  function changeErrors(change) {
    if (change.op) return listChangeErrors(change);
    if (change.stale) return ["Stale. The text changed, so the current text is shown. Undo this edit, then edit again."];
    var item = itemById(change.itemId);
    if (!item) return ["That edit is no longer on the page. Undo it."];
    var field = fieldByPath(item, change.path);
    if (!field) return ["That field is not editable."];
    return fieldErrors(item, field, change.after);
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

  function teachingGroups(indexDoc, mapDocs) {
    var slugOf = {};
    ((indexDoc && indexDoc.companies) || []).forEach(function (company) {
      if (!company || typeof company.id !== "string") return;
      (company.principles || []).forEach(function (rec) {
        if (rec && typeof rec.slug === "string") slugOf[company.id + ":" + rec.id] = rec.slug;
      });
    });
    var parent = {};
    function add(file) { if (!parent[file]) parent[file] = file; }
    function find(file) {
      add(file);
      var root = file;
      while (parent[root] !== root) root = parent[root];
      while (parent[file] !== root) {
        var next = parent[file];
        parent[file] = root;
        file = next;
      }
      return root;
    }
    function unite(a, b) {
      var left = find(a);
      var right = find(b);
      if (left !== right) parent[right] = left;
    }
    (mapDocs || []).forEach(function (doc) {
      if (!doc || typeof doc.source !== "string" || typeof doc.target !== "string") return;
      unite("data/teaching/" + doc.source + "/index.json", "data/teaching/" + doc.target + "/index.json");
      (doc.pairs || []).forEach(function (pair) {
        var targetIds = pair && pair.targetIds;
        if (!pair || typeof pair.sourceSlug !== "string" || !Array.isArray(targetIds) || targetIds.length !== 1) return;
        var targetSlug = slugOf[doc.target + ":" + targetIds[0]];
        if (!targetSlug) return;
        unite(
          "data/teaching/" + doc.source + "/" + pair.sourceSlug + ".json",
          "data/teaching/" + doc.target + "/" + targetSlug + ".json"
        );
      });
    });
    var groups = {};
    Object.keys(parent).forEach(function (file) {
      var root = find(file);
      if (!groups[root]) groups[root] = [];
      groups[root].push(file);
    });
    return groups;
  }

  function filesForSave(changes) {
    var files = {};
    function add(key) {
      if (Object.prototype.hasOwnProperty.call(files, key)) return;
      var stored = S.files[key];
      if (stored && typeof stored.text === "string") files[key] = stored.text;
    }
    var needIndex = false;
    var needMaps = false;
    var needQuestions = false;
    var needFacets = false;
    var needRowRefs = false;
    var teachingFiles = [];
    function addSourceRecords(value) {
      if (!value || typeof value !== "object") return;
      var rows = Array.isArray(value.rows) ? value.rows : [value];
      rows.forEach(function (row) {
        if (!row || typeof row.principle !== "number" || row.situation) return;
        var meta = S.byId && S.byId[row.principle];
        if (meta && typeof meta.file === "string") add("principles:" + meta.file);
      });
    }
    function addPrinciple(pid) {
      if (typeof pid !== "number" || (pid | 0) !== pid) return;
      var meta = S.byId && S.byId[pid];
      if (meta && typeof meta.file === "string") add("principles:" + meta.file);
    }
    function addFacetPrinciples(facet) {
      if (!facet || !Array.isArray(facet.principles)) return;
      facet.principles.forEach(addPrinciple);
    }
    function hasSourceRef(facet) {
      var rows = facet && facet.rows;
      if (!Array.isArray(rows)) return false;
      return rows.some(function (row) {
        return !!(row && typeof row.principle === "number" && (row.principle | 0) === row.principle && !Object.prototype.hasOwnProperty.call(row, "situation"));
      });
    }
    (changes || []).forEach(function (change) {
      if (!change || !change.repo || !change.file) return;
      if (change.op !== "create") add(change.repo + ":" + change.file);
      if (change.file === "data/facets.json" && (change.op === "insert" || change.op === "remove" || change.op === "move")) {
        if (change.op !== "remove") addSourceRecords(change.op === "move" ? change.before : change.value);
        var loadedFacets = S.files["principles:data/facets.json"];
        var facetList = loadedFacets && loadedFacets.json && Array.isArray(loadedFacets.json.facets) ? loadedFacets.json.facets : [];
        facetList.forEach(function (facet) {
          if (!hasSourceRef(facet)) addFacetPrinciples(facet);
        });
        var path = change.path;
        var wholeFacet = Array.isArray(path) && path.length === 1 && path[0] === "facets";
        if (wholeFacet) {
          if (change.op === "insert") addFacetPrinciples(change.value);
        } else {
          var step = path && path[1];
          var facetId = step && step.id;
          var matched = false;
          if (typeof facetId === "string") {
            facetList.forEach(function (facet) {
              if (facet && facet.id === facetId) {
                addFacetPrinciples(facet);
                matched = true;
              }
            });
          }
          if (!matched) addFacetPrinciples(change.op === "insert" ? change.value : change.before);
        }
      }
      var facetChange = change.file === "data/facets.json" || change.listKind === "facet" || (Array.isArray(change.path) && change.path[change.path.length - 1] === "facets");
      var teachingChange = change.repo === "principles" && change.file.indexOf("data/teaching/") === 0;
      if (teachingChange) teachingFiles.push(change.file);
      if (change.repo === "principles" || teachingChange || facetChange) needIndex = true;
      if (teachingChange || facetChange) needMaps = true;
      if (change.repo === "biq" || facetChange) needQuestions = true;
      if (facetChange) needFacets = true;
      if (
        change.repo === "principles" &&
        (change.op === "insert" || change.op === "remove" || change.op === "move") &&
        Array.isArray(change.path) && change.path.length === 1 && change.path[0] === "rows" &&
        typeof change.file === "string" &&
        change.file.indexOf("data/teaching/") !== 0 &&
        change.file.indexOf("data/maps/") !== 0 &&
        /^data\/[a-z0-9-]+\/[a-z0-9-]+\.json$/.test(change.file)
      ) needRowRefs = true;
    });
    if (needRowRefs) {
      needFacets = true;
      var rowFacetFile = S.files["principles:data/facets.json"];
      var rowFacetList = rowFacetFile && rowFacetFile.json && rowFacetFile.json.facets;
      (Array.isArray(rowFacetList) ? rowFacetList : []).forEach(function (facet) {
        addSourceRecords(facet);
      });
    }
    if (needIndex) add("principles:data/index.json");
    if (needFacets) add("principles:data/facets.json");
    if (needQuestions) add("biq:data/questions.json");
    if (needMaps && S.maps) {
      var mapNames = [];
      S.maps.forEach(function (map) {
        if (!map || !map.file) return;
        add("principles:" + map.file);
        mapNames.push(map.file);
      });
      var structuralFacet = (changes || []).some(function (change) {
        if (!change) return false;
        if (change.file === "data/facets.json" && Array.isArray(change.path) && change.path.length === 1 && change.path[0] === "facets") return true;
        return Array.isArray(change.path) && change.path.length && change.path[change.path.length - 1] === "facets";
      });
      if (structuralFacet) files["principles:data/maps/_list.json"] = JSON.stringify(mapNames);
    }
    if (teachingFiles.length) {
      var indexDoc = S.files["principles:data/index.json"];
      var mapDocs = (S.maps || []).map(function (map) { return map.json; });
      var groups = teachingGroups(indexDoc && indexDoc.json, mapDocs);
      var clusterOf = {};
      Object.keys(groups).forEach(function (root) {
        groups[root].forEach(function (file) { clusterOf[file] = groups[root]; });
      });
      teachingFiles.forEach(function (file) {
        (clusterOf[file] || []).forEach(function (sibling) { add("principles:" + sibling); });
      });
    }
    return files;
  }

  function batchError(list) {
    if (list.length > MAX_CHANGES) return "This batch has " + list.length + " edits. Save at most " + MAX_CHANGES + " at a time.";
    var files = fileCount(list);
    if (files > MAX_FILES) return "This batch touches " + files + " files. Save at most " + MAX_FILES + " at a time.";
    if (Object.keys(filesForSave(list)).length > MAX_FILES) return "Too many files in one save.";
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
        op: change.op || "",
        index: change.index,
        to: change.to,
        seq: change.seq,
        value: change.value,
        listKind: change.listKind || "",
        type: change.type || "",
        itemKind: change.itemKind || "",
        kicker: change.kicker || "",
        tags: change.tags || [],
        batch: change.batch || "",
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

  function listProjection(saved) {
    var stored = S.files[saved.repo + ":" + saved.file];
    var listed = stored ? dig(stored.json, saved.path) : null;
    return Array.isArray(listed) ? listed.slice() : null;
  }

  function applyRestoredList(list, saved) {
    var next = list.slice();
    if (saved.op === "remove") {
      if (typeof saved.index === "number" && saved.index >= 0 && saved.index < next.length) next.splice(saved.index, 1);
      return next;
    }
    if (saved.op === "insert") {
      if (typeof saved.index === "number" && saved.index >= 0 && saved.index <= next.length) next.splice(saved.index, 0, saved.value);
      return next;
    }
    if (typeof saved.index !== "number" || saved.index < 0 || saved.index >= next.length) return next;
    var moved = next.splice(saved.index, 1)[0];
    var to = typeof saved.to === "number" ? saved.to : 0;
    if (to < 0) to = 0;
    if (to > next.length) to = next.length;
    next.splice(to, 0, moved);
    return next;
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
    var structural = [];
    var plainIds = [];
    for (var i = 0; i < ids.length; i++) {
      var saved = data.edits[ids[i]];
      if (!saved || typeof saved !== "object") continue;
      if (typeof saved.repo !== "string" || typeof saved.file !== "string" || !Array.isArray(saved.path)) continue;
      if (saved.op) structural.push(saved);
      else plainIds.push(ids[i]);
    }
    structural.sort(function (a, b) {
      return (typeof a.seq === "number" ? a.seq : 0) - (typeof b.seq === "number" ? b.seq : 0);
    });
    var projectedLists = Object.create(null);
    for (var s = 0; s < structural.length && n < MAX_CHANGES; s++) {
      var opSaved = structural[s];
      var listId = listKey(opSaved.repo, opSaved.file, opSaved.path);
      if (!Object.prototype.hasOwnProperty.call(projectedLists, listId)) projectedLists[listId] = listProjection(opSaved);
      var restoredOp = restoreOp(opSaved, projectedLists[listId]);
      if (!restoredOp) continue;
      n++;
      if (restoredOp.stale) staleN++;
      else if (Array.isArray(projectedLists[listId]) && (opSaved.op === "insert" || opSaved.op === "remove" || opSaved.op === "move")) {
        projectedLists[listId] = applyRestoredList(projectedLists[listId], opSaved);
      }
    }
    for (var p = 0; p < plainIds.length && n < MAX_CHANGES; p++) {
      var plainId = plainIds[p];
      var saved = data.edits[plainId];
      if (!saved || typeof saved !== "object") continue;
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
      var id = item && field ? changeId(item, field) : String(saved.id || plainId);
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

  function fileSha(repo, file) {
    var stored = S.files[repo + ":" + file];
    return stored && stored.sha ? stored.sha : "";
  }

  function applyStructuralLocal(change) {
    var key = change.repo + ":" + change.file;
    if (change.op === "create") {
      if (change.value === undefined) return;
      keep(change.repo, change.file, JSON.stringify(change.value, null, 2) + "\n");
      return;
    }
    if (change.op === "delete") {
      delete S.files[key];
      return;
    }
    var stored = S.files[key];
    if (!stored || !stored.json) return;
    var doc = cloneJson(stored.json);
    var listed = dig(doc, change.path);
    if (!Array.isArray(listed)) return;
    if (change.op === "remove") {
      if (typeof change.index === "number" && change.index >= 0 && change.index < listed.length) listed.splice(change.index, 1);
    } else if (change.op === "insert") {
      var at = typeof change.index === "number" ? change.index : listed.length;
      if (at < 0) at = 0;
      if (at > listed.length) at = listed.length;
      listed.splice(at, 0, cloneJson(change.value));
    } else if (change.op === "move") {
      if (typeof change.index !== "number" || change.index < 0 || change.index >= listed.length) return;
      var moved = listed.splice(change.index, 1)[0];
      var to = typeof change.to === "number" ? change.to : 0;
      if (to < 0) to = 0;
      if (to > listed.length) to = listed.length;
      listed.splice(to, 0, moved);
    } else {
      return;
    }
    stored.json = doc;
    stored.text = JSON.stringify(doc, null, 2) + "\n";
    gitBlobSha(stored.text).then(function (sha) { stored.sha = sha; }).catch(function () {});
  }

  function settleSaved(changes) {
    var ordered = (changes || []).slice().sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
    var structural = false;
    ordered.forEach(function (change) {
      if (change && change.op) structural = true;
      applyLocal(change);
    });
    if (structural) buildItems();
  }

  function applyLocal(change) {
    if (!change) return;
    if (change.op === "insert" || change.op === "remove" || change.op === "move" || change.op === "create" || change.op === "delete") {
      applyStructuralLocal(change);
      return;
    }
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
          addField(holder, "note", "Note", ["blog", i, "note"], post.note, { multiline: true, tokens: true });
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
        addField(holder, "note", "Note", ["blog", i, "note"], post.note, { multiline: true, tokens: true });
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
    finishLists();
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
      return '<a href="' + essayHref(url) + '" rel="noopener noreferrer">' + label + "</a>";
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
    if (hit || item.synthetic) {
      btn.appendChild(el("span", {
        class: "ed-dot" + (hit && hit.stale ? " is-stale" : ""),
        role: "img",
        "aria-label": hit && hit.stale ? "Stale edit" : "Pending edit",
      }));
    }
    var where = listWhere(item);
    if (where) btn.appendChild(el("span", { class: "ed-row-where" }, where));
    if (!item.listPath) return btn;
    var wrap = el("div", { class: "ed-row-wrap" });
    wrap.appendChild(btn);
    wrap.appendChild(el("button", {
      type: "button",
      class: "ed-icon",
      "data-delete-item": item.id,
      "aria-label": "Delete " + (clip(listLabel(item), 80) || "item"),
    }, "Delete"));
    return wrap;
  }

  function renderList() {
    project();
    var pane = document.getElementById("ed-list");
    if (!pane) return;
    var top = pane.scrollTop;
    clear(pane);
    S.addButtons = [];
    if (S.notice && !S.draft) pane.appendChild(el("p", { class: "ed-warn", id: "ed-notice" }, S.notice));
    var rows = visible();
    var count = el("p", { class: "ed-count" }, rows.length + (rows.length === 1 ? " item" : " items"));
    pane.appendChild(count);
    if (S.filters.view === "drill") {
      renderDrill(pane, rows);
      appendFacetAdd(pane);
      pane.scrollTop = top;
      return;
    }
    if (S.filters.group === "none") {
      rows.forEach(function (item) { pane.appendChild(renderRow(item)); });
      seenAddHomes(rows).forEach(function (home) { appendAdds(pane, home.companyId, home.principleId); });
      appendFacetAdd(pane);
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
    ensureAddGroups(groups, index);
    groups.sort(function (a, b) {
      if (a.companyIndex !== b.companyIndex) return a.companyIndex - b.companyIndex;
      return a.sort - b.sort;
    });
    groups.forEach(function (group) {
      pane.appendChild(el("h2", { class: "ed-group" }, group.title));
      group.items.forEach(function (item) { pane.appendChild(renderRow(item)); });
      if (S.filters.group === "company") {
        var co = S.companies.filter(function (item) { return item.id === group.key; })[0];
        ((co && co.principles) || []).forEach(function (pr) { appendAdds(pane, co.id, pr.id); });
      } else {
        var bits = String(group.key).split(":");
        appendAdds(pane, bits[0], bits[1]);
      }
    });
    appendFacetAdd(pane);
    if (!rows.length && !pane.querySelector(".ed-add")) {
      pane.appendChild(el("p", { class: "ed-empty" }, "Nothing matches these filters."));
    }
    pane.scrollTop = top;
  }

  function seenAddHomes(rows) {
    var homes = [];
    var seen = {};
    function add(companyId, principleId) {
      var key = companyId + ":" + principleId;
      if (!companyId || seen[key]) return;
      if (!addsFor(companyId, principleId).length) return;
      seen[key] = true;
      homes.push({ companyId: companyId, principleId: principleId });
    }
    rows.forEach(function (item) {
      (item.tags || []).forEach(function (tag) { add(tag.companyId, tag.principleId); });
    });
    (S.lists || []).forEach(function (spec) { add(spec.companyId, spec.principleId); });
    (S.teachingAdds || []).forEach(function (spec) { add(spec.companyId, spec.principleId); });
    return homes;
  }

  function ensureAddGroups(groups, index) {
    function consider(spec) {
      if (S.filters.type !== "all" && spec.type !== S.filters.type) return;
      if (S.filters.companies.length && S.filters.companies.indexOf(spec.companyId) === -1) return;
      if (S.filters.group === "principle" && S.filters.principles.length && S.filters.principles.indexOf(String(spec.principleId)) === -1) return;
      var key = S.filters.group === "company" ? spec.companyId : spec.companyId + ":" + spec.principleId;
      if (!key || index[key]) return;
      index[key] = {
        key: key,
        title: S.filters.group === "company" ? spec.companyName : spec.principleName + " · " + spec.companyName,
        companyIndex: spec.companyIndex == null ? 99 : spec.companyIndex,
        sort: spec.sort == null ? 999 : spec.sort,
        items: [],
      };
      groups.push(index[key]);
    }
    (S.lists || []).forEach(consider);
    (S.teachingAdds || []).forEach(consider);
  }

  function appendFacetAdd(pane) {
    if (S.filters.type !== "all" && S.filters.type !== "facets") return;
    pane.appendChild(addButton({ mode: "facet", kind: "facet", type: "facets", label: "Add a facet" }));
  }

  function renderDrill(pane, rows) {
    S.companies.forEach(function (co) {
      if (S.filters.companies.length && S.filters.companies.indexOf(co.id) === -1) return;
      var principles = (co.principles || []).filter(function (pr) {
        if (S.filters.principles.length && S.filters.principles.indexOf(String(pr.id)) === -1) return false;
        var hasRows = rows.some(function (item) {
          return item.tags.some(function (tag) { return tag.principleId === pr.id; });
        });
        return hasRows || addsFor(co.id, pr.id).length > 0;
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
        appendAdds(kids, co.id, pr.id);
        pane.appendChild(kids);
      });
    });
  }

  function renderEditor() {
    project();
    var pane = document.getElementById("ed-editor");
    if (!pane) return;
    clear(pane);
    if (S.narrow) pane.appendChild(el("button", { class: "ed-back", type: "button", id: "ed-back" }, "Back to the list"));
    if (S.draft && !S.filters.item) {
      renderDraft(pane);
      return;
    }
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
    var removed = pendingList().some(function (change) { return change.op === "remove" && change.itemId === item.id; });
    if (S.notice) pane.appendChild(el("p", { class: "ed-warn" }, S.notice));
    if (removed) pane.appendChild(el("p", { class: "ed-banner" }, "This entry is marked deleted. Undo it from the pending list to put it back."));
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
      var errors = fieldErrors(item, field, value);
      var staleHit = S.pending[changeId(item, field)];
      if (staleHit && staleHit.stale) errors = ["This edit is stale. The text changed since you wrote it. The current text is shown."].concat(errors);
      warn.hidden = !errors.length;
      warn.textContent = errors[0] || "";
      input.setAttribute("aria-describedby", "ed-warn-" + index);
      input.setAttribute("aria-invalid", errors.length ? "true" : "false");
      pane.appendChild(warn);
      if (field.url) {
        var link = el("a", { href: /^https?:\/\//.test(value) ? essayHref(value) : "https://kindel.com/", rel: "noopener noreferrer", "data-preview": String(index) }, value || "Link preview");
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
    var actions = renderListActions(item);
    if (actions) pane.appendChild(actions);
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
    var previousHoney = root.querySelector("[name=website]");
    var honeyValue = previousHoney ? previousHoney.value : "";
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
    honey.value = honeyValue;
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
    var was = S.narrow;
    S.narrow = window.matchMedia("(max-width: 800px)").matches;
    var app = document.getElementById("ed-app");
    if (!app) return;
    app.classList.toggle("is-detail", S.narrow && (!!S.filters.item || !!S.draft));
    if (was !== S.narrow && document.getElementById("ed-editor")) renderEditor();
  }

  function paint() {
    project();
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
    S.draft = null;
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
    if (item.synthetic && item.insertId && S.pending[item.insertId]) {
      var created = S.pending[item.insertId];
      var previous = cloneJson(created.value);
      if (field.live) created.value[field.live] = after;
      else created.value = after;
      field.value = after;
      created.label = listLabel(item) || created.label;
      item.title = created.label;
      if (created.listKind === "question" && field.live === "text" && created.batch) {
        pendingList().forEach(function (other) {
          if (other.batch !== created.batch || other.listKind !== "pack" || !other.value) return;
          other.value.question = after;
        });
      }
      if (previous !== undefined) {
        pendingList().forEach(function (other) {
          if (!other.op || other.seq <= created.seq) return;
          if (listKey(other.repo, other.file, other.path) !== listKey(created.repo, created.file, created.path)) return;
          if (sameJson(other.before, previous)) other.before = cloneJson(created.value);
        });
      }
      persistPending();
      var liveErrors = fieldErrors(item, field, after);
      var liveWarn = root.querySelector('[data-warn="' + input.getAttribute("data-field") + '"]');
      if (liveWarn) {
        liveWarn.hidden = !liveErrors.length;
        liveWarn.textContent = liveErrors[0] || "";
      }
      input.setAttribute("aria-invalid", liveErrors.length ? "true" : "false");
      renderList();
      renderPending();
      return;
    }
    if (item.listPath && wordingClash(item.repo, item.file, item.listPath)) {
      input.value = currentValue(item, field);
      var blocked = root.querySelector('[data-warn="' + input.getAttribute("data-field") + '"]');
      if (blocked) {
        blocked.hidden = false;
        blocked.textContent = "Save the list change and the wording change separately.";
      }
      return;
    }
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
    var errors = fieldErrors(item, field, after);
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
        if (preview.tagName === "A") preview.setAttribute("href", /^https?:\/\//.test(after) ? essayHref(after) : "https://kindel.com/");
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
    var files = filesForSave(changes);
    var slugs = {};
    if (Object.keys(files).length > MAX_FILES) {
      S.saving = false;
      S.result = { error: "Too many files in one save." };
      renderPending();
      renderEditor();
      return;
    }
    changes.forEach(function (change) {
      var item = itemById(change.itemId);
      var company = (item && item.company) || change.company;
      if (company) slugs[company] = slugsFor(company);
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
            var out = {
              repo: change.repo,
              file: change.file,
              path: change.path || [],
              label: change.label,
              field: change.field,
              company: change.company || "",
              companyName: change.companyName || "",
              principle: change.principleName || "",
              principleName: change.principleName || "",
              shared: !!change.shared,
            };
            if (change.op) {
              out.op = change.op;
              out.seq = change.seq;
              if (typeof change.index === "number") out.index = change.index;
              if (typeof change.to === "number") out.to = change.to;
              if (change.value !== undefined) out.value = change.value;
              if (change.before !== undefined) out.before = change.before;
              return out;
            }
            out.before = change.before;
            out.after = change.after;
            return out;
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
        settleSaved(changes.filter(function (change) { return openedRepos[change.repo]; }));
        dropOpened(data.opened);
        rememberPulls(data.opened);
        finishPending();
      } else if (data.pulls) {
        S.result = data;
        if (data.created) {
          settleSaved(changes);
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
    var deleter = event.target.closest("[data-delete-item]");
    if (deleter) {
      deleteListed(itemById(deleter.getAttribute("data-delete-item")));
      paint();
      return;
    }
    var add = event.target.closest("[data-add]");
    if (add) {
      var spec = S.addButtons[Number(add.getAttribute("data-add"))];
      if (spec) startDraft(spec);
      paint();
      return;
    }
    var act = event.target.closest("[data-act]");
    if (act) {
      var current = itemById(S.filters.item);
      var name = act.getAttribute("data-act");
      if (name === "add" && current) startDraft(listSpecForItem(current));
      else if (name === "delete" && current) deleteListed(current);
      else if (name === "up" && current) moveListed(current, -1);
      else if (name === "down" && current) moveListed(current, 1);
      else if (name === "delete-facet" && current) deleteFacetById(facetIdOf(current));
      else if (name === "facet-up" && current) moveFacet(current, -1);
      else if (name === "facet-down" && current) moveFacet(current, 1);
      else if (name === "delete-teaching" && current) deleteTeachingFile(current);
      else if (name === "teaching-up" && current) moveTeaching(current, -1);
      else if (name === "teaching-down" && current) moveTeaching(current, 1);
      paint();
      return;
    }
    if (event.target.id === "ed-draft-add") {
      commitDraft();
      paint();
      return;
    }
    if (event.target.id === "ed-draft-cancel") {
      S.draft = null;
      S.notice = "";
      paint();
      return;
    }
    if (event.target.id === "ed-back") {
      S.filters.item = "";
      S.draft = null;
      S.notice = "";
      writeFilters(true);
      renderList();
      renderEditor();
      applyNarrow();
      window.scrollTo(0, 0);
      return;
    }
    var undo = event.target.closest("[data-undo]");
    if (undo) {
      undoChange(undo.getAttribute("data-undo"));
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
    if (event.target.hasAttribute("data-draft")) {
      onDraftInput(event.target);
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
    if (event.target.hasAttribute("data-draft")) {
      onDraftInput(event.target);
      return;
    }
    if (event.target.hasAttribute("data-facet-principle") && S.draft) {
      var picked = event.target.getAttribute("data-facet-principle");
      if (event.target.checked) {
        if (S.draft.principles.indexOf(picked) === -1) S.draft.principles.push(picked);
      } else {
        S.draft.principles = S.draft.principles.filter(function (value) { return value !== picked; });
      }
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

  function listKey(repo, file, path) {
    return repo + "\u0000" + file + "\u0000" + JSON.stringify(path || []);
  }

  function cloneJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function sameJson(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function slugify(text) {
    return String(text || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function uniqueRowId(base, used) {
    var id = base;
    var n = 2;
    while (used[id]) {
      id = base + "-" + n;
      n += 1;
    }
    return id;
  }

  function addLabel(kind) {
    if (kind === "blog") return "Add a further reading link";
    if (kind === "deepen") return "Add a concrete question";
    if (kind === "question") return "Add a BIQ question";
    if (kind === "why") return "Add a why paragraph";
    if (kind === "example") return "Add an example";
    if (kind === "related") return "Add a related note";
    if (kind === "row" || kind === "facetRow") return "Add a calibration row";
    if (kind === "teaching") return "Add teaching";
    if (kind === "facet") return "Add a facet";
    return "Add";
  }

  function unpublished(companyId) {
    return companyId === "generic";
  }

  function dig(root, path) {
    var cur = root;
    for (var i = 0; i < path.length; i++) {
      var step = path[i];
      if (cur == null) return null;
      if (typeof step === "string" || typeof step === "number") {
        cur = cur[step];
        continue;
      }
      if (!step || typeof step !== "object" || !Array.isArray(cur)) return null;
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
      cur = found;
    }
    return cur;
  }

  function indexIn(arr, step) {
    if (!Array.isArray(arr)) return -1;
    if (typeof step === "number") return step;
    if (step && step.id != null) {
      for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === step.id) return i;
    }
    return -1;
  }

  function pushList(spec) {
    if (!spec || !spec.key || S.listByKey[spec.key]) return;
    S.listByKey[spec.key] = spec;
    S.lists.push(spec);
  }

  function assignList(item, path, index, kind, type, value) {
    if (index < 0 || value == null) return;
    item.listPath = path;
    item.listIndex = index;
    item.listKind = kind;
    item.listValue = value;
    var tag = (item.tags && item.tags[0]) || {};
    var companyId = item.company || tag.companyId || "";
    var principleId = tag.principleId || 0;
    if (kind === "question" && path.length >= 4) {
      companyId = path[1] && path[1].id ? path[1].id : companyId;
      principleId = path[3] && path[3].id ? path[3].id : principleId;
    }
    var meta = S.byId[principleId];
    pushList({
      key: listKey(item.repo, item.file, path),
      repo: item.repo,
      file: item.file,
      path: path,
      kind: kind,
      type: type,
      label: addLabel(kind),
      companyId: companyId,
      principleId: principleId,
      companyName: (meta && meta.companyName) || tag.companyName || "",
      principleName: (meta && meta.name) || item.principleName || tag.principleName || "",
      companyIndex: meta ? meta.companyIndex : (tag.companyIndex == null ? 99 : tag.companyIndex),
      sort: meta ? meta.sort : (tag.sort == null ? 999 : tag.sort),
    });
  }

  function tagItemList(item) {
    if (!item.fields || !item.fields.length) return;
    var path = item.fields[0].path;
    var stored = S.files[item.repo + ":" + item.file];
    if (!stored) return;
    if (item.kind === "reading" && path[0] === "blog" && typeof path[1] === "number") {
      assignList(item, ["blog"], path[1], "blog", "reading", dig(stored.json, ["blog", path[1]]));
    } else if (item.kind === "concrete" && path[0] === "deepen") {
      assignList(item, ["deepen"], path[1], "deepen", "concrete", dig(stored.json, ["deepen", path[1]]));
    } else if (item.kind === "question") {
      var qPath = path.slice(0, 5);
      var questions = dig(stored.json, qPath);
      var qIndex = indexIn(questions, path[5]);
      assignList(item, qPath, qIndex, "question", "questions", questions && questions[qIndex]);
    } else if (item.kind === "facet") {
      var fPath = path.slice(0, 3);
      var rows = dig(stored.json, fPath);
      var fIndex = indexIn(rows, path[3]);
      assignList(item, fPath, fIndex, "facetRow", "facets", rows && rows[fIndex]);
    } else if (item.kind === "row") {
      var recordRows = dig(stored.json, ["rows"]);
      var rIndex = indexIn(recordRows, path[1]);
      assignList(item, ["rows"], rIndex, "row", "facets", recordRows && recordRows[rIndex]);
    } else if (item.kind === "teaching" && path[0] === "why") {
      assignList(item, ["why"], path[1], "why", "teaching", dig(stored.json, ["why", path[1]]));
    } else if (item.kind === "teaching" && path[0] === "examples") {
      assignList(item, ["examples"], path[1], "example", "teaching", dig(stored.json, ["examples", path[1]]));
    } else if (item.kind === "teaching" && path[0] === "related") {
      assignList(item, ["related"], path[1], "related", "teaching", dig(stored.json, ["related", path[1]]));
    }
  }

  function registerQuestionLists() {
    var bank = S.files["biq:data/questions.json"];
    if (!bank) return;
    (bank.json.companies || []).forEach(function (co) {
      (co.principles || []).forEach(function (pr) {
        var path = ["companies", { id: co.id }, "principles", { id: pr.id }, "questions"];
        var meta = S.byId[pr.id] || {};
        pushList({
          key: listKey("biq", "data/questions.json", path),
          repo: "biq",
          file: "data/questions.json",
          path: path,
          kind: "question",
          type: "questions",
          label: addLabel("question"),
          companyId: co.id,
          principleId: pr.id,
          companyName: co.name,
          principleName: pr.name,
          companyIndex: meta.companyIndex == null ? 99 : meta.companyIndex,
          sort: meta.sort == null ? 999 : meta.sort,
        });
      });
    });
  }

  function registerRowLists() {
    S.companies.forEach(function (co) {
      (co.principles || []).forEach(function (pr) {
        var file = pr.file;
        if (!S.files["principles:" + file]) return;
        var path = ["rows"];
        var meta = S.byId[pr.id] || {};
        pushList({
          key: listKey("principles", file, path),
          repo: "principles",
          file: file,
          path: path,
          kind: "row",
          type: "facets",
          label: addLabel("row"),
          companyId: co.id,
          principleId: pr.id,
          companyName: co.name,
          principleName: pr.name,
          companyIndex: meta.companyIndex == null ? 99 : meta.companyIndex,
          sort: meta.sort == null ? 999 : meta.sort,
        });
      });
    });
  }

  function finishLists() {
    S.lists = [];
    S.listByKey = Object.create(null);
    S.teachingAdds = [];
    S.items.forEach(tagItemList);
    registerQuestionLists();
    registerRowLists();
    S.companies.forEach(function (co) {
      (co.principles || []).forEach(function (pr) {
        var file = "data/teaching/" + co.id + "/" + pr.slug + ".json";
        if (S.files["principles:" + file]) return;
        var meta = S.byId[pr.id] || {};
        S.teachingAdds.push({
          mode: "teaching",
          kind: "teaching",
          type: "teaching",
          label: "Add teaching",
          companyId: co.id,
          principleId: pr.id,
          companyName: co.name,
          principleName: pr.name,
          companyIndex: meta.companyIndex == null ? 99 : meta.companyIndex,
          sort: meta.sort == null ? 999 : meta.sort,
          slug: pr.slug,
          file: file,
          repo: "principles",
        });
      });
    });
    S.base = S.items.slice();
  }

  function compareItems(a, b) {
    var ta = a.tags[0] || { companyIndex: 99, sort: 999 };
    var tb = b.tags[0] || { companyIndex: 99, sort: 999 };
    if (ta.companyIndex !== tb.companyIndex) return ta.companyIndex - tb.companyIndex;
    if (ta.sort !== tb.sort) return ta.sort - tb.sort;
    if (a.order !== b.order) return a.order - b.order;
    return String(a.title).localeCompare(String(b.title));
  }

  function listOps(repo, file, path) {
    var key = listKey(repo, file, path);
    return pendingList().filter(function (change) {
      return change.op && change.op !== "create" && change.op !== "delete" && listKey(change.repo, change.file, change.path) === key;
    }).sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
  }

  function nextSeq() {
    var n = 1;
    pendingList().forEach(function (change) {
      if ((change.seq || 0) >= n) n = change.seq + 1;
    });
    return n;
  }

  function replayValues(repo, file, path, original) {
    var arr = (original || []).slice();
    listOps(repo, file, path).forEach(function (op) {
      if (op.stale) return;
      if (op.op === "remove") {
        if (op.index >= 0 && op.index < arr.length) arr.splice(op.index, 1);
      } else if (op.op === "insert") {
        var at = op.index;
        if (at < 0) at = 0;
        if (at > arr.length) at = arr.length;
        arr.splice(at, 0, op.value);
      } else if (op.op === "move") {
        if (op.index < 0 || op.index >= arr.length) return;
        var moved = arr.splice(op.index, 1)[0];
        var to = op.to;
        if (to < 0) to = 0;
        if (to > arr.length) to = arr.length;
        arr.splice(to, 0, moved);
      }
    });
    return arr;
  }

  function syntheticItem(op) {
    var value = op.value;
    var title = op.label || "Added";
    if (op.listKind === "blog") title = value && value.title || title;
    else if (op.listKind === "deepen" || op.listKind === "why") title = String(value || title);
    else if (op.listKind === "question") title = value && value.text || title;
    else if (op.listKind === "example") title = value && value.title || title;
    else if (op.listKind === "related") title = "Related: " + ((value && value.id) || "");
    else if (op.listKind === "row" || op.listKind === "facetRow") title = value && value.situation || title;
    else if (op.listKind === "facet") title = value && (value.label || value.id) || title;
    var item = baseItem({
      id: "pending:" + op.id,
      synthetic: true,
      insertId: op.id,
      type: op.type || "all",
      kind: op.itemKind || (op.listKind === "deepen" ? "concrete" : op.listKind === "blog" ? "reading" : op.listKind === "question" ? "question" : op.listKind === "facet" ? "facet" : "teaching"),
      title: title,
      text: typeof value === "string" ? value : title,
      kicker: op.kicker || addLabel(op.listKind).replace(/^Add a |^Add an |^Add /, ""),
      tags: op.tags || [],
      company: op.company,
      principleName: op.principleName,
      repo: op.repo,
      file: op.file,
      order: 5000 + (op.seq || 0),
      listPath: op.path,
      listKind: op.listKind,
      listValue: value,
    });
    if (op.listKind === "blog") {
      addField(item, "title", "Title", ["blog", op.index, "title"], value.title, { allowEnDash: true, live: "title" });
      addField(item, "url", "URL", ["blog", op.index, "url"], value.url, { url: true, live: "url" });
      addField(item, "note", "Note", ["blog", op.index, "note"], value.note, { multiline: true, tokens: true, live: "note" });
    } else if (op.listKind === "deepen") {
      addField(item, "deepen", "Concrete question", ["deepen", op.index], value, { multiline: true, tokens: true, questionMark: true, live: "" });
    } else if (op.listKind === "why") {
      addField(item, "why", "Why", ["why", op.index], value, { multiline: true, tokens: true, live: "" });
    } else if (op.listKind === "question") {
      addField(item, "text", "BIQ question", op.path.concat([op.index, "text"]), value.text, { multiline: true, live: "text" });
    } else if (op.listKind === "example") {
      addField(item, "title", "Title", ["examples", op.index, "title"], value.title, { live: "title" });
      addField(item, "body", "Example", ["examples", op.index, "body"], value.body, { multiline: true, tokens: true, live: "body" });
    } else if (op.listKind === "related") {
      addField(item, "note", "Related", ["related", op.index, "note"], value.note, { multiline: true, tokens: true, live: "note" });
    } else if (op.listKind === "row" || op.listKind === "facetRow") {
      ["situation", "under", "justRight", "over"].forEach(function (key) {
        var label = key === "justRight" ? "Just right" : key.charAt(0).toUpperCase() + key.slice(1);
        addField(item, key, label, op.path.concat([op.index, key]), value[key], { sentences: key !== "situation", multiline: key !== "situation", live: key });
      });
    }
    return item;
  }

  function syntheticFile(change) {
    return baseItem({
      id: "pending:" + change.id,
      synthetic: true,
      insertId: change.id,
      type: "teaching",
      kind: "teaching",
      title: change.label || "New teaching",
      text: "This teaching record is waiting in the batch.",
      kicker: "Teaching",
      tags: change.tags || [],
      company: change.company,
      principleName: change.principleName,
      repo: change.repo,
      file: change.file,
      order: 0,
      note: "This teaching record is added as a whole. Save it, then edit the prose.",
    });
  }

  function replayItems(repo, file, path) {
    var key = listKey(repo, file, path);
    var byIndex = Object.create(null);
    (S.base || []).forEach(function (item) {
      if (!item.listPath || listKey(item.repo, item.file, item.listPath) !== key) return;
      if (byIndex[item.listIndex]) return;
      byIndex[item.listIndex] = item;
    });
    var original = originalArray(repo, file, path);
    var arr = original.map(function (value, index) {
      if (byIndex[index]) return byIndex[index];
      return {
        id: "hidden:" + index + ":" + key,
        hidden: true,
        listPath: path,
        listIndex: index,
        listValue: value,
        repo: repo,
        file: file,
      };
    });
    listOps(repo, file, path).forEach(function (op) {
      if (op.stale) return;
      if (op.op === "remove") {
        if (op.index >= 0 && op.index < arr.length) arr.splice(op.index, 1);
      } else if (op.op === "insert") {
        var at = op.index < 0 ? 0 : op.index;
        if (at > arr.length) at = arr.length;
        arr.splice(at, 0, syntheticItem(op));
      } else if (op.op === "move") {
        if (op.index < 0 || op.index >= arr.length) return;
        var moved = arr.splice(op.index, 1)[0];
        var to = op.to < 0 ? 0 : op.to;
        if (to > arr.length) to = arr.length;
        arr.splice(to, 0, moved);
      }
    });
    return arr;
  }

  function project() {
    if (!S.base) return;
    var hidden = {};
    pendingList().forEach(function (change) {
      if (change.op === "delete") hidden[change.repo + ":" + change.file] = true;
    });
    var grouped = Object.create(null);
    var order = [];
    var loose = [];
    S.base.forEach(function (item) {
      if (hidden[item.repo + ":" + item.file]) return;
      if (!item.listPath) {
        loose.push(item);
        return;
      }
      var key = listKey(item.repo, item.file, item.listPath);
      if (!grouped[key]) {
        grouped[key] = true;
        order.push({ repo: item.repo, file: item.file, path: item.listPath });
      }
    });
    pendingList().forEach(function (change) {
      if (change.op !== "insert" && change.op !== "move") return;
      var key = listKey(change.repo, change.file, change.path);
      if (grouped[key]) return;
      grouped[key] = true;
      order.push({ repo: change.repo, file: change.file, path: change.path });
    });
    var out = loose.slice();
    order.forEach(function (entry) {
      replayItems(entry.repo, entry.file, entry.path).forEach(function (item) {
        if (item.hidden) return;
        out.push(item);
      });
    });
    pendingList().forEach(function (change) {
      if (change.op === "create" && change.listKind !== "pack") out.push(syntheticFile(change));
    });
    out.sort(compareItems);
    S.items = out;
  }

  function currentIndex(item) {
    if (!item || !item.listPath) return -1;
    var arr = replayItems(item.repo, item.file, item.listPath);
    for (var i = 0; i < arr.length; i++) if (arr[i].id === item.id) return i;
    return -1;
  }

  function lengthLimit(kind, next, companyId) {
    if (kind === "deepen" && (next < 6 || next > 12)) return "Concrete questions must stay between 6 and 12.";
    if (kind === "why" && (next < 3 || next > 6)) return "Why must stay between 3 and 6 paragraphs.";
    if (kind === "example" && (next < 2 || next > 4)) return "Examples must stay between 2 and 4.";
    if (kind === "related" && next < 2) return "Related needs at least two principles.";
    if (kind === "blog" && next < 1) return "Further reading cannot be empty.";
    if (kind === "row" && next < 1 && !unpublished(companyId)) return "This principle needs at least one calibration row.";
    if (kind === "facetRow" && next < 1) return "A facet needs at least one row.";
    return "";
  }

  function companyExamples(companyId) {
    var bank = S.files["biq:data/questions.json"];
    if (!bank) return true;
    var co = (bank.json.companies || []).filter(function (item) { return item.id === companyId; })[0];
    return !co || co.examples !== false;
  }

  function essayProblem(url) {
    var cat = window.KINDEL_ESSAY_CATALOG;
    var parsed;
    try { parsed = new URL(String(url || "").trim()); } catch (err) { return ""; }
    if (parsed.protocol !== "https:" || parsed.hostname !== "blog.kindel.com" || !cat) return "";
    var dated = /^\/\d{4}\/\d{2}\/\d{2}\/([a-z0-9-]+)\/?$/.exec(parsed.pathname);
    if (dated && cat.bySlug && cat.bySlug[dated[1]]) {
      var slug = cat.bySlug[dated[1]];
      if (typeof slug !== "string" || !slug) slug = dated[1];
      return "This essay has to use https://kindel.com/essays/" + slug + "/.";
    }
    var postId = parsed.searchParams.get("p");
    if (postId && cat.byId && typeof cat.byId[postId] === "string" && cat.byId[postId]) {
      return "This essay has to use https://kindel.com/essays/" + cat.byId[postId] + "/.";
    }
    return "";
  }

  function dashProblem(text, allowEnDash) {
    return checkText(text, { allowEnDash: !!allowEnDash }).filter(function (error) {
      return error.indexOf("dash") !== -1 || error.indexOf("---") !== -1;
    });
  }

  function wordingClash(repo, file, listPath) {
    return pendingList().some(function (change) {
      if (change.op || change.repo !== repo || change.file !== file) return false;
      if (!Array.isArray(change.path) || change.path.length < listPath.length) return false;
      for (var i = 0; i < listPath.length; i++) {
        if (JSON.stringify(change.path[i]) !== JSON.stringify(listPath[i])) return false;
      }
      return true;
    });
  }

  function listClash(item) {
    if (!item || !item.listPath) return false;
    return wordingClash(item.repo, item.file, item.listPath);
  }

  function queueOp(spec) {
    var seq = spec.seq || nextSeq();
    var id = listKey(spec.repo, spec.file, spec.path || []) + "\u0000" + spec.op + "\u0000" + seq;
    var principleName = spec.principleName || spec.principle || "";
    S.pending[id] = {
      id: id,
      op: spec.op,
      seq: seq,
      itemId: spec.itemId || ("pending:" + id),
      label: spec.label || "Item",
      field: spec.field || (spec.op === "insert" || spec.op === "create" ? "added" : spec.op === "move" ? "moved" : "deleted"),
      repo: spec.repo,
      file: spec.file,
      path: spec.path || [],
      index: spec.index,
      to: spec.to,
      value: spec.value,
      before: spec.before,
      company: spec.company || "",
      companyName: spec.companyName || "",
      principle: principleName,
      principleName: principleName,
      shared: !!spec.shared,
      sha: spec.sha || fileSha(spec.repo, spec.file),
      stale: false,
      listKind: spec.listKind || "",
      type: spec.type || "",
      itemKind: spec.itemKind || "",
      kicker: spec.kicker || "",
      tags: spec.tags || [],
      batch: spec.batch || "",
    };
    return S.pending[id];
  }

  function afterStruct() {
    S.notice = "";
    persistPending();
    project();
  }

  function undoChange(id) {
    var change = S.pending[id];
    if (!change) return;
    if (change.batch) {
      var batch = change.batch;
      Object.keys(S.pending).forEach(function (key) {
        if (S.pending[key].batch === batch) delete S.pending[key];
      });
      return;
    }
    if (change.op) {
      var key = listKey(change.repo, change.file, change.path || []);
      var seq = change.seq || 0;
      Object.keys(S.pending).forEach(function (pid) {
        var other = S.pending[pid];
        if (!other || !other.op || other.batch) return;
        if (listKey(other.repo, other.file, other.path || []) !== key) return;
        if ((other.seq || 0) >= seq) delete S.pending[pid];
      });
      return;
    }
    delete S.pending[id];
  }

  function metaFrom(spec, item) {
    var tag = item && item.tags && item.tags[0];
    return {
      company: (item && item.company) || spec.companyId || "",
      companyName: spec.companyName || (tag && tag.companyName) || "",
      principleName: spec.principleName || (tag && tag.principleName) || "",
      shared: !!(item && item.shared),
      tags: item && item.tags ? item.tags : (spec.principleId ? [{
        companyId: spec.companyId,
        companyName: spec.companyName,
        companyIndex: spec.companyIndex == null ? 99 : spec.companyIndex,
        principleId: spec.principleId,
        principleName: spec.principleName,
        sort: spec.sort == null ? 999 : spec.sort,
      }] : []),
    };
  }

  function originalArray(repo, file, path) {
    var stored = S.files[repo + ":" + file];
    var value = stored ? dig(stored.json, path) : null;
    return Array.isArray(value) ? value : [];
  }

  function queueInsert(spec, value, label, batch) {
    if (wordingClash(spec.repo, spec.file, spec.path)) {
      S.notice = "Save the list change and the wording change separately.";
      return null;
    }
    var current = replayValues(spec.repo, spec.file, spec.path, originalArray(spec.repo, spec.file, spec.path));
    var next = current.length + 1;
    var limit = lengthLimit(spec.kind, next, spec.companyId);
    if (limit) {
      S.notice = limit;
      return null;
    }
    if (spec.kind === "question" && !companyExamples(spec.companyId)) {
      var coName = spec.companyName || spec.companyId;
      S.notice = coName + " shows a shared BIQ list and does not store its own questions. Add the question on the company that stores them.";
      return null;
    }
    var home = metaFrom(spec, null);
    var change = queueOp({
      op: "insert",
      repo: spec.repo,
      file: spec.file,
      path: spec.path,
      index: current.length,
      value: value,
      label: label,
      field: "added",
      listKind: spec.kind,
      type: spec.type,
      itemKind: spec.kind === "deepen" ? "concrete" : spec.kind === "blog" ? "reading" : spec.kind === "example" || spec.kind === "why" || spec.kind === "related" ? "teaching" : spec.kind === "facetRow" || spec.kind === "row" ? "facet" : spec.kind,
      kicker: addLabel(spec.kind).replace(/^Add /, ""),
      company: home.company,
      companyName: home.companyName,
      principleName: home.principleName,
      shared: spec.kind === "facetRow",
      tags: home.tags,
      batch: batch || "",
    });
    afterStruct();
    return change;
  }

  function deleteListed(item) {
    if (!item) return;
    if (item.synthetic && item.insertId) {
      undoChange(item.insertId);
      afterStruct();
      if (S.filters.item === item.id) S.filters.item = "";
      return;
    }
    if (!item.listPath) return;
    if (listClash(item)) {
      S.notice = "Save the list change and the wording change separately.";
      return;
    }
    var index = currentIndex(item);
    if (index < 0) return;
    var current = replayValues(item.repo, item.file, item.listPath, originalArray(item.repo, item.file, item.listPath));
    var limit = lengthLimit(item.listKind, current.length - 1, item.company);
    if (limit) {
      S.notice = limit;
      return;
    }
    if (item.listKind === "facetRow") {
      var left = 0;
      current.forEach(function (row, at) {
        if (at === index) return;
        if (row && row.words === "generated" && row.under && !Object.prototype.hasOwnProperty.call(row, "principle")) left++;
      });
      if (!left) {
        S.notice = "This facet needs a generated calibration row so every principle keeps a table.";
        return;
      }
    }
    if (item.listKind === "question") {
      var loss = questionLoss(item, index);
      if (loss) {
        S.notice = loss;
        return;
      }
    }
    var home = metaFrom({}, item);
    queueOp({
      op: "remove",
      repo: item.repo,
      file: item.file,
      path: item.listPath,
      index: index,
      before: current[index],
      label: listLabel(item),
      field: "deleted",
      listKind: item.listKind,
      type: item.type,
      itemId: item.id,
      company: home.company,
      companyName: home.companyName,
      principleName: home.principleName,
      shared: !!item.shared,
      tags: item.tags,
    });
    afterStruct();
  }

  function moveListed(item, dir) {
    if (!item || !item.listPath) return;
    if (item.synthetic) {
      S.notice = "Save or undo this new entry before moving it.";
      return;
    }
    if (listClash(item)) {
      S.notice = "Save the list change and the wording change separately.";
      return;
    }
    var index = currentIndex(item);
    var to = index + dir;
    var current = replayValues(item.repo, item.file, item.listPath, originalArray(item.repo, item.file, item.listPath));
    if (index < 0 || to < 0 || to >= current.length) return;
    var home = metaFrom({}, item);
    queueOp({
      op: "move",
      repo: item.repo,
      file: item.file,
      path: item.listPath,
      index: index,
      to: to,
      before: current[index],
      label: listLabel(item),
      field: "moved",
      listKind: item.listKind,
      type: item.type,
      itemId: item.id,
      company: home.company,
      companyName: home.companyName,
      principleName: home.principleName,
      shared: !!item.shared,
      tags: item.tags,
    });
    afterStruct();
  }

  function questionLoss(item, index) {
    var bank = S.files["biq:data/questions.json"];
    if (!bank) return "The question bank is not loaded, so this save cannot be checked.";
    var doc = cloneJson(bank.json);
    var arr = dig(doc, item.listPath);
    if (!Array.isArray(arr) || index < 0 || index >= arr.length) return "";
    var removed = arr[index];
    arr.splice(index, 1);
    var linked = removed && removed.id ? linkedFacet(doc, removed.id) : "";
    if (linked) return "Question id " + removed.id + " is still linked from " + linked + ", so it cannot be removed.";
    return visibleDrop(bank.json, doc);
  }

  function donorsOf(doc, skipFacet) {
    var donors = Object.create(null);
    (doc.companies || []).forEach(function (co) {
      (co.principles || []).forEach(function (pr) {
        var count = pr && Array.isArray(pr.questions) ? pr.questions.length : 0;
        if (!count) return;
        (pr.facets || []).forEach(function (facetId) {
          if (facetId === skipFacet) return;
          if (!donors[facetId]) donors[facetId] = count;
        });
      });
    });
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

  function linkedFacet(doc, id) {
    var map = (doc && doc.facetQuestions) || {};
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      var entry = map[keys[i]];
      var ids = Array.isArray(entry) ? entry : ((entry && entry.ids) || []);
      if (ids.indexOf(id) !== -1) return keys[i];
    }
    return "";
  }

  function visibleOf(pr, donors, doc) {
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

  function visibleDrop(before, after) {
    var beforeDonors = donorsOf(before);
    var afterDonors = donorsOf(after);
    var name = "";
    (before.companies || []).forEach(function (co) {
      (co.principles || []).forEach(function (pr) {
        if (name) return;
        var was = visibleOf(pr, beforeDonors, before);
        var nextPr = null;
        (after.companies || []).forEach(function (aco) {
          if (aco.id !== co.id) return;
          (aco.principles || []).forEach(function (apr) {
            if (apr.id === pr.id) nextPr = apr;
          });
        });
        var now = visibleOf(nextPr, afterDonors, after);
        if (was > 0 && now === 0) name = (pr.name || co.name) + " would have no BIQ question.";
      });
    });
    return name;
  }

  function generatedMap(skipId) {
    var set = Object.create(null);
    var doc = S.files["principles:data/facets.json"];
    ((doc && doc.json.facets) || []).forEach(function (facet) {
      if (!facet || facet.id === skipId) return;
      (facet.rows || []).forEach(function (row) {
        if (row && row.words === "generated" && row.under && !Object.prototype.hasOwnProperty.call(row, "principle")) set[facet.id] = true;
      });
    });
    return set;
  }

  function facetCoverageProblem(skipId) {
    var now = generatedMap(null);
    var next = generatedMap(skipId);
    var lost = [];
    S.companies.forEach(function (co) {
      (co.principles || []).forEach(function (pr) {
        var had = (pr.facets || []).some(function (id) { return now[id]; });
        var still = (pr.facets || []).filter(function (id) { return id !== skipId; }).some(function (id) { return next[id]; });
        if (had && !still) lost.push(pr.name + " (" + co.name + ")");
      });
    });
    if (!lost.length) return "";
    return "These principles would have no calibration table: " + lost.join(", ") + ".";
  }

  function facetQuestionProblem(skipId) {
    var bank = S.files["biq:data/questions.json"];
    if (!bank) return "The question bank is not loaded, so this save cannot be checked.";
    var before = bank.json;
    var after = cloneJson(before);
    (after.companies || []).forEach(function (co) {
      (co.principles || []).forEach(function (pr) {
        pr.facets = (pr.facets || []).filter(function (id) { return id !== skipId; });
      });
    });
    var beforeDonors = donorsOf(before);
    var afterDonors = donorsOf(after, skipId);
    var lost = [];
    (before.companies || []).forEach(function (co) {
      (co.principles || []).forEach(function (pr) {
        var was = visibleOf(pr, beforeDonors, before);
        var nextPr = null;
        (after.companies || []).forEach(function (aco) {
          if (aco.id !== co.id) return;
          (aco.principles || []).forEach(function (apr) { if (apr.id === pr.id) nextPr = apr; });
        });
        if (was > 0 && visibleOf(nextPr, afterDonors, after) === 0) lost.push((pr.name || "") + " (" + co.name + ")");
      });
    });
    if (!lost.length) return "";
    return "These principles would have no BIQ question: " + lost.join(", ") + ".";
  }

  function removeSlug(repo, file, path, slug, batch, label) {
    var current = replayValues(repo, file, path, originalArray(repo, file, path));
    var index = current.indexOf(slug);
    if (index === -1) return false;
    queueOp({
      op: "remove",
      repo: repo,
      file: file,
      path: path,
      index: index,
      before: current[index],
      label: label,
      field: "deleted",
      listKind: "facetLink",
      batch: batch,
      company: "",
      principleName: label,
    });
    return true;
  }

  function insertSlug(repo, file, path, slug, batch, label, companyId, principleName) {
    var current = replayValues(repo, file, path, originalArray(repo, file, path));
    if (current.indexOf(slug) !== -1) return;
    var index = current.length;
    for (var i = 0; i < current.length; i++) {
      if (String(current[i]) > slug) {
        index = i;
        break;
      }
    }
    queueOp({
      op: "insert",
      repo: repo,
      file: file,
      path: path,
      index: index,
      value: slug,
      label: label,
      field: "added",
      listKind: "facetLink",
      batch: batch,
      company: companyId || "",
      principleName: principleName || "",
    });
  }

  function moveFacet(item, dir) {
    var facetId = facetIdOf(item);
    if (!facetId) return;
    if (!S.maps.length) {
      S.notice = S.mapsNote || "Derivation maps are not loaded, so a facet change cannot be checked.";
      return;
    }
    var doc = S.files["principles:data/facets.json"];
    if (!doc) return;
    var facets = replayValues("principles", "data/facets.json", ["facets"], doc.json.facets || []);
    var index = -1;
    for (var i = 0; i < facets.length; i++) if (facets[i] && facets[i].id === facetId) index = i;
    var to = index + dir;
    if (index < 0 || to < 0 || to >= facets.length) return;
    queueOp({
      op: "move",
      repo: "principles",
      file: "data/facets.json",
      path: ["facets"],
      index: index,
      to: to,
      before: facets[index],
      label: facets[index].label || facetId,
      field: "moved",
      listKind: "facet",
      type: "facets",
      shared: true,
      principleName: facets[index].label || facetId,
    });
    afterStruct();
  }

  function moveTeaching(item, dir) {
    var match = /^data\/teaching\/([a-z0-9-]+)\/([a-z0-9-]+)\.json$/.exec(item && item.file || "");
    if (!match || match[2] === "index") return;
    var companyId = match[1];
    var slug = match[2];
    var indexFile = "data/teaching/" + companyId + "/index.json";
    var stored = S.files["principles:" + indexFile];
    if (!stored) return;
    var list = replayValues("principles", indexFile, ["principles"], stored.json.principles || []);
    var index = -1;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].slug === slug) index = i;
    var to = index + dir;
    if (index < 0 || to < 0 || to >= list.length) return;
    var co = S.companies.filter(function (entry) { return entry.id === companyId; })[0];
    var meta = co ? (co.principles || []).filter(function (pr) { return pr.slug === slug; })[0] : null;
    queueOp({
      op: "move",
      repo: "principles",
      file: indexFile,
      path: ["principles"],
      index: index,
      to: to,
      before: list[index],
      label: (meta && meta.name) || slug,
      field: "moved",
      listKind: "catalog",
      company: companyId,
      companyName: co ? co.name : companyId,
      principleName: meta ? meta.name : slug,
    });
    afterStruct();
  }

  function deleteFacetById(facetId) {
    if (!S.maps.length) {
      S.notice = S.mapsNote || "Derivation maps are not loaded, so a facet change cannot be checked.";
      return;
    }
    var doc = S.files["principles:data/facets.json"];
    if (!doc) return;
    var facets = replayValues("principles", "data/facets.json", ["facets"], doc.json.facets || []);
    var index = -1;
    for (var i = 0; i < facets.length; i++) if (facets[i] && facets[i].id === facetId) index = i;
    if (index === -1) return;
    var coverage = facetCoverageProblem(facetId);
    if (coverage) {
      S.notice = coverage;
      return;
    }
    var questions = facetQuestionProblem(facetId);
    if (questions) {
      S.notice = questions;
      return;
    }
    var batch = "facet:" + nextSeq();
    var label = facets[index].label || facetId;
    queueOp({
      op: "remove",
      repo: "principles",
      file: "data/facets.json",
      path: ["facets"],
      index: index,
      before: facets[index],
      label: label,
      field: "deleted",
      listKind: "facet",
      type: "facets",
      batch: batch,
      shared: true,
      principleName: label,
    });
    function scan(repo, file) {
      var stored = S.files[repo + ":" + file];
      if (!stored) return;
      (stored.json.companies || []).forEach(function (co) {
        (co.principles || []).forEach(function (pr) {
          if ((pr.facets || []).indexOf(facetId) === -1) return;
          removeSlug(repo, file, ["companies", { id: co.id }, "principles", { id: pr.id }, "facets"], facetId, batch, label);
        });
      });
    }
    scan("principles", "data/index.json");
    scan("biq", "data/questions.json");
    S.maps.forEach(function (map) {
      (map.json.pairs || []).forEach(function (pair) {
        if (!pair || typeof pair.sourceId !== "number" || !Array.isArray(pair.facets)) return;
        if (pair.facets.indexOf(facetId) === -1) return;
        removeSlug("principles", map.file, ["pairs", { sourceId: pair.sourceId }, "facets"], facetId, batch, label);
      });
    });
    afterStruct();
  }

  function linkFacet(facetId, principleIds, batch, label) {
    principleIds.forEach(function (pid) {
      var meta = S.byId[pid];
      if (!meta) return;
      var path = ["companies", { id: meta.companyId }, "principles", { id: pid }, "facets"];
      insertSlug("principles", "data/index.json", path, facetId, batch, label, meta.companyId, meta.name);
      insertSlug("biq", "data/questions.json", path, facetId, batch, label, meta.companyId, meta.name);
      S.maps.forEach(function (map) {
        (map.json.pairs || []).forEach(function (pair) {
          if (!pair || pair.sourceId !== pid || !Array.isArray(pair.facets)) return;
          insertSlug("principles", map.file, ["pairs", { sourceId: pid }, "facets"], facetId, batch, label, meta.companyId, meta.name);
        });
      });
    });
  }

  function recordRows(principleId) {
    var meta = S.byId[principleId];
    if (!meta) return [];
    var stored = S.files["principles:" + meta.file];
    if (!stored || !Array.isArray(stored.json.rows)) return [];
    return stored.json.rows.filter(function (row) { return row && row.id; });
  }

  function commitFacet(draft) {
    if (!S.maps.length) return "Derivation maps are not loaded, so a facet change cannot be checked.";
    var label = String(draft.fields.facetLabel || "").trim();
    var id = slugify(label);
    if (!id || slugify(label) !== id) return "A facet id has to be the slug of its label.";
    var facets = originalArray("principles", "data/facets.json", ["facets"]);
    if (facets.some(function (facet) { return facet && facet.id === id; })) return "That facet id is already used.";
    var ids = (draft.principles || []).map(function (value) { return Number(value); }).filter(function (value) { return S.byId[value]; });
    if (!ids.length) return "A facet needs at least one principle.";
    var situation = String(draft.fields.situation || "").trim();
    var under = String(draft.fields.under || "").trim();
    var justRight = String(draft.fields.justRight || "").trim();
    var over = String(draft.fields.over || "").trim();
    var problems = [];
    if (!situation) problems.push("A calibration row needs a situation.");
    ["under", "justRight", "over"].forEach(function (key) {
      var text = key === "under" ? under : key === "justRight" ? justRight : over;
      problems = problems.concat(checkText(text, { sentences: true }));
    });
    if (problems.length) return problems[0];
    var used = {};
    var rows = [];
    ids.forEach(function (pid) {
      var have = recordRows(pid);
      if (!have.length) return;
      used[have[0].id] = true;
      rows.push({ principle: pid, id: have[0].id });
    });
    var rowId = slugify(situation);
    if (!rowId) return "A row id has to be kebab-case.";
    rowId = uniqueRowId(rowId, used);
    rows.push({ id: rowId, situation: situation, under: under, justRight: justRight, over: over, words: "generated" });
    var value = { id: id, label: label, principles: ids.slice(), rows: rows };
    var batch = "facet:" + nextSeq();
    var current = replayValues("principles", "data/facets.json", ["facets"], facets);
    queueOp({
      op: "insert",
      repo: "principles",
      file: "data/facets.json",
      path: ["facets"],
      index: current.length,
      value: value,
      label: label,
      field: "added",
      listKind: "facet",
      type: "facets",
      itemKind: "facet",
      batch: batch,
      shared: true,
      principleName: label,
      tags: ids.map(function (pid) {
        var meta = S.byId[pid];
        return {
          companyId: meta.companyId,
          companyName: meta.companyName,
          companyIndex: meta.companyIndex,
          principleId: pid,
          principleName: meta.name,
          sort: meta.sort,
        };
      }),
    });
    linkFacet(id, ids, batch, label);
    return "";
  }

  function rewriteTokens(text, slugs) {
    return String(text || "").replace(/\{lp:([a-z0-9]+(?:-[a-z0-9]+)*)\}/g, function (all, slug) {
      if (slugs.indexOf(slug) !== -1) return all;
      return principleName("generic", slug) || slug;
    });
  }

  function walkCopy(node, slugs) {
    if (typeof node === "string") return rewriteTokens(node, slugs);
    if (Array.isArray(node)) return node.map(function (item) { return walkCopy(item, slugs); });
    if (node && typeof node === "object") {
      var out = {};
      Object.keys(node).forEach(function (key) { out[key] = walkCopy(node[key], slugs); });
      return out;
    }
    return node;
  }

  function scaffoldTeaching(companyId, principleId, sourceSlug) {
    var meta = S.byId[principleId];
    var co = S.companies.filter(function (item) { return item.id === companyId; })[0];
    var source = S.files["principles:data/teaching/generic/" + sourceSlug + ".json"];
    if (!meta || !co || !source) return null;
    var slugs = (co.principles || []).map(function (pr) { return pr.slug; });
    var doc = walkCopy(source.json, slugs);
    doc.id = meta.id;
    doc.slug = meta.slug;
    var related = (doc.related || []).filter(function (rel) {
      return rel && slugs.indexOf(rel.id) !== -1 && rel.id !== meta.slug && rel.note;
    });
    var used = {};
    related.forEach(function (rel) { used[rel.id] = true; });
    (co.principles || []).forEach(function (pr) {
      if (related.length >= 2) return;
      if (pr.slug === meta.slug || used[pr.slug]) return;
      related.push({ id: pr.slug, note: "Read this alongside " + pr.name + "." });
      used[pr.slug] = true;
    });
    doc.related = related;
    return doc;
  }

  function commitTeaching(draft) {
    var sourceSlug = draft.fields.source;
    var doc = scaffoldTeaching(draft.companyId, draft.principleId, sourceSlug);
    if (!doc) return "Pick a generic teaching record to start from.";
    if (!Array.isArray(doc.blog) || !doc.blog.length) return "The generic record has no further reading to copy.";
    var batch = "teach:" + nextSeq();
    var meta = S.byId[draft.principleId];
    var tags = [{
      companyId: draft.companyId,
      companyName: draft.companyName,
      companyIndex: meta ? meta.companyIndex : 99,
      principleId: draft.principleId,
      principleName: draft.principleName,
      sort: meta ? meta.sort : 999,
    }];
    queueOp({
      op: "create",
      repo: "principles",
      file: draft.file,
      path: [],
      value: doc,
      label: draft.principleName,
      field: "added",
      listKind: "teaching",
      type: "teaching",
      batch: batch,
      company: draft.companyId,
      companyName: draft.companyName,
      principleName: draft.principleName,
      tags: tags,
      itemId: "pending-teaching:" + draft.file,
    });
    var indexFile = "data/teaching/" + draft.companyId + "/index.json";
    var entry = { id: meta.id, slug: meta.slug, file: meta.slug + ".json" };
    if (S.files["principles:" + indexFile]) {
      var list = replayValues("principles", indexFile, ["principles"], originalArray("principles", indexFile, ["principles"]));
      queueOp({
        op: "insert",
        repo: "principles",
        file: indexFile,
        path: ["principles"],
        index: list.length,
        value: entry,
        label: draft.principleName,
        field: "added",
        listKind: "catalog",
        batch: batch,
        company: draft.companyId,
        companyName: draft.companyName,
        principleName: draft.principleName,
        tags: tags,
      });
    } else {
      var blog = doc.blog[0];
      queueOp({
        op: "create",
        repo: "principles",
        file: indexFile,
        path: [],
        value: {
          title: draft.companyName + ": a user's manual",
          principles: [entry],
          blog: [{ title: blog.title, url: blog.url, note: blog.note }],
        },
        label: draft.companyName + " teaching",
        field: "added",
        listKind: "teaching",
        batch: batch,
        company: draft.companyId,
        companyName: draft.companyName,
        principleName: "The set",
        tags: [{
          companyId: draft.companyId,
          companyName: draft.companyName,
          companyIndex: meta ? meta.companyIndex : 99,
          principleId: 0,
          principleName: "The set",
          sort: 999,
        }],
      });
    }
    return "";
  }

  function deleteTeachingFile(item) {
    if (!item || item.repo !== "principles") return;
    var match = /^data\/teaching\/([a-z0-9-]+)\/([a-z0-9-]+)\.json$/.exec(item.file || "");
    if (!match || match[2] === "index") return;
    var companyId = match[1];
    var slug = match[2];
    var indexFile = "data/teaching/" + companyId + "/index.json";
    var batch = "teach:" + nextSeq();
    var meta = null;
    var co = S.companies.filter(function (entry) { return entry.id === companyId; })[0];
    if (co) meta = (co.principles || []).filter(function (pr) { return pr.slug === slug; })[0];
    queueOp({
      op: "delete",
      repo: "principles",
      file: item.file,
      path: [],
      label: (meta && meta.name) || slug,
      field: "deleted",
      batch: batch,
      company: companyId,
      companyName: co ? co.name : companyId,
      principleName: meta ? meta.name : slug,
      itemId: item.id,
      tags: item.tags || [],
    });
    if (S.files["principles:" + indexFile]) {
      var list = replayValues("principles", indexFile, ["principles"], originalArray("principles", indexFile, ["principles"]));
      var index = -1;
      for (var i = 0; i < list.length; i++) if (list[i] && list[i].slug === slug) index = i;
      if (index !== -1) {
        if (list.length <= 1) {
          Object.keys(S.pending).forEach(function (key) {
            if (S.pending[key].batch === batch) delete S.pending[key];
          });
          S.notice = "The teaching catalog cannot be empty.";
          return;
        }
        queueOp({
          op: "remove",
          repo: "principles",
          file: indexFile,
          path: ["principles"],
          index: index,
          before: list[index],
          label: (meta && meta.name) || slug,
          field: "deleted",
          listKind: "catalog",
          batch: batch,
          company: companyId,
          companyName: co ? co.name : "",
          principleName: meta ? meta.name : slug,
        });
      }
    }
    afterStruct();
    S.filters.item = "";
  }

  function draftProblems(draft) {
    var fields = draft.fields || {};
    if (draft.mode === "blog") {
      var titleErr = dashProblem(fields.title, true);
      if (!String(fields.title || "").trim()) return "A reading link needs a title.";
      if (titleErr.length) return titleErr[0];
      if (!/^https:\/\/\S+$/.test(String(fields.url || "").trim())) return "A reading link needs an https URL.";
      var essay = essayProblem(fields.url);
      if (essay) return essay;
      var noteErr = checkText(fields.note, { tokens: true });
      if (noteErr.length) return noteErr[0];
      return "";
    }
    if (draft.mode === "deepen") {
      var qErr = checkText(fields.text, { questionMark: true, tokens: true });
      if (qErr.length) return qErr[0];
      return "";
    }
    if (draft.mode === "why") {
      var whyErr = checkText(fields.text, { tokens: true });
      if (whyErr.length) return whyErr[0];
      return "";
    }
    if (draft.mode === "question") {
      var textErr = checkText(fields.text, { questionMark: true });
      if (textErr.length) return textErr[0];
      return "";
    }
    if (draft.mode === "example") {
      var exTitle = checkText(fields.title, {});
      if (exTitle.length) return exTitle[0];
      var exBody = checkText(fields.body, { tokens: true });
      if (exBody.length) return exBody[0];
      return "";
    }
    if (draft.mode === "related") {
      if (!fields.related) return "A related note needs a principle.";
      var relErr = checkText(fields.note, { tokens: true });
      if (relErr.length) return relErr[0];
      return "";
    }
    if (draft.mode === "row" || draft.mode === "facetRow") {
      if (!String(fields.situation || "").trim()) return "A calibration row needs a situation.";
      var rowErr = [];
      ["under", "justRight", "over"].forEach(function (key) {
        rowErr = rowErr.concat(checkText(fields[key], { sentences: true }));
      });
      if (rowErr.length) return rowErr[0];
      if (!slugify(fields.situation)) return "A row id has to be kebab-case.";
      return "";
    }
    if (draft.mode === "facet") return "";
    if (draft.mode === "teaching") {
      if (!fields.source) return "Pick a generic teaching record to start from.";
      return "";
    }
    return "That list cannot be changed.";
  }

  function commitDraft() {
    var draft = S.draft;
    if (!draft) return;
    if (draft.mode === "facet") {
      var facetError = commitFacet(draft);
      if (facetError) {
        S.notice = facetError;
        return;
      }
      S.draft = null;
      afterStruct();
      return;
    }
    if (draft.mode === "teaching") {
      var teachError = commitTeaching(draft);
      if (teachError) {
        S.notice = teachError;
        return;
      }
      S.draft = null;
      afterStruct();
      return;
    }
    var problem = draftProblems(draft);
    if (problem) {
      S.notice = problem;
      return;
    }
    var fields = draft.fields;
    var value;
    var label = "";
    if (draft.mode === "blog") {
      value = { title: String(fields.title).trim(), url: String(fields.url).trim(), note: String(fields.note).trim() };
      label = value.title;
    } else if (draft.mode === "deepen" || draft.mode === "why") {
      value = String(fields.text).trim();
      label = value;
    } else if (draft.mode === "question") {
      var qText = String(fields.text).trim();
      var qId = freshQuestionId();
      if (!qId) {
        S.notice = "This browser could not mint a question id.";
        return;
      }
      value = { text: qText, manager: !!fields.manager, id: qId };
      label = qText;
      var qBatch = "question:" + nextSeq();
      var qChange = queueInsert(draft, value, label, qBatch);
      if (!qChange) return;
      var ownerPr = null;
      var bank = S.files["biq:data/questions.json"];
      if (bank) {
        (bank.json.companies || []).forEach(function (co) {
          if (co.id !== draft.companyId) return;
          (co.principles || []).forEach(function (pr) {
            if (pr.id === draft.principleId) ownerPr = pr;
          });
        });
      }
      inheritorTags((ownerPr && ownerPr.facets) || [], draft.companyId, draft.principleId).forEach(function (tag) {
        qChange.tags.push(tag);
      });
      qChange.tags.sort(function (a, b) {
        if (a.companyIndex !== b.companyIndex) return a.companyIndex - b.companyIndex;
        return a.sort - b.sort;
      });
      if (companyExamples(draft.companyId)) {
        queueOp({
          op: "create",
          repo: "biq",
          file: "data/examples/" + qId + ".json",
          path: [],
          value: {
            principle_id: draft.principleId,
            principle: draft.principleName,
            question: qText,
          },
          label: "Example pack",
          field: "added",
          listKind: "pack",
          type: "questions",
          itemKind: "question",
          kicker: "Example pack",
          batch: qBatch,
          company: draft.companyId,
          companyName: draft.companyName,
          principleName: draft.principleName,
          tags: qChange.tags,
        });
        afterStruct();
      }
      S.draft = null;
      S.filters.item = "pending:" + qChange.id;
      S.filters.type = draft.type && draft.type !== "all" ? draft.type : S.filters.type;
      return;
    } else if (draft.mode === "example") {
      value = { title: String(fields.title).trim(), body: String(fields.body).trim() };
      label = value.title;
    } else if (draft.mode === "related") {
      value = { id: fields.related, note: String(fields.note).trim() };
      label = "Related: " + fields.related;
    } else if (draft.mode === "row" || draft.mode === "facetRow") {
      var rowId = slugify(fields.situation);
      var existing = replayValues(draft.repo, draft.file, draft.path, originalArray(draft.repo, draft.file, draft.path));
      var taken = {};
      existing.forEach(function (row) { if (row && row.id) taken[row.id] = true; });
      rowId = uniqueRowId(rowId, taken);
      value = {
        id: rowId,
        situation: String(fields.situation).trim(),
        under: String(fields.under).trim(),
        justRight: String(fields.justRight).trim(),
        over: String(fields.over).trim(),
      };
      if (draft.mode === "facetRow") value.words = "generated";
      label = value.situation;
    }
    var change = queueInsert(draft, value, label);
    if (!change) return;
    S.draft = null;
    S.filters.item = "pending:" + change.id;
    S.filters.type = draft.type && draft.type !== "all" ? draft.type : S.filters.type;
  }

  function inheritorTags(facets, ownerCompanyId, ownerPrincipleId) {
    var tags = [];
    var bank = S.files["biq:data/questions.json"];
    if (!bank) return tags;
    (bank.json.companies || []).forEach(function (co) {
      (co.principles || []).forEach(function (pr) {
        if (co.id === ownerCompanyId && pr.id === ownerPrincipleId) return;
        if ((pr.questions || []).length) return;
        var share = (pr.facets || []).some(function (facet) { return facets.indexOf(facet) !== -1; });
        if (!share) return;
        var meta = S.byId[pr.id] || {};
        tags.push({
          companyId: co.id,
          companyName: co.name,
          companyIndex: meta.companyIndex == null ? 99 : meta.companyIndex,
          principleId: pr.id,
          principleName: pr.name,
          sort: meta.sort == null ? 999 : meta.sort,
        });
      });
    });
    return tags;
  }

  function freshQuestionId() {
    var used = Object.create(null);
    var bank = S.files["biq:data/questions.json"];
    if (bank) {
      (bank.json.companies || []).forEach(function (co) {
        (co.principles || []).forEach(function (pr) {
          (pr.questions || []).forEach(function (q) {
            if (q && q.id) used[q.id] = true;
          });
        });
      });
      var mapped = bank.json.facetQuestions || {};
      Object.keys(mapped).forEach(function (facet) {
        var entry = mapped[facet];
        var ids = Array.isArray(entry) ? entry : ((entry && entry.ids) || []);
        ids.forEach(function (id) { used[id] = true; });
      });
    }
    pendingList().forEach(function (change) {
      if (change.value && typeof change.value.id === "string") used[change.value.id] = true;
    });
    if (!window.crypto || !window.crypto.getRandomValues) return "";
    var bytes = new Uint8Array(4);
    function hex(n) {
      var s = n.toString(16);
      return s.length === 1 ? "0" + s : s;
    }
    for (var n = 0; n < 8; n++) {
      window.crypto.getRandomValues(bytes);
      var id = hex(bytes[0]) + hex(bytes[1]) + hex(bytes[2]) + hex(bytes[3]);
      if (!used[id]) return id;
    }
    return "";
  }

  function retargetQuestion(spec) {
    if (!spec || (spec.kind || spec.mode) !== "question") return spec;
    var bank = S.files["biq:data/questions.json"];
    if (!bank) return spec;
    var companies = bank.json.companies || [];
    var owner = null;
    var principle = null;
    companies.forEach(function (co) {
      if (co.id !== spec.companyId) return;
      (co.principles || []).forEach(function (pr) {
        if (pr.id === spec.principleId) {
          owner = co;
          principle = pr;
        }
      });
    });
    if (!owner || !principle) return spec;
    if (owner.examples !== false) return spec;
    if ((principle.questions || []).length) return spec;
    var facets = principle.facets || [];
    var donor = null;
    companies.forEach(function (co) {
      if (donor) return;
      (co.principles || []).forEach(function (pr) {
        if (donor || !(pr.questions || []).length) return;
        var share = (pr.facets || []).some(function (facet) { return facets.indexOf(facet) !== -1; });
        if (!share) return;
        var meta = S.byId[pr.id] || {};
        donor = {
          companyId: co.id,
          principleId: pr.id,
          companyName: co.name,
          principleName: pr.name,
          companyIndex: meta.companyIndex == null ? 99 : meta.companyIndex,
          sort: meta.sort == null ? 999 : meta.sort,
          path: ["companies", { id: co.id }, "principles", { id: pr.id }, "questions"],
          repo: "biq",
          file: "data/questions.json",
          kind: "question",
          type: spec.type || "questions",
          sharedFrom: (spec.companyName || spec.companyId) + ", " + (spec.principleName || "this principle"),
        };
      });
    });
    if (!donor) {
      return Object.assign({}, spec, {
        blocked: (owner.name || owner.id) + " shows a shared BIQ list and does not store its own questions. No company that stores this list was loaded.",
      });
    }
    return Object.assign({}, spec, donor);
  }

  function startDraft(spec) {
    spec = retargetQuestion(spec);
    if (spec.blocked) {
      S.draft = null;
      S.notice = spec.blocked;
      S.filters.item = "";
      return;
    }
    var generic = S.companies.filter(function (co) { return co.id === "generic"; })[0];
    var source = "";
    if (generic && spec.slug) {
      var same = (generic.principles || []).filter(function (pr) { return pr.slug === spec.slug; })[0];
      source = same ? same.slug : ((generic.principles || [])[0] && generic.principles[0].slug) || "";
    }
    S.draft = {
      mode: spec.kind || spec.mode,
      type: spec.type,
      repo: spec.repo,
      file: spec.file,
      path: spec.path,
      kind: spec.kind || spec.mode,
      companyId: spec.companyId || "",
      principleId: spec.principleId || 0,
      companyName: spec.companyName || "",
      principleName: spec.principleName || "",
      companyIndex: spec.companyIndex,
      sort: spec.sort,
      slug: spec.slug || "",
      label: spec.label || addLabel(spec.kind || spec.mode),
      sharedFrom: spec.sharedFrom || "",
      fields: {
        title: "",
        url: "https://",
        note: "",
        text: "",
        body: "",
        situation: "",
        under: "",
        justRight: "",
        over: "",
        related: "",
        source: source,
        facetLabel: "",
        manager: false,
      },
      principles: spec.principleId ? [String(spec.principleId)] : [],
    };
    S.notice = "";
    S.filters.item = "";
    S.result = null;
  }

  function addsFor(companyId, principleId) {
    var out = [];
    (S.lists || []).forEach(function (spec) {
      if (spec.companyId !== companyId || String(spec.principleId) !== String(principleId)) return;
      if (S.filters.type !== "all" && spec.type !== S.filters.type) return;
      out.push(spec);
    });
    (S.teachingAdds || []).forEach(function (spec) {
      if (spec.companyId !== companyId || String(spec.principleId) !== String(principleId)) return;
      if (S.filters.type !== "all" && spec.type !== "teaching") return;
      out.push(spec);
    });
    return out;
  }

  function addButton(spec) {
    var index = S.addButtons.length;
    S.addButtons.push(spec);
    return el("button", { type: "button", class: "ed-add", "data-add": String(index) }, spec.label);
  }

  function appendAdds(parent, companyId, principleId) {
    addsFor(companyId, principleId).forEach(function (spec) {
      parent.appendChild(addButton(spec));
    });
  }

  function listSpecForItem(item) {
    if (!item || !item.listPath) return null;
    var key = listKey(item.repo, item.file, item.listPath);
    return S.listByKey[key] || {
      kind: item.listKind,
      type: item.type,
      repo: item.repo,
      file: item.file,
      path: item.listPath,
      companyId: item.company,
      principleId: item.tags && item.tags[0] ? item.tags[0].principleId : 0,
      companyName: item.tags && item.tags[0] ? item.tags[0].companyName : "",
      principleName: item.tags && item.tags[0] ? item.tags[0].principleName : "",
      label: addLabel(item.listKind),
    };
  }

  function renderDraft(pane) {
    var draft = S.draft;
    if (!draft) return;
    pane.appendChild(el("p", { class: "ed-kicker" }, draft.label));
    pane.appendChild(el("h2", { class: "ed-text" }, draft.principleName || draft.companyName || "New entry"));
    function field(name, label, multiline, type) {
      pane.appendChild(el("label", { class: "ed-label", for: "ed-draft-" + name }, label));
      var input;
      if (multiline) {
        input = el("textarea", { class: "ed-area", id: "ed-draft-" + name, "data-draft": name, rows: "4", spellcheck: "true", lang: "en" });
        input.value = draft.fields[name] || "";
      } else {
        input = el("input", { class: "ed-input", id: "ed-draft-" + name, "data-draft": name, type: type || "text", spellcheck: "true", lang: "en" });
        input.value = draft.fields[name] == null ? "" : draft.fields[name];
      }
      pane.appendChild(input);
    }
    if (draft.mode === "blog") {
      field("title", "Title", false);
      field("url", "URL", false, "url");
      field("note", "Note", true);
    } else if (draft.mode === "deepen" || draft.mode === "why" || draft.mode === "question") {
      field("text", draft.mode === "question" ? "BIQ question" : draft.mode === "why" ? "Why" : "Concrete question", true);
      if (draft.mode === "question") {
        var manager = el("label", { class: "ed-check" });
        var managerBox = el("input", { type: "checkbox", id: "ed-draft-manager", "data-draft": "manager" });
        managerBox.checked = !!draft.fields.manager;
        manager.appendChild(managerBox);
        manager.appendChild(document.createTextNode(" Manager question"));
        pane.appendChild(manager);
        var packNote = "This save adds a stub example pack with the principle and the question. It does not invent interview examples.";
        if (draft.sharedFrom) {
          packNote = "Stored on " + draft.companyName + ", " + draft.principleName + ". " + draft.sharedFrom + " shows this list through a shared facet. " + packNote;
        }
        pane.appendChild(el("p", { class: "ed-banner" }, packNote));
      }
    } else if (draft.mode === "example") {
      field("title", "Title", false);
      field("body", "Example", true);
    } else if (draft.mode === "related") {
      pane.appendChild(el("label", { class: "ed-label", for: "ed-draft-related" }, "Principle"));
      var select = el("select", { class: "ed-select", id: "ed-draft-related", "data-draft": "related" });
      select.appendChild(el("option", { value: "" }, "Choose a principle"));
      var co = S.companies.filter(function (item) { return item.id === draft.companyId; })[0];
      ((co && co.principles) || []).forEach(function (pr) {
        if (pr.slug === draft.slug) return;
        var opt = el("option", { value: pr.slug }, pr.name);
        if (draft.fields.related === pr.slug) opt.selected = true;
        select.appendChild(opt);
      });
      pane.appendChild(select);
      field("note", "Note", true);
    } else if (draft.mode === "row" || draft.mode === "facetRow") {
      field("situation", "Situation", false);
      field("under", "Under", true);
      field("justRight", "Just right", true);
      field("over", "Over", true);
      pane.appendChild(el("p", { class: "ed-banner" }, "Under, just right, and over need one to three sentences."));
    } else if (draft.mode === "facet") {
      field("facetLabel", "Label", false);
      pane.appendChild(el("p", { class: "ed-banner" }, "The id is the slug of the label. Principles that already have calibration rows link their first row. Every selected principle keeps its calibration table and its BIQ questions."));
      var box = el("div", { class: "ed-checks" });
      S.companies.forEach(function (co) {
        (co.principles || []).forEach(function (pr) {
          var row = el("label", {});
          var input = el("input", { type: "checkbox", "data-facet-principle": String(pr.id) });
          input.checked = draft.principles.indexOf(String(pr.id)) !== -1;
          row.appendChild(input);
          row.appendChild(document.createTextNode(" " + pr.name + " · " + co.name));
          box.appendChild(row);
        });
      });
      pane.appendChild(box);
      field("situation", "Generated row situation", false);
      field("under", "Under", true);
      field("justRight", "Just right", true);
      field("over", "Over", true);
    } else if (draft.mode === "teaching") {
      pane.appendChild(el("label", { class: "ed-label", for: "ed-draft-source" }, "Start from generic teaching"));
      var source = el("select", { class: "ed-select", id: "ed-draft-source", "data-draft": "source" });
      var generic = S.companies.filter(function (item) { return item.id === "generic"; })[0];
      ((generic && generic.principles) || []).forEach(function (pr) {
        if (!S.files["principles:data/teaching/generic/" + pr.slug + ".json"]) return;
        var opt = el("option", { value: pr.slug }, pr.name);
        if (draft.fields.source === pr.slug) opt.selected = true;
        source.appendChild(opt);
      });
      pane.appendChild(source);
      pane.appendChild(el("p", { class: "ed-banner" }, "The new record copies that generic teaching, keeps this company's principle id, and rewrites links that this company does not have."));
    }
    if (S.notice) pane.appendChild(el("p", { class: "ed-warn", id: "ed-notice" }, S.notice));
    var actions = el("div", { class: "ed-actions" });
    actions.appendChild(el("button", { type: "button", id: "ed-draft-add" }, "Add to pending"));
    actions.appendChild(el("button", { type: "button", id: "ed-draft-cancel" }, "Cancel"));
    pane.appendChild(actions);
  }

  function renderListActions(item) {
    if (!item || !item.listPath && item.kind !== "teaching" && item.kind !== "concrete" && item.kind !== "reading" && item.kind !== "facet") return null;
    var actions = el("div", { class: "ed-actions" });
    if (item.listPath) {
      actions.appendChild(el("button", { type: "button", "data-act": "add" }, "Add another"));
      actions.appendChild(el("button", { type: "button", "data-act": "up" }, "Move up"));
      actions.appendChild(el("button", { type: "button", "data-act": "down" }, "Move down"));
      actions.appendChild(el("button", { type: "button", "data-act": "delete" }, "Delete"));
    }
    if (item.kind === "facet" && item.file === "data/facets.json") {
      actions.appendChild(el("button", { type: "button", "data-act": "facet-up" }, "Move facet up"));
      actions.appendChild(el("button", { type: "button", "data-act": "facet-down" }, "Move facet down"));
      actions.appendChild(el("button", { type: "button", "data-act": "delete-facet" }, "Delete facet"));
    }
    if ((item.kind === "teaching" || item.kind === "concrete" || item.kind === "reading") && item.file.indexOf("/index.json") === -1 && item.file.indexOf("data/teaching/") === 0) {
      actions.appendChild(el("button", { type: "button", "data-act": "teaching-up" }, "Move teaching up"));
      actions.appendChild(el("button", { type: "button", "data-act": "teaching-down" }, "Move teaching down"));
      actions.appendChild(el("button", { type: "button", "data-act": "delete-teaching" }, "Delete teaching"));
    }
    return actions.childNodes.length ? actions : null;
  }

  function facetIdOf(item) {
    if (!item || item.kind !== "facet" || !item.fields.length) return "";
    var step = item.fields[0].path[1];
    return step && step.id ? step.id : "";
  }

  function onDraftInput(input) {
    if (!S.draft) return;
    var name = input.getAttribute("data-draft");
    if (!name) return;
    if (input.type === "checkbox") S.draft.fields[name] = input.checked;
    else S.draft.fields[name] = input.value;
  }

  function listChangeErrors(change) {
    if (change.stale) return ["Stale. The list changed, so this edit was set aside. Undo it, then try again."];
    if (change.op === "insert") {
      if (change.listKind === "blog") {
        var blogErr = [];
        if (!change.value || !String(change.value.title || "").trim()) blogErr.push("A reading link needs a title.");
        if (!change.value || !/^https:\/\/\S+$/.test(String(change.value.url || "").trim())) blogErr.push("A reading link needs an https URL.");
        var essay = essayProblem(change.value && change.value.url);
        if (essay) blogErr.push(essay);
        if (!change.value || !String(change.value.note || "").trim()) blogErr.push("A reading link needs a note.");
        return blogErr;
      }
      if (change.listKind === "deepen") return checkText(change.value, { questionMark: true, tokens: true });
      if (change.listKind === "why") return checkText(change.value, { tokens: true });
      if (change.listKind === "question") {
        var qErr = checkText(change.value && change.value.text, { questionMark: true });
        if (qErr.length) return qErr;
        if (!change.value || !/^[0-9a-f]{8}$/.test(change.value.id || "")) return ["A question id has to be eight hex characters."];
        if (!companyExamples(change.company)) {
          return [(change.companyName || change.company) + " shows a shared BIQ list and does not store its own questions. Add the question on the company that stores them."];
        }
        var packFile = "data/examples/" + change.value.id + ".json";
        var pack = pendingList().filter(function (other) {
          return other.op === "create" && other.repo === "biq" && other.file === packFile && other.batch === change.batch;
        })[0];
        if (!pack) return [(change.companyName || change.company) + " keeps an example pack for every question. This save needs the pack file."];
        return [];
      }
      if (change.listKind === "pack") {
        if (!change.value || !String(change.value.question || "").trim()) return ["An example pack needs the question text."];
        if (typeof change.value.principle_id !== "number") return ["An example pack needs a principle id."];
        return [];
      }
    }
    return [];
  }

  function restoreOp(saved, projected) {
    var op = saved.op;
    if (op !== "insert" && op !== "remove" && op !== "move" && op !== "create" && op !== "delete") return false;
    if (!Array.isArray(saved.path) || saved.path.length > 8) return false;
    if ((op === "insert" || op === "remove" || op === "move") && (typeof saved.index !== "number" || saved.path.length < 1)) return false;
    if (op === "move" && typeof saved.to !== "number") return false;
    if ((op === "insert" || op === "create") && saved.value == null) return false;
    if ((op === "remove" || op === "move") && saved.before == null) return false;
    var seq = typeof saved.seq === "number" ? saved.seq : nextSeq();
    var id = listKey(saved.repo, saved.file, saved.path) + "\u0000" + op + "\u0000" + seq;
    if (S.pending[id]) return false;
    var stored = S.files[saved.repo + ":" + saved.file];
    var stale = false;
    if (op === "create") {
      stale = !!stored;
    } else if (op === "delete") {
      stale = !stored || !!(saved.sha && stored.sha && saved.sha !== stored.sha);
    } else if (op === "insert" || op === "remove" || op === "move") {
      var currentSha = stored && stored.sha ? stored.sha : "";
      var listed = projected || (stored ? dig(stored.json, saved.path) : null);
      if (saved.sha && currentSha && saved.sha !== currentSha) stale = true;
      else if (op === "insert") {
        if (projected || !saved.sha || !stored) stale = !Array.isArray(listed) || saved.index > listed.length;
      } else {
        stale = !Array.isArray(listed) || !sameJson(listed[saved.index], saved.before);
      }
    }
    S.pending[id] = {
      id: id,
      op: op,
      seq: seq,
      itemId: saved.itemId || ("pending:" + id),
      label: saved.label || "Item",
      field: saved.field || (op === "insert" || op === "create" ? "added" : op === "move" ? "moved" : "deleted"),
      repo: saved.repo,
      file: saved.file,
      path: saved.path,
      index: saved.index,
      to: saved.to,
      value: saved.value,
      before: saved.before,
      company: saved.company || "",
      companyName: saved.companyName || "",
      principle: saved.principleName || saved.principle || "",
      principleName: saved.principleName || saved.principle || "",
      shared: !!saved.shared,
      sha: typeof saved.sha === "string" ? saved.sha : "",
      stale: stale,
      listKind: saved.listKind || "",
      type: saved.type || "",
      itemKind: saved.itemKind || "",
      kicker: saved.kicker || "",
      tags: Array.isArray(saved.tags) ? saved.tags : [],
      batch: saved.batch || "",
    };
    return S.pending[id];
  }

  async function loadMaps() {
    S.maps = [];
    S.mapsNote = "";
    var files = [];
    try {
      var listing = await fetch("https://api.github.com/repos/kindel/principles/contents/data/maps", { cache: "no-store" });
      if (listing.ok) {
        var entries = await listing.json();
        if (Array.isArray(entries)) {
          entries.forEach(function (entry) {
            if (entry && entry.type === "file" && /\.json$/.test(entry.name || "") && typeof entry.path === "string") files.push(entry.path);
          });
        }
      }
    } catch (err) {}
    if (!files.length) files.push("data/maps/generic-amazon.json");
    for (var i = 0; i < files.length; i++) {
      try {
        var text = await fetchText(RAW.principles + files[i]);
        var kept = keep("principles", files[i], text);
        S.maps.push({ file: files[i], json: kept.json });
      } catch (err) {}
    }
    if (!S.maps.length) S.mapsNote = "Derivation maps are not loaded, so a facet change cannot be checked.";
  }

  async function load() {
    renderShell();
    try {
      keep("principles", "data/index.json", await fetchText(RAW.principles + "data/index.json"));
      keep("principles", "data/facets.json", await fetchText(RAW.principles + "data/facets.json"));
      keep("biq", "data/questions.json", await fetchText(RAW.biq + "data/questions.json"));
      await loadMaps();
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
