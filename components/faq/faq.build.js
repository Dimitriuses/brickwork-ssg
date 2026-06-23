// FAQ Component Build Script
// This script handles building the FAQ component with dynamic FAQ items

const fs = require('fs');
const path = require('path');
const { raw } = require('../../lib/html');

/**
 * Build the FAQ component
 * @param {object} vars - Component variables including FAQ_ITEMS array
 * @param {function} loadComponent - Function to load component files
 * @param {function} replaceVariables - Function to replace variables in template
 * @returns {string} - Compiled HTML
 */
function build(vars, loadComponent, replaceVariables) {
  // Load the faqItem template
  const faqItemTemplate = loadComponent('faqItem');
  
  // Build FAQ items HTML
  let faqItemsHtml = '';
  
  if (vars.FAQ_ITEMS && Array.isArray(vars.FAQ_ITEMS)) {
    vars.FAQ_ITEMS.forEach((item, index) => {
      const itemNum = index + 1;
      
      // Replace variables in faqItem template
      const itemVars = {
        ITEM_INDEX: itemNum,
        QUESTION: item.question,
        // Answers may contain HTML (documented feature), so insert verbatim.
        ANSWER: raw(item.answer)
      };
      
      const itemHtml = replaceVariables(faqItemTemplate, itemVars);
      faqItemsHtml += itemHtml + '\n';
    });
  }
  
  // Add the generated items to vars for main component
  vars.FAQ_ITEMS = raw(faqItemsHtml);
  
  // Load and return the main FAQ component
  const faqTemplate = loadComponent('faq');
  return replaceVariables(faqTemplate, vars);
}

module.exports = { build };
