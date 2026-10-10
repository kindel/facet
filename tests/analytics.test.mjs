import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "js/facet.js"), "utf8");

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
