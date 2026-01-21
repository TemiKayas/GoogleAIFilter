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
function hideElement(element) {
  if (!element || element.dataset.gscHidden === 'true') return;

  if (!isSafeToHide(element)) {
    return;
  }

  element.dataset.gscHidden = 'true';
  element.style.display = 'none';
}

// Main cleaning function
function cleanSearch(prefs) {
  // AI Overview
  if (prefs.hideAI) {
    // First try direct selectors
    let aiElements = findElements(SELECTORS.aiOverview);

    // If no elements found, try the text-based search
    if (aiElements.length === 0) {
      const aiContainer = findAIOverviewContainer();
      if (aiContainer) {
        aiElements = [aiContainer];
      }
    }

    aiElements.forEach(el => hideElement(el));
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
    if (!prefs.isPaid) {
      console.log('[Google Search Cleaner] Payment required to activate filters');
      return;
    }

    // Initial clean
    cleanSearch(prefs);

    // Watch for dynamic content changes (Google loads content via AJAX)
    const observer = new MutationObserver(() => {
      cleanSearch(prefs);
    });

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
        // Reset hidden states for new search
        document.querySelectorAll('[data-gsc-hidden="true"]').forEach(el => {
          el.dataset.gscHidden = 'false';
        });
        // Multiple delays to catch lazy-loaded content
        setTimeout(() => cleanSearch(prefs), 100);
        setTimeout(() => cleanSearch(prefs), 300);
        setTimeout(() => cleanSearch(prefs), 500);
        setTimeout(() => cleanSearch(prefs), 1000);
        setTimeout(() => cleanSearch(prefs), 2000);
        setTimeout(() => cleanSearch(prefs), 3000);
      }
    }, 200);

    // Also listen for popstate (back/forward navigation)
    window.addEventListener('popstate', () => {
      setTimeout(() => cleanSearch(prefs), 100);
    });

    // Aggressive AI Overview check - runs periodically because AI Overview loads very late
    // Checks current prefs each time so it respects toggle changes
    setInterval(() => {
      chrome.storage.sync.get({ hideAI: true, isPaid: false }, (currentPrefs) => {
        if (currentPrefs.isPaid && currentPrefs.hideAI) {
          const aiContainer = findAIOverviewContainer();
          if (aiContainer && aiContainer.dataset.gscHidden !== 'true') {
            hideElement(aiContainer);
          }
        }
      });
    }, 500);
  });
}

// Listen for preference changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    chrome.storage.sync.get(DEFAULT_PREFS, (prefs) => {
      // Reset hidden states
      document.querySelectorAll('[data-gsc-hidden="true"]').forEach(el => {
        el.style.display = '';
        el.dataset.gscHidden = 'false';
      });

      // Only apply filters if paid
      if (prefs.isPaid) {
        // Run immediately and with delays to catch AI Overview
        cleanSearch(prefs);
        setTimeout(() => cleanSearch(prefs), 100);
        setTimeout(() => cleanSearch(prefs), 300);
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
