# Site-Side Extensibility — Engine v0.2 design

_Status: **planned for engine v0.2** (after the repo split). Deferred deliberately: not needed for the demo or personal site, and it is purely additive (a non-breaking minor version), so it carries no lock-in. This doc specifies it so the work isn't lost._

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

## The model — four additive changes

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

Touch points:
- `buildComponent`: compute the component dir / build-script path / json path via site-first resolution (today they use `COMPONENTS_DIR` = engine only).
- `collectComponentAssets` / `copyComponentAssets`: walk **both** roots; a site component's `style.css`/`script.js` get copied and linked. On a name clash, the site file wins.

### 3. Generic generator contract

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
- `ctx.lib` hands generators the engine helpers so they don't reach into `../lib` by relative path (which only works because they live inside the engine today).

### 4. Declarative sub-components

Replace the hardcoded `subComponentMappings` (`faqItem→faq`, `productCard→products`, `header-light/dark→header`) with a per-component declaration in `<name>.json`:

```jsonc
// components/faq/faq.json
{ "dependencies": [], "subComponents": ["faqItem"] }
```

The engine builds the sub-component → parent map by scanning every component's `.json` across both roots. Site components can then define their own sub-components.

## Backward compatibility

All four changes are additive:
- No `SITE_ROOT/components` or `/generators` ⇒ identical to v0.1.
- Built-in generators keep working (migrated behind the new contract).
- Existing component `.json` files without `subComponents` keep working (the engine seeds the built-in mappings as defaults until components declare their own).

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
4. Docs + a demo example (the demo site ships one custom component to showcase it).
