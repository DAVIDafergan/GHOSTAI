/**
 * The MAIN-world script (patches window.fetch/XHR, no chrome.* API access)
 * and the isolated-world content script (has chrome.storage/runtime access,
 * holds the entity index and token store) talk via window.postMessage,
 * since they don't share a JS scope despite running in the same tab.
 */
export const PII_SHIELD_REQUEST = 'pii-shield:tokenize-request';
export const PII_SHIELD_RESPONSE = 'pii-shield:tokenize-response';

export interface TokenizeRequestMessage {
  type: typeof PII_SHIELD_REQUEST;
  id: string;
  text: string;
}

export interface TokenizeResponseMessage {
  type: typeof PII_SHIELD_RESPONSE;
  id: string;
  tokenizedText: string;
  hiddenCount: number;
  failSafe: boolean;
}
