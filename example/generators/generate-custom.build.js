// Example SITE generator that SHADOWS the engine's generate-custom.build.js
// (same filename). Because generators now resolve site-first by filename, the
// engine's version does not run - the smoke test proves this by asserting the
// engine's "[CUSTOM-PAGES]" log is absent while this one's marker page appears.
const fs = require('fs');
const path = require('path');

module.exports = {
  generate(ctx) {
    const { escapeHtml } = ctx.lib;
    const title = 'Custom (site generator)';
    const pageConfig = {
      page: 'custom-demo',
      title,
      header_theme: 'dark',
      layout: '_layout',
      components: [],
      content: `<main class="container py-5" style="padding-top:90px;">`
        + `<h1>${escapeHtml(title)}</h1></main>`
    };
    const file = path.join(ctx.outputDir, '_generated-custom-demo.json');
    fs.writeFileSync(file, JSON.stringify(pageConfig, null, 2));
    console.log('[EXAMPLE-CUSTOM] site generator ran (shadowing the engine generate-custom)');
    return [file];
  }
};
