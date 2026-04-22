import { DriveClient } from '../core/drive-client.js';
import { backupFilename, selectForDeletion } from '../core/rotation.js';
import type {
  BackupFile,
  BackupKind,
  BackupListEntry,
  SiteSettings,
} from '../core/types.js';
import { MAX_MANUAL_BACKUPS, SCHEMA_VERSION } from '../core/types.js';
import { restoreLocalStorage, snapshotLocalStorage } from '../extension/injected.js';
import { connectInteractive, disconnect, getAccessToken } from './oauth.js';
import { ensureDeviceInfo, getOrCreateSiteSettings, storage } from './platform.js';

const OVERLAY_HOST_ID = '__localstorage_backup_overlay__';
const pageOrigin = location.origin;

interface AppState {
  deviceName?: string;
  connected: boolean;
  rootFolderId?: string;
  settings?: SiteSettings;
  backups?: BackupListEntry[];
  loadError?: string;
}

function driveClient(): DriveClient {
  return new DriveClient(async (opts) => getAccessToken({ forceRefresh: opts?.forceRefresh }));
}

async function computeState(): Promise<AppState> {
  const [device, rootFolderId, auth, settings] = await Promise.all([
    storage.getDevice(),
    storage.getRootFolderId(),
    storage.getAuth(),
    storage.getSiteSettings(pageOrigin),
  ]);
  const connected = !!auth && !!rootFolderId;
  const state: AppState = {
    deviceName: device?.name,
    connected,
    rootFolderId,
    settings,
  };
  if (!connected || !rootFolderId) return state;
  try {
    const client = driveClient();
    const siteFolderId = await client.findOrCreateSiteFolder(rootFolderId, pageOrigin);
    const [autoFolder, manualFolder] = await Promise.all([
      client.findOrCreateKindFolder(siteFolderId, 'auto'),
      client.findOrCreateKindFolder(siteFolderId, 'manual'),
    ]);
    const [a, m] = await Promise.all([
      client.listBackups(autoFolder),
      client.listBackups(manualFolder),
    ]);
    state.backups = [
      ...a.map((b) => ({ ...b, kind: 'auto' as const })),
      ...m.map((b) => ({ ...b, kind: 'manual' as const })),
    ].sort((x, y) => y.createdTime.localeCompare(x.createdTime));
  } catch (err) {
    state.loadError = err instanceof Error ? err.message : String(err);
    state.backups = [];
  }
  return state;
}

const inProgress = { value: false };

async function backupNow(kind: BackupKind): Promise<BackupListEntry> {
  if (inProgress.value) throw new Error('A backup is already running.');
  inProgress.value = true;
  try {
    const snap = snapshotLocalStorage();
    if (Object.keys(snap.localStorage).length === 0) {
      throw new Error("This page's localStorage is empty — nothing to back up.");
    }
    const device = await ensureDeviceInfo();
    const rootFolderId = await storage.getRootFolderId();
    if (!rootFolderId) throw new Error('Drive not connected');

    const client = driveClient();
    const siteFolderId = await client.findOrCreateSiteFolder(rootFolderId, pageOrigin);
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

    const settings = await getOrCreateSiteSettings(pageOrigin);
    settings.lastBackupAt = createdAt.getTime();
    if (kind === 'auto' && settings.interval > 0) {
      settings.nextEligibleTime = Date.now() + settings.interval * 60_000;
    }
    await storage.setSiteSettings(pageOrigin, settings);

    const limit = kind === 'auto' ? settings.maxAuto : MAX_MANUAL_BACKUPS;
    const existing = await client.listBackups(kindFolderId);
    const toDelete = selectForDeletion(existing, limit);
    await Promise.all(toDelete.map((id) => client.deleteFile(id)));

    return {
      id: fileId,
      name: filename,
      createdTime: backup.createdAt,
      kind,
      deviceName: device.name,
    };
  } finally {
    inProgress.value = false;
  }
}

async function restore(fileId: string): Promise<void> {
  const client = driveClient();
  const backup = await client.downloadBackup(fileId);
  restoreLocalStorage(backup.localStorage);
  document.getElementById(OVERLAY_HOST_ID)?.remove();
  location.reload();
}

async function updateSettings(patch: Partial<SiteSettings>): Promise<SiteSettings> {
  const current = await getOrCreateSiteSettings(pageOrigin);
  const next: SiteSettings = { ...current, ...patch };
  if (patch.interval !== undefined && patch.interval !== current.interval) {
    if (patch.interval === 0) next.nextEligibleTime = 0;
    else if (current.interval === 0) next.nextEligibleTime = Date.now();
    else next.nextEligibleTime = (current.lastBackupAt || Date.now()) + patch.interval * 60_000;
  }
  await storage.setSiteSettings(pageOrigin, next);
  return next;
}

// -------------------- rendering --------------------

const STYLE = `
  :host { all: initial; }
  .wrap { display: flex; justify-content: flex-end;
    padding: env(safe-area-inset-top, 8px) env(safe-area-inset-right, 8px) 0 env(safe-area-inset-left, 8px);
    pointer-events: none; }
  .panel {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #fff; color: #1f2328; border: 1px solid #d0d7de; border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.18); padding: 12px;
    width: min(320px, calc(100vw - 16px));
    box-sizing: border-box;
    max-height: 80vh; overflow-y: auto; font-size: 13px; position: relative;
    pointer-events: auto;
  }
  @media (prefers-color-scheme: dark) {
    .panel { background: #0d1117; color: #e6edf3; border-color: #30363d; }
  }
  h1 { font-size: 14px; margin: 0 0 2px; padding-right: 52px; overflow: hidden;
       text-overflow: ellipsis; white-space: nowrap; }
  .sub { color: #656d76; font-size: 12px; margin-bottom: 8px; }
  @media (prefers-color-scheme: dark) { .sub { color: #8d96a0; } }
  button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid #d0d7de;
    background: #f6f8fa; color: inherit; cursor: pointer; }
  @media (prefers-color-scheme: dark) {
    button { background: #161b22; border-color: #30363d; }
  }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.primary { background: #0969da; border-color: #0969da; color: #fff; }
  button.danger { color: #cf222e; }
  @media (prefers-color-scheme: dark) { button.danger { color: #f85149; } }
  .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .row.spread { justify-content: space-between; }
  .hint { color: #656d76; font-size: 11px; flex: 1; }
  .banner { padding: 8px 10px; border-radius: 6px; background: #f6f8fa;
    border: 1px solid #d0d7de; font-size: 12px; }
  .banner.err { color: #cf222e; border-color: #cf222e; background: rgba(207,34,46,0.06); }
  .banner.warn { color: #9a6700; border-color: #d4a72c; background: #fff8c5; }
  @media (prefers-color-scheme: dark) {
    .banner { background: #161b22; border-color: #30363d; }
    .banner.warn { color: #e3b341; background: #2d2100; border-color: #7d4e00; }
  }
  .divider { border: 0; border-top: 1px solid #d0d7de; margin: 8px 0; }
  @media (prefers-color-scheme: dark) { .divider { border-color: #30363d; } }
  .backup-list { display: flex; flex-direction: column; gap: 6px;
    max-height: 240px; overflow-y: auto; padding: 0; margin: 0; list-style: none; }
  .backup-list li { display: flex; justify-content: space-between; align-items: center;
    gap: 8px; padding: 6px 8px; border: 1px solid #d0d7de; border-radius: 6px;
    background: #f6f8fa; }
  @media (prefers-color-scheme: dark) {
    .backup-list li { background: #161b22; border-color: #30363d; }
  }
  .backup-list li.kind-manual {
    background: rgba(26,127,55,0.18); border-color: rgba(26,127,55,0.55);
  }
  @media (prefers-color-scheme: dark) {
    .backup-list li.kind-manual {
      background: rgba(63,185,80,0.22); border-color: rgba(63,185,80,0.5);
    }
  }
  .meta { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .time { font-weight: 500; }
  .device { color: #656d76; font-size: 11px; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  @media (prefers-color-scheme: dark) { .device { color: #8d96a0; } }
  .kind-tag { font-size: 11px; padding: 1px 6px; border-radius: 999px;
    border: 1px solid #d0d7de; color: #656d76; text-transform: capitalize; }
  @media (prefers-color-scheme: dark) {
    .kind-tag { border-color: #30363d; color: #8d96a0; }
  }
  .top-right { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; }
  .icon-btn { padding: 4px; background: transparent; border: 1px solid transparent;
    line-height: 0; color: #656d76; cursor: pointer; border-radius: 4px; }
  .icon-btn:hover { background: #f6f8fa; border-color: #d0d7de; color: #1f2328; }
  @media (prefers-color-scheme: dark) {
    .icon-btn { color: #8d96a0; }
    .icon-btn:hover { background: #161b22; border-color: #30363d; color: #e6edf3; }
  }
  select, .max-input { font: inherit; padding: 4px 6px; border-radius: 6px;
    border: 1px solid #d0d7de; background: #fff; color: inherit; }
  .max-input { width: 60px; text-align: right; }
  @media (prefers-color-scheme: dark) {
    select, .max-input { background: #0d1117; border-color: #30363d; }
  }
  .settings-row { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
  .settings-row > span:first-child { color: #656d76; font-size: 12px; }
  @media (prefers-color-scheme: dark) { .settings-row > span:first-child { color: #8d96a0; } }
  .settings-note { font-size: 11px; color: #656d76; margin-top: 4px; }
`;

const ICON_CLOSE =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const ICON_LOGOUT =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';

const INTERVAL_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Off' },
  { value: 0.5, label: 'Every 30 seconds (test)' },
  { value: 5, label: 'Every 5 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 120, label: 'Every 2 hours' },
  { value: 240, label: 'Every 4 hours' },
  { value: 480, label: 'Every 8 hours' },
  { value: 1440, label: 'Every 24 hours' },
];

function el(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: Array<Node | string | false | undefined>
): HTMLElement {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const c of children) {
    if (c === false || c === undefined) continue;
    n.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

function iconButton(inner: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'icon-btn';
  b.setAttribute('aria-label', label);
  b.setAttribute('title', label);
  b.innerHTML = inner;
  b.addEventListener('click', onClick);
  return b;
}

function labelButton(
  label: string,
  variant: 'primary' | 'danger' | '',
  onClick: (btn: HTMLButtonElement) => void | Promise<void>,
): HTMLButtonElement {
  const b = document.createElement('button');
  if (variant) b.className = variant;
  b.textContent = label;
  b.addEventListener('click', () => void onClick(b));
  return b;
}

function hostOf(o: string): string {
  try {
    return new URL(o).host;
  } catch {
    return o;
  }
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString();
}

function relativeFuture(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr`;
  return `${Math.floor(h / 24)} day(s)`;
}

let panelRef: HTMLElement | null = null;

function positionHost(host: HTMLElement): void {
  const vv = (window as Window & { visualViewport?: VisualViewport }).visualViewport;
  if (!vv) {
    // No visualViewport support — rely on CSS right:0 via width=100vw fallback.
    host.style.left = '0';
    host.style.width = '100vw';
    return;
  }
  const update = () => {
    host.style.left = `${vv.offsetLeft}px`;
    host.style.top = `${vv.offsetTop}px`;
    host.style.width = `${vv.width}px`;
  };
  update();
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
}

async function refresh(): Promise<void> {
  if (!panelRef) return;
  const state = await computeState();
  renderView(panelRef, state);
  maybeCatchup(state);
}

function renderError(panel: HTMLElement, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  panel.prepend(el('div', { class: 'banner err' }, msg));
}

function renderHeader(state: AppState): HTMLElement {
  const wrap = el('div', { class: 'top-right' });
  if (state.connected) {
    wrap.append(
      iconButton(ICON_LOGOUT, 'Disconnect Google Drive', () => {
        if (panelRef) renderDisconnectConfirm(panelRef);
      }),
    );
  }
  wrap.append(
    iconButton(ICON_CLOSE, 'Close', () => {
      document.getElementById(OVERLAY_HOST_ID)?.remove();
      panelRef = null;
    }),
  );
  return wrap;
}

function renderView(panel: HTMLElement, state: AppState): void {
  panel.innerHTML = '';
  panel.append(renderHeader(state));
  if (!state.connected) return renderConnect(panel);
  renderActive(panel, state);
}

function renderConnect(panel: HTMLElement): void {
  panel.append(
    el('h1', {}, 'LocalStorage Backup'),
    el('div', { class: 'sub' }, `Back up ${hostOf(pageOrigin)} to your Google Drive.`),
    el(
      'div',
      { class: 'row' },
      labelButton('Connect Google Drive', 'primary', async (btn) => {
        btn.disabled = true;
        btn.textContent = 'Connecting…';
        try {
          await connectInteractive();
          await ensureDeviceInfo();
          const rootFolderId = await driveClient().findOrCreateRootFolder();
          await storage.setRootFolderId(rootFolderId);
          await refresh();
        } catch (err) {
          renderError(panel, err);
          btn.disabled = false;
          btn.textContent = 'Connect Google Drive';
        }
      }),
    ),
  );
}

function renderActive(panel: HTMLElement, state: AppState): void {
  const settings = state.settings;
  const backups = state.backups ?? [];

  panel.append(
    el('h1', {}, hostOf(pageOrigin)),
    el(
      'div',
      { class: 'sub' },
      `Device: ${state.deviceName ?? 'unknown'}${
        settings?.lastBackupAt ? ` • Last backup ${relativeTime(settings.lastBackupAt)}` : ' • No backups yet'
      }`,
    ),
    el(
      'div',
      { class: 'row' },
      labelButton('Back up now', 'primary', async (btn) => {
        btn.disabled = true;
        btn.textContent = 'Backing up…';
        try {
          await backupNow('manual');
          await refresh();
        } catch (err) {
          renderError(panel, err);
          btn.disabled = false;
          btn.textContent = 'Back up now';
        }
      }),
      el('span', { class: 'hint' }, `Keeps the last ${MAX_MANUAL_BACKUPS} manual backups.`),
    ),
  );

  if (state.loadError) {
    panel.append(el('div', { class: 'banner err' }, `Couldn't load backups: ${state.loadError}`));
  }

  panel.append(el('hr', { class: 'divider' }));

  if (settings) panel.append(renderSettings(settings));

  panel.append(el('hr', { class: 'divider' }));
  panel.append(el('div', { class: 'row spread' }, el('strong', {}, `Backups (${backups.length})`)));
  panel.append(
    backups.length === 0
      ? el('div', { class: 'sub' }, 'No backups yet.')
      : renderBackupList(backups),
  );
}

function renderSettings(settings: SiteSettings): HTMLElement {
  const wrap = el('div', {});

  const intervalRow = el('label', { class: 'settings-row' }, el('span', {}, 'Auto backup'));
  const intervalSelect = document.createElement('select');
  for (const opt of INTERVAL_OPTIONS) {
    const o = document.createElement('option');
    o.value = String(opt.value);
    o.textContent = opt.label;
    if (opt.value === settings.interval) o.selected = true;
    intervalSelect.append(o);
  }
  intervalSelect.addEventListener('change', async () => {
    intervalSelect.disabled = true;
    try {
      await updateSettings({ interval: Number(intervalSelect.value) as SiteSettings['interval'] });
      await refresh();
    } catch (err) {
      if (panelRef) renderError(panelRef, err);
      intervalSelect.disabled = false;
    }
  });
  intervalRow.append(intervalSelect);

  const maxRow = el('label', { class: 'settings-row' }, el('span', {}, 'Keep last'));
  const maxInput = document.createElement('input');
  maxInput.type = 'number';
  maxInput.min = '1';
  maxInput.max = '100';
  maxInput.value = String(settings.maxAuto);
  maxInput.className = 'max-input';
  maxInput.addEventListener('change', async () => {
    const parsed = Math.max(1, Math.min(100, Math.floor(Number(maxInput.value) || settings.maxAuto)));
    maxInput.value = String(parsed);
    if (parsed === settings.maxAuto) return;
    maxInput.disabled = true;
    try {
      await updateSettings({ maxAuto: parsed });
      await refresh();
    } catch (err) {
      if (panelRef) renderError(panelRef, err);
      maxInput.disabled = false;
    }
  });
  maxRow.append(maxInput, el('span', { class: 'hint' }, 'auto backups'));

  wrap.append(intervalRow, maxRow);

  if (settings.interval > 0 && settings.nextEligibleTime > 0) {
    const delta = settings.nextEligibleTime - Date.now();
    const note = delta <= 0 ? 'Next backup: runs on next tap' : `Next backup: in ${relativeFuture(delta)}`;
    wrap.append(el('div', { class: 'settings-note' }, note));
  }

  return wrap;
}

function renderBackupList(backups: BackupListEntry[]): HTMLElement {
  const ul = el('ul', { class: 'backup-list' });
  for (const b of backups) {
    const row = el(
      'li',
      { class: `kind-${b.kind}` },
      el(
        'div',
        { class: 'meta' },
        el('span', { class: 'time' }, relativeTime(new Date(b.createdTime).getTime())),
        el('span', { class: 'device' }, b.deviceName),
      ),
      el('span', { class: 'kind-tag' }, b.kind),
    );
    const restoreBtn = labelButton('Restore', '', () => promptRestore(row, restoreBtn, b));
    row.append(restoreBtn);
    ul.append(row);
  }
  return ul;
}

function promptRestore(row: HTMLElement, trigger: HTMLButtonElement, backup: BackupListEntry): void {
  const when = new Date(backup.createdTime).toLocaleString();
  const confirmWrap = el(
    'div',
    { class: 'row' },
    el('span', { class: 'hint' }, `Overwrite with ${when}?`),
  );
  const confirmBtn = labelButton('Confirm', 'danger', async (btn) => {
    btn.disabled = true;
    btn.textContent = 'Restoring…';
    try {
      await restore(backup.id);
    } catch (err) {
      if (panelRef) renderError(panelRef, err);
    }
  });
  const cancelBtn = labelButton('Cancel', '', () => confirmWrap.replaceWith(trigger));
  confirmWrap.append(confirmBtn, cancelBtn);
  trigger.replaceWith(confirmWrap);
}

function renderDisconnectConfirm(panel: HTMLElement): void {
  panel.innerHTML = '';
  panel.append(renderHeader({ connected: false }));
  panel.append(
    el('h1', {}, 'Disconnect Google Drive?'),
    el('div', { class: 'sub' }, 'Your existing backups in Drive are kept.'),
    el(
      'div',
      { class: 'row' },
      labelButton('Disconnect', 'danger', async (btn) => {
        btn.disabled = true;
        btn.textContent = 'Disconnecting…';
        try {
          await disconnect();
          await storage.clearRootFolderId();
          await refresh();
        } catch (err) {
          renderError(panel, err);
          btn.disabled = false;
          btn.textContent = 'Disconnect';
        }
      }),
      labelButton('Cancel', '', () => void refresh()),
    ),
  );
}

function maybeCatchup(state: AppState): void {
  if (!state.connected || !state.settings) return;
  if (state.settings.interval <= 0) return;
  if (Date.now() < state.settings.nextEligibleTime) return;
  void (async () => {
    try {
      await backupNow('auto');
      await refresh();
    } catch {
      // silent; don't disturb UI
    }
  })();
}

async function openOverlay(): Promise<void> {
  const existing = document.getElementById(OVERLAY_HOST_ID);
  if (existing) {
    existing.remove();
    panelRef = null;
    return;
  }
  const host = document.createElement('div');
  host.id = OVERLAY_HOST_ID;
  host.style.cssText =
    'all:initial;display:block;position:fixed;top:0;left:0;' +
    'z-index:2147483647;pointer-events:none;';
  positionHost(host);
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  const panel = document.createElement('div');
  panel.className = 'panel';
  wrap.append(panel);
  shadow.append(style, wrap);
  document.body.append(host);
  panelRef = panel;

  panel.append(el('div', { class: 'sub' }, 'Loading…'));
  try {
    const state = await computeState();
    renderView(panel, state);
    maybeCatchup(state);
  } catch (err) {
    renderError(panel, err);
  }
}

void openOverlay();
