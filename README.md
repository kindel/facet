# Facet

Browse every facet, every BIQ question, and the questions that make a principle concrete. Edit the text, and open a pull request.

## App card

This repo ships `card.json` and `icon.png` as the listing for any host (kindel.com, iOS, Android).

`status` is `beta`. `unlisted` is true, so a host whose launcher honors that flag keeps the app off the catalog grid. The page is still [https://kindel.com/kld/apps/facet/](https://kindel.com/kld/apps/facet/). It is noindex, and it is not in the nav.

## What lives here

The page layout is `layouts/page/facet.html`. The host content file sets `layout: facet` and does not add an intro. `js/facet.js` and `css/facet.css` are the list and the editor. A row is the situation, or the question on one line. The full text is only in the editor.

`lib/` is the patch, the allowlist, and the abuse caps (`allow.js`, `patch.js`, `plan.js`, `rules.js`, `guard.js`). The host's save function runs these files on the server. It does not trust the browser. A list can gain an entry, lose one, or reorder one. The patch keeps the file's indent and commas. Teaching records can be added or removed. Principles and companies cannot. A new BIQ question on a company that stores its own questions needs an eight-character hex id and a stub example pack in the same save. The stub names the principle and the question, and it does not invent interview examples. A company that only shows a shared list cannot gain its own questions. Add the question on the company that stores that list. Removing a teaching record also clears its catalog entry, and adding one lists it in that catalog. A facet change has to include every derivation map. A new related note has to name one of that company's principles. A new example pack has to match a question. A reading link that points at an Essays-category post has to use the kindel.com/essays path. A facet id is the slug of its label, and each principle on it is a numeric id. Removing a facet also clears that id from facet questions. A new teaching catalog checks each entry and each new reading link. A reused teaching record uses the destination company's principle id. A copied list edit stays ahead of a later edit of that same copy. The same list edit sent for both companies is kept once. A facet and a teaching catalog entry can move up or down on their own. A question that a facet still names cannot be removed, and those mapped questions still count as coverage.

Principle text stays in [kindel/principles](https://github.com/kindel/principles). BIQ question text stays in [kindel/biq](https://github.com/kindel/biq). Questions that make a principle concrete are the `deepen` list in a teaching file. This repo does not copy those sets.

## Run

The list loads the current files from GitHub, so use a static server.

```
python3 -m http.server
```

Open http://127.0.0.1:8000/

That shell has no site chrome. kindel.com mounts the layout and supplies the app frame.

## Host mount

```toml
[[module.imports]]
  path = "github.com/kindel/facet"
  [[module.imports.mounts]]
    source = "js"
    target = "static/js"
  [[module.imports.mounts]]
    source = "css"
    target = "static/css"
  [[module.imports.mounts]]
    source = "layouts"
    target = "layouts"
  [[module.imports.mounts]]
    source = "card.json"
    target = "data/tools/facet.json"
  [[module.imports.mounts]]
    source = "icon.png"
    target = "static/images/tools/facet.png"
```

The save function stays on the host (`api/editor-save` on kindel.com). Azure packages the `api/` directory, so the host keeps a copy of those five `lib/` files next to the function and checks that copy against this repo. The token and the GitHub calls stay in the host. A local build of the host can point Hugo at a checkout of this repo:

```
HUGO_MODULE_REPLACEMENTS="github.com/kindel/facet -> ../facet"
```

## Tests

```
node --check js/facet.js lib/allow.js lib/patch.js lib/plan.js lib/rules.js lib/guard.js
node --test tests/patch.test.mjs tests/allow.test.mjs
```

## License

MIT. Copyright (c) 2026 Kindel, LLC. Keep the copyright notice and permission notice in all copies.

Derivatives link to [https://kindel.com](https://kindel.com).
