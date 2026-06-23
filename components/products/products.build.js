// Products Component Build Script
// Scans product folders and builds product cards

const fs = require('fs');
const path = require('path');
const { slugify } = require('../../lib/slugify');
const { raw } = require('../../lib/html');

/**
 * Build the Products component
 * @param {object} vars - Component variables
 * @param {function} loadComponent - Function to load component files
 * @param {function} replaceVariables - Function to replace variables in template
 * @returns {string} - Compiled HTML
 */
function build(vars, loadComponent, replaceVariables) {
  const productsDir = vars.PRODUCTS_DIR || 'build/products';  // Read from build after collections copied
  const buttonText = vars.BUTTON_TEXT || 'View Details';

  // Pagination: number of cards shown per page (configured in advance via page JSON).
  // 0 or unset = pagination disabled (all products on one page).
  const perPage = parseInt(vars.PRODUCTS_PER_PAGE, 10);
  vars.PRODUCTS_PER_PAGE = Number.isFinite(perPage) && perPage > 0 ? perPage : 0;
  
  // Load the productCard template
  const productCardTemplate = loadComponent('productCard');
  
  // Build products HTML
  let productsHtml = '';
  
  // Check if products directory exists
  if (!fs.existsSync(productsDir)) {
    console.log(`  [PRODUCTS] Directory not found: ${productsDir}`);
    productsHtml = '<div class="col-12"><p class="text-center text-muted">No products available</p></div>';
  } else {
    // Get all subdirectories in products folder
    const productFolders = fs.readdirSync(productsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    if (productFolders.length === 0) {
      console.log(`  [PRODUCTS] No product folders found in ${productsDir}/`);
      productsHtml = '<div class="col-12"><p class="text-center text-muted">No products available</p></div>';
    } else {
      console.log(`  [PRODUCTS] Found ${productFolders.length} product(s)`);
      
      // Process each product folder
      productFolders.forEach(folderName => {
        const productPath = path.join(productsDir, folderName);
        const configPath = path.join(productPath, 'product.json');
        
        // Check if product.json exists
        if (!fs.existsSync(configPath)) {
          console.log(`  [WARNING] No product.json in ${folderName}/`);
          return;
        }
        
        try {
          // Load product configuration
          const productConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

          // Selector-/URL-safe id derived from the folder name. Used for the
          // carousel element id and the detail-page link; the generator slugs
          // the same way so the link matches the generated page. Image src
          // paths below keep the real folder name (the actual directory).
          const productId = slugify(folderName);

          // Find all images in the folder
          const files = fs.readdirSync(productPath);
          const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
          const imageFiles = files.filter(file => 
            imageExtensions.some(ext => file.toLowerCase().endsWith(ext))
          );
          
          if (imageFiles.length === 0) {
            console.log(`  [WARNING] No images found in ${folderName}/`);
            return;
          }
          
          // Build carousel images HTML
          let carouselImagesHtml = '';
          imageFiles.forEach((imageFile, index) => {
            // Remove 'build/' prefix from path for HTML output
            const htmlPath = productsDir.replace(/^build\//, '');
            const imagePath = `${htmlPath}/${folderName}/${imageFile}`;
            const activeClass = index === 0 ? 'active' : '';
            carouselImagesHtml += `
          <div class="carousel-item ${activeClass}">
            <img src="${imagePath}" class="d-block w-100 product-image" alt="${productConfig.name || 'Product'}" loading="lazy" decoding="async">
          </div>`;
          });
          
          // Build carousel controls (only if multiple images)
          let carouselControlsHtml = '';
          if (imageFiles.length > 1) {
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
          ${imageFiles.map((_, i) => `<button type="button" data-bs-target="#carousel-${productId}" data-bs-slide-to="${i}" ${i === 0 ? 'class="active"' : ''}></button>`).join('')}
        </div>`;
          }
          
          // Prepare product card variables
          const cardVars = {
            PRODUCT_ID: productId,
            CAROUSEL_IMAGES: raw(carouselImagesHtml),
            CAROUSEL_CONTROLS: raw(carouselControlsHtml),
            PRODUCT_NAME: productConfig.name || 'Untitled Product',
            PRODUCT_DESCRIPTION: productConfig.description || '',
            PRODUCT_PRICE: productConfig.price || 'Price not available',
            PRODUCT_LINK: `product-${productId}.html`, // Link to generated product page
            BUTTON_TEXT: buttonText
          };
          
          // Build the product card
          const cardHtml = replaceVariables(productCardTemplate, cardVars);
          productsHtml += cardHtml + '\n';
          
        } catch (error) {
          console.log(`  [ERROR] Failed to process ${folderName}:`, error.message);
        }
      });
    }
  }
  
  // Add the generated products to vars
  vars.PRODUCTS_HTML = raw(productsHtml);
  
  // Load and return the main products component
  const productsTemplate = loadComponent('products');
  return replaceVariables(productsTemplate, vars);
}

module.exports = { build };