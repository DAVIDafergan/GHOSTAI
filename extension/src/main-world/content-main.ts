import { PII_SHIELD_REQUEST, PII_SHIELD_RESPONSE, TokenizeRequestMessage, TokenizeResponseMessage } from '../shared/messages';

// Diagnostic logging below is scoped to never include raw typed/composer
// text or outgoing request bodies - both can contain real PII, which must
// never reach the browser console (readable by other extensions with
// debugger permissions, remote-debugging tools, screen-share/support
// sessions, etc.), not just never leave the browser entirely.
console.log('[PII Shield][main] content-main.ts loaded on', location.href);

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
// Fallback selectors, tried in order, used when focus has already moved
// away from the composer by the time the outgoing request fires (observed
// on real ChatGPT/Claude: clicking "Send" blurs the composer to <body>
// before the fetch happens - activeElement is useless at that point).
// Most specific first: ChatGPT and Claude both build their composer on
// ProseMirror, whose editor root always carries the `.ProseMirror` class -
// a stable, framework-added class name, unlike per-app hashed classes.
// Critically, `[contenteditable="true"]` alone is NOT enough - real-world
// testing found ChatGPT/Claude's composer does NOT necessarily have the
// literal attribute value "true" (some editors set a bare `contenteditable`
// attribute, or "plaintext-only"), so match on the attribute's presence in
// any non-"false" state too.
const FALLBACK_SELECTORS = ['.ProseMirror[contenteditable]', '[contenteditable]:not([contenteditable="false"])', 'textarea'];

function getLiveInputText(): string | null {
  const active = document.activeElement as HTMLElement | null;
  console.log('[PII Shield][main] getLiveInputText: document.activeElement =', {
    tagName: active?.tagName,
    isContentEditable: active?.isContentEditable,
  });
  if (active) {
    if (active.tagName === 'TEXTAREA') {
      const value = (active as HTMLTextAreaElement).value;
      console.log('[PII Shield][main] getLiveInputText: found via activeElement TEXTAREA, length', value.length);
      return value;
    }
    if (active.isContentEditable) {
      const value = active.innerText;
      console.log('[PII Shield][main] getLiveInputText: found via activeElement contentEditable, length', value.length);
      return value;
    }
  }

  for (const selector of FALLBACK_SELECTORS) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const value = el.tagName === 'TEXTAREA' ? (el as HTMLTextAreaElement).value : (el as HTMLElement).innerText;
    console.log(
      `[PII Shield][main] getLiveInputText: activeElement did not match, fell back to querySelector("${selector}"), length`,
      value.length,
    );
    return value;
  }

  console.warn(
    '[PII Shield][main] getLiveInputText: found NOTHING - no focused textarea/contentEditable, and none of',
    FALLBACK_SELECTORS,
    'matched anywhere on the page. The site\'s input box DOM structure may not match what this looks for.',
  );
  return null;
}

// Real-world testing against chat.openai.com found that fixing the
// selector above was not enough: by the time our patched fetch()/XHR.send()
// runs, the app has already cleared the composer optimistically (before
// awaiting the network call), so a DOM read at that moment is always empty
// - not a selector problem, a timing problem. The fix is to snapshot the
// text *before* the composer can be cleared: on every keystroke and on
// Enter (capture phase, so this runs before the page's own handlers).
let capturedInputText: string | null = null;
let capturedInputTextAt = 0;
const CAPTURE_MAX_AGE_MS = 5000;

function captureFromElement(el: HTMLElement | null, reason: string): void {
  if (!el) return;
  let value: string | null = null;
  if (el.tagName === 'TEXTAREA') value = (el as HTMLTextAreaElement).value;
  else if (el.isContentEditable) value = el.innerText;
  if (value && value.trim()) {
    capturedInputText = value;
    capturedInputTextAt = Date.now();
    console.log(
      `[PII Shield][main] captured composer text ahead of a possible submit (reason: ${reason}), length`,
      value.length,
    );
  }
}

// Capture directly from the element actually receiving the event - not a
// page-wide querySelector guess. This matters when the page has more than
// one contentEditable region (found in real-world testing: ChatGPT's
// Canvas side panel adds a second editor alongside the actual message
// composer). A blind page-wide scan at click-time - after the composer has
// already blurred to <body> - can match the *wrong* one and overwrite the
// correct text that 'input' events had already captured from the real
// composer during typing. event.target has no such ambiguity: it's always
// the exact element the user is interacting with.
document.addEventListener('input', (e) => captureFromElement(e.target as HTMLElement, 'input'), true);
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Enter' && !e.shiftKey) captureFromElement(e.target as HTMLElement, 'Enter keydown');
  },
  true,
);

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
  // Prefer the captured value over a fresh DOM read: by definition, if the
  // user typed anything, an 'input' event already fired on the exact
  // element they typed into (see the capture listeners above) - so a
  // recent capture is a *verified* correct source. A direct DOM read at
  // this point (composer possibly already cleared/blurred, and on pages
  // with more than one contentEditable region - e.g. ChatGPT's Canvas
  // panel - a generic selector can match the wrong element entirely) is
  // less reliable, not more, despite being "fresher."
  let liveText: string | null = null;
  let usedCapturedFallback = false;
  const capturedAge = Date.now() - capturedInputTextAt;
  if (capturedInputText && capturedAge <= CAPTURE_MAX_AGE_MS) {
    liveText = capturedInputText;
    usedCapturedFallback = true;
    console.log(
      '[PII Shield][main] tokenizeOutgoingBody: using text captured',
      capturedAge,
      'ms ago from the verified input target, length',
      liveText.length,
    );
  } else {
    liveText = getLiveInputText();
    console.log(
      '[PII Shield][main] tokenizeOutgoingBody: no recent captured text - falling back to a live DOM read, length',
      liveText?.length ?? 0,
    );
  }
  if (!liveText || !liveText.trim()) {
    console.warn(
      '[PII Shield][main] tokenizeOutgoingBody: no live input text found (DOM read empty AND no recent captured text) - passing body through UNCHANGED.',
    );
    return bodyText;
  }

  let bodyContainsLiveText = false;
  let parsedJson: JsonValue | undefined;
  try {
    const parsed = JSON.parse(bodyText) as JsonValue;
    parsedJson = parsed;
    bodyContainsLiveText = deepReplaceExactString(parsed, liveText, PROBE_MARKER).changed;
  } catch {
    bodyContainsLiveText = bodyText.includes(liveText);
  }
  console.log('[PII Shield][main] tokenizeOutgoingBody: bodyContainsLiveText =', bodyContainsLiveText);
  if (!bodyContainsLiveText) {
    console.warn(
      '[PII Shield][main] tokenizeOutgoingBody: the live/captured input text does NOT appear anywhere in this specific outgoing request body - passing through UNCHANGED. This request body was probably not the message-send request.',
    );
    return bodyText;
  }

  // Consumed - clear it so it can't leak into a later, unrelated request.
  if (usedCapturedFallback) capturedInputText = null;

  const response = await requestTokenization(liveText);
  console.log('[PII Shield][main] tokenizeOutgoingBody: tokenization response from isolated world:', response);
  if (parsedJson !== undefined) {
    const { changed, value } = deepReplaceExactString(parsedJson, liveText, response.tokenizedText);
    if (changed) return JSON.stringify(value);
  }
  return bodyText.split(liveText).join(response.tokenizedText);
}

const originalFetch = window.fetch;
window.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  console.log('[PII Shield][main] fetch() intercepted:', {
    url,
    method: init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET'),
    bodyType: init ? typeof init.body : typeof (input as Request)?.body,
    bodyIsString: !!(init && typeof init.body === 'string'),
  });
  if (init && typeof init.body === 'string') {
    const tokenizedBody = await tokenizeOutgoingBody(init.body);
    return originalFetch(input, { ...init, body: tokenizedBody });
  }
  console.warn(
    '[PII Shield][main] fetch() body is not a plain string (or no init.body) - this request was NOT checked. If this is the chat send request, the body construction (e.g. Request object, streaming body, FormData) is not covered by the current interception logic.',
  );
  return originalFetch(input, init);
};

const OriginalXHRSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function patchedSend(
  this: XMLHttpRequest,
  body?: Document | XMLHttpRequestBodyInit | null,
) {
  console.log('[PII Shield][main] XMLHttpRequest.send() intercepted:', {
    bodyType: typeof body,
    bodyIsString: typeof body === 'string',
  });
  if (typeof body === 'string') {
    tokenizeOutgoingBody(body)
      .then((tokenizedBody) => OriginalXHRSend.call(this, tokenizedBody))
      .catch((err) => {
        console.error('[PII Shield][main] blocked outgoing XHR request, tokenization failed', err);
      });
    return;
  }
  return OriginalXHRSend.call(this, body);
};
