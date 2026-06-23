// Global state
let currentCollection = '';
let collections = [];
let products = [];
let productToDelete = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadCollections();
});

// Load collections from database.json
async function loadCollections() {
  try {
    const response = await fetch('/api/collections');
    collections = await response.json();
    
    const nav = document.getElementById('collectionsNav');
    nav.innerHTML = '';
    
    collections.forEach((collection, index) => {
      const link = document.createElement('a');
      link.className = `nav-link ${index === 0 ? 'active' : ''}`;
      link.href = '#';
      link.innerHTML = `<i class="bi bi-folder"></i> ${collection.name}`;
      link.onclick = (e) => {
        e.preventDefault();
        selectCollection(collection.name);
        
        // Update active state
        document.querySelectorAll('#collectionsNav .nav-link').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
      };
      nav.appendChild(link);
    });
    
    // Load first collection by default
    if (collections.length > 0) {
      selectCollection(collections[0].name);
    }
  } catch (error) {
    console.error('Error loading collections:', error);
    alert('Error loading collections: ' + error.message);
  }
}

// Select collection and load its products
async function selectCollection(collectionName) {
  currentCollection = collectionName;
  document.getElementById('pageTitle').textContent = collectionName.charAt(0).toUpperCase() + collectionName.slice(1);
  loadProducts(collectionName);
}

// Load products from collection
async function loadProducts(collectionName) {
  try {
    const response = await fetch(`/api/products/${collectionName}`);
    products = await response.json();
    
    document.getElementById('productCount').textContent = `${products.length} product${products.length !== 1 ? 's' : ''}`;
    
    const tbody = document.getElementById('productsTableBody');
    tbody.innerHTML = '';
    
    if (products.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center py-5">
            <i class="bi bi-inbox" style="font-size: 3rem; color: #ccc;"></i>
            <p class="text-muted mt-3">No products yet. Click "New Product" to create one.</p>
          </td>
        </tr>
      `;
      return;
    }
    
    products.forEach(product => {
      const row = document.createElement('tr');
      row.onclick = () => editProduct(collectionName, product.id);
      
      // Truncate description to 80 characters
      const truncatedDesc = product.description.length > 80 
        ? product.description.substring(0, 80) + '...' 
        : product.description;
      
      row.innerHTML = `
        <td><code class="text-primary">${product.id}</code></td>
        <td>
          <strong>${product.name}</strong>
          ${product.images && product.images.length > 0 ? 
            `<span class="badge bg-info ms-2" title="${product.images.length} images">
              <i class="bi bi-images"></i> ${product.images.length}
            </span>` : 
            ''
          }
        </td>
        <td><strong class="text-success">${product.price}</strong></td>
        <td class="description-cell" title="${product.description}">${truncatedDesc}</td>
        <td class="text-center">
          <div class="action-buttons">
            <button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); editProduct('${collectionName}', '${product.id}')" title="Edit">
              <i class="bi bi-pencil"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation(); showDeleteModal(event, '${collectionName}', '${product.id}', '${product.name}')" title="Delete">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </td>
      `;
      
      tbody.appendChild(row);
    });
  } catch (error) {
    console.error('Error loading products:', error);
    alert('Error loading products: ' + error.message);
  }
}

// Show create product modal
function showCreateProductModal() {
  if (!currentCollection) {
    alert('Please select a collection first');
    return;
  }
  
  document.getElementById('modalTitle').textContent = `Create Product in "${currentCollection}"`;
  document.getElementById('saveButtonText').textContent = 'Create Product';
  document.getElementById('productMode').value = 'create';
  document.getElementById('productCollection').value = currentCollection;
  
  // Reset form
  document.getElementById('productForm').reset();
  document.getElementById('productId').disabled = false;
  
  // Enable Generate button for new products
  const generateBtn = document.getElementById('generateIdBtn');
  generateBtn.disabled = false;
  generateBtn.classList.remove('disabled');
  
  // IMPORTANT: Clear file input and preview container
  document.getElementById('productImages').value = '';
  document.getElementById('imagePreviewContainer').innerHTML = '';
  
  // Reset labels for create mode
  document.getElementById('imageUploadLabel').textContent = 'Images';
  document.getElementById('imageUploadBadge').style.display = 'none';
  document.getElementById('imageUploadHelp').textContent = 'Select images to upload (JPG, PNG, GIF, WebP)';
  
  // Generate ID suggestions
  generateIdSuggestions();
  
  // Show which collection we're creating in
  const collectionInfo = document.createElement('div');
  collectionInfo.className = 'alert alert-info';
  collectionInfo.id = 'collectionInfoAlert';
  collectionInfo.innerHTML = `<i class="bi bi-info-circle"></i> Creating product in collection: <strong>${currentCollection}</strong>`;
  
  // Insert at top of form
  const form = document.getElementById('productForm');
  const existingAlert = document.getElementById('collectionInfoAlert');
  if (existingAlert) {
    existingAlert.remove();
  }
  
  const firstElement = form.firstElementChild;
  if (firstElement) {
    form.insertBefore(collectionInfo, firstElement);
  } else {
    form.appendChild(collectionInfo);
  }
  
  const modal = new bootstrap.Modal(document.getElementById('productModal'));
  modal.show();
}

// Simple hash function for generating IDs
function simpleHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i); // hash * 33 + c
  }
  return Math.abs(hash);
}

// Generate a 20-char, letter-leading id from a timestamp + random salt.
// An optional seed lets callers produce distinct ids within a tight loop.
function makeHashId(seed = '') {
  const uniqueString = `${Date.now()}${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}${seed}`;

  let hashStr = '';
  for (let i = 0; i < uniqueString.length; i += 3) {
    const chunk = uniqueString.substring(i, i + 3);
    const charCodes = chunk.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const hashChar = (charCodes * 7919 + i * 31) % 36;
    hashStr += hashChar.toString(36);
  }

  // Pad to at least 20 chars, then take exactly 20.
  while (hashStr.length < 20) {
    hashStr += simpleHash(hashStr + Date.now() + seed).toString(36);
  }
  let id = hashStr.substring(0, 20);

  // Ensure it starts with a letter (a-z).
  if (!/^[a-z]/.test(id)) {
    id = String.fromCharCode(97 + (parseInt(id.substring(0, 2), 36) % 26)) + id.substring(1);
  }
  return id;
}

// Generate a product ID into the form field.
function generateProductId() {
  document.getElementById('productId').value = makeHashId();
}

// Generate three clickable ID suggestions.
function generateIdSuggestions() {
  const suggestionsContainer = document.getElementById('idSuggestions');
  const suggestionsList = document.getElementById('idSuggestionsList');

  const suggestions = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    suggestions.push(makeHashId(String(attempt)));
  }

  suggestionsList.innerHTML = '';
  suggestions.forEach(suggestion => {
    const badge = document.createElement('span');
    badge.className = 'badge bg-secondary';
    badge.style.cursor = 'pointer';
    badge.textContent = suggestion;
    badge.title = 'Click to use this ID';
    badge.onclick = () => {
      document.getElementById('productId').value = suggestion;
    };
    suggestionsList.appendChild(badge);
  });

  suggestionsContainer.style.display = suggestions.length > 0 ? 'block' : 'none';
}

// Render the "Existing Images" previews into a container. Pass emptyMessage to
// show a note when there are no images (otherwise the container is just cleared).
function renderImagePreviews(container, images, collection, productId, emptyMessage) {
  container.innerHTML = '';

  if (images && images.length > 0) {
    const title = document.createElement('h6');
    title.className = 'mt-3 mb-2 text-primary';
    title.innerHTML = '<i class="bi bi-images"></i> Existing Images:';
    container.appendChild(title);

    images.forEach(image => {
      const preview = document.createElement('div');
      preview.className = 'image-preview';
      preview.innerHTML = `
        <img src="${image.path}" alt="${image.name}">
        <button type="button" class="btn btn-danger btn-sm btn-delete" onclick="deleteImage(event, '${collection}', '${productId}', '${image.name}')">
          <i class="bi bi-x"></i>
        </button>
      `;
      container.appendChild(preview);
    });
  } else if (emptyMessage) {
    container.innerHTML = `<p class="text-muted">${emptyMessage}</p>`;
  }
}

// Edit product
async function editProduct(collection, productId) {
  try {
    const response = await fetch(`/api/products/${collection}/${productId}`);
    const product = await response.json();
    
    document.getElementById('modalTitle').textContent = `Edit Product: ${product.name}`;
    document.getElementById('saveButtonText').textContent = 'Update Product';
    document.getElementById('productMode').value = 'edit';
    document.getElementById('productCollection').value = collection;
    
    document.getElementById('productId').value = product.id;
    document.getElementById('productId').disabled = true;
    
    // Disable Generate button when editing (ID cannot change)
    const generateBtn = document.getElementById('generateIdBtn');
    generateBtn.disabled = true;
    generateBtn.classList.add('disabled');
    
    document.getElementById('productName').value = product.name;
    document.getElementById('productPrice').value = product.price;
    document.getElementById('productDescription').value = product.description;
    document.getElementById('productDetails').value = product.details || '';
    
    // IMPORTANT: Clear the file input to prevent uploading old files
    const imageInput = document.getElementById('productImages');
    imageInput.value = '';
    
    // Hide ID suggestions when editing
    document.getElementById('idSuggestions').style.display = 'none';
    
    // Update labels for edit mode
    document.getElementById('imageUploadLabel').textContent = 'Add New Images';
    document.getElementById('imageUploadBadge').style.display = 'inline';
    document.getElementById('imageUploadHelp').textContent = 'Upload additional images to this product (optional)';
    
    // Show existing images
    const previewContainer = document.getElementById('imagePreviewContainer');
    renderImagePreviews(previewContainer, product.images, collection, productId);
    
    const modal = new bootstrap.Modal(document.getElementById('productModal'));
    modal.show();
  } catch (error) {
    console.error('Error loading product:', error);
    alert('Error loading product: ' + error.message);
  }
}

// Save product (create or update)
async function saveProduct() {
  const mode = document.getElementById('productMode').value;
  const collection = document.getElementById('productCollection').value;
  const id = document.getElementById('productId').value.trim();
  const name = document.getElementById('productName').value.trim();
  const price = document.getElementById('productPrice').value.trim();
  const description = document.getElementById('productDescription').value.trim();
  const details = document.getElementById('productDetails').value.trim();
  
  console.log('Saving product:', { mode, collection, id, name, price });
  
  if (!collection) {
    alert('No collection selected. Please select a collection from the sidebar first.');
    return;
  }
  
  if (!id || !name || !price || !description) {
    alert('Please fill in all required fields');
    return;
  }
  
  // Validate ID format
  if (!/^[a-z0-9-]+$/.test(id)) {
    alert('Product ID must contain only lowercase letters, numbers, and hyphens');
    return;
  }
  
  try {
    const productData = { id, name, price, description, details };
    
    let response;
    if (mode === 'create') {
      console.log(`Creating product in collection: ${collection}`);
      response = await fetch(`/api/products/${collection}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productData)
      });
    } else {
      console.log(`Updating product ${id} in collection: ${collection}`);
      response = await fetch(`/api/products/${collection}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productData)
      });
    }
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || 'Failed to save product');
    }
    
    console.log('Product saved successfully:', result);
    
    // Upload images if any
    const imageInput = document.getElementById('productImages');
    if (imageInput.files.length > 0) {
      console.log(`Uploading ${imageInput.files.length} images...`);
      await uploadImages(collection, id, imageInput.files);
    }
    
    // Close modal and reload products
    bootstrap.Modal.getInstance(document.getElementById('productModal')).hide();
    loadProducts(collection);
    
    alert(mode === 'create' ? 'Product created successfully!' : 'Product updated successfully!');
  } catch (error) {
    console.error('Error saving product:', error);
    alert('Error saving product: ' + error.message);
  }
}

// Upload images
async function uploadImages(collection, productId, files) {
  for (let file of files) {
    const formData = new FormData();
    formData.append('image', file);
    // Don't send collection and productId in body - they're in the URL
    
    try {
      const response = await fetch(`/api/products/${collection}/${productId}/upload`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      alert(`Error uploading ${file.name}: ${error.message}`);
    }
  }
}

// Delete image
async function deleteImage(event, collection, productId, filename) {
  event.stopPropagation();
  
  if (!confirm(`Delete image ${filename}?`)) {
    return;
  }
  
  try {
    const response = await fetch(`/api/products/${collection}/${productId}/images/${filename}`, {
      method: 'DELETE'
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || 'Failed to delete image');
    }
    
    console.log('Image deleted successfully');
    
    // Instead of reloading the entire modal, just refresh the image preview
    await refreshProductImages(collection, productId);
    
  } catch (error) {
    console.error('Error deleting image:', error);
    alert('Error deleting image: ' + error.message);
  }
}

// Refresh product images in the modal without reloading entire modal
async function refreshProductImages(collection, productId) {
  try {
    const response = await fetch(`/api/products/${collection}/${productId}`);
    const product = await response.json();
    
    // Update the image preview container only
    const previewContainer = document.getElementById('imagePreviewContainer');
    renderImagePreviews(previewContainer, product.images, collection, productId, 'No images. Upload images above to add them to this product.');
  } catch (error) {
    console.error('Error refreshing images:', error);
  }
}

// Show delete confirmation modal
function showDeleteModal(event, collection, productId, productName) {
  event.stopPropagation();
  
  productToDelete = { collection, productId };
  document.getElementById('deleteProductName').textContent = productName;
  
  const modal = new bootstrap.Modal(document.getElementById('deleteModal'));
  modal.show();
}

// Confirm delete
async function confirmDelete() {
  if (!productToDelete) return;
  
  try {
    const response = await fetch(`/api/products/${productToDelete.collection}/${productToDelete.productId}`, {
      method: 'DELETE'
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || 'Failed to delete product');
    }
    
    // Close modal and reload products
    bootstrap.Modal.getInstance(document.getElementById('deleteModal')).hide();
    loadProducts(productToDelete.collection);
    productToDelete = null;
    
    alert('Product deleted successfully!');
  } catch (error) {
    console.error('Error deleting product:', error);
    alert('Error deleting product: ' + error.message);
  }
}