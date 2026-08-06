// Minimal MV3 background service worker. No persistent state is kept here -
// entity data and tokenization live in each tab's isolated content script -
// this mainly exists so the extension has a stable, discoverable service
// worker context (useful for automated testing and future features like
// install/update notifications).
chrome.runtime.onInstalled.addListener(() => {
  console.log('Nistar installed');
});
