# Generator contract & migration

Page generation is **declared by a page**. A *template page* under `pages/` names a
generator and how to drive it; the engine resolves the generator **by name** (via
`generators/registry.json`), runs it once to get a list of item descriptors, and
assembles one page per item from the template's HTML + layout + components.

- **Template page** — `pages/<name>/<name>.json` carrying a `generatorOptions` object,
  plus `<name>.html` (the per-item content template) and optional `style.css`/`script.js`.
- **Generator** — `generators/<file>.js`, **data only**:
  `generate(ctx, options) -> [{ slug, title, description, vars }]`.
- **Registry** — `generators/registry.json` maps `name -> file`. The engine ships
  defaults; a site's `generators/registry.json` is merged over them (site wins), and a
  mapped file resolves site-first.

## Template page

```jsonc
// pages/product-detail/product-detail.json   (a leading "_" is allowed - it is only a
//                                              comment, never used for discovery or names)
{
  "generatorOptions": {
    "generator": "products",          // -> generators/registry.json
    "pageName": "product-{slug}",      // {slug} comes from the generator
    "source": "products"               // a collection in shared/database.json (optional)
  },
  "layout": "_layout",                 // ordinary page settings live outside generatorOptions
  "header_theme": "dark",
  "components": [ { "name": "contactIcons" } ]   // built into every generated page
}
// product-detail.html    -> content template, filled per item with the item's vars
// style.css / script.js  -> linked into every page this template produces
```

A config is a **template** iff it has a `generatorOptions` object (found regardless of any
leading `_`). A `_`-prefixed **non-template** page is excluded from the build.

## The generator contract

```js
// generators/<file>.js  — DATA ONLY (no template, no page JSON, no file writes)
module.exports = {
  generate(ctx) {
    // ctx = { siteRoot, engineRoot, buildDir,
    //         lib: { slugify, escapeHtml, raw },
    //         collection: { options, dir, webPath, items } }   // resolved from options.source
    // ctx.collection.items = [{ id, item }] - the engine pre-resolves each item from the
    //   data_model: `id` is the {slug}, `item` is keyed by part (item.data parsed, item.images
    //   web paths). Read these instead of doing file I/O (dir/webPath remain for raw scanning).
    return ctx.collection.items.map(({ id, item }) => ({
      slug: id, title: item.data.name, description: item.data.description,
      vars: { /* values for the template's {{PLACEHOLDERS}} */ }
    }));
  }
};
```

- `vars` text is HTML-escaped by the engine; insert HTML fragments with `ctx.lib.raw(...)`.
- A collection's `data_model` surfaces each item into `ctx.collection.items` and controls which
  files reach `build/` (`copy` defaults **false** — mark web assets `copy: true`).
- The engine derives each page name from `generatorOptions.pageName` (substituting `{slug}`),
  inherits the template's `layout` / `header_theme` / `components`, fills the template HTML,
  and builds it through the normal page pipeline.

## Generator-free pages (`generatorOptions.map`)

`generator` is **optional**. A template page with just a `source` + a `map` needs no JS at all —
the engine renders one page per collection item, filling the template from the map:

```jsonc
// pages/product-detail/product-detail.json
{ "generatorOptions": {
    "pageName": "product-{slug}", "source": "products",
    "map": { "PRODUCT_NAME": "$data.name", "PRODUCT_PRICE": "$data.price" }
  }, "layout": "_layout" }
```

A `$`-prefixed value is a path into the item (`$data.name`, `$images`); anything else is a
literal. A bad path (root isn't a `data_model` part) is a **build error**; a miss (deeper value
absent) is a **warning** and fills `""`. Computed output (e.g. an image carousel) is done with a
**component** that receives `$images` — so a standard detail page can be pure config (no generator).
Reach for a generator only when you need to reshape the collection (group, paginate, aggregate).

## Build-time validation (loud errors)

The build **fails** with a clear message on: a `generatorOptions` missing `generator` or
`pageName`; an unknown generator name (registry miss); a `source` naming a missing or
disabled collection; or two pages resolving to the same `<page>.html` (name collision).

## Migrating an older generator

### From the interim `generate(ctx)` that emitted page JSON

| Before | Now |
|---|---|
| owns its HTML template (read via `__dirname`) | template moves to a `pages/<name>/` **template page** |
| writes `{ page, title, layout, components, content }` JSON to `ctx.outputDir` | returns `[{ slug, title, description, vars }]` |
| computes the page name itself (e.g. `product-<id>`) | engine applies `generatorOptions.pageName` to each `slug` |
| reads `path.join(ctx.buildDir, '<dest>')` + scans for files | reads `ctx.collection.items` (the engine surfaces data/images from the `data_model`) |
| auto-run by scanning `generators/*.build.js` | referenced **by name** from a template page (`generators/registry.json`) |
| file named `*.build.js` | file named `*.js` (the `.build.js` auto-run scan is gone) |

The two built-in generators (`generate-products`, `generate-custom`) became identical once
the template and source were externalized, so they are now a single `generators/generate-detail.js`
registered under both `products` and `custom`.

### From the original `generateProductPages(outputDir)`

That contract was removed in v0.2.1; migrate to the data-only contract above.

## Component build scripts

Unrelated to generators but on the same helper surface: component `.build.js` scripts
receive `build(vars, loadComponent, replaceVariables, helpers)` where
`helpers = { slugify, escapeHtml, raw }`. Additive; existing 3-argument scripts are unaffected.
