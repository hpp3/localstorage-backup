import { DriveClient, DriveError } from '../core/drive-client.js';
import { backupFilename, selectForDeletion } from '../core/rotation.js';
import type {
  BackupFile,
  BackupKind,
  BackupListEntry,
  DeviceInfo,
  SiteSettings,
} from '../core/types.js';
import { MAX_MANUAL_BACKUPS, SCHEMA_VERSION } from '../core/types.js';
import {
  ensureDeviceInfo,
  findTabByOrigin,
  getAuthToken,
  getOrCreateSiteSettings,
  hasHostPermission,
  storage,
} from './platform.js';
import { restoreLocalStorage, snapshotLocalStorage } from './injected.js';
import type { SnapshotResult } from './injected.js';

type Request =
  | { type: 'get-status'; origin?: string }
  | { type: 'connect-drive' }
  | { type: 'init-site'; origin: string }
  | { type: 'deinit-site'; origin: string }
  | { type: 'backup-now'; origin: string; kind: BackupKind }
  | { type: 'restore'; origin: string; fileId: string }
  | { type: 'list-backups'; origin: string }
  | { type: 'update-settings'; origin: string; patch: Partial<SiteSettings> }
  | { type: 'disconnect-drive' };

const ALARM_PREFIX = 'autobackup:';
const alarmName = (origin: string) => `${ALARM_PREFIX}${origin}`;

const backupInProgress = new Set<string>();

interface Status {
  driveConnected: boolean;
  device?: DeviceInfo;
  email?: string;
  origin?: string;
  hasPermission: boolean;
  settings?: SiteSettings;
  backups?: BackupListEntry[];
  authExpired?: boolean;
  tabOpen?: boolean;
}

chrome.runtime.onMessage.addListener((msg: Request, _sender, sendResponse) => {
  handleMessage(msg)
    .then((result) => sendResponse({ ok: true, data: result }))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const details = err instanceof DriveError ? err.details : undefined;
      sendResponse({ ok: false, error: message, details });
    });
  return true;
});

async function handleMessage(msg: Request): Promise<unknown> {
  switch (msg.type) {
    case 'get-status':
      return getStatus(msg.origin);
    case 'connect-drive':
      return connectDrive();
    case 'init-site':
      return initSite(msg.origin);
    case 'deinit-site':
      return deinitSite(msg.origin);
    case 'backup-now':
      return backupNow(msg.origin, msg.kind);
    case 'restore':
      return restore(msg.origin, msg.fileId);
    case 'list-backups':
      return listBackups(msg.origin);
    case 'update-settings':
      return updateSettings(msg.origin, msg.patch);
    case 'disconnect-drive':
      return disconnectDrive();
  }
}

async function disconnectDrive(): Promise<void> {
  // Grab the current token so we can revoke it at Google, then clear Chrome's cache.
  const token = await new Promise<string | undefined>((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (t) => {
      void chrome.runtime.lastError;
      resolve(t || undefined);
    });
  });
  if (token) {
    // Best-effort revoke so Chrome can't silently re-grant the same account.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
    }).catch(() => undefined);
    await new Promise<void>((resolve) => {
      chrome.identity.removeCachedAuthToken({ token }, () => resolve());
    });
  }
  await new Promise<void>((resolve) => {
    chrome.identity.clearAllCachedAuthTokens(() => resolve());
  });
  await chrome.storage.sync.remove(['rootFolderId', 'email']);
}

async function getStatus(origin?: string): Promise<Status> {
  const [{ rootFolderId, email }, device] = await Promise.all([
    storage.getSync(),
    storage.getDevice(),
  ]);
  const driveConnected = !!device && !!rootFolderId;
  const status: Status = {
    driveConnected,
    device,
    email,
    origin,
    hasPermission: false,
  };
  if (origin) {
    status.hasPermission = await hasHostPermission(origin);
    status.settings = await storage.getSiteSettings(origin);
    if (status.hasPermission) {
      const tab = await findTabByOrigin(origin);
      status.tabOpen = !!tab?.id;
    }
    if (driveConnected && status.settings && status.hasPermission) {
      try {
        status.backups = await listBackups(origin);
      } catch (err) {
        status.backups = [];
        if (err instanceof DriveError && err.status === 401) status.authExpired = true;
      }
      void tryCatchupBackup(origin);
    }
  }
  return status;
}

async function updateSettings(origin: string, patch: Partial<SiteSettings>): Promise<SiteSettings> {
  const current = await getOrCreateSiteSettings(origin);
  const next: SiteSettings = { ...current, ...patch };
  if (patch.interval !== undefined && patch.interval !== current.interval) {
    if (patch.interval === 0) {
      next.nextEligibleTime = 0;
    } else if (current.interval === 0) {
      // Just enabled: back up right away.
      next.nextEligibleTime = Date.now();
    } else {
      // Changing interval mid-stream: schedule relative to last backup.
      next.nextEligibleTime = (current.lastBackupAt || Date.now()) + patch.interval * 60_000;
    }
  }
  await storage.setSiteSettings(origin, next);
  await scheduleFor(origin, next);
  if (next.interval > 0 && next.nextEligibleTime <= Date.now()) {
    void tryCatchupBackup(origin);
  }
  return next;
}

async function scheduleFor(origin: string, settings: SiteSettings): Promise<void> {
  await chrome.alarms.clear(alarmName(origin));
  if (!settings.enabled || settings.interval <= 0) return;
  await chrome.alarms.create(alarmName(origin), {
    periodInMinutes: settings.interval,
    delayInMinutes: settings.interval,
  });
}

async function tryCatchupBackup(origin: string): Promise<boolean> {
  if (backupInProgress.has(origin)) return false;
  backupInProgress.add(origin);
  try {
    const settings = await storage.getSiteSettings(origin);
    if (!settings || !settings.enabled || settings.interval <= 0) return false;
    if (Date.now() < settings.nextEligibleTime) return false;
    if (!(await hasHostPermission(origin))) return false;
    const tab = await findTabByOrigin(origin);
    if (!tab?.id) return false;
    await backupNow(origin, 'auto');
    const updated = await getOrCreateSiteSettings(origin);
    updated.nextEligibleTime = Date.now() + settings.interval * 60_000;
    await storage.setSiteSettings(origin, updated);
    return true;
  } catch {
    return false;
  } finally {
    backupInProgress.delete(origin);
  }
}

async function connectDrive(): Promise<DeviceInfo> {
  const token = await getAuthToken({ interactive: true });
  await ensureDriveScope(token);
  const device = await ensureDeviceInfo();
  const client = driveClient();
  const rootFolderId = await client.findOrCreateRootFolder();
  const email = await fetchUserEmail(token);
  await storage.setSync({ rootFolderId, ...(email ? { email } : {}) });
  return device;
}

const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/drive.file';

async function ensureDriveScope(token: string): Promise<void> {
  let granted: string[];
  try {
    const res = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`);
    if (!res.ok) return; // tokeninfo unavailable; let later API calls surface a real error
    const json = (await res.json()) as { scope?: string };
    granted = (json.scope ?? '').split(' ').filter(Boolean);
  } catch {
    return; // network or parse error; same reasoning
  }
  if (!granted.includes(REQUIRED_SCOPE)) {
    // User unchecked Drive access on the consent screen. Token is unusable.
    await new Promise<void>((resolve) => {
      chrome.identity.removeCachedAuthToken({ token }, () => resolve());
    });
    throw new Error(
      'Drive access was not granted. Please reconnect and keep the "See, edit, create, and delete only the specific Google Drive files you use with this app" permission checked.',
    );
  }
}

async function fetchUserEmail(token: string): Promise<string | undefined> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { email?: string };
    return json.email;
  } catch {
    return undefined;
  }
}

async function initSite(origin: string): Promise<SiteSettings> {
  if (!(await hasHostPermission(origin))) {
    throw new Error('Host permission not granted for this site');
  }
  const settings = await getOrCreateSiteSettings(origin);
  await scheduleFor(origin, settings);
  return settings;
}

async function deinitSite(origin: string): Promise<void> {
  await chrome.alarms.clear(alarmName(origin));
  await storage.removeSiteSettings(origin);
}

async function backupNow(origin: string, kind: BackupKind): Promise<BackupListEntry> {
  if (!(await hasHostPermission(origin))) {
    throw new Error('Host permission not granted');
  }
  const tab = await findTabByOrigin(origin);
  if (!tab?.id) throw new Error(`No open tab for ${origin}`);

  const [execResult] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: snapshotLocalStorage,
  });
  const snap = execResult?.result as SnapshotResult | undefined;
  if (!snap) throw new Error('Snapshot failed');
  if (Object.keys(snap.localStorage).length === 0) {
    throw new Error("This page's localStorage is empty — nothing to back up.");
  }

  const device = await ensureDeviceInfo();
  const { rootFolderId } = await storage.getSync();
  if (!rootFolderId) throw new Error('Drive not connected');

  const client = driveClient();
  const siteFolderId = await client.findOrCreateSiteFolder(rootFolderId, origin);
  const kindFolderId = await client.findOrCreateKindFolder(siteFolderId, kind);

  const createdAt = new Date();
  const backup: BackupFile = {
    schemaVersion: SCHEMA_VERSION,
    kind,
    createdAt: createdAt.toISOString(),
    device,
    source: {
      gameOrigin: snap.origin,
      topLevelHost: snap.topLevelHost,
      pageUrl: snap.pageUrl,
    },
    localStorage: snap.localStorage,
  };

  const filename = backupFilename(createdAt, device.name);
  const fileId = await client.uploadBackup(kindFolderId, filename, backup);

  const settings = await getOrCreateSiteSettings(origin);
  settings.lastBackupAt = createdAt.getTime();
  await storage.setSiteSettings(origin, settings);

  await rotate(client, kindFolderId, kind, settings.maxAuto);

  return {
    id: fileId,
    name: filename,
    createdTime: backup.createdAt,
    kind,
    deviceName: device.name,
  };
}

async function rotate(
  client: DriveClient,
  folderId: string,
  kind: BackupKind,
  maxAuto: number,
): Promise<void> {
  const limit = kind === 'auto' ? maxAuto : MAX_MANUAL_BACKUPS;
  const existing = await client.listBackups(folderId);
  const toDelete = selectForDeletion(existing, limit);
  await Promise.all(toDelete.map((id) => client.deleteFile(id)));
}

async function restore(origin: string, fileId: string): Promise<{ reloaded: boolean }> {
  if (!(await hasHostPermission(origin))) {
    throw new Error('Host permission not granted');
  }
  const tab = await findTabByOrigin(origin);
  if (!tab?.id) throw new Error(`No open tab for ${origin}`);

  const client = driveClient();
  const backup = await client.downloadBackup(fileId);

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: restoreLocalStorage,
    args: [backup.localStorage],
  });
  await chrome.tabs.reload(tab.id);
  return { reloaded: true };
}

async function listBackups(origin: string): Promise<BackupListEntry[]> {
  const { rootFolderId } = await storage.getSync();
  if (!rootFolderId) return [];
  const client = driveClient();
  const siteFolderId = await client.findOrCreateSiteFolder(rootFolderId, origin);
  const [autoFolder, manualFolder] = await Promise.all([
    client.findOrCreateKindFolder(siteFolderId, 'auto'),
    client.findOrCreateKindFolder(siteFolderId, 'manual'),
  ]);
  const [autoList, manualList] = await Promise.all([
    client.listBackups(autoFolder),
    client.listBackups(manualFolder),
  ]);
  const entries = [
    ...autoList.map((b) => ({ ...b, kind: 'auto' as const })),
    ...manualList.map((b) => ({ ...b, kind: 'manual' as const })),
  ];
  return entries.sort((a, b) => b.createdTime.localeCompare(a.createdTime));
}

function driveClient(): DriveClient {
  return new DriveClient((opts) => getAuthToken({ interactive: false, forceRefresh: opts?.forceRefresh }));
}

chrome.permissions.onRemoved.addListener((perms) => {
  if (!perms.origins) return;
  void (async () => {
    for (const pattern of perms.origins ?? []) {
      const origin = pattern.replace(/\/\*$/, '');
      await chrome.alarms.clear(alarmName(origin));
      await storage.removeSiteSettings(origin);
    }
  })();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const origin = alarm.name.slice(ALARM_PREFIX.length);
  void tryCatchupBackup(origin);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void (async () => {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    const origin = originFromUrl(tab?.url);
    if (!origin) return;
    const settings = await storage.getSiteSettings(origin);
    if (!settings) return;
    await tryCatchupBackup(origin);
  })();
});

function originFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}

async function rearmAllAlarms(): Promise<void> {
  const all = await storage.getAllSiteSettings();
  for (const [origin, settings] of Object.entries(all)) {
    await scheduleFor(origin, settings);
  }
}

chrome.runtime.onStartup.addListener(() => void rearmAllAlarms());
chrome.runtime.onInstalled.addListener(() => void rearmAllAlarms());
