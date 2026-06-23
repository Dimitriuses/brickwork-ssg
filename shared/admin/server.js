const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware. The admin UI assets ship with the engine, so resolve them
// relative to this file rather than the working directory.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Paths. The site being managed is the working directory (set by the CLI:
// `ssg admin --site <dir>`), so its data lives under cwd, not the engine.
const ROOT_DIR = process.cwd();
const DATABASE_PATH = path.join(ROOT_DIR, 'shared/database.json');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      // Validates :id and keeps the path inside the collection directory
      const productPath = getProductPath(req.params.collection, req.params.id);

      if (!fs.existsSync(productPath)) {
        fs.mkdirSync(productPath, { recursive: true });
      }

      cb(null, productPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: function (req, file, cb) {
    // Strip any directory component so an originalname like "../../x" cannot
    // escape the destination folder.
    const safeName = path.basename(file.originalname || '');
    if (!isSafeSegment(safeName)) {
      return cb(badRequest('Invalid filename'));
    }
    cb(null, safeName);
  }
});

const upload = multer({ storage: storage });

// Helper function to get collection path from database.json
function getCollectionPath(collectionName) {
  const database = JSON.parse(fs.readFileSync(DATABASE_PATH, 'utf8'));
  const collection = database.collections.find(c => c.name === collectionName);
  
  if (!collection) {
    throw new Error(`Collection ${collectionName} not found`);
  }
  
  return path.join(ROOT_DIR, collection.source);
}

// --- Path-traversal hardening -------------------------------------------------
// :id and :filename come from the URL (or request body) and flow into fs calls
// like rmSync/unlinkSync/writeFile. A value such as ".." or "a/b" could escape
// the collection directory, so every untrusted path segment goes through these.

// A 400 error whose status is honored by the route catch blocks.
function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

// True only for a single, safe path segment (no separators, no traversal).
function isSafeSegment(segment) {
  return typeof segment === 'string'
    && segment.length > 0
    && !segment.includes('/')
    && !segment.includes('\\')
    && !segment.includes('\0')
    && segment !== '.'
    && segment !== '..';
}

// Resolve `segments` under `baseDir` and assert the result stays inside it.
function resolveWithin(baseDir, ...segments) {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, ...segments);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw badRequest('Resolved path escapes its collection directory');
  }
  return target;
}

// Validated absolute path to a product folder inside its collection.
function getProductPath(collectionName, productId) {
  if (!isSafeSegment(productId)) {
    throw badRequest('Invalid product id');
  }
  return resolveWithin(getCollectionPath(collectionName), productId);
}

// Validated absolute path to an image file inside a product folder.
function getImagePath(collectionName, productId, filename) {
  if (!isSafeSegment(filename)) {
    throw badRequest('Invalid filename');
  }
  return resolveWithin(getProductPath(collectionName, productId), filename);
}
// -----------------------------------------------------------------------------

// Get all collections from database.json
app.get('/api/collections', (req, res) => {
  try {
    const database = JSON.parse(fs.readFileSync(DATABASE_PATH, 'utf8'));
    const enabledCollections = database.collections.filter(c => c.enabled);
    res.json(enabledCollections);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Get all products from a collection
app.get('/api/products/:collection', (req, res) => {
  try {
    const collectionPath = getCollectionPath(req.params.collection);
    
    if (!fs.existsSync(collectionPath)) {
      return res.json([]);
    }
    
    const folders = fs.readdirSync(collectionPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    const products = [];
    
    folders.forEach(folderName => {
      const productPath = path.join(collectionPath, folderName);
      const configPath = path.join(productPath, 'product.json');
      
      if (fs.existsSync(configPath)) {
        try {
          const productData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          
          // Get images
          const files = fs.readdirSync(productPath);
          const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
          const images = files.filter(file => 
            imageExtensions.some(ext => file.toLowerCase().endsWith(ext))
          );
          
          products.push({
            id: folderName,
            ...productData,
            images: images,
            imagePath: images.length > 0 ? `../../${req.params.collection}/${folderName}/${images[0]}` : null
          });
        } catch (error) {
          console.error(`Error reading ${folderName}:`, error.message);
        }
      }
    });
    
    res.json(products);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Get single product
app.get('/api/products/:collection/:id', (req, res) => {
  try {
    const productPath = getProductPath(req.params.collection, req.params.id);
    const configPath = path.join(productPath, 'product.json');

    if (!fs.existsSync(configPath)) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const productData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    // Get images
    const files = fs.readdirSync(productPath);
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const images = files.filter(file => 
      imageExtensions.some(ext => file.toLowerCase().endsWith(ext))
    );
    
    res.json({
      id: req.params.id,
      ...productData,
      images: images.map(img => ({
        name: img,
        path: `../../${req.params.collection}/${req.params.id}/${img}`
      }))
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Create new product
app.post('/api/products/:collection', (req, res) => {
  try {
    const { id, name, price, description, details } = req.body;

    // New product ids must be clean slugs - matches the client and the builder's
    // slugify scheme, and inherently blocks path traversal.
    if (!/^[a-z0-9-]+$/.test(String(id || ''))) {
      return res.status(400).json({ error: 'Product ID must contain only lowercase letters, numbers, and hyphens' });
    }

    const productPath = getProductPath(req.params.collection, id);

    // Check if product already exists
    if (fs.existsSync(productPath)) {
      return res.status(400).json({ error: 'Product with this ID already exists' });
    }
    
    // Create product folder
    fs.mkdirSync(productPath, { recursive: true });
    
    // Create product.json
    const productData = {
      name,
      price,
      description,
      details: details || description
    };
    
    fs.writeFileSync(
      path.join(productPath, 'product.json'),
      JSON.stringify(productData, null, 2)
    );
    
    res.json({ success: true, id, ...productData });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Update product
app.put('/api/products/:collection/:id', (req, res) => {
  try {
    const { name, price, description, details } = req.body;
    const productPath = getProductPath(req.params.collection, req.params.id);
    const configPath = path.join(productPath, 'product.json');

    if (!fs.existsSync(configPath)) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Update product.json
    const productData = {
      name,
      price,
      description,
      details: details || description
    };
    
    fs.writeFileSync(configPath, JSON.stringify(productData, null, 2));
    
    res.json({ success: true, id: req.params.id, ...productData });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Delete product
app.delete('/api/products/:collection/:id', (req, res) => {
  try {
    const productPath = getProductPath(req.params.collection, req.params.id);

    if (!fs.existsSync(productPath)) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Delete product folder and all contents
    fs.rmSync(productPath, { recursive: true, force: true });
    
    res.json({ success: true, message: 'Product deleted' });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Upload image
const uploadSingle = upload.single('image');
app.post('/api/products/:collection/:id/upload', (req, res) => {
  uploadSingle(req, res, (err) => {
    if (err) {
      // Validation / multer errors (e.g. invalid id or filename)
      return res.status(err.status || 400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    res.json({
      success: true,
      filename: req.file.filename,
      path: `../../${req.params.collection}/${req.params.id}/${req.file.filename}`
    });
  });
});

// Delete image
app.delete('/api/products/:collection/:id/images/:filename', (req, res) => {
  try {
    const imagePath = getImagePath(req.params.collection, req.params.id, req.params.filename);

    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: 'Image not found' });
    }
    
    fs.unlinkSync(imagePath);
    
    res.json({ success: true, message: 'Image deleted' });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Serve admin panel
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log('========================================');
  console.log('🚀 Admin Panel Started');
  console.log('========================================');
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`📁 Managing collections from: ${ROOT_DIR}/shared/`);
  console.log('========================================');
  console.log('⚠  Unauthenticated, local development only - do not expose to a network.');
  console.log('Press Ctrl+C to stop');
  console.log('');
});
