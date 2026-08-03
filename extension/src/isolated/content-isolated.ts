import { PII_SHIELD_REQUEST, PII_SHIELD_RESPONSE, TokenizeRequestMessage } from '../shared/messages';
import { TokenStore, tokenizeText } from '../shared/tokenizer';
import { loadEntityStore, EntityStoreState } from './entityStore';
import { renderBadge, updateBadge } from './badge';
import { observeResponses } from './responseObserver';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const tokenStore = new TokenStore();
let storeState: EntityStoreState = {
  entityIndex: new Map(),
  companySalt: null,
  confidenceThreshold: 50,
  enabledEntityTypes: [],
  failSafe: true,
  backendUrl: null,
  extensionKey: null,
};

async function refreshEntityStore(): Promise<void> {
  storeState = await loadEntityStore();
  updateBadge({ failSafe: storeState.failSafe });
}

/** Fire-and-forget so a slow/unreachable backend never delays sending the
 * (already-tokenized) message - this is for the admin dashboard's audit
 * trail, not a safety gate. */
function reportBlockedEntities(entityTypes: string[]): void {
  if (!storeState.backendUrl || !storeState.extensionKey) return;
  for (const entityType of entityTypes) {
    fetch(`${storeState.backendUrl}/audit-logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-extension-key': storeState.extensionKey },
      body: JSON.stringify({ eventType: 'blocked', entityType }),
    }).catch(() => undefined);
  }
}

async function handleTokenizeRequest(data: TokenizeRequestMessage): Promise<void> {
  const result = storeState.failSafe
    ? await tokenizeText(data.text, tokenStore, { failSafe: true })
    : await tokenizeText(data.text, tokenStore, {
        failSafe: false,
        entityIndex: storeState.entityIndex,
        companySalt: storeState.companySalt as string,
        confidenceThreshold: storeState.confidenceThreshold,
        enabledEntityTypes: storeState.enabledEntityTypes,
      });

  updateBadge({ failSafe: result.failSafe, hiddenCount: result.hiddenCount });
  if (!result.failSafe) reportBlockedEntities(result.hiddenEntityTypes);

  window.postMessage(
    {
      type: PII_SHIELD_RESPONSE,
      id: data.id,
      tokenizedText: result.tokenizedText,
      hiddenCount: result.hiddenCount,
      failSafe: result.failSafe,
    },
    '*',
  );
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as TokenizeRequestMessage | undefined;
  if (!data || data.type !== PII_SHIELD_REQUEST) return;
  handleTokenizeRequest(data);
});

function whenBodyReady(callback: () => void): void {
  if (document.body) {
    callback();
    return;
  }
  // Defense in depth: even if run_at timing ever changes, a crash here must
  // never silently abort refreshEntityStore() below it - that would leave
  // the extension looking "active" while actually never having loaded the
  // company's entity list (permanent, invisible fail-safe).
  document.addEventListener('DOMContentLoaded', () => callback(), { once: true });
}

whenBodyReady(() => {
  renderBadge();
  observeResponses(tokenStore);
});

refreshEntityStore();
setInterval(refreshEntityStore, REFRESH_INTERVAL_MS);
