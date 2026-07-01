// Products Component Build Script
// Builds the product grid from a collection's resolved data model (the same items generators see
// via ctx.collection.items, reached here through the `collection` helper). Reading the model - not
// raw files under build/ - keeps the grid correct when data files are not copied into the output
// (data_model `copy: false`): image paths come from the model's `images` part, and name/price/
// description from its `data` part.
const { raw, escapeHtml } = require('../../lib/html');

function build(vars, loadComponent, replaceVariables, helpers) {
  const collectionName = vars.COLLECTION || 'products';
  const buttonText = vars.BUTTON_TEXT || 'View Details';

  // Pagination: number of cards shown per page (configured via page JSON).
  // 0 or unset = pagination disabled (all products on one page).
  const perPage = parseInt(vars.PRODUCTS_PER_PAGE, 10);
  vars.PRODUCTS_PER_PAGE = Number.isFinite(perPage) && perPage > 0 ? perPage : 0;

  const productCardTemplate = loadComponent('productCard');

  // Resolve the collection through the data model (engine-provided helper).
  const resolved = (helpers && typeof helpers.collection === 'function') ? helpers.collection(collectionName) : null;
  const items = (resolved && resolved.items) || [];
  // Scoped logger from the engine (provenance auto-filled); no-op fallback for older engines.
  const log = (helpers && helpers.log) || { debug() {}, warn() {} };

  let productsHtml = '';

  if (items.length === 0) {
    log.warn(`No items in collection "${collectionName}"`);
    productsHtml = '<div class="col-12"><p class="text-center text-muted">No products available</p></div>';
  } else {
    log.debug(`  [PRODUCTS] Found ${items.length} product(s)`);

    items.forEach(({ id, item }) => {
      const data = (item && item.data) || {};
      const images = (item && Array.isArray(item.images)) ? item.images : [];

      if (images.length === 0) {
        log.warn(`No images for "${id}" in collection "${collectionName}"`);
      }

      // `id` is the engine's canonical, URL-safe item slug (respects data.slug); the detail
      // page is generated under the same slug, so the link below matches.
      const productId = id;
      const name = data.name || 'Untitled Product';

      // Build carousel images HTML
      let carouselImagesHtml = '';
      images.forEach((src, index) => {
        const activeClass = index === 0 ? 'active' : '';
        carouselImagesHtml += `
          <div class="carousel-item ${activeClass}">
            <img src="${src}" class="d-block w-100 product-image" alt="${escapeHtml(name)}" loading="lazy" decoding="async">
          </div>`;
      });

      // Build carousel controls (only if multiple images)
      let carouselControlsHtml = '';
      if (images.length > 1) {
        carouselControlsHtml = `
        <button class="carousel-control-prev" type="button" data-bs-target="#carousel-${productId}" data-bs-slide="prev">
          <span class="carousel-control-prev-icon" aria-hidden="true"></span>
          <span class="visually-hidden">Previous</span>
        </button>
        <button class="carousel-control-next" type="button" data-bs-target="#carousel-${productId}" data-bs-slide="next">
          <span class="carousel-control-next-icon" aria-hidden="true"></span>
          <span class="visually-hidden">Next</span>
        </button>
        <div class="carousel-indicators">
          ${images.map((_, i) => `<button type="button" data-bs-target="#carousel-${productId}" data-bs-slide-to="${i}" ${i === 0 ? 'class="active"' : ''}></button>`).join('')}
        </div>`;
      }

      const cardVars = {
        PRODUCT_ID: productId,
        CAROUSEL_IMAGES: raw(carouselImagesHtml),
        CAROUSEL_CONTROLS: raw(carouselControlsHtml),
        PRODUCT_NAME: name,
        PRODUCT_DESCRIPTION: data.description || '',
        PRODUCT_PRICE: data.price || 'Price not available',
        PRODUCT_LINK: `product-${productId}.html`, // Link to the generated detail page
        BUTTON_TEXT: buttonText
      };

      productsHtml += replaceVariables(productCardTemplate, cardVars) + '\n';
    });
  }

  // Add the generated products to vars
  vars.PRODUCTS_HTML = raw(productsHtml);

  // Load and return the main products component
  const productsTemplate = loadComponent('products');
  return replaceVariables(productsTemplate, vars);
}

module.exports = { build };
