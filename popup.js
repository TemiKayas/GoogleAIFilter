// Google Search Cleaner - Popup Script

// ExtensionPay ID
const EXTPAY_ID = 'aifilter';

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

// Toggle IDs mapped to preference keys
const TOGGLE_MAP = {
  'hideAI': 'hideAI',
  'hideForums': 'hideForums',
  'hidePeopleAlsoAsk': 'hidePeopleAlsoAsk',
  'hideShopping': 'hideShopping',
  'hideVideos': 'hideVideos',
  'hideSponsored': 'hideSponsored'
};

// ALL features require payment ($2)
const PREMIUM_FEATURES = ['hideAI', 'hideForums', 'hidePeopleAlsoAsk', 'hideShopping', 'hideVideos', 'hideSponsored'];

let extpay = null;
let isPaid = false;

// Initialize ExtensionPay
function initExtPay() {
  try {
    if (typeof ExtPay !== 'undefined') {
      extpay = ExtPay(EXTPAY_ID);
      // Note: startBackground() is called in background.js, not here
      return true;
    }
  } catch (e) {
    console.log('ExtPay not available:', e);
  }
  return false;
}

// Check payment status
async function checkPaymentStatus() {
  if (!extpay) {
    // For development/testing, check stored isPaid flag
    return new Promise((resolve) => {
      chrome.storage.sync.get({ isPaid: false }, (prefs) => {
        resolve(prefs.isPaid);
      });
    });
  }

  try {
    const user = await extpay.getUser();
    isPaid = user.paid;

    // Store payment status
    chrome.storage.sync.set({ isPaid: isPaid });

    return isPaid;
  } catch (e) {
    console.log('Payment check failed:', e);
    return false;
  }
}

// Update UI based on payment status
function updatePaymentUI(paid) {
  const paymentBanner = document.getElementById('payment-banner');
  const allToggles = PREMIUM_FEATURES.map(id => document.getElementById(id)?.closest('.filter-item')).filter(Boolean);

  if (paid) {
    // Hide payment banner
    paymentBanner.classList.remove('show');

    // Enable all toggles
    allToggles.forEach(item => {
      item.classList.remove('locked');
    });
  } else {
    // Show payment banner - full screen paywall
    paymentBanner.classList.add('show');

    // Lock ALL toggles until payment
    allToggles.forEach(item => {
      item.classList.add('locked');
    });
  }
}

// Handle payment button click
function handlePayment() {
  if (extpay) {
    extpay.openPaymentPage();
  } else {
    // For development: simulate payment
    console.log('ExtPay not configured. For development, enable features manually.');
    chrome.storage.sync.set({ isPaid: true }, () => {
      updatePaymentUI(true);
    });
  }
}

// Load preferences and update UI
function loadPreferences() {
  chrome.storage.sync.get(DEFAULT_PREFS, (prefs) => {
    Object.keys(TOGGLE_MAP).forEach(toggleId => {
      const toggle = document.getElementById(toggleId);
      if (toggle) {
        toggle.checked = prefs[TOGGLE_MAP[toggleId]] || false;
      }
    });
  });
}

// Save preference when toggle changes
function savePreference(key, value) {
  chrome.storage.sync.set({ [key]: value }, () => {
    console.log(`Saved ${key}: ${value}`);
  });
}

// Setup toggle event listeners
function setupToggles() {
  Object.keys(TOGGLE_MAP).forEach(toggleId => {
    const toggle = document.getElementById(toggleId);
    if (toggle) {
      toggle.addEventListener('change', (e) => {
        const prefKey = TOGGLE_MAP[toggleId];

        // Check if this is a premium feature and user hasn't paid
        if (PREMIUM_FEATURES.includes(prefKey) && !isPaid) {
          e.preventDefault();
          toggle.checked = false;
          handlePayment();
          return;
        }

        savePreference(prefKey, e.target.checked);
      });
    }
  });
}

// Initialize popup
async function init() {
  // Initialize ExtensionPay
  initExtPay();

  // Check payment status
  isPaid = await checkPaymentStatus();

  // Update UI
  updatePaymentUI(isPaid);

  // Load saved preferences
  loadPreferences();

  // Setup toggle listeners
  setupToggles();

  // Setup payment button
  const paymentBtn = document.getElementById('payment-btn');
  if (paymentBtn) {
    paymentBtn.addEventListener('click', handlePayment);
  }

  // Listen for storage changes (payment status updates from background)
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.isPaid) {
      isPaid = changes.isPaid.newValue;
      updatePaymentUI(isPaid);
    }
  });
}

// Run on DOM ready
document.addEventListener('DOMContentLoaded', init);
