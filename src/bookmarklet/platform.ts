import type { DeviceInfo, SiteSettings } from '../core/types.js';
import { DEFAULT_SITE_SETTINGS } from '../core/types.js';

export interface AuthTokens {
  accessToken: string;
  expiresAt: number;
}

const DB_NAME = 'localstorage-backup';
const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_SITES = 'sites';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_SITES)) {
        db.createObjectStore(STORE_SITES, { keyPath: 'origin' });
      }
    };
  });
  return dbPromise;
}

function tx(store: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function metaGet<T>(key: string): Promise<T | undefined> {
  const store = await tx(STORE_META, 'readonly');
  const row = await req<{ key: string; value: T } | undefined>(store.get(key));
  return row?.value;
}

async function metaSet<T>(key: string, value: T): Promise<void> {
  const store = await tx(STORE_META, 'readwrite');
  await req(store.put({ key, value }));
}

async function metaDelete(key: string): Promise<void> {
  const store = await tx(STORE_META, 'readwrite');
  await req(store.delete(key));
}

export const storage = {
  async getDevice(): Promise<DeviceInfo | undefined> {
    return metaGet<DeviceInfo>('device');
  },
  async setDevice(device: DeviceInfo): Promise<void> {
    await metaSet('device', device);
  },
  async getRootFolderId(): Promise<string | undefined> {
    return metaGet<string>('rootFolderId');
  },
  async setRootFolderId(id: string): Promise<void> {
    await metaSet('rootFolderId', id);
  },
  async clearRootFolderId(): Promise<void> {
    await metaDelete('rootFolderId');
  },
  async getAuth(): Promise<AuthTokens | undefined> {
    return metaGet<AuthTokens>('auth');
  },
  async setAuth(auth: AuthTokens): Promise<void> {
    await metaSet('auth', auth);
  },
  async clearAuth(): Promise<void> {
    await metaDelete('auth');
  },
  async getEmail(): Promise<string | undefined> {
    return metaGet<string>('email');
  },
  async setEmail(email: string): Promise<void> {
    await metaSet('email', email);
  },
  async clearEmail(): Promise<void> {
    await metaDelete('email');
  },
  async getSiteSettings(origin: string): Promise<SiteSettings | undefined> {
    const store = await tx(STORE_SITES, 'readonly');
    const row = await req<{ origin: string; settings: SiteSettings } | undefined>(store.get(origin));
    return row?.settings;
  },
  async setSiteSettings(origin: string, settings: SiteSettings): Promise<void> {
    const store = await tx(STORE_SITES, 'readwrite');
    await req(store.put({ origin, settings }));
  },
  async removeSiteSettings(origin: string): Promise<void> {
    const store = await tx(STORE_SITES, 'readwrite');
    await req(store.delete(origin));
  },
};

export async function getOrCreateSiteSettings(origin: string): Promise<SiteSettings> {
  const existing = await storage.getSiteSettings(origin);
  if (existing) return existing;
  const fresh = { ...DEFAULT_SITE_SETTINGS };
  await storage.setSiteSettings(origin, fresh);
  return fresh;
}

export async function ensureDeviceInfo(): Promise<DeviceInfo> {
  const existing = await storage.getDevice();
  if (existing) return existing;
  const plat = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? 'mobile';
  const rand = [...crypto.getRandomValues(new Uint8Array(2))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const device: DeviceInfo = { id: crypto.randomUUID(), name: `${plat}-${rand}` };
  await storage.setDevice(device);
  return device;
}
