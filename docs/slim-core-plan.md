# Material deploy, slim core & `ssg init` — draft plan (for discussion)

> **Status: draft.** Combines two roadmap items — **"Material *deploy* commands & a slim core"** and
> **"`ssg init`"** — into **one task, two phases**, with a transitional "eject" bridge between them so
> the breaking change lands safely. Detail for [tooling-and-distribution-plan.md](tooling-and-distribution-plan.md)
> §1–2. Nothing here is decided.

## The problem

Today the engine **ships default components** (`header`, `footer`, `hero`, `products` +
`productCard`, `faq` + `faqItem`, `contactIcons`, `carousel`, `_layout`) and a site **inherits** any
it doesn't override, via **site-first per-file resolution**. Overriding means **hand-copying** a file
into the site's `components/`.

The **slim core** goal: the engine stops shipping those defaults; materials are **deployed by name**
into a site instead (`ssg add`). That fixes three real pains (phantom example output; override =
dig-and-copy; silent drift on engine update). But it's a **breaking change**: the moment the engine
drops a default, every inheriting site loses that component and the build fails to resolve it.

**Concrete stakes (measured):** the **demo** owns only `carousel` + `testimonials` and **inherits
~8** materials (`header`, `footer`, `hero`, `products`/`productCard`, `faq`/`faqItem`, `contactIcons`,
`_layout`). Under a naive slim core it would break outright. (The **private** site already owns every
component it uses — it copied them all during the v0.4 migration — so it's the "already-ejected" case.)

## Your idea: a transitional "eject" bridge — endorsed

Ship a **bridge release** that *still* includes all defaults **and** adds a command that, when run,
**copies every component a site uses-but-inherits into the site**. After running it a site **owns**
everything, so the *next* release can drop the defaults with **zero breakage**. The command is
obsolete once nothing is inherited, so it can be removed in the slim release.

This is the right shape — it's the "eject" pattern (à la create-react-app), scoped and automated for
one transition. Why it works and what to sharpen:

- **It inverts the risk.** Instead of "remove defaults and hope sites coped," sites take **ownership
  first**, verifiably, while the safety net (the defaults) is still in place. The breaking release
  then only affects sites that ignored the bridge.
- **Reuse the build's own resolution for "used" — don't re-invent it.** The engine already walks the
  component graph (for asset bundling) and already resolves each file **site-first** via
  `resolveComponentFile(name, file)`. Eject = *(used component set)* × *(its files)*, and for every
  file that **resolves to an engine path while the site has no local copy**, copy it to the site.
  That's the ground truth of what the build actually pulls from the engine — no guessing.
- **Per-file gap-fill, never clobber.** Resolution is per-file, so a site may own `header/header.html`
  but inherit `header/header.build.js`. Eject must copy **only the files the site lacks**, preserving
  partial overrides. Idempotent + safe to re-run.
- **Copy whole folders for nested materials.** A component's **nested sub-component folders**
  (`faq/faq_item/…`) and **bundled `style.css`/`script.js`** must come along (the C1/C2 structure),
  or the ejected component is half-copied.
- **Report through the new logger.** Each copied file → `log.info` (phase `eject`); a skipped
  already-owned file → `log.debug`; a component that couldn't be resolved → `log.warn`. `--dry-run`
  prints the plan without writing. (Nice cohesion with the v0.5 terminal-UX work.)
- **It doesn't commit.** It writes files; the site owner reviews + commits. The migration is a normal
  reviewable diff in the site repo.

One honest note: ejecting makes explicit the trade-off that already exists for hand-copied components
— **an owned component stops tracking engine updates.** That's the *point* (ownership), but the
command should say so in its summary.

## Two phases

Illustrative versions: current **v0.5.1** → **Phase 1 = v0.6.0** (additive) → **Phase 2 = v0.7.0**
(breaking, loud migration note). Pre-1.0, so a minor carries the breaking change.

### Phase 1 — deploy commands + the eject bridge *(defaults still shipped; additive)*

- **`ssg add <kind> <name>`** — deploy a single material (component/generator/test/page) from the
  engine **catalog** into the site (`ssg add component header`). Refuses to overwrite unless
  `--force`; `--dry-run`. This is the **permanent** command.
- **`ssg eject`** *(name TBD)* — the **transitional** bulk command: resolve the site's used-but-
  inherited components (+ `_layout`) and gap-fill them per file. `--dry-run`, logger output. This is
  the **bridge**, removed in Phase 2.
- The engine is otherwise **unchanged** — it still ships every default, so nothing breaks and eject
  is opt-in. Validate on the **demo** (eject → owns all 8 → builds identically) and confirm the
  **private** site's eject is a near-no-op.

### Phase 2 — slim core + `ssg init` *(defaults removed; breaking)*

- **Slim core.** The default components move out of the auto-resolved `components/` into a
  **`catalog/`** (shipped but not resolved during a build). Component resolution for a name the site
  doesn't own → a **clear "not installed — run `ssg add <name>`" error**, not a silent miss.
- **`ssg add`** now pulls from the catalog (same command, its permanent home). Remove **`ssg eject`**
  (nothing left to eject).
- **`ssg init [dir] [--template <name>]`** — scaffold a working project: a minimal `config.json`,
  `pages/index/`, `assets/`, and a **baseline set of deployed materials**. Your sub-idea — *copy the
  demo* — fits as a named template (`--template demo`) alongside a **`blank`** default (see below).
- **Migration note (loud):** "bumping to v0.7 removes bundled defaults; run `ssg eject` on v0.6
  first (or `ssg add` each material) so your site owns them." The bump is gated on that.

## Notes & suggestions

- **`ssg add` and `ssg eject` share one copy path.** Eject = "for each used-inherited material, do
  what `ssg add` does, per missing file." Build `ssg add` as the primitive; eject orchestrates it.
- **`_layout`: core or catalog?** It's used by *every* page. Two options: keep `_layout` in the
  **core** (never removed — one thing a slim engine still guarantees), or make it a deployable that
  `ssg init` always installs. Leaning **keep in core** — it's the one universal.
- **The catalog is the current `components/`, relocated.** Minimal work: move `engine/components/*`
  → `engine/catalog/*` and stop resolving builds from it. Keep it **build-tested** — the bundled
  `example/` site should deploy + exercise the catalog so it can't rot (a catalog that nobody builds
  silently breaks).
- **Generators need nothing now.** The engine ships **no** default generators (`registry.json` is
  `{}`), so slim core is a *components*-only concern today. Keep `ssg add generator <name>` in the
  design for symmetry, but there's no generator inheritance to eject.
- **`ssg init` source.** A **`blank`** template (generic config + one page + the core materials the
  page needs) is the right *default* — a fresh project shouldn't inherit "Brickwork & Co." content.
  `--template demo` copies the demo (a complete, real storefront) as a richer starting point. Caveat:
  the demo carries `shared/products` sample data + specific copy; fine for a demo template, wrong as
  the blank default.
- **Optional: stamp provenance.** Copied materials could record which engine version they came from
  (a header comment or a `materials.lock`), enabling a future **`ssg update <name>`** that re-pulls +
  shows a diff. Defer, but the eject/add copy is the natural place to write it.

## Caveats / watch-items

- **"Used" false negatives are the sharp edge.** If eject misses a component the site actually needs
  (e.g. referenced only dynamically, or via an unusual `registry.json` remap), slim core breaks that
  site. Mitigation: drive "used" from the **actual build resolution** (ground truth), and **warn
  loudly** on anything ambiguous rather than silently skipping. A good acceptance test: *after eject,
  a build with the engine's `components/` temporarily emptied still succeeds.*
- **Partial overrides must survive.** Gap-fill per file; never overwrite a site's existing file.
- **`components/registry.json` remaps.** If a site maps a name to a non-default folder, eject/add
  must respect the mapping when deciding source + destination paths.
- **Slim core is breaking — treat it like the `generate-detail.js` retire (v0.4).** Major-ish bump,
  loud migration note, and *the sites go first* (eject demo + verify private) before the engine drops
  anything.
- **Catalog rot.** Once defaults aren't auto-built, they can break unnoticed. The example site (or a
  dedicated catalog smoke) must deploy + build them every CI run.
- **Idempotency + git hygiene.** Eject/add write only; re-running is safe; the tool never commits.
- **Scope creep into a package manager.** `ssg add`/`eject` copy *local* engine materials by name.
  **Third-party/npm distribution + a registry is a later item** (tooling draft §3) — keep this task
  to the in-engine catalog so it stays small.

## Open questions

- **Names.** The bridge verb (`eject` / `vendor` / `localize` / `adopt` / `ssg add --all-used`); and
  confirm `ssg add` / `ssg init`.
- **"Used" detection.** Build-resolution capture (accurate, needs a build) vs a static scan of page
  configs + `{{COMPONENT}}` + `subComponents` (no build, may miss dynamic) vs **both** (scan, then
  confirm against a build). Recommendation leans build-resolution; confirm.
- **Eject scope.** Components + `_layout` only, or also page-assets / generators / tests? (Inheritance
  surface today is components + layout.)
- **`_layout`** — core or catalog (see notes).
- **Catalog location** — in-engine `catalog/` (simple) vs a separate "materials" project (sets up §3
  distribution but more moving parts). Start in-engine?
- **`ssg init` default** — `blank` baseline vs `demo`; and does `init` also wire `package.json`
  scripts + the engine submodule, or assume they exist?
- **Provenance/lockfile** — stamp copied materials for a future `ssg update`, or keep copies plain?
- **Keep or drop the bridge in Phase 2** — remove `ssg eject` entirely, or retain it as
  `ssg add --all-used` for niche re-syncs?
- **Reconcile existing partial copies** — the private site owns everything already; should eject also
  *detect drift* (an owned file that differs from the engine's) and report it, or strictly gap-fill?
