# PII Shield Extension

Chrome Extension (Manifest V3) that intercepts text before it's sent to
ChatGPT/Claude/Gemini, replaces company-sensitive values with tokens, and
restores the real values when the response comes back on screen. The AI
provider never sees the raw values.

## How it works

- **`content-main.js`** runs in the page's own JS world (`"world": "MAIN"`,
  `document_start`) and patches `window.fetch`/`XMLHttpRequest.prototype.send`.
  For each outgoing request, it finds the text the user is currently
  typing/just submitted (from the focused textarea/contenteditable), asks the
  isolated-world script to tokenize it, and substitutes the tokenized version
  into the request body wherever the original text appears - this works
  across providers without needing to know their specific API schema.
- **`content-isolated.js`** runs in the extension's isolated world. It holds
  the actual entity index (fetched from the backend via the employee's
  `extensionKey`), does the tokenization/detokenization, shows a small status
  badge, and watches the rendered DOM for tokens to swap back to real values.
- The two communicate via `window.postMessage`, since MAIN-world scripts
  can't use `chrome.*` APIs and isolated-world scripts can't patch the page's
  own `fetch`.
- `shared/tokenizer.ts` is the detection/tokenization core: structured regex
  (Israeli ID with check-digit validation, email, phone, currency amounts)
  plus sliding word n-grams (1-4 words) for names/case numbers - the n-gram
  candidates only ever get tokenized if their hash matches the company's
  fetched entity list, which is what lets this work in Hebrew and English
  alike without language-specific NER.
- **Fail-safe:** if the backend/entity list can't be reached, structured
  regex matches are still blocked unconditionally (never send completely
  unchecked); name/case-number detection is skipped since it depends on
  having a list to compare against. The badge shows a warning in this state.

## Build

```bash
npm install
npm run build
```

Produces an unpacked extension in `dist/`. Load it via
`chrome://extensions` → Developer mode → "Load unpacked" → select `dist/`.

Note: `manifest.json`'s `host_permissions`/`content_scripts` matches include
`http://localhost/*` and `http://127.0.0.1/*` in addition to the three real
chat providers - this is deliberate, so the extension can be exercised
against a local mock page for testing (see `e2e/`); it doesn't do anything
on other people's localhost sites since most users don't browse localhost.

## Configure

Click the extension icon, enter the backend URL and the `extensionKey`
issued for a specific employee (`POST /employees` on the backend), and save.
This is stored in `chrome.storage.local`.

## Test

- `npm test` - unit tests (Jest) for the pure detection/tokenization logic.
  Includes a cross-package test asserting the hashing algorithm here is
  byte-for-byte identical to the backend's and connector's copies.
- `npm run e2e` - loads the actual built extension in a real Chromium
  instance (via Playwright) against a local mock chat page + a real spawned
  backend instance, and asserts the network payload the mock "provider"
  receives is tokenized while the rendered response is detokenized. This is
  the automated equivalent of the manual "paste PII into a real chat, check
  the Network tab" verification - see BUILD_LOG.md for why real
  chat.openai.com/claude.ai couldn't be used for this instead.
