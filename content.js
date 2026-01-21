// Google Search Cleaner - Content Script
// Uses multiple selector strategies for resilience against Google's frequent DOM changes

const SELECTORS = {
  // AI Overview - using stable data attributes and semantic markers
  aiOverview: [
    '[data-async-type="du_kg"]',           // Most reliable - data attribute for AI hub
    '[data-attrid="wa:/description"]',     // Alternative data attribute
    '#arc-srp_1',                          // Legacy ID (less reliable)
  ],

  // Forums / Discussions
  forums: [
    '#rso a[href*="reddit.com"]',
    '#rso a[href*="quora.com"]',
    '#rso a[href*="stackexchange.com"]',
    '#rso a[href*="stackoverflow.com"]',
  ],

  // Discussion section block
  discussionSection: [
    '[data-attrid*="discussion"]',
    'div[jsname="yEVEwb"]',
  ],

  // People Also Ask - target the whole container
  peopleAlsoAsk: [
    '[data-sgrd="true"]',
    '[data-initq]',                    // Data attribute for question blocks
  ],

  // Shopping Results
  shopping: [
    '.commercial-unit-desktop-top',
    '.cu-container',
    '.pla-unit-container',
    '.sh-dgr__grid-result',
    '.sh-pr__product-results',
    '#rso [data-attrid*="kc:/shopping"]',
  ],

  // Video Carousels - using semantic selectors
  videos: [
    'video-voyager',                                    // Custom element for video
    'g-scrolling-carousel:has(a[href*="youtube.com"])', // Carousel containing YouTube links
    'g-scrolling-carousel:has(a[href*="video"])',       // Carousel with video links
    '[data-attrid*="video"]',                           // Data attribute for video blocks
    '#rso [data-hveid] a[href*="youtube.com"]',         // YouTube links in results
  ],

  // Sponsored / Ads
  sponsored: [
    '.ads-fr',
    '#tads',
    '#tadsb',
    '.uEierd',
    'div[data-text-ad="1"]',
    '#rso > div[data-sokoban-container]',
  ]
};

// Default preferences
const DEFAULT_PREFS = {
  hideAI: true,
  hideForums: false,
  hidePeopleAlsoAsk: false,
  hideShopping: false,
  hideVideos: false,
  hideSponsored: false,
  isPaid: false
};

// Global state to prevent race conditions
let currentState = { ...DEFAULT_PREFS };

// Debounce utility
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Check if an element is safe to hide (not part of header/nav)
function isSafeToHide(element) {
  const forbiddenSelectors = [
    '#gb',           // Google header bar
    '#searchform',   // Search form
    'header',
    '[role="navigation"]',
    '#top_nav',
    '.sfbg',         // Search form background
  ];

  for (const selector of forbiddenSelectors) {
    if (element.matches && element.matches(selector)) {
      return false;
    }
    if (element.closest && element.closest(selector)) {
      return false;
    }
  }

  return true;
}

// Find elements by selectors
function findElements(selectorArray) {
  const found = [];
  for (const selector of selectorArray) {
    try {
      document.querySelectorAll(selector).forEach(el => {
        if (!found.includes(el)) {
          found.push(el);
        }
      });
    } catch (e) {
      // Invalid selector, skip
    }
  }
  return found;
}

// Find AI Overview container using stable semantic selectors
function findAIOverviewContainer() {
  // Method 1: Data Attributes (Most Reliable)
  // Google uses data- attributes for internal tracking that are harder to change
  const dataSelectors = [
    '[data-async-type="du_kg"]',
    '[data-attrid="wa:/description"]',
    '[data-async-context*="ai_overview"]',
  ];

  for (const selector of dataSelectors) {
    const container = document.querySelector(selector);
    if (container) {
      return container;
    }
  }

  // Method 2: Shadow DOM Piercing
  // In some regions, Google puts AI Overview inside Shadow DOM
  const shadowHosts = document.querySelectorAll('search-as-you-type, ai-overview-container, [data-component]');
  for (const host of shadowHosts) {
    if (host.shadowRoot) {
      const innerContent = host.shadowRoot.querySelector('[data-async-type="du_kg"], .container');
      if (innerContent) {
        return host; // Hide the host element
      }
    }
  }

  // Method 3: Heading Text Search (Fail-Safe)
  // Find "AI Overview" text and traverse up to container
  const headings = document.querySelectorAll('h1, h2, h3, div[role="heading"], [aria-level]');
  for (const heading of headings) {
    const text = (heading.innerText || heading.textContent || '').trim().toLowerCase();
    if (text === 'ai overview' || text.startsWith('ai overview')) {
      // Traverse up to find the main container using stable attributes
      let container = heading.closest('[data-async-context], [data-hveid], [data-ved]');
      if (container) {
        // Keep going up until we find the outermost AI container
        // but stop at main search results boundaries
        let parent = container;
        while (parent && parent.parentElement) {
          const parentParent = parent.parentElement;
          // Stop if we hit the main results container
          if (parentParent.id === 'rso' || parentParent.id === 'center_col' || parentParent.id === 'rcnt') {
            return parent;
          }
          // Check if parent also has data attributes (might be the actual container)
          if (parentParent.hasAttribute('data-async-context') || parentParent.hasAttribute('data-hveid')) {
            parent = parentParent;
          } else {
            break;
          }
        }
        return parent || container;
      }

      // Fallback: just go up a fixed number of levels
      let element = heading;
      for (let i = 0; i < 6 && element.parentElement; i++) {
        element = element.parentElement;
        // Stop if we find a container with data attributes
        if (element.hasAttribute('data-hveid') || element.hasAttribute('data-async-context')) {
          return element;
        }
      }
      return element;
    }
  }

  // Method 4: TreeWalker text search (most thorough fail-safe)
  // Find any text node containing "AI Overview" and walk up
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const text = node.textContent.trim();
        if (text === 'AI Overview') {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      }
    }
  );

  const textNode = walker.nextNode();
  if (textNode && textNode.parentElement) {
    let element = textNode.parentElement;
    // Walk up to find a container with data attributes
    for (let i = 0; i < 10 && element; i++) {
      if (element.hasAttribute('data-hveid') || element.hasAttribute('data-async-context')) {
        // Keep going up to find the outermost container
        let parent = element;
        while (parent.parentElement) {
          const pp = parent.parentElement;
          if (pp.id === 'rso' || pp.id === 'center_col' || pp.id === 'rcnt') {
            return parent;
          }
          if (pp.hasAttribute('data-hveid') || pp.hasAttribute('data-async-context')) {
            parent = pp;
          } else {
            break;
          }
        }
        return parent;
      }
      element = element.parentElement;
    }
  }

  return null;
}

// Hide an element
function hideElement(element, type = 'generic') {
  if (!element || element.dataset.gscHidden === 'true') return;

  if (!isSafeToHide(element)) {
    return;
  }

  // Mark as processed
  element.dataset.gscHidden = 'true';

  // Special handling for AI Overview - Add "Show" button
  if (type === 'ai') {
    // Create wrapper for the button to ensure it doesn't mess up layout
    const buttonId = 'gsc-show-ai-btn-' + Math.random().toString(36).substr(2, 9);
    
    const btn = document.createElement('button');
    btn.id = buttonId;
    btn.className = 'gsc-show-ai-btn';
    btn.innerText = '✨ Show AI Overview';
    btn.style.cssText = `
      display: block;
      margin: 10px 0;
      padding: 8px 16px;
      background: #f1f3f4;
      border: 1px solid #dadce0;
      border-radius: 18px;
      color: #1a73e8;
      font-family: Google Sans, Roboto, sans-serif;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      z-index: 999;
    `;

    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Unhide the element
      element.style.display = '';
      element.dataset.gscHidden = 'user-shown'; // distinct state so we don't re-hide immediately
      btn.remove();
    };

    // Insert button before the element
    if (element.parentNode) {
      element.parentNode.insertBefore(btn, element);
    }
    
    // Hide the element
    element.style.setProperty('display', 'none', 'important');
  } else {
    // Standard hiding for other elements
    element.style.setProperty('display', 'none', 'important');
  }
}

// Main cleaning function - uses global currentState
function cleanSearch() {
  const prefs = currentState;
  
  if (!prefs.isPaid) return;

  // AI Overview
  if (prefs.hideAI) {
    // Collect ALL potential AI elements
    let aiElements = findElements(SELECTORS.aiOverview);
    
    // Always try to find the container via heuristics too, 
    // as direct selectors often miss the parent wrapper
    const aiContainer = findAIOverviewContainer();
    if (aiContainer && !aiElements.includes(aiContainer)) {
      aiElements.push(aiContainer);
    }

    // Filter out elements that are already shown by user
    aiElements = aiElements.filter(el => el.dataset.gscHidden !== 'user-shown');

    aiElements.forEach(el => hideElement(el, 'ai'));
  }

  // Forums / Discussions
  if (prefs.hideForums) {
    findElements(SELECTORS.forums).forEach(el => {
      const resultBlock = el.closest('[data-hveid]');
      if (resultBlock) hideElement(resultBlock);
    });
    findElements(SELECTORS.discussionSection).forEach(el => hideElement(el));
  }

  // People Also Ask
  if (prefs.hidePeopleAlsoAsk) {
    // Try direct selectors first
    findElements(SELECTORS.peopleAlsoAsk).forEach(el => {
      // Walk up to find container with the heading
      const container = el.closest('[data-hveid]');
      if (container) hideElement(container);
      else hideElement(el);
    });

    // Also find by heading text (fail-safe)
    const headings = document.querySelectorAll('h2, h3, div[role="heading"], [aria-level]');
    for (const heading of headings) {
      const text = (heading.innerText || heading.textContent || '').trim().toLowerCase();
      if (text === 'people also ask' || text.startsWith('people also ask')) {
        const container = heading.closest('[data-hveid]');
        if (container) hideElement(container);
      }
    }
  }

  // Shopping
  if (prefs.hideShopping) {
    findElements(SELECTORS.shopping).forEach(el => hideElement(el));
  }

  // Videos
  if (prefs.hideVideos) {
    // First try direct selectors
    findElements(SELECTORS.videos).forEach(el => {
      // Find the containing block - walk up to the result container
      const carousel = el.closest('g-scrolling-carousel');
      if (carousel) {
        // Hide the carousel's parent container (the whole video block)
        const container = carousel.closest('[data-hveid]') || carousel.parentElement;
        hideElement(container);
      } else {
        const container = el.closest('[data-hveid]');
        if (container) hideElement(container);
        else hideElement(el);
      }
    });

    // Also find video sections by heading text (fail-safe)
    const headings = document.querySelectorAll('h2, h3, div[role="heading"], [aria-level]');
    for (const heading of headings) {
      const text = (heading.innerText || heading.textContent || '').toLowerCase();
      if (text.includes('video') || text.includes('watch')) {
        const container = heading.closest('[data-hveid]');
        if (container) hideElement(container);
      }
    }
  }

  // Sponsored / Ads
  if (prefs.hideSponsored) {
    findElements(SELECTORS.sponsored).forEach(el => hideElement(el));
  }
}

// Initialize
function init() {
  chrome.storage.sync.get(DEFAULT_PREFS, (prefs) => {
    currentState = prefs;
    
    if (!currentState.isPaid) {
      console.log('[Google Search Cleaner] Payment required to activate filters');
      return;
    }

    // Initial clean
    cleanSearch();

    // Watch for dynamic content changes (Google loads content via AJAX)
    // Debounced to prevent performance issues
    const observer = new MutationObserver(debounce(() => {
      cleanSearch();
    }, 100));

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Handle client-side navigation (Google uses History API for new searches)
    let lastUrl = location.href;

    // Check for URL changes periodically (catches all navigation types)
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // Reset hidden states for new search - removing buttons and resetting flags
        document.querySelectorAll('.gsc-show-ai-btn').forEach(btn => btn.remove());
        document.querySelectorAll('[data-gsc-hidden]').forEach(el => {
          el.dataset.gscHidden = 'false';
          el.style.display = ''; 
        });
        
        // Multiple delays to catch lazy-loaded content
        setTimeout(cleanSearch, 100);
        setTimeout(cleanSearch, 300);
        setTimeout(cleanSearch, 500);
        setTimeout(cleanSearch, 1000);
      }
    }, 200);

    // Also listen for popstate (back/forward navigation)
    window.addEventListener('popstate', () => {
      setTimeout(cleanSearch, 100);
    });

    // Aggressive AI Overview check - runs periodically because AI Overview loads very late
    setInterval(() => {
      if (currentState.isPaid && currentState.hideAI) {
        // We force a check here
        const aiContainer = findAIOverviewContainer();
        if (aiContainer && aiContainer.dataset.gscHidden !== 'true' && aiContainer.dataset.gscHidden !== 'user-shown') {
          hideElement(aiContainer, 'ai');
        }
      }
    }, 1000); 
  });
}

// Listen for preference changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    chrome.storage.sync.get(DEFAULT_PREFS, (prefs) => {
      currentState = prefs; // Update global state
      
      // Reset hidden states completely
      document.querySelectorAll('.gsc-show-ai-btn').forEach(btn => btn.remove());
      document.querySelectorAll('[data-gsc-hidden]').forEach(el => {
        el.style.display = '';
        el.dataset.gscHidden = 'false';
      });

      // Only apply filters if paid
      if (currentState.isPaid) {
        // Run immediately and with delays to catch AI Overview
        cleanSearch();
        setTimeout(cleanSearch, 100);
        setTimeout(cleanSearch, 300);
      }
    });
  }
});

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
