// Example data-only generator (restructure Phase 2 contract). Resolved by NAME
// ("collection") via generators/registry.json, invoked once per template page.
// It returns one descriptor per collection item; the engine assembles the pages.
//   generate(ctx, options) -> [{ slug, title, description, vars }]
//   ctx.collection = { dir, webPath }  (the source collection's post-copy build folder)
const fs = require('fs');
const path = require('path');

module.exports = {
  generate(ctx, options) {
    const { slugify } = ctx.lib;
    const { dir, webPath } = ctx.collection;
    if (!dir || !fs.existsSync(dir)) return [];

    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => ({
        slug: slugify(entry.name),
        title: `Catalog: ${entry.name}`,
        description: `Generated from the "${options.source}" collection`,
        vars: {
          ITEM_NAME: entry.name,
          ITEM_IMAGE: `${webPath}/${entry.name}/p.png`
        }
      }));
  }
};
