import { PII_SHIELD_REQUEST, PII_SHIELD_RESPONSE, TokenizeRequestMessage, TokenizeResponseMessage } from '../shared/messages';

const pending = new Map<string, { resolve: (r: TokenizeResponseMessage) => void; reject: (e: Error) => void }>();

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as TokenizeResponseMessage | undefined;
  if (!data || data.type !== PII_SHIELD_RESPONSE) return;
  const waiter = pending.get(data.id);
  if (waiter) {
    pending.delete(data.id);
    waiter.resolve(data);
  }
});

function requestTokenization(text: string): Promise<TokenizeResponseMessage> {
  const id = `${Date.now()}-${Math.random()}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('PII Shield: tokenization request timed out - message not sent'));
    }, 5000);
    pending.set(id, {
      resolve: (r) => {
        clearTimeout(timeout);
        resolve(r);
      },
      reject,
    });
    const message: TokenizeRequestMessage = { type: PII_SHIELD_REQUEST, id, text };
    window.postMessage(message, '*');
  });
}

/**
 * Finds the text the user is actively typing/just submitted. This, not the
 * provider's specific API schema, is what lets one interception mechanism
 * work across ChatGPT/Claude/Gemini: whatever the request body's shape,
 * chat UIs embed this exact string in it.
 */
function getLiveInputText(): string | null {
  const active = document.activeElement as HTMLElement | null;
  if (active) {
    if (active.tagName === 'TEXTAREA') return (active as HTMLTextAreaElement).value;
    if (active.isContentEditable) return active.innerText;
  }
  const textarea = document.querySelector('textarea');
  if (textarea) return (textarea as HTMLTextAreaElement).value;
  const editable = document.querySelector('[contenteditable="true"]');
  if (editable) return (editable as HTMLElement).innerText;
  return null;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function deepReplaceExactString(
  value: JsonValue,
  target: string,
  replacement: string,
): { changed: boolean; value: JsonValue } {
  if (typeof value === 'string') {
    return value === target ? { changed: true, value: replacement } : { changed: false, value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((v) => {
      const r = deepReplaceExactString(v, target, replacement);
      if (r.changed) changed = true;
      return r.value;
    });
    return { changed, value: changed ? next : value };
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const next: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value)) {
      const r = deepReplaceExactString(v, target, replacement);
      if (r.changed) changed = true;
      next[k] = r.value;
    }
    return { changed, value: changed ? next : value };
  }
  return { changed: false, value };
}

const PROBE_MARKER = 'PII_SHIELD_PROBE_MARKER';

async function tokenizeOutgoingBody(bodyText: string): Promise<string> {
  const liveText = getLiveInputText();
  if (!liveText || !liveText.trim()) return bodyText;

  let bodyContainsLiveText = false;
  let parsedJson: JsonValue | undefined;
  try {
    const parsed = JSON.parse(bodyText) as JsonValue;
    parsedJson = parsed;
    bodyContainsLiveText = deepReplaceExactString(parsed, liveText, PROBE_MARKER).changed;
  } catch {
    bodyContainsLiveText = bodyText.includes(liveText);
  }
  if (!bodyContainsLiveText) return bodyText;

  const response = await requestTokenization(liveText);
  if (parsedJson !== undefined) {
    const { changed, value } = deepReplaceExactString(parsedJson, liveText, response.tokenizedText);
    if (changed) return JSON.stringify(value);
  }
  return bodyText.split(liveText).join(response.tokenizedText);
}

const originalFetch = window.fetch;
window.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (init && typeof init.body === 'string') {
    const tokenizedBody = await tokenizeOutgoingBody(init.body);
    return originalFetch(input, { ...init, body: tokenizedBody });
  }
  return originalFetch(input, init);
};

const OriginalXHRSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function patchedSend(
  this: XMLHttpRequest,
  body?: Document | XMLHttpRequestBodyInit | null,
) {
  if (typeof body === 'string') {
    tokenizeOutgoingBody(body)
      .then((tokenizedBody) => OriginalXHRSend.call(this, tokenizedBody))
      .catch((err) => {
        console.error('PII Shield: blocked outgoing XHR request, tokenization failed', err);
      });
    return;
  }
  return OriginalXHRSend.call(this, body);
};
