# Material deploy, slim core & `ssg init` — draft plan (for discussion)

> **Status: decisions locked; ready to build Phase 1.** Combines two roadmap items — **"Material
> *deploy* commands & a slim core"** and **"`ssg init`"** — into **one task, two phases**, bridged by
> a transitional `ssg add --all-used` so the breaking change lands safely. Detail for
> [tooling-and-distribution-plan.md](tooling-and-distribution-plan.md) §1–2. See **Decided** and the
> **Implementation plan (commits)** below.

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

## Your idea: an eject bridge that becomes the install command — endorsed

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

**It's more than a bridge — keep it.** `--all-used` generalises into a permanent **material-install**
command: "for every material this site *uses* but doesn't have present, fetch it from its source and
drop it in." In Phase 1 the only source is the engine catalog (so it reads as "eject the defaults").
Once a **material registry** exists (tooling §3), the source can be an npm package / git repo / URL,
and the *same* command installs third-party materials — a lightweight `npm install` for materials.
So the two verbs settle into a clean split, both permanent:
- **`ssg add --all-used`** — *install* every used-but-missing material from its source (bulk, keeps
  attribution — you're a **user** of it).
- **`ssg add <name>`** — *vendor* one material into the repo to **own/edit** it (your copy from here).

This is why the origin/attribution stamp matters: a merely-*installed* material keeps its author's
credit in its `<name>.json`; the moment you `ssg add <name>` to edit it, it's your copy (still stamped
with where it came from). (Stamp mechanics live in §3 — see Notes.)

## Two phases

Illustrative versions: current **v0.5.1** → **Phase 1 = v0.6.0** (additive) → **Phase 2 = v0.7.0**
(breaking, loud migration note). Pre-1.0, so a minor carries the breaking change.

### Phase 1 — deploy commands + the `--all-used` bridge *(defaults still shipped; additive; ~v0.6.0)*

- **`ssg add <name>`** (component by default; `ssg add <kind> <name>` for others) — deploy a single
  material from the engine **catalog** into the site. `--force` to overwrite, `--dry-run` to preview.
  The **permanent** command.
- **`ssg add --all-used`** *(decided name)* — auto-detect the site's used-but-missing materials
  (in Phase 1, the engine-inherited components + `_layout`) and gap-fill them per file. Same copy path
  as single `add`, over the detected set. `--dry-run`; logger output (phase `add`). **Permanent** — it
  debuts here as the eject bridge and stays as the material-install command (see above).
- **"Used" = build resolution** *(decided)*: walk the site's component graph exactly as the build
  does — page `components` arrays + `{{COMPONENT:…}}` + declared `subComponents` + dependencies +
  the always-on `header`/`footer`/`_layout` — then, per file, check whether it **resolves to the
  engine while the site lacks a local copy** → copy it.
- The engine is otherwise **unchanged** (still ships every default) → opt-in and safe. Validate on
  the **demo** (`--all-used` → owns all 8 inherited → builds identically) and confirm the **private**
  site's run is a near-no-op (it already owns everything).

### Phase 2 — slim core + `ssg init` *(defaults removed; breaking; ~v0.7.0)*

- **Slim core.** Default materials move from the auto-resolved `components/` to an in-engine
  **`catalog/`** *(decided)* — shipped but **not** resolved during a build. The **core keeps the
  generation tools** (build pipeline, data model, template/`map` rendering, component resolution, the
  log system); the catalog holds **optional materials**. Using any is opt-in — themed / design-system
  variants are an **option, not a requirement** (they belong to the Phase-3 registry, below).
- Build resolution for a name the site doesn't own → a **clear "not installed — run `ssg add <name>`"
  error**, not a silent miss. `ssg add` now pulls from the catalog (its permanent home). **Keep
  `ssg add --all-used`** — it's no longer just an eject bridge but the standing material-install
  command (installs any used-but-missing material; source resolution grows with the §3 registry).
- **`_layout` is deployable too** *(decided)* — it lives in the catalog **as a component** (recommended
  over inventing a "page" material kind: it already resolves as a component and lives in
  `components/_layout/`). `ssg init` always installs it; existing sites get it via `--all-used`.
- **`ssg init [dir]`** — scaffold a **blank** project from scratch *(decided)*: `package.json`,
  `config.json`, `assets/css/global.css`, `assets/js/global.js`, `pages/index/index.{html,json}`
  (a welcome page), and `components/_layout/_layout.html`. **`ssg init --template demo`** copies the
  **demo** repo's *files* (history-stripped, engine re-pinned — see Notes).
- **Migration note (loud):** "v0.7 removes bundled defaults; on v0.6 run `ssg add --all-used` (or
  `ssg add` each material) so your site owns them first." The bump is gated on that.

## Notes & suggestions

- **One copy path.** `ssg add --all-used` = "for each used-inherited material, do what `ssg add`
  does, per missing file." Build `ssg add <name>` as the primitive; `--all-used` orchestrates it over
  the detected set. Same code, one behaviour to test.
- **The catalog is the current `components/`, relocated.** Move `engine/components/*` (incl.
  `_layout`) → `engine/catalog/*` and stop resolving builds from it.
- **Keep the bundled `example/` site — don't delete it** *(per your note)*. It stops being "the
  engine's default-materials example" (there are no bundled defaults now) and becomes an explicit,
  self-deploying **catalog showcase**: it `ssg add`s the materials it uses, so the catalog is built +
  CI-tested every run and **can't silently rot** — and it's the natural seed for a future **Material
  Design themed demo**. So "make it non-functional for the site" = it no longer *auto-inherits*;
  it deploys what it uses, on purpose.
- **`--template demo` mechanism — git-clone, history-stripped.** Fetch the demo's *files* without its
  git history and **without touching the user's own git**: shallow-clone into a temp dir, copy
  everything except `.git` into the target, discard the temp (the "degit" pattern). The user may
  already have a repo in the target — never clobber their `.git`.
  **Engine-version drift** (the demo can lag the engine that runs `init`, e.g. mid-development): the
  robust fix is a **CI gate that builds the demo against the engine's `main`**, so the demo is never
  behind — then `init` can safely **re-pin the scaffold's engine submodule to the version that ran
  `ssg init`** (a matching pair). If the gate ever shows drift, fall back to scaffolding with the
  demo's *own* pinned (older, known-good) engine **+ a printed note that it was held back**, or refuse
  with "demo not yet migrated to `<engine>`". **Avoid** promising "the engine is always
  backward-compatible" — slim core is deliberately breaking, so that's not a promise we can keep.
- **Generators need nothing now.** The engine ships **no** default generators (`registry.json` is
  `{}`), so slim core is a *components*-only concern today. Keep `ssg add generator <name>` in the
  design for symmetry, but there's no generator inheritance to `--all-used`.
- **`ssg init` = a real blank project.** Not "copy a baseline set of catalog materials" — literally
  emit the files a working site needs: `package.json` (with `build`/`test`/`admin` scripts + the
  engine submodule reference), `config.json`, `assets/css/global.css` + `assets/js/global.js`,
  `pages/index/index.{html,json}` (a welcome page), and `components/_layout/_layout.html`. So a fresh
  `ssg init && npm run build` produces a page with no other materials needed. `--template demo` is the
  richer path — a copy of the demo repo.
- **Provenance / attribution stamp → the material's `.json`, deferred with the registry.** Decided
  location: the source (author / package / engine version) lives in the copied material's
  `<name>.json`. It doubles as **attribution** — a material you only *install* (`--all-used`) keeps its
  author's credit; `ssg add <name>` gives you an editable copy still stamped with its origin. The
  stamp *and* the tooling that reads it (list a site's materials + sources; a future `ssg update`;
  "who contributed the materials this build uses") move to **tooling §3 (plugins + registry)**;
  `ssg add`/`--all-used` stay plain copies until then. (Wrinkle for §3: materials with no `.json` —
  a template-only component, a `.js` generator — need a stamp home.)

## Caveats / watch-items

- **"Used" false negatives are the sharp edge.** If `--all-used` misses a material the site actually
  needs (e.g. referenced only dynamically, or via an unusual `registry.json` remap), slim core breaks
  that site. Mitigation: drive "used" from the **actual build resolution** (ground truth), and **warn
  loudly** on anything ambiguous rather than silently skipping. A good acceptance test: *after
  `--all-used`, a build with the engine's `components/` temporarily emptied still succeeds.*
- **Partial overrides must survive.** Gap-fill per file; never overwrite a site's existing file.
- **`components/registry.json` remaps.** If a site maps a name to a non-default folder, `add`/
  `--all-used` must respect the mapping when deciding source + destination paths.
- **Slim core is breaking — treat it like the `generate-detail.js` retire (v0.4).** Major-ish bump,
  loud migration note, and *the sites go first* (`--all-used` on demo + verify private) before the
  engine drops anything.
- **Catalog rot.** Once defaults aren't auto-built, they can break unnoticed. The `example/` showcase
  (deploying what it uses) must build every CI run — that's what keeps the catalog honest.
- **Idempotency + git hygiene.** `add`/`--all-used` write only; re-running is safe; the tool never
  commits.
- **Staged, not scope-crept.** Phase 1 `--all-used` copies *local* engine-catalog materials only.
  The third-party/npm/registry generalisation is **deliberately §3**, not now — but design the Phase-1
  source lookup with a **seam** (a `resolveSource(name) → path` step), so §3 can add npm/git/URL
  resolvers without rewriting `--all-used`. Don't hardcode "the engine catalog" as the only possible
  source.

## Decided

- **Bridge command:** **`ssg add --all-used`** — a flag on the permanent `ssg add`, not a separate verb.
- **"Used" detection:** **build resolution** — the site's actual component graph, per file, site-first.
- **Scope:** **components + `_layout`** (the engine ships no default generators, so nothing else).
- **`_layout`:** a **deployable catalog component** (not kept in core; not a new "page" material kind).
- **Catalog:** **in-engine `catalog/`**; the core keeps the generation tools, the catalog holds
  optional materials + (later) themed variants.
- **`ssg init`:** emit a **blank** project (`package.json`, `config.json`, `global.css`/`global.js`,
  `pages/index` welcome page, `components/_layout`); **`--template demo`** copies the demo repo.
- **Provenance stamp:** in the material's `.json`, but **deferred to §3** (registry) with its display.
- **`--all-used` is permanent** — debuts as the eject bridge (Phase 1), stays as the material-install
  command (Phase 2+; source resolution grows with the §3 registry). *Not* removed.
- **`--template demo`:** git-clone the demo files (history-stripped, don't touch the user's git);
  re-pin the scaffold's engine to the version that ran `init`, backed by a CI gate that builds the
  demo against engine `main`; note-and-hold on drift/offline (see Notes).
- **`example/` kept** as a self-deploying catalog showcase (not deleted).
- **Drift is detected + reported** *(decided)*. `add`/`--all-used` compare each engine file against
  the site's copy: **missing** → copy (gap-fill); **present + identical** → skip; **present +
  differs** → **report drift** (don't silently overwrite; `--force` overwrites on purpose). So the
  run's summary is `copied / skipped / drifted` — the drifted list tells you which owned files have
  diverged from the engine.
- **Source = the engine catalog, for now** *(decided)*. `--all-used` stays a pure component-migration
  bridge until §3 adds external (`external-material-design`) sources; the source lookup is a seam §3
  plugs into, not built now.

*(Remaining questions are §3-time — the registry interface, no-`.json` stamp home, trust boundary —
and are parked in [tooling-and-distribution-plan.md](tooling-and-distribution-plan.md) §3.)*

## Implementation plan (commits)

`npm test` green after each. **Phase 1** is the actionable near-term work; **Phase 2** is a
coordinated breaking release, done *after* Phase 1 ships and the sites have run `--all-used`.

### Phase 1 — `ssg add` + `--all-used` (~v0.6.0, additive)

> **Built on branch `feat/deploy`** (`npm test` green each commit, 109 checks): **1** `lib/deploy.js`
> (copy primitive + drift); **2** `ssg add <name>` CLI; **3** extracted the shared `lib/components.js`
> resolver + `lib/used-materials.js`; **4** `ssg add --all-used` (+ acceptance test). **5** = this docs
> pass. The engine still ships every default, so it's additive/opt-in.

1. **`lib/deploy.js` — the copy primitive.** Walk a component's engine folder (`<name>.html`,
   `<name>.build.js`, `<name>.json`, `style.css`, `script.js`, + nested sub-component folders) and,
   per file, classify against the site copy: **missing** → copy, **identical** → skip, **differs** →
   **drift** (don't overwrite unless `force`). `deployMaterial(name, { engineComponentsDir,
   siteComponentsDir, force, dryRun })` → `{ copied, skipped, drifted }`. Unit-tested against a temp
   site (copy / skip-identical / detect-drift / force-overwrite / dry-run writes nothing). No CLI yet.
2. **`ssg add <name>` CLI.** New `add` command in `cli.js`: `configureLogging('add')`, deploy the
   named material via `lib/deploy`, `--force`/`--dry-run`, logger summary ("added N file(s)"); a name
   with no engine material → clear error. Tests: adds a component into a temp site; `--dry-run` writes
   nothing; `--force` overwrites.
3. **`lib/used-materials.js` — used-inherited detection.** Extract/reuse the build's component-graph
   walk (page `components` + `{{COMPONENT}}` + `subComponents` + deps + `header`/`footer`/`_layout`)
   to compute the used set, then per file mark those that **resolve to the engine while the site
   lacks a copy**. Unit-tested on a fixture site that references + inherits a couple of components.
4. **`ssg add --all-used`.** Orchestrate detection → `deployMaterial` over the used set → one summary
   (`copied / skipped / drifted`, the drifted list surfaced as warnings); `--dry-run`. Acceptance
   test: after `--all-used` on the fixture, a build with the engine's `components/` temporarily hidden
   **still succeeds** (proves completeness); owned files untouched; a deliberately-edited owned file
   shows up as **drift**.
5. **Docs + README.** Document the `add` commands; mark Phase 1 done here + in the tooling draft §1
   and ROADMAP. (Running `--all-used` on the real demo happens in the *sites* when they bump to v0.6.)

### Phase 2 — slim core + `ssg init` (~v0.7.0, breaking — after sites eject)

A. **Relocate defaults to `catalog/`.** Move `engine/components/*` (incl. `_layout`) →
   `engine/catalog/*`; point `add`/`--all-used` at the catalog; stop build resolution from the (now
   empty) engine `components/`. Convert the bundled `example/` into a **self-deploying showcase** — it
   `ssg add`s the materials it uses, so it still builds and the catalog stays CI-tested (kept, not
   deleted).
B. **Not-installed error.** Resolution for an unowned name → a clear "not installed — run
   `ssg add <name>`" error (instead of a silent miss).
C. **`ssg init`.** The blank scaffold (files above) + `--template demo` (git-clone the demo files,
   history-stripped, engine re-pinned). Add the **CI gate** that builds the demo against engine `main`.
D. **Ship the breaking release.** Loud migration note; the bump; engine + both sites together (sites
   already own their materials from Phase 1). **`--all-used` stays** (it's the standing material-install
   command, not an eject-only bridge).
