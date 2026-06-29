# Site-Side Extensibility — Engine v0.2 design

_Status: **implemented in v0.2.0.** Originally deferred after the repo split (purely additive, non-breaking, no lock-in); this doc is the design of record. All five capabilities below ship in v0.2.0._

## Goal

Let a **site repo author its own components and generators**, not just override the markup of engine-provided ones. A site should be able to drop a new component (template + logic + assets) or a new page generator into its own tree and have the engine discover and build it — without forking the engine.

## Where v0.1 stands (the gap this closes)

After Phase 1 the engine is site-agnostic and resolves component **templates** site-first, but logic/assets/generators are engine-only:

| Site wants to… | v0.1 | v0.2 |
|---|---|---|
| Override a component's markup | ✅ `loadComponent` site-first | ✅ |
| Add a plain-template component (vars only) | ⚠️ renders, but CSS/JS not copied/linked | ✅ |
| Add a component with its own `.build.js` (logic) | ❌ build scripts resolve engine-only | ✅ |
| Add its own generator | ❌ generators scan `ENGINE_ROOT/generators` only | ✅ |
| A component with sub-components | ❌ `subComponentMappings` hardcoded | ✅ declared per-component |
| Run tests for the site itself | ❌ only the engine's `example/` smoke test | ✅ `ssg test` runs site tests + reusable checks |

## The model — five additive changes

### 1. Search paths (site wins)

Introduce ordered search roots, site before engine:

```
COMPONENT_ROOTS = [ SITE_ROOT/components, ENGINE_ROOT/components ]
GENERATOR_ROOTS = [ SITE_ROOT/generators, ENGINE_ROOT/generators ]
```

An engine-only site (no `SITE_ROOT/components` or `/generators`) behaves exactly as v0.1.

### 2. Per-file, site-first component resolution

Generalize what `loadComponent` already does to **every** component file — `<name>.html`, `<name>.build.js`, `<name>.json`, `style.css`, `script.js` — each resolved site-first across `COMPONENT_ROOTS`.

- A fully site-authored component (`pricing/`) has all its files in the site → all load from the site.
- An override that ships only `header/header.html` keeps using the engine's `header.build.js` (the existing "override markup, keep logic" behavior — now consistent for all file types).
- **Optional component registry** — `SITE_ROOT/components/registry.json` maps `"<componentName>": "<folder under components/>"`, so a site can place a component's folder anywhere (Angular-style) instead of requiring folder-name = component-name. Files inside keep the `<name>.*` convention.

Touch points:
- `buildComponent`: compute the component dir / build-script path / json path via site-first resolution (today they use `COMPONENTS_DIR` = engine only).
- `collectComponentAssets` / `copyComponentAssets`: walk **both** roots; a site component's `style.css`/`script.js` get copied and linked. On a name clash, the site file wins.

### 3. Generic generator contract

> **Superseded — read [docs/generator-migration.md](generator-migration.md) for the current model.**
> The contract below is the v0.2 design (auto-run generators that emit page JSON). The
> generator subsystem was later **restructured** to page-driven generation: generators
> are **data-only** (`generate(ctx, options) -> [{ slug, title, description, vars }]`),
> referenced **by name** from a *template page* (a `pages/` config with `generatorOptions`)
> via `generators/registry.json` — there is no auto-run scan, and the engine assembles one
> page per item. The rest of this document (components, sub-components, tests) is current.

Today a generator must export a function literally named `generateProductPages`. Replace with a neutral contract:

```js
// SITE_ROOT/generators/my-thing.build.js
module.exports = {
  generate(ctx) {
    // ctx: { siteRoot, engineRoot, buildDir, outputDir, lib: { slugify, escapeHtml, raw } }
    // ...write page JSON into ctx.outputDir, return the list of written files
    return [writtenPath, ...];
  }
};
```

- The engine scans `GENERATOR_ROOTS`, requires each `*.build.js`, and calls `generate(ctx)`.
- The two built-in generators (`generate-products`, `generate-custom`) migrate to this contract internally — an engine-side change, invisible to sites.
- Ordering: run engine generators first, then site generators, so a site generator can override an engine-produced page by emitting the same `page` name (later write wins). Emit a warning on a page-name collision.
  - **Refined in v0.2.1:** generators resolve **site-first by filename** — a site generator *shadows* the engine generator of the same name (the engine's is not run), and `product-detail.css|js` page assets resolve site-first too. Differently-named generators emitting the same page still collide (last write wins, with a warning).
- `ctx.lib` hands generators the engine helpers so they don't reach into `../lib` by relative path (which only works because they live inside the engine today).
- The same `lib` surface (`{ slugify, escapeHtml, raw }`) is also passed to component `.build.js` scripts as a 4th argument — `build(vars, loadComponent, replaceVariables, helpers)` — so site components can escape and emit HTML without reaching into the engine's `lib/`. Additive and backward-compatible (existing 3-arg scripts ignore it). Implemented in Phase C.
  - **Extended in v0.4:** `helpers` also carries `collection(name)`, which resolves a collection by name to `{ name, destination, items: [{ id, item }] }` — the same data generators see via `ctx.collection.items`. A component can thus read the **data model** instead of raw files under `build/` (which `data_model` `copy:false` keeps out): the `products` grid reads `helpers.collection('products')` rather than scanning `build/products/*/product.json`.

### 4. Declarative sub-components

Replace the hardcoded `subComponentMappings` (`faqItem→faq`, `productCard→products`, `header-light/dark→header`) with a per-component declaration in `<name>.json`:

```jsonc
// components/faq/faq.json
{ "dependencies": [], "subComponents": ["faqItem"] }
```

The engine builds the sub-component → parent map by scanning every component's `.json` across both roots. Site components can then define their own sub-components.

### 5. Site-authored tests

Today only the engine self-tests (`test/smoke.js` builds `example/` and asserts content-agnostic invariants). A site can't reuse those checks or add its own. v0.2 lets a site test **its own** build:

- **Extract the engine's invariant checks** out of `test/smoke.js` into a reusable module (e.g. `lib/checks.js`) exporting `standardChecks(buildDir) -> failures[]` — no unresolved `{{VAR}}` / `{{COMPONENT:}}`, no broken links, no invalid ids, no backslash web paths, etc.
- **New `ssg test [--site <dir>]` command** — builds the site, runs the standard checks against `build/`, then runs the site's own `test/*.test.js` files (if any), and exits non-zero on any failure.
- **Site test contract:**

  ```js
  // SITE_ROOT/test/shop.test.js
  module.exports = ({ buildDir, read, check }) => {
    const shop = read('shop.html');
    check('shop lists 4 products', (shop.match(/product-card/g) || []).length === 4);
    check('has a contact page', read('contact.html').length > 0);
  };
  ```

  `ctx` provides `{ siteRoot, buildDir, read(file), check(name, cond), standardChecks }` so site tests assert site-specific things (product counts, required pages, nav targets) on top of the generic invariants.

The engine keeps its own `test/smoke.js`, now built on `lib/checks.js`. Sites opt in by adding a `test/` dir; with no `test/`, `ssg test` just builds and runs the standard checks.

## Backward compatibility

All four changes are additive:
- No `SITE_ROOT/components` or `/generators` ⇒ identical to v0.1.
- Built-in generators keep working (migrated behind the new contract).
- Existing component `.json` files without `subComponents` keep working (the engine seeds the built-in mappings as defaults until components declare their own).
- `ssg test` is new and opt-in; a site with no `test/` dir just gets the standard checks. The engine's own smoke test keeps passing (re-pointed at `lib/checks.js`).

So v0.2 is a **non-breaking minor release**; sites on v0.1 upgrade with no changes.

## Risks / decisions to settle when we build it

- **Name collisions** between a site component/generator and an engine one: site wins (documented), warn on shadow.
- **Trust**: site build scripts/generators run arbitrary Node during the build. Acceptable — it's the site author's own code in their own repo, same trust level as the engine. No sandboxing planned.
- **Resolution unit**: per-file site-first (recommended above) vs. per-component-dir ownership. Per-file is more flexible (partial overrides) but allows mixing site template + engine logic; document the behavior clearly.

## Explicitly out of scope for v0.2

- npm-distributed third-party plugins/themes and any plugin registry. v0.2 is only "a site repo can author its own components and generators." Third-party distribution can be a later milestone once the in-repo model is proven.

## Rough work breakdown (when picked up)

1. Component search paths + site-first resolution in `buildComponent` (+ asset collect/copy across both roots). Smoke-test: a site-only component with template + build.js + CSS renders, styles, and links.
2. Declarative sub-components; seed built-in defaults; remove the hardcoded map.
3. Generic `generate(ctx)` contract; migrate the two built-in generators; scan both generator roots. Smoke-test: a site-only generator emits a page.
4. Extract `lib/checks.js`; add the `ssg test` command + site test contract. Smoke-test: a site `test/*.test.js` runs and can fail the build.
5. Docs + a demo example (the demo ships a custom component, a custom generator, and a site test to showcase all of v0.2).
