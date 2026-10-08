/* Matcher copied from kindelwww static/js/essay-links.js.
   Same rules: a dated blog.kindel.com permalink, or ?p= on the blog root, rewrites only when the essays catalog names the post.
   rewriteHref returns /essays/<slug>/ plus any fragment. Callers that need the apex URL prefix https://kindel.com.
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && typeof root === "object") root.kindelEssayLinks = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  // One catalog of Essays-category posts. rewriteHref leaves the original
  // string unless that catalog names the linked post.

  function safeSlug(raw) {
    var slug = String(raw || "").trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return "";
    return slug;
  }

  function idKey(value) {
    var raw = String(value == null ? "" : value).trim();
    if (!/^\d+$/.test(raw)) return "";
    var n = Number(raw);
    if (!isFinite(n) || n <= 0) return "";
    return String(n);
  }

  function decodeSlug(raw) {
    try {
      return decodeURIComponent(String(raw || ""));
    } catch (err) {
      return "";
    }
  }

  function blogHost(hostname) {
    var host = String(hostname || "").toLowerCase().replace(/^www\./, "");
    return host === "blog.kindel.com";
  }

  function slugFromBlogLink(link) {
    try {
      var url = new URL(String(link || ""), "https://kindel.com");
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      if (!blogHost(url.hostname)) return "";
      var dated = /^\/\d{4}\/\d{2}\/\d{2}\/([^/]+)\/?$/.exec(url.pathname);
      if (!dated) return "";
      return safeSlug(decodeSlug(dated[1]));
    } catch (err) {
      return "";
    }
  }

  function catalogFromPosts(posts) {
    var bySlug = Object.create(null);
    var byId = Object.create(null);
    if (!Array.isArray(posts)) return { bySlug: bySlug, byId: byId };
    posts.forEach(function (post) {
      if (!post || typeof post !== "object") return;
      var slug = safeSlug(post.slug);
      if (!slug) return;
      bySlug[slug] = slug;
      var key = idKey(post.id);
      if (key) byId[key] = slug;
      var fromLink = slugFromBlogLink(post.link);
      if (fromLink) bySlug[fromLink] = slug;
    });
    return { bySlug: bySlug, byId: byId };
  }

  function essayPath(slug, hash) {
    return "/essays/" + slug + "/" + (hash || "");
  }

  function barePostPath(pathname) {
    return pathname === "/" || pathname === "" || /^\/index\.php$/i.test(pathname);
  }

  function rewriteHref(href, catalog) {
    var original = href == null ? "" : String(href);
    if (!catalog || !catalog.bySlug || !catalog.byId) return original;
    var url;
    try {
      url = new URL(original, "https://kindel.com");
    } catch (err) {
      return original;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return original;
    if (!blogHost(url.hostname)) return original;
    var dated = /^\/\d{4}\/\d{2}\/\d{2}\/([^/]+)\/?$/.exec(url.pathname);
    if (dated) {
      var candidate = safeSlug(decodeSlug(dated[1]));
      var fromPath = candidate ? catalog.bySlug[candidate] : "";
      if (typeof fromPath !== "string" || !safeSlug(fromPath)) return original;
      return essayPath(fromPath, url.hash);
    }
    if (!barePostPath(url.pathname)) return original;
    var p = url.searchParams.get("p");
    var key = idKey(p);
    var fromId = key ? catalog.byId[key] : "";
    if (typeof fromId !== "string" || !safeSlug(fromId)) return original;
    return essayPath(fromId, url.hash);
  }

  function applyTo(root, catalog) {
    if (!root || !catalog || typeof root.querySelectorAll !== "function") return;
    var nodes = root.querySelectorAll("a[href]");
    Array.prototype.forEach.call(nodes, function (node) {
      if (!node || typeof node.getAttribute !== "function" || typeof node.setAttribute !== "function") return;
      var href = node.getAttribute("href");
      if (href == null) return;
      var next = rewriteHref(href, catalog);
      if (next !== href) node.setAttribute("href", next);
    });
  }

  return {
    catalogFromPosts: catalogFromPosts,
    rewriteHref: rewriteHref,
    applyTo: applyTo
  };
});
