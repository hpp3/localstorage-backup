import type { DeviceInfo, SiteSettings } from '../core/types.js';
import { DEFAULT_SITE_SETTINGS } from '../core/types.js';

type SyncShape = {
  device?: DeviceInfo;
  rootFolderId?: string;
};

type LocalShape = {
  siteSettings?: Record<string, SiteSettings>;
};

export const storage = {
  async getSync(): Promise<SyncShape> {
    return (await chrome.storage.sync.get(['device', 'rootFolderId'])) as SyncShape;
  },
  async setSync(patch: Partial<SyncShape>): Promise<void> {
    await chrome.storage.sync.set(patch);
  },
  async getSiteSettings(origin: string): Promise<SiteSettings | undefined> {
    const { siteSettings } = (await chrome.storage.local.get('siteSettings')) as LocalShape;
    return siteSettings?.[origin];
  },
  async setSiteSettings(origin: string, settings: SiteSettings): Promise<void> {
    const { siteSettings = {} } = (await chrome.storage.local.get('siteSettings')) as LocalShape;
    siteSettings[origin] = settings;
    await chrome.storage.local.set({ siteSettings });
  },
  async removeSiteSettings(origin: string): Promise<void> {
    const { siteSettings = {} } = (await chrome.storage.local.get('siteSettings')) as LocalShape;
    delete siteSettings[origin];
    await chrome.storage.local.set({ siteSettings });
  },
  async getAllSiteSettings(): Promise<Record<string, SiteSettings>> {
    const { siteSettings = {} } = (await chrome.storage.local.get('siteSettings')) as LocalShape;
    return siteSettings;
  },
};

export async function getAuthToken(opts?: { interactive?: boolean; forceRefresh?: boolean }): Promise<string> {
  if (opts?.forceRefresh) {
    const cached = await new Promise<string | undefined>((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (t) => {
        if (chrome.runtime.lastError) resolve(undefined);
        else resolve(t);
      });
    });
    if (cached) {
      await new Promise<void>((resolve) =>
        chrome.identity.removeCachedAuthToken({ token: cached }, () => resolve()),
      );
    }
  }
  return new Promise<string>((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: opts?.interactive ?? false }, (token) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!token) return reject(new Error('No auth token returned'));
      resolve(token);
    });
  });
}

export async function hasHostPermission(origin: string): Promise<boolean> {
  return chrome.permissions.contains({ origins: [`${origin}/*`] });
}

export async function requestHostPermission(origin: string): Promise<boolean> {
  return chrome.permissions.request({ origins: [`${origin}/*`] });
}

export async function removeHostPermission(origin: string): Promise<boolean> {
  return chrome.permissions.remove({ origins: [`${origin}/*`] });
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export async function findTabByOrigin(origin: string): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  return tabs.find((t) => !t.discarded) ?? tabs[0];
}

export function defaultDeviceName(): string {
  const plat = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? 'device';
  const rand = [...crypto.getRandomValues(new Uint8Array(2))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${plat}-${rand}`;
}

export async function ensureDeviceInfo(): Promise<DeviceInfo> {
  const { device } = await storage.getSync();
  if (device) return device;
  const newDevice: DeviceInfo = { id: crypto.randomUUID(), name: defaultDeviceName() };
  await storage.setSync({ device: newDevice });
  return newDevice;
}

export async function getOrCreateSiteSettings(origin: string): Promise<SiteSettings> {
  const existing = await storage.getSiteSettings(origin);
  if (existing) return existing;
  const fresh = { ...DEFAULT_SITE_SETTINGS };
  await storage.setSiteSettings(origin, fresh);
  return fresh;
}

export function originOfUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}
