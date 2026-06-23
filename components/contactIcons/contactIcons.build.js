// Contact Icons Component Build Script
// Reads social links from config.json and generates icon links

const fs = require('fs');
const path = require('path');
const { raw } = require('../../lib/html');

/**
 * Build the Contact Icons component
 * @param {object} vars - Component variables
 * @param {function} loadComponent - Function to load component files
 * @param {function} replaceVariables - Function to replace variables in template
 * @returns {string} - Compiled HTML
 */
function build(vars, loadComponent, replaceVariables) {
  // Load config.json to get social links
  const configPath = 'config.json';
  let config = {};
  
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  
  // Define icon mappings with Bootstrap Icons
  const iconMap = {
    'telegram': { icon: 'bi-telegram', label: 'Telegram' },
    'whatsapp': { icon: 'bi-whatsapp', label: 'WhatsApp' },
    'instagram': { icon: 'bi-instagram', label: 'Instagram' },
    'signal': { icon: 'bi-signal', label: 'Signal' },
    'viber': { icon: 'viber-custom', label: 'Viber' },
    'facebook': { icon: 'bi-facebook', label: 'Facebook' },
    'twitter': { icon: 'bi-twitter', label: 'Twitter' },
    'linkedin': { icon: 'bi-linkedin', label: 'LinkedIn' },
    'youtube': { icon: 'bi-youtube', label: 'YouTube' },
    'github': { icon: 'bi-github', label: 'GitHub' },
    'email': { icon: 'bi-envelope', label: 'Email' },
    'phone': { icon: 'bi-telephone', label: 'Phone' }
  };
  
  // Build social icons HTML
  let iconsHtml = '';
  
  // Get social links from config
  const socialLinks = config.SOCIAL_LINKS || config.social || {};
  
  // Process each social link
  Object.entries(socialLinks).forEach(([platform, url]) => {
    if (!url) return; // Skip empty links
    
    const iconInfo = iconMap[platform.toLowerCase()];
    if (!iconInfo) return; // Skip unknown platforms
    
    // Special handling for Viber (uses custom SVG)
    if (platform.toLowerCase() === 'viber') {
      iconsHtml += `
          <a href="${url}" target="_blank" aria-label="${iconInfo.label}">
            <img class="bi" src="assets/images/viber-brands-solid-full.svg" alt="${iconInfo.label}" > 
          </a>`; // style="filter: brightness(0) saturate(100%) invert(30%) sepia(47%) saturate(3809%) hue-rotate(208deg) brightness(99%) contrast(102%);" width="21" height="21"
    } else {
      // Standard Bootstrap Icon
      iconsHtml += `
          <a href="${url}" target="_blank" aria-label="${iconInfo.label}">
            <i class="bi ${iconInfo.icon}"></i>
          </a>`;
    }
  });
  
  // If no icons generated, show a message
  if (!iconsHtml.trim()) {
    iconsHtml = '<!-- No social links configured in config.json -->';
  }
  
  // Prepare variables
  const componentVars = {
    SOCIAL_ICONS: raw(iconsHtml)
  };
  
  // Load and return the component
  const template = loadComponent('contactIcons');
  return replaceVariables(template, componentVars);
}

module.exports = { build };
