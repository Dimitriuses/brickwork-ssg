# Generator restructuring — implementation plan

A restructuring of the generator subsystem from **generator-driven (auto-run)** to
**declarative, page-driven** generation. No version label is attached on purpose —
this is a refactor of how generation works, to be implemented on the
`refactor/generator-restructure` branch.

## The idea

Today a generator is a `*.build.js` that scans a data folder, owns its own HTML
template (read via `__dirname`), and emits one fully-formed page-config JSON per
item. Generation runs by **scanning** `generators/` and **running every** script.

After this change, generation is **declared by a page**:

- A **template page** lives in `pages/` and declares *which* generator to run and
  *with what options*. Its `.html` is the per-item content template; its folder may
  carry `style.css` / `script.js` (the engine already bundles page-folder assets).
- A **generator** (`generators/*.js`) holds only **data logic**: given options, it
  returns a list of item descriptors (`slug`, `title`, `vars`, …). It no longer owns
  the template, the layout, the components, or the page JSON.
- A **`generators/registry.json`** maps a generator **name → file**. A template page
  references the generator **by name**.
- The engine resolves the named generator, invokes it **once**, and **assembles**
  one concrete page per item from the template's HTML + layout + components, then
  builds each through the existing `buildPage`.

This keeps templates with the pages they produce, makes generation configurable in
the page JSON (including integrating already-implemented components), and lets the
engine **index** exactly what it needs (load only the referenced generator; read the
template from its declared folder) instead of scanning and running everything.

## Locked decisions

1. **Discovery by config keys.** A page config is a *template* **iff** it has both
   `generator` and `generatorOptions`. The `_` prefix is **not** a discovery
   mechanism — it is a cosmetic author comment only: the engine never relies on it to
   find templates and never emits it into output names.
2. **Page naming via pattern.** The template config carries a `pageName` pattern,
   e.g. `"pageName": "product-{slug}"`; the generator supplies `slug` per item.
3. **Pre-copy source.** Generators read from the **pre-copy** source under
   `SITE_ROOT` (e.g. `shared/products`), not `build/`, because data locations may move
   later. `generatorOptions.source` names that folder.
4. **Site-first registry.** `generators/registry.json` is resolved site-first — a site
   can remap a generator name to its own file — mirroring `components/registry.json`.
5. **N templates → 1 generator.** A generator is parameterized by `generatorOptions`,
   so the two near-identical product/custom generators can collapse into a single
   generic *collection* generator driven by two template pages.
6. **Title/description from the generator** (per item) for now — not config fields.
   They may become config fields in a later engine change; out of scope here.

## Design constraint — `registry.json` is volatile

A future task will restructure `registry.json` (and may change parts of this very
feature). Keep registry handling **cheap to change**:

- Route every read through **one** resolver (e.g. `resolveGenerator(name)`); do not
  scatter registry-shape assumptions across call sites.
- Keep the on-disk schema **minimal**: `{ "<name>": "<file>" }`.
- Mirror the existing `siteComponentRegistry()` merge pattern so a later unification
  of the registries is a one-place change.

## Target shapes

```jsonc
// pages/product-detail/product-detail.json   ('_' prefix, if used, is a comment only)
{
  "generator": "collection",                            // -> generators/registry.json
  "generatorOptions": { "source": "shared/products" },  // pre-copy data folder
  "pageName": "product-{slug}",                         // {slug} comes from the generator
  "layout": "_layout",
  "header_theme": "dark",
  "components": [ { "name": "contactIcons" } ]          // built into every generated page
}
// pages/product-detail/product-detail.html   -> per-item content template
// pages/product-detail/style.css, script.js  -> detail-page assets (was generators/product-detail.*)
```

```json
// generators/registry.json   (engine ships defaults; a site's copy is merged over it)
{ "collection": "generate-collection.js" }
```

```js
// generators/generate-collection.js  — DATA ONLY
module.exports = {
  // ctx = { siteRoot, engineRoot, buildDir, lib: { slugify, escapeHtml, raw }, collections }
  // options = the template's generatorOptions, e.g. { source: 'shared/products' }
  generate(ctx, options) {
    // read ctx.siteRoot/options.source (pre-copy); for each item return a descriptor:
    return [
      { slug: 'red-brick', title: 'Red Brick', description: '…',
        vars: { PRODUCT_NAME: '…', CAROUSEL_SLIDES: ctx.lib.raw('…'), /* … */ } },
      // …
    ];
  }
};
```

## Engine flow (target)

1. **Scan** `pages/` for configs (one pass).
2. **Classify** each config: has `generator` *and* `generatorOptions` ⇒ **template**;
   otherwise ⇒ **normal page**. Normal `_`-prefixed entries stay excluded (examples);
   a template is found by its keys regardless of any `_`.
3. **Normal pages** → `buildPage` as today.
4. **Templates** → `resolveGenerator(name)` (registry, site-first) → `generate(ctx,
   options)` → for each item: compute `pageName` from the pattern + `slug`, fill the
   template HTML with `item.vars`, assemble a page config `{ page, title, description,
   layout, header_theme, components, content }`, and `buildPage` it.
5. **Assets**: each generated page links the **template page's** `style.css/script.js`
   (named after the template), replacing the hard-coded `product-detail` special case.

### Reading pre-copy data, emitting build paths

Generators read item data from the pre-copy `source`, but image/asset URLs in the
rendered page must point at the **collection destination** in `build/` (e.g.
`products/<folder>/<img>`). The engine already knows `source → destination` from
`shared/database.json` collections. Hand the generator the resolved destination (or
the collection mapping) via `ctx` so it can build correct web paths without assuming
the source equals the destination. (Small detail; settle the exact `ctx` surface in
Phase 2.)

## Phased implementation

Each phase is independently testable via the engine's `example/` fixture + smoke test.

### Phase 1 — Registry + resolver (isolated, cheap to change)
- Add `generators/registry.json` (engine) for the built-in generator name(s).
- Add a single `resolveGenerator(name)`: merge engine + site registries (site wins),
  map `name → file`, then resolve the file site-first across `[SITE_ROOT/generators,
  ENGINE_ROOT/generators]`. No other module learns the registry shape.
- No pipeline change yet. Smoke: resolver returns the site file when a site overrides
  a name, the engine file otherwise.

### Phase 2 — Data-only contract + assembler (behind a fixture)
- Define `generate(ctx, options) -> items[]` and an `assemblePages(templateConfig,
  templateHtml, items)` that fills the template per item and calls `buildPage`.
- Settle the `ctx` surface (incl. the collection `source → destination` mapping).
- Add an `example/` template page + a tiny generator returning two items. Smoke:
  both pages built, the template's components are integrated, and the template's
  `style.css` reaches the built pages.

### Phase 3 — Discovery + pipeline inversion
- Classify scanned configs (template vs normal); expand templates via Phases 1–2.
- Remove the old auto-run dispatch (scan-and-run-all). Confirm `_`-prefixed example
  pages remain excluded while templates are found by their keys.
- Provide data-only `generate(ctx, options)` versions of the two built-ins and move
  their templates into `example/pages/` in the fixture.

### Phase 4 — Page-asset generalization
- Replace the `product-detail` special case (asset collect + copy) with
  "generated pages link/copy the asset named after their template page." The
  existing top-level page-folder copy already covers non-`_` template folders;
  the generated page config carries its template's asset base for the link side.

### Phase 5 — Collapse built-ins + docs
- Optionally merge `generate-products` + `generate-custom` into one generic
  `generate-collection` driven by two template pages (`product-detail`,
  `custom-detail`) that differ only by `generatorOptions` + HTML.
- Update `docs/generator-migration.md` (new contract + template-page model),
  `CLAUDE.md`, and `docs/extensibility.md`.

### Phase 6 — Site migration (separate repos, after the engine merges)
- Private site and demo: move templates into `pages/`, add `generators/registry.json`,
  thin the generators to data-only, and move `product-detail.css/js` into the template
  folder. Verify output is equivalent (the `product-<id>` page names are preserved when
  the `pageName` pattern matches the previous slugging).

## Breaking-change & migration notes

- **Contract:** `generate(ctx)` emitting page-config JSON → `generate(ctx, options)`
  returning item descriptors. Document the mapping in `docs/generator-migration.md`.
- **Layout:** templates move from `generators/` into `pages/`; `product-detail.css/js`
  move into the template folder; `generators/registry.json` is added.
- Any site-authored generator must migrate to the data-only contract; the engine
  should fail loud (as the removed legacy shim does) if it sees the old shape.

## Out of scope / deferred

- The upcoming `registry.json` restructuring (kept cheap to change here).
- `generatorOptions` beyond `source` (filters, sort, pagination).
- `title`/`description` (and other page fields) as template-config values.
- Multiple `style.css` / `script.js` files per page folder.
