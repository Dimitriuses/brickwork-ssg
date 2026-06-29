// Carousel component. Renders image slides + a thumbnail strip from an IMAGES array of web paths
// (typically a collection item's $images, passed via per-item component vars), using ALT for the
// alt text. The prev/next controls and indicators are injected client-side by script.js, so the
// build emits only the data-derived markup; Bootstrap (loaded by the layout) drives the sliding.
//   vars: { IMAGES: string[], ALT?: string }
function build(vars, loadComponent, replaceVariables, helpers) {
  const { raw, escapeHtml } = helpers;
  const images = Array.isArray(vars.IMAGES) ? vars.IMAGES : [];
  const alt = escapeHtml(vars.ALT || '');

  const slides = images.map((src, i) => `
            <div class="carousel-item ${i === 0 ? 'active' : ''}">
              <img src="${src}" class="d-block w-100" alt="${alt}" loading="lazy" decoding="async">
            </div>`).join('');

  // Thumbnails only make sense with more than one image.
  const thumbnails = images.length > 1
    ? images.map((src, i) => `
            <img src="${src}" alt="${alt}" class="thumbnail-image" data-bs-target="#productCarousel" data-bs-slide-to="${i}" loading="lazy" decoding="async">`).join('')
    : '';

  return replaceVariables(loadComponent('carousel'), {
    CAROUSEL_SLIDES: raw(slides),
    THUMBNAIL_IMAGES: raw(thumbnails)
  });
}

module.exports = { build };
