// Product Pages Build Script
// Automatically generates a page for each product

const fs = require('fs');
const path = require('path');
const { slugify } = require('../lib/slugify');
const { escapeHtml } = require('../lib/html');

/**
 * Generate product detail pages
 * This script is called during the build process to create individual pages for each product
 */
function generateProductPages(outputDir) {
  const productsDir = 'build/custom';
  // Template ships with the engine, next to this generator.
  const templateFile = path.join(__dirname, '_custom-detail-template.html');
  // Generated page JSON goes to a build scratch dir, not the pages/ source tree.
  const generatedDir = outputDir || path.join('build', '_generated-pages');

  console.log('[CUSTOM-PAGES] Generating individual product pages...');

  // Check if products directory exists
  if (!fs.existsSync(productsDir)) {
    console.log('[CUSTOM-PAGES] No products directory found, skipping...');
    return [];
  }

  // Check if template exists
  if (!fs.existsSync(templateFile)) {
    console.log('[CUSTOM-PAGES] Template not found, skipping...');
    return [];
  }

  // Load the template
  const template = fs.readFileSync(templateFile, 'utf8');

  // Ensure the output directory exists
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }

  // Get all product folders
  const productFolders = fs.readdirSync(productsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  const generatedPages = [];

  productFolders.forEach(folderName => {
    const productPath = path.join(productsDir, folderName);
    const configPath = path.join(productPath, 'product.json');

    // Skip if no product.json
    if (!fs.existsSync(configPath)) {
      return;
    }

    try {
      // Load product configuration
      const productConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

      // Selector-/URL-safe id; must match the slug used by the products
      // component so each card's "View Details" link resolves to this page.
      const productId = slugify(folderName);

      // Find all images in the folder
      const files = fs.readdirSync(productPath);
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      const imageFiles = files.filter(file =>
        imageExtensions.some(ext => file.toLowerCase().endsWith(ext))
      );

      if (imageFiles.length === 0) {
        console.log(`  [WARNING] No images in ${folderName}/`);
        return;
      }

      // Build carousel slides
      let carouselSlidesHtml = '';

      // Remove 'build/' prefix from path for HTML output
      const htmlPath = productsDir.replace(/^build\//, '');
      imageFiles.forEach((imgFile, index) => {
        const imgPath = `${htmlPath}/${folderName}/${imgFile}`;
        const activeClass = index === 0 ? 'active' : '';
        carouselSlidesHtml += `
            <div class="carousel-item ${activeClass}">
              <img src="${imgPath}" class="d-block w-100" alt="${escapeHtml(productConfig.name)}">
            </div>`;
      });

      // Build carousel controls (only if multiple images)
      let carouselControlsHtml = '';
      if (imageFiles.length > 1) {
        carouselControlsHtml = `
          <button class="carousel-control-prev" type="button" data-bs-target="#productCarousel" data-bs-slide="prev">
            <span class="carousel-control-prev-icon" aria-hidden="true"></span>
            <span class="visually-hidden">Previous</span>
          </button>
          <button class="carousel-control-next" type="button" data-bs-target="#productCarousel" data-bs-slide="next">
            <span class="carousel-control-next-icon" aria-hidden="true"></span>
            <span class="visually-hidden">Next</span>
          </button>
          <div class="carousel-indicators">
            ${imageFiles.map((_, i) => 
              `<button type="button" data-bs-target="#productCarousel" data-bs-slide-to="${i}" ${i === 0 ? 'class="active" aria-current="true"' : ''}></button>`
            ).join('')}
          </div>`;
      }

      // Generate thumbnail gallery HTML
      let thumbnailsHtml = '';
      if (imageFiles.length > 1) {
        imageFiles.forEach((imgFile, index) => {
          const imgPath = `${htmlPath}/${folderName}/${imgFile}`;
          thumbnailsHtml += `
            <img src="${imgPath}" alt="${escapeHtml(productConfig.name)}" class="thumbnail-image" data-bs-target="#productCarousel" data-bs-slide-to="${index}">
          `;
        });
      }

      // Create page configuration object
      const pageConfig = {
        page: `product-${productId}`,
        title: productConfig.name || 'Product',
        description: productConfig.description || '',
        layout: '_layout',
        header_theme: 'dark',
        components: [],
        content: template
          // HTML fragments stay raw; function replacers avoid $-sequence mangling.
          .replace(/{{CAROUSEL_SLIDES}}/g, () => carouselSlidesHtml)
          .replace(/{{CAROUSEL_CONTROLS}}/g, () => carouselControlsHtml)
          .replace(/{{THUMBNAIL_IMAGES}}/g, () => thumbnailsHtml)
          // Text fields are HTML-escaped to prevent injection.
          .replace(/{{PRODUCT_NAME}}/g, () => escapeHtml(productConfig.name || 'Untitled Product'))
          .replace(/{{PRODUCT_PRICE}}/g, () => escapeHtml(productConfig.price || 'Price not available'))
          .replace(/{{PRODUCT_DESCRIPTION}}/g, () => escapeHtml(productConfig.description || 'No description available'))
          .replace(/{{PRODUCT_DETAILS}}/g, () => escapeHtml(productConfig.details || productConfig.description || 'No additional details available'))
      };

      // Write the page JSON file to the build scratch directory
      const pageJsonPath = path.join(generatedDir, `_generated-product-${productId}.json`);
      fs.writeFileSync(pageJsonPath, JSON.stringify(pageConfig, null, 2));

      generatedPages.push(pageJsonPath);

      console.log(`  [CUSTOM-PAGES] Generated page for ${folderName}`);

    } catch (error) {
      console.log(`  [ERROR] Failed to generate page for ${folderName}:`, error.message);
    }
  });

  console.log(`[CUSTOM-PAGES] Generated ${generatedPages.length} product page(s)`);
  return generatedPages;
}

module.exports = { generateProductPages };