// Example SITE-authored generator (v0.2 contract). Emits one page per news
// item, proving a site can add its own generator alongside the engine's.
const fs = require('fs');
const path = require('path');

const ITEMS = [
  { title: 'Brickwork v0.2', body: 'Sites can now author their own components and generators.' },
  { title: 'Theming', body: 'Reskin a site by overriding the --bw-* CSS variables.' }
];

module.exports = {
  generate(ctx) {
    const { slugify, escapeHtml } = ctx.lib;
    const written = [];
    ITEMS.forEach(item => {
      const slug = slugify(item.title);
      const pageConfig = {
        page: `news-${slug}`,
        title: item.title,
        header_theme: 'dark',
        layout: '_layout',
        components: [],
        content: `<main class="container py-5" style="padding-top:90px;">`
          + `<h1>${escapeHtml(item.title)}</h1><p>${escapeHtml(item.body)}</p></main>`
      };
      const file = path.join(ctx.outputDir, `_generated-news-${slug}.json`);
      fs.writeFileSync(file, JSON.stringify(pageConfig, null, 2));
      written.push(file);
    });
    console.log(`[NEWS] Generated ${written.length} news page(s)`);
    return written;
  }
};
