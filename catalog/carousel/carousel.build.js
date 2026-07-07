// Carousel component. Renders image slides + a thumbnail strip from an IMAGES array of web paths
// (typically a collection item's $images, passed via per-item component vars), using ALT for the
// alt text. The prev/next controls and indicators are injected client-side by script.js (which reads
// each carousel's own id), so the build emits only the data-derived markup; Bootstrap (loaded by the
// layout) drives the sliding.
//   vars: { IMAGES: string[], ALT?: string, CAROUSEL_ID?: string }
function build(vars, loadComponent, replaceVariables, helpers) {
  const { raw, escapeHtml } = helpers;
  const images = Array.isArray(vars.IMAGES) ? vars.IMAGES : [];
  const alt = escapeHtml(vars.ALT || '');

  // A per-instance DOM id, so two carousels on one page don't collide (shared id + thumbnails that all
  // drive the first one). Prefer an explicit CAROUSEL_ID, else derive from ALT (usually the item name),
  // else a short stable hash of the image paths.
  const id = carouselId(vars, images, helpers.slugify);

  const slides = images.map((src, i) => `
            <div class="carousel-item ${i === 0 ? 'active' : ''}">
              <img src="${src}" class="d-block w-100" alt="${alt}" loading="lazy" decoding="async">
            </div>`).join('');

  // Thumbnails only make sense with more than one image; each targets THIS carousel by id.
  const thumbnails = images.length > 1
    ? images.map((src, i) => `
            <img src="${src}" alt="${alt}" class="thumbnail-image" data-bs-target="#${id}" data-bs-slide-to="${i}" loading="lazy" decoding="async">`).join('')
    : '';

  return replaceVariables(loadComponent('carousel'), {
    CAROUSEL_ID: id,
    CAROUSEL_SLIDES: raw(slides),
    THUMBNAIL_IMAGES: raw(thumbnails)
  });
}

// A selector-safe, unique-per-instance carousel id. slugify (engine helper) makes it [a-z0-9-]; a
// fallback lowercase slug keeps it working if slugify isn't passed.
function carouselId(vars, images, slugify) {
  const slug = (s) => (typeof slugify === 'function' ? slugify(String(s))
    : String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item');
  if (vars.CAROUSEL_ID) return slug(vars.CAROUSEL_ID);
  if (vars.ALT) return `carousel-${slug(vars.ALT)}`;
  let h = 0;
  for (const s of images) for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `carousel-${(h >>> 0).toString(36)}`;
}

module.exports = { build };
