// Built-in data-only generator (restructure). Turns a collection of item folders
// (each with a product.json + image files) into detail-page item descriptors for a
// product/custom detail template. Registered under both "products" and "custom" -
// the two former built-ins differed only by source folder, now externalized to
// generatorOptions.source, so one generator serves both template pages.
//
//   generate(ctx, options) -> [{ slug, title, description, vars }]
//   ctx.collection = { dir, webPath }  (the source collection's post-copy build folder)
const fs = require('fs');
const path = require('path');

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

module.exports = {
  generate(ctx, options) {
    const { slugify, escapeHtml, raw } = ctx.lib;
    const { dir, webPath } = ctx.collection;
    if (!dir || !fs.existsSync(dir)) return [];

    const items = [];
    fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .forEach(entry => {
        const folder = entry.name;
        const itemDir = path.join(dir, folder);
        const configPath = path.join(itemDir, 'product.json');
        if (!fs.existsSync(configPath)) return;

        let cfg;
        try {
          cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (error) {
          console.log(`  [WARNING] ${folder}/product.json: ${error.message}`);
          return;
        }

        const images = fs.readdirSync(itemDir)
          .filter(file => IMAGE_EXTS.some(ext => file.toLowerCase().endsWith(ext)));
        if (images.length === 0) {
          console.log(`  [WARNING] No images in ${folder}/`);
          return;
        }

        const name = cfg.name || 'Untitled';
        const src = img => `${webPath}/${folder}/${img}`;

        const slides = images.map((img, i) => `
            <div class="carousel-item ${i === 0 ? 'active' : ''}">
              <img src="${src(img)}" class="d-block w-100" alt="${escapeHtml(name)}" loading="lazy" decoding="async">
            </div>`).join('');

        let controls = '';
        if (images.length > 1) {
          controls = `
          <button class="carousel-control-prev" type="button" data-bs-target="#productCarousel" data-bs-slide="prev">
            <span class="carousel-control-prev-icon" aria-hidden="true"></span>
            <span class="visually-hidden">Previous</span>
          </button>
          <button class="carousel-control-next" type="button" data-bs-target="#productCarousel" data-bs-slide="next">
            <span class="carousel-control-next-icon" aria-hidden="true"></span>
            <span class="visually-hidden">Next</span>
          </button>
          <div class="carousel-indicators">
            ${images.map((_, i) =>
              `<button type="button" data-bs-target="#productCarousel" data-bs-slide-to="${i}" ${i === 0 ? 'class="active" aria-current="true"' : ''}></button>`
            ).join('')}
          </div>`;
        }

        let thumbnails = '';
        if (images.length > 1) {
          thumbnails = images.map((img, i) => `
            <img src="${src(img)}" alt="${escapeHtml(name)}" class="thumbnail-image" data-bs-target="#productCarousel" data-bs-slide-to="${i}" loading="lazy" decoding="async">`).join('');
        }

        items.push({
          slug: slugify(folder),
          title: name,
          description: cfg.description || '',
          vars: {
            // HTML fragments insert verbatim; text fields are escaped by the engine.
            CAROUSEL_SLIDES: raw(slides),
            CAROUSEL_CONTROLS: raw(controls),
            THUMBNAIL_IMAGES: raw(thumbnails),
            PRODUCT_NAME: name,
            PRODUCT_PRICE: cfg.price || 'Price not available',
            PRODUCT_DESCRIPTION: cfg.description || 'No description available',
            PRODUCT_DETAILS: cfg.details || cfg.description || 'No additional details available'
          }
        });
      });

    return items;
  }
};
