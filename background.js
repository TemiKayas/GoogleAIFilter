// Google Search Cleaner - Background Service Worker

// Import ExtPay
importScripts('ExtPay.js');

// Initialize ExtPay - IMPORTANT: must call startBackground()
const extpay = ExtPay('aifilter');
extpay.startBackground();

// Listen for successful payments and update isPaid status
extpay.onPaid.addListener(user => {
  console.log('User paid!', user);
  chrome.storage.sync.set({ isPaid: true });
});

// Initialize default preferences on install
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Set default preferences
    chrome.storage.sync.set({
      hideAI: true,
      hideForums: false,
      hidePeopleAlsoAsk: false,
      hideShopping: false,
      hideVideos: false,
      hideSponsored: false,
      isPaid: false
    });

    console.log('Google Search Cleaner installed with default settings');
  }
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPaymentStatus') {
    // Re-initialize extpay in callback context (service worker requirement)
    const extpayCheck = ExtPay('aifilter');
    extpayCheck.getUser().then(user => {
      chrome.storage.sync.set({ isPaid: user.paid });
      sendResponse({ isPaid: user.paid });
    }).catch(err => {
      console.error('ExtPay error:', err);
      chrome.storage.sync.get({ isPaid: false }, (prefs) => {
        sendResponse({ isPaid: prefs.isPaid });
      });
    });
    return true; // Keep channel open for async response
  }
});
