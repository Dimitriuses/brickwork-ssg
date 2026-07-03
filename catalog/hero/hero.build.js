// Hero Component Build Script
// Handles default values for background image, height, and overlay

/**
 * Build the Hero component with configurable background, height, and overlay
 * @param {object} vars - Component variables
 * @param {function} loadComponent - Function to load component files
 * @param {function} replaceVariables - Function to replace variables in template
 * @returns {string} - Compiled HTML
 */
function build(vars, loadComponent, replaceVariables) {
  // Set default values if not provided
  const heroVars = {
    HERO_TITLE: vars.HERO_TITLE || 'Welcome',
    HERO_SUBTITLE: vars.HERO_SUBTITLE || 'Your subtitle here',
    HERO_BG_IMAGE: vars.HERO_BG_IMAGE || 'assets/images/hero.png',
    HERO_HEIGHT: vars.HERO_HEIGHT || '100vh',
    HERO_OVERLAY: vars.HERO_OVERLAY !== undefined ? vars.HERO_OVERLAY : '0.45'
  };
  
  // Load and return the hero component
  const heroTemplate = loadComponent('hero');
  return replaceVariables(heroTemplate, heroVars);
}

module.exports = { build };