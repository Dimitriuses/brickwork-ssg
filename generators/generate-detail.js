// Built-in data-only generator. Reads the engine-resolved `ctx.collection.items` (each
// `{ id, item }`, where `item.data` is the parsed data file and `item.images` is the array of
// web paths) and returns one detail-page descriptor per item. No file I/O - surfacing and the
// copy/leak control are handled by the collection's `data_model`. Registered as both
// "products" and "custom" (they differ only by source + template).
//   generate(ctx) -> [{ slug, title, description, vars }]
module.exports = {
  generate(ctx) {
    const { escapeHtml, raw } = ctx.lib;

    return ctx.collection.items.map(({ id, item }) => {
      const data = (item && item.data) || {};
      const images = (item && Array.isArray(item.images)) ? item.images : [];
      const name = data.name || 'Untitled';

      const slides = images.map((src, i) => `
            <div class="carousel-item ${i === 0 ? 'active' : ''}">
              <img src="${src}" class="d-block w-100" alt="${escapeHtml(name)}" loading="lazy" decoding="async">
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
        thumbnails = images.map((src, i) => `
            <img src="${src}" alt="${escapeHtml(name)}" class="thumbnail-image" data-bs-target="#productCarousel" data-bs-slide-to="${i}" loading="lazy" decoding="async">`).join('');
      }

      return {
        slug: id,
        title: name,
        description: data.description || '',
        vars: {
          // HTML fragments insert verbatim; text fields are escaped by the engine.
          CAROUSEL_SLIDES: raw(slides),
          CAROUSEL_CONTROLS: raw(controls),
          THUMBNAIL_IMAGES: raw(thumbnails),
          PRODUCT_NAME: name,
          PRODUCT_PRICE: data.price || 'Price not available',
          PRODUCT_DESCRIPTION: data.description || 'No description available',
          PRODUCT_DETAILS: data.details || data.description || 'No additional details available'
        }
      };
    });
  }
};
