import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "js/facet.js"), "utf8");
const plan = createRequire(import.meta.url)(join(root, "lib/plan.js"));

const INDEX = {
  companies: [
    { id: "generic", name: "Universal", principles: [] },
    { id: "amazon", name: "Amazon", principles: [] },
    { id: "blue-origin", name: "Blue Origin", principles: [] },
  ],
};

function jsonResponse(body, status) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status: status,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

function failResponse(status) {
  return {
    ok: false,
    status: status,
    text: async () => "",
    json: async () => ({}),
  };
}

// Enough of a document for the editor shell, the company checkbox, and popstate.
// The analytics paths call paint(), which rebuilds that shell.
function dom() {
  function node(tag) {
    const el = {
      tagName: String(tag || "").toUpperCase(),
      nodeType: 1,
      children: [],
      parentNode: null,
      attrs: {},
      className: "",
      id: "",
      hidden: false,
      disabled: false,
      checked: false,
      value: "",
      selected: false,
      scrollTop: 0,
      tabIndex: 0,
      style: {},
      _text: "",
      _listeners: {},
    };
    el.setAttribute = (key, value) => {
      const v = String(value);
      el.attrs[key] = v;
      if (key === "id") el.id = v;
      if (key === "class") el.className = v;
    };
    el.getAttribute = (key) => {
      if (key === "class") return el.className || null;
      return Object.prototype.hasOwnProperty.call(el.attrs, key) ? el.attrs[key] : null;
    };
    el.hasAttribute = (key) => el.getAttribute(key) != null;
    el.removeAttribute = (key) => {
      delete el.attrs[key];
      if (key === "id") el.id = "";
    };
    Object.defineProperty(el, "textContent", {
      get() { return el._text; },
      set(value) {
        el._text = value == null ? "" : String(value);
        el.children.splice(0, el.children.length);
      },
    });
    el.classList = {
      toggle(name, on) {
        const parts = (el.className || "").split(/\s+/).filter(Boolean);
        const has = parts.indexOf(name) !== -1;
        const want = on == null ? !has : !!on;
        const next = parts.filter((part) => part !== name);
        if (want) next.push(name);
        el.className = next.join(" ");
      },
      add(name) { this.toggle(name, true); },
      remove(name) { this.toggle(name, false); },
      contains(name) { return (el.className || "").split(/\s+/).indexOf(name) !== -1; },
    };
    el.appendChild = (child) => {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = el;
      el.children.push(child);
      return child;
    };
    el.removeChild = (child) => {
      const i = el.children.indexOf(child);
      if (i !== -1) el.children.splice(i, 1);
      child.parentNode = null;
      return child;
    };
    el.insertBefore = (child, ref) => {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = el;
      const i = ref ? el.children.indexOf(ref) : -1;
      if (i < 0) el.children.push(child);
      else el.children.splice(i, 0, child);
      return child;
    };
    Object.defineProperty(el, "firstChild", { get() { return el.children[0] || null; } });
    Object.defineProperty(el, "childNodes", { get() { return el.children; } });
    el.remove = () => { if (el.parentNode) el.parentNode.removeChild(el); };
    el.focus = () => {};
    el.contains = (other) => {
      let cur = other;
      while (cur) {
        if (cur === el) return true;
        cur = cur.parentNode;
      }
      return false;
    };
    el.closest = (sel) => {
      let cur = el;
      while (cur) {
        if (cur.nodeType === 1 && matches(cur, sel)) return cur;
        cur = cur.parentNode;
      }
      return null;
    };
    el.addEventListener = (type, fn) => {
      (el._listeners[type] || (el._listeners[type] = [])).push(fn);
    };
    el.dispatchEvent = (event) => {
      if (!event.target) event.target = el;
      event.currentTarget = el;
      const list = (el._listeners[event.type] || []).slice();
      for (const fn of list) fn.call(el, event);
      if (event.bubbles !== false && el.parentNode && el.parentNode.dispatchEvent) {
        el.parentNode.dispatchEvent(event);
      }
      return true;
    };
    el.querySelector = (sel) => el.querySelectorAll(sel)[0] || null;
    el.querySelectorAll = (sel) => {
      const out = [];
      const parts = String(sel).split(",").map((part) => part.trim()).filter(Boolean);
      function walk(node) {
        if (node.nodeType === 1 && parts.some((part) => matches(node, part))) out.push(node);
        (node.children || []).forEach(walk);
      }
      (el.children || []).forEach(walk);
      return out;
    };
    return el;
  }

  function matches(el, sel) {
    if (sel.charAt(0) === "#") return el.id === sel.slice(1);
    if (sel.charAt(0) === ".") {
      return (el.className || "").split(/\s+/).indexOf(sel.slice(1)) !== -1;
    }
    const attr = sel.match(/^([a-z0-9-]*)\[([^\]=]+)(?:=["']?([^"'\]]*)["']?)?\]$/i);
    if (attr) {
      if (attr[1] && el.tagName !== attr[1].toUpperCase()) return false;
      if (attr[3] == null) return el.hasAttribute(attr[2]);
      return el.getAttribute(attr[2]) === attr[3];
    }
    return el.tagName === sel.toUpperCase();
  }

  const document = node("#document");
  document.nodeType = 9;
  document.createElement = (tag) => node(tag);
  document.createTextNode = (text) => ({
    nodeType: 3,
    textContent: String(text),
    parentNode: null,
    children: [],
  });
  document.body = document.createElement("body");
  document.appendChild(document.body);
  document.activeElement = null;
  document.getElementById = (id) => {
    function walk(node) {
      if (node.nodeType === 1 && node.id === id) return node;
      for (const child of node.children || []) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    }
    return walk(document);
  };
  document.addEventListener = () => {};
  const editor = document.createElement("div");
  editor.id = "kld-editor";
  document.body.appendChild(editor);
  return { document, editor };
}

function boot(href, fetchImpl) {
  const calls = [];
  const tree = dom();
  const listeners = {};
  const location = { href: "" };
  function setHref(next) {
    const url = new URL(next, "https://kindel.com");
    location.href = url.href;
    location.pathname = url.pathname;
    location.search = url.search;
    location.origin = url.origin;
  }
  setHref(href);
  const history = {
    pushState(_state, _title, next) { setHref(next); },
    replaceState(_state, _title, next) { setHref(next); },
  };
  const sandbox = {
    console,
    URL,
    URLSearchParams,
    Promise,
    TextEncoder,
    Uint8Array,
    document: tree.document,
    history,
    location,
    fetch: fetchImpl,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    matchMedia() { return { matches: false }; },
    scrollTo() {},
    addEventListener(type, fn) {
      (listeners[type] || (listeners[type] = [])).push(fn);
    },
    kldTrack(name, params) { calls.push({ name, params: Object.assign({}, params) }); },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "js/facet.js" });
  return {
    calls,
    editor: tree.editor,
    document: tree.document,
    setHref,
    popstate() {
      for (const fn of listeners.popstate || []) fn({ type: "popstate" });
    },
    pick(id, checked) {
      const input = tree.document.createElement("input");
      input.setAttribute("data-company", id);
      input.checked = checked;
      tree.editor.appendChild(input);
      input.dispatchEvent({ type: "change", bubbles: true });
    },
  };
}

async function settle() {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function companies(calls) {
  return calls.filter((call) => call.name === "kld_company").map((call) => call.params);
}

test("initial URL company is sent once when later loads fail", async () => {
  const page = boot("https://kindel.com/kld/apps/facet/?c=amazon,amazon,missing", async (url) => {
    const target = String(url);
    if (target.endsWith("data/index.json")) return jsonResponse(INDEX, 200);
    return failResponse(500);
  });
  await settle();
  assert.deepEqual(page.calls.filter((call) => call.name === "app_view").map((call) => call.params), [
    { app: "facet" },
  ]);
  assert.deepEqual(companies(page.calls), [
    { app: "facet", company: "amazon", previous_company: "", source: "url" },
  ]);
});

test("a full load does not send the URL company again", async () => {
  const page = boot("https://kindel.com/kld/apps/facet/?c=generic,generic", async (url) => {
    const target = String(url);
    if (target.endsWith("data/index.json")) return jsonResponse(INDEX, 200);
    if (target.endsWith("data/facets.json")) return jsonResponse({ facets: [] }, 200);
    if (target.endsWith("data/questions.json")) return jsonResponse({ companies: [] }, 200);
    if (target.indexOf("api.github.com") !== -1) return failResponse(404);
    if (target.endsWith("/index.json")) return failResponse(404);
    return failResponse(404);
  });
  await settle();
  assert.deepEqual(companies(page.calls), [
    { app: "facet", company: "generic", previous_company: "", source: "url" },
  ]);
});

test("picker check sends source picker and uncheck sends nothing", async () => {
  const page = boot("https://kindel.com/kld/apps/facet/?c=generic", async (url) => {
    const target = String(url);
    if (target.endsWith("data/index.json")) return jsonResponse(INDEX, 200);
    return failResponse(500);
  });
  await settle();
  page.calls.length = 0;
  page.pick("amazon", true);
  page.pick("amazon", false);
  page.pick("blue-origin", true);
  assert.deepEqual(companies(page.calls), [
    { app: "facet", company: "amazon", previous_company: "generic", source: "picker" },
    { app: "facet", company: "blue-origin", previous_company: "amazon", source: "picker" },
  ]);
});

test("an inherited object name is still sent as a company id", async () => {
  const index = {
    companies: INDEX.companies.concat([{ id: "constructor", name: "Constructor", principles: [] }]),
  };
  const page = boot("https://kindel.com/kld/apps/facet/?c=constructor,constructor", async (url) => {
    const target = String(url);
    if (target.endsWith("data/index.json")) return jsonResponse(index, 200);
    return failResponse(500);
  });
  await settle();
  assert.deepEqual(companies(page.calls), [
    { app: "facet", company: "constructor", previous_company: "", source: "url" },
  ]);
});

test("popstate sends a newly added company once", async () => {
  const page = boot("https://kindel.com/kld/apps/facet/?c=amazon", async (url) => {
    const target = String(url);
    if (target.endsWith("data/index.json")) return jsonResponse(INDEX, 200);
    return failResponse(500);
  });
  await settle();
  page.calls.length = 0;
  page.setHref("https://kindel.com/kld/apps/facet/?c=amazon,blue-origin,blue-origin");
  page.popstate();
  assert.deepEqual(companies(page.calls), [
    { app: "facet", company: "blue-origin", previous_company: "amazon", source: "url" },
  ]);
});

test("a catalog-only teaching set does not fail load", async () => {
  // USMC has a set catalog and no per-principle teaching files. load()
  // used to 404 those files and never become ready.
  const index = {
    companies: [{
      id: "usmc",
      name: "U.S. Marine Corps",
      principles: [{
        id: 10005,
        slug: "set-the-example",
        name: "Set the example",
        file: "data/usmc/set-the-example.json",
      }],
    }],
  };
  const catalog = {
    principles: [{
      id: 10005,
      slug: "set-the-example",
      file: "set-the-example.json",
    }],
    blog: [{ title: "Leadership Traits", url: "https://example.com/", note: "Character." }],
  };
  const page = boot("https://kindel.com/kld/apps/facet/?c=usmc", async (url) => {
    const target = String(url);
    if (target.endsWith("data/index.json")) return jsonResponse(index, 200);
    if (target.endsWith("data/facets.json")) return jsonResponse({ facets: [] }, 200);
    if (target.endsWith("data/questions.json")) return jsonResponse({ companies: [] }, 200);
    if (target.endsWith("data/usmc/set-the-example.json")) {
      return jsonResponse({ id: 10005, slug: "set-the-example", name: "Set the example", rows: [] }, 200);
    }
    if (target.endsWith("data/teaching/usmc/index.json")) return jsonResponse(catalog, 200);
    return failResponse(404);
  });
  await settle();
  const status = page.document.getElementById("ed-status");
  const text = status ? status.textContent : "";
  assert.ok(!/Could not load the content from GitHub/.test(text), text);
});

function buttons(page) {
  return page.editor.querySelectorAll("button");
}

function click(node) {
  node.dispatchEvent({ type: "click", bubbles: true });
}

// A listed teaching file can 404 without blanking the editor. Creating it
// must reuse the catalog row. An empty principles list is the set-level
// catalog, and the first real file still has to be inserted.
async function addFirstTeaching(catalogPrinciples) {
  const saved = [];
  const index = {
    companies: [
      {
        id: "generic",
        name: "Universal",
        principles: [{
          id: 8001,
          slug: "ownership",
          name: "Ownership",
          sort: 1,
          file: "data/generic/ownership.json",
        }],
      },
      {
        id: "usmc",
        name: "U.S. Marine Corps",
        principles: [{
          id: 10005,
          slug: "set-the-example",
          name: "Set the example",
          sort: 5,
          file: "data/usmc/set-the-example.json",
        }],
      },
    ],
  };
  const genericTeach = {
    id: 8001,
    slug: "ownership",
    blog: [{ title: "A note", url: "https://example.com/a", note: "Why it belongs." }],
  };
  const page = boot("https://kindel.com/kld/apps/facet/?c=usmc&type=teaching", async (url, opts) => {
    const target = String(url);
    if (target.indexOf("editor-save") !== -1) {
      saved.push(opts && opts.body);
      return { ok: false, status: 422, json: async () => ({ error: "stopped" }), text: async () => "" };
    }
    if (target.endsWith("data/index.json")) return jsonResponse(index, 200);
    if (target.endsWith("data/facets.json")) return jsonResponse({ facets: [] }, 200);
    if (target.endsWith("data/questions.json")) return jsonResponse({ companies: [] }, 200);
    if (target.endsWith("data/generic/ownership.json")) {
      return jsonResponse({ id: 8001, slug: "ownership", name: "Ownership", rows: [] }, 200);
    }
    if (target.endsWith("data/usmc/set-the-example.json")) {
      return jsonResponse({ id: 10005, slug: "set-the-example", name: "Set the example", rows: [] }, 200);
    }
    if (target.endsWith("data/teaching/generic/index.json")) {
      return jsonResponse({
        principles: [{ id: 8001, slug: "ownership", file: "ownership.json" }],
        blog: genericTeach.blog,
      }, 200);
    }
    if (target.endsWith("data/teaching/generic/ownership.json")) return jsonResponse(genericTeach, 200);
    if (target.endsWith("data/teaching/usmc/index.json")) {
      return jsonResponse({
        principles: catalogPrinciples,
        blog: [{ title: "Leadership Traits", url: "https://example.com/traits", note: "Character." }],
      }, 200);
    }
    return failResponse(404);
  });
  await settle();
  const status = page.document.getElementById("ed-status");
  const statusText = status ? status.textContent : "";
  assert.ok(!/Could not load/.test(statusText), statusText);
  const adds = buttons(page).filter((btn) => btn.textContent === "Add teaching");
  assert.equal(adds.length, 1, buttons(page).map((btn) => btn.textContent).join(" | "));
  click(adds[0]);
  const draftAdd = page.document.getElementById("ed-draft-add");
  assert.ok(draftAdd, "draft did not open");
  click(draftAdd);
  const notice = page.document.getElementById("ed-notice");
  const toggle = page.document.getElementById("ed-pending-toggle");
  assert.ok(toggle, notice ? notice.textContent : "no pending toggle");
  const save = page.document.getElementById("ed-save");
  click(save);
  await settle();
  assert.equal(saved.length, 1, toggle.textContent + (notice ? " " + notice.textContent : ""));
  const body = JSON.parse(saved[0]);
  return { body, pending: toggle.textContent };
}

test("creating a listed teaching file does not add a second catalog row", async () => {
  const { body } = await addFirstTeaching([
    { id: 10005, slug: "set-the-example", file: "set-the-example.json" },
  ]);
  const ops = body.changes.map((change) => change.op + " " + change.file);
  assert.deepEqual(ops, ["create data/teaching/usmc/set-the-example.json"]);
  assert.equal(typeof body.files["principles:data/teaching/usmc/index.json"], "string");
  const catalog = JSON.parse(body.files["principles:data/teaching/usmc/index.json"]);
  assert.equal(catalog.principles.length, 1);
});

test("the first teaching file for a set catalog is still listed", async () => {
  const { body } = await addFirstTeaching([]);
  const ops = body.changes.map((change) => change.op + " " + change.file).sort();
  assert.deepEqual(ops, [
    "create data/teaching/usmc/set-the-example.json",
    "insert data/teaching/usmc/index.json",
  ]);
});

test("deleting the last teaching file leaves an empty catalog", async () => {
  const saved = [];
  const index = {
    companies: [{
      id: "usmc",
      name: "U.S. Marine Corps",
      principles: [{
        id: 10005,
        slug: "set-the-example",
        name: "Set the example",
        sort: 5,
        file: "data/usmc/set-the-example.json",
      }],
    }],
  };
  const catalog = {
    principles: [{ id: 10005, slug: "set-the-example", file: "set-the-example.json" }],
    blog: [{ title: "Leadership Traits", url: "https://example.com/traits", note: "Character." }],
  };
  const teachingFile = {
    id: 10005,
    slug: "set-the-example",
    why: ["Marines copy what you do."],
  };
  const page = boot("https://kindel.com/kld/apps/facet/?c=usmc&type=teaching", async (url, opts) => {
    const target = String(url);
    if (target.indexOf("editor-save") !== -1) {
      saved.push(opts && opts.body);
      return { ok: false, status: 422, json: async () => ({ error: "stopped" }), text: async () => "" };
    }
    if (target.endsWith("data/index.json")) return jsonResponse(index, 200);
    if (target.endsWith("data/facets.json")) return jsonResponse({ facets: [] }, 200);
    if (target.endsWith("data/questions.json")) return jsonResponse({ companies: [] }, 200);
    if (target.endsWith("data/usmc/set-the-example.json")) {
      return jsonResponse({ id: 10005, slug: "set-the-example", name: "Set the example", rows: [] }, 200);
    }
    if (target.endsWith("data/teaching/usmc/index.json")) return jsonResponse(catalog, 200);
    if (target.endsWith("data/teaching/usmc/set-the-example.json")) return jsonResponse(teachingFile, 200);
    return failResponse(404);
  });
  await settle();
  const status = page.document.getElementById("ed-status");
  const statusText = status ? status.textContent : "";
  assert.ok(!/Could not load/.test(statusText), statusText);
  const rows = buttons(page).filter((btn) => (btn.getAttribute("data-item") || "").indexOf("teach:usmc:") === 0);
  assert.ok(rows.length > 0, buttons(page).map((btn) => btn.textContent).join(" | "));
  click(rows[0]);
  const del = buttons(page).filter((btn) => btn.getAttribute("data-act") === "delete-teaching");
  assert.equal(del.length, 1, buttons(page).map((btn) => btn.getAttribute("data-act") || btn.textContent).join(" | "));
  click(del[0]);
  const notice = page.document.getElementById("ed-notice");
  assert.ok(!notice || !/cannot be empty/.test(notice.textContent), notice ? notice.textContent : "");
  const toggle = page.document.getElementById("ed-pending-toggle");
  assert.ok(toggle, notice ? notice.textContent : "no pending toggle");
  click(page.document.getElementById("ed-save"));
  await settle();
  assert.equal(saved.length, 1, toggle.textContent + (notice ? " " + notice.textContent : ""));
  const body = JSON.parse(saved[0]);
  const ops = body.changes.map((change) => change.op + " " + change.file).sort();
  assert.deepEqual(ops, [
    "delete data/teaching/usmc/set-the-example.json",
    "remove data/teaching/usmc/index.json",
  ]);
  const prepared = plan.prepare(body.files, body.changes);
  assert.equal(prepared.ok, true, prepared.ok ? "" : prepared.errors[0].error);
  const after = prepared.files.filter((file) => file.file === "data/teaching/usmc/index.json")[0];
  assert.ok(after, prepared.files.map((file) => file.file).join(" "));
  assert.deepEqual(JSON.parse(after.after).principles, []);
});
