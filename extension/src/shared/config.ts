export interface ExtensionConfig {
  backendUrl: string;
  extensionKey: string;
}

const STORAGE_KEY = 'piiShieldConfig';

export async function getConfig(): Promise<ExtensionConfig | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as ExtensionConfig | undefined) ?? null;
}

export async function setConfig(config: ExtensionConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
}
