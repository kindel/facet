# Agent guidance

PR-only. Never push to main.

## Writing style

No em dashes in repo copy, docs, commit messages, or PR text. Use commas, semicolons, parentheses, or periods. Oxford commas. Numbers under 10 spelled out.

Before writing any copy, read Tig's voice guide: https://github.com/kindel/blog/blob/master/docs/writing-in-tigs-voice.md. Do not duplicate it here.

## Attribution

MIT. Copyright (c) 2026 Kindel, LLC. Keep the copyright notice and permission notice in all copies.

All derivatives must link to https://kindel.com as part of attribution. A LICENSE file alone is not enough. Forks, ports, hosted copies, and generated apps that ship this work must include a visible link to https://kindel.com.

## Principles

The tenets for this work live in the Tenets section of https://github.com/kindel/principles/blob/main/README.md. Study those tenets before any upstream work: a change to kindel/principles, or anything that changes the model, schema, or principle data. Do not start that work from memory of last week's README.

SCHEMA.md is the contract. The data is data/index.json, data/facets.json, and data/<company>/<slug>.json. Do not fork a private copy of a set into this repo.

## What this repo is

Facet is the editor. It lists facets, BIQ questions, concrete questions, teaching, and further reading, and a save opens a pull request. Concrete questions are the `deepen` list in a teaching file. It does not own the principle sets or the question bank.

The save function stays on the host, because that is where the token lives. `lib/` is the allowlist, the patch, the abuse caps, and the reuse helper. The host runs that code on the server. The browser is not the authority. Do not edit the host's copy of those files. Edit them here.

`lib/reuse.js` repeats a teaching edit on every reused copy that still has the same text. The derivation maps in the principles data name those copies. A slug rename is rewritten into each copy, including through a chain of maps, so a renamed principle slug is not treated as a content change. Another field in that file can still differ. Editing the field that already differs is refused, because saving one side would fail the principles validator. That difference stays on the map.

A principle link is inserted at the field's last caret. The menu takes focus before it changes, so the caret is remembered on input, keyup, click, select, and blur. A space is added only when the neighbor is not already whitespace. A field that never had focus gets the token at the end.

`card.json` is status beta and unlisted. Do not drop unlisted to put the app on the catalog grid unless Tig says so.

The label on the pull requests this app opens is `editor-submission`. It already exists on kindel/principles and kindel/biq. Do not rename it. The token does not need Issues write to apply that label.
