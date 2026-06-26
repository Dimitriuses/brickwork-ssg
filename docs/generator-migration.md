# Generator contract — v0.2 migration

As of v0.2, page generators use a neutral contract and can live in **either** the
engine (`generators/`) or a **site** (`SITE_ROOT/generators/`). Generators resolve
**site-first by filename** (v0.2.1): a site generator shadows the engine generator
of the same name, and a new-named site generator is simply added. The
`generators/product-detail.css|js` page assets resolve site-first too. (Two
*different* generators that emit the same `page` name still collide — last write
wins, with a warning.)

## The contract

```js
// generators/<name>.build.js
module.exports = {
  generate(ctx) {
    // ctx = {
    //   siteRoot,     // absolute path to the site being built
    //   engineRoot,   // absolute path to the engine
    //   buildDir,     // absolute path to the site's build/ output
    //   outputDir,    // scratch dir to write page JSON into (built then removed)
    //   lib: { slugify, escapeHtml, raw }
    // }
    // Write one JSON file per page into ctx.outputDir; return the list of paths.
    return [writtenPath, ...];
  }
};
```

Each emitted JSON is a page config (`{ page, title, layout, components, content, ... }`),
the same shape `pages/<name>/<name>.json` uses. The engine builds each into
`build/<page>.html`.

## The legacy contract was removed in v0.2.1

The original contract — `module.exports = { generateProductPages(outputDir) }` —
was supported through **v0.2.0** and **removed in v0.2.1**. A generator that
exports only `generateProductPages` now **fails the build** with a pointer to
this document, instead of silently doing nothing. Migrate it to `generate(ctx)`:

| Before (removed) | Now |
|---|---|
| `function generateProductPages(outputDir)` | `generate(ctx)` |
| `outputDir` | `ctx.outputDir` |
| `'build/products'` (cwd-relative) | `path.join(ctx.buildDir, 'products')` |
| `require('../lib/slugify')` / `require('../lib/html')` | `ctx.lib.slugify` / `ctx.lib.escapeHtml` / `ctx.lib.raw` |
| `module.exports = { generateProductPages }` | `module.exports = { generate }` |

Nothing else changes — still return the array of written file paths.

## Component build scripts

Related change: component `.build.js` scripts now receive the same helper surface
as a 4th argument — `build(vars, loadComponent, replaceVariables, helpers)` where
`helpers = { slugify, escapeHtml, raw }`. This is additive; existing 3-argument
build scripts are unaffected.
