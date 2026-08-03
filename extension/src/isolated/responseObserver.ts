import { TokenStore, detokenizeText } from '../shared/tokenizer';

function replaceTokensInNode(node: Node, store: TokenStore): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const original = node.textContent ?? '';
    const replaced = detokenizeText(original, store);
    if (replaced !== original) node.textContent = replaced;
    return;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      const original = current.textContent ?? '';
      const replaced = detokenizeText(original, store);
      if (replaced !== original) current.textContent = replaced;
      current = walker.nextNode();
    }
  }
}

/**
 * Watches the page's rendered DOM (not the network response) for any of
 * this session's tokens and swaps them back for the real value. DOM-level
 * detokenization is more robust than patching streamed fetch/XHR responses,
 * since it doesn't depend on where a token falls across SSE/stream chunks.
 */
export function observeResponses(store: TokenStore): MutationObserver {
  const observer = new MutationObserver((mutations) => {
    if (store.allTokens().length === 0) return;
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => replaceTokensInNode(node, store));
      if (mutation.type === 'characterData' && mutation.target) {
        replaceTokensInNode(mutation.target, store);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return observer;
}
