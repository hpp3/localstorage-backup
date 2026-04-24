import type { BackupKind, BackupListEntry, SiteSettings, DeviceInfo } from '../../core/types.js';
import { MAX_MANUAL_BACKUPS } from '../../core/types.js';

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

type Response<T> = { ok: true; data: T } | { ok: false; error: string; details?: unknown };

async function send<T>(msg: unknown): Promise<T> {
  const res = (await chrome.runtime.sendMessage(msg)) as Response<T>;
  if (!res?.ok) throw new Error(res?.error ?? 'Unknown error');
  return res.data;
}

const app = document.getElementById('app')!;

let currentTab: chrome.tabs.Tab | undefined;
let currentOrigin: string | undefined;

init().catch(renderError);

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  currentOrigin = originOf(tab?.url);
  await refresh();
}

async function refresh(): Promise<void> {
  const status = await send<Status>({ type: 'get-status', origin: currentOrigin });
  render(status);
}

function render(status: Status): void {
  app.innerHTML = '';
  if (!navigator.onLine) {
    app.append(el('div', { class: 'banner warn' }, "You're offline. Backups will resume once you're reconnected."));
  }
  if (status.authExpired) {
    app.append(renderAuthExpired());
    return;
  }
  if (!currentOrigin) {
    renderUnsupported();
    return;
  }
  if (!status.driveConnected) {
    renderConnectDrive();
    return;
  }
  app.append(renderAccountBar(status));
  if (!status.hasPermission || !status.settings) {
    renderAddSite(status);
    return;
  }
  renderActive(status);
}

function renderAccountBar(status: Status): HTMLElement {
  const bar = el('div', { class: 'account-bar' });
  if (status.email) {
    bar.append(el('span', { class: 'account-email', title: status.email }, status.email));
  }
  const btn = document.createElement('button');
  btn.className = 'logout-btn';
  btn.setAttribute('aria-label', 'Disconnect Google Drive');
  btn.setAttribute('title', 'Disconnect Google Drive');
  btn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>' +
    '<polyline points="16 17 21 12 16 7"/>' +
    '<line x1="21" y1="12" x2="9" y2="12"/>' +
    '</svg>';
  btn.addEventListener('click', () => renderDisconnectConfirm());
  bar.append(btn);
  return bar;
}

function renderDisconnectConfirm(): void {
  app.innerHTML = '';
  app.append(
    el('h1', {}, 'Disconnect Google Drive?'),
    el(
      'div',
      { class: 'subtitle' },
      'Your existing backups in Drive are kept. You can reconnect any time — Chrome will let you pick a different account.',
    ),
    el(
      'div',
      { class: 'row' },
      button('danger', 'Disconnect', async (btn) => {
        btn.disabled = true;
        btn.textContent = 'Disconnecting…';
        try {
          await send({ type: 'disconnect-drive' });
          await refresh();
        } catch (err) {
          renderError(err);
        }
      }),
      button('', 'Cancel', () => void refresh()),
    ),
  );
}

function renderAuthExpired(): HTMLElement {
  const wrap = el('div', {});
  wrap.append(
    el('h1', {}, 'Drive access expired'),
    el(
      'div',
      { class: 'subtitle' },
      'Google revoked the extension\'s Drive access. Reconnect to resume backups.',
    ),
    button('primary', 'Reconnect Google Drive', async (btn) => {
      btn.disabled = true;
      btn.textContent = 'Connecting…';
      try {
        await send({ type: 'connect-drive' });
        await refresh();
      } catch (err) {
        renderError(err);
      }
    }),
  );
  return wrap;
}

function renderUnsupported(): void {
  const url = currentTab?.url ?? '';
  app.append(
    el('h1', {}, 'LocalStorage Backup'),
    el('div', { class: 'banner' }, url ? `Cannot back up ${url}. Only http(s) pages are supported.` : 'No active tab.'),
  );
}

function renderConnectDrive(): void {
  app.append(
    el('h1', {}, 'Connect Google Drive'),
    el(
      'div',
      { class: 'subtitle' },
      'Backups are stored in your own Drive under a folder called "local-storage-backups". We never see your data.',
    ),
    button('primary', 'Connect Google Drive', async (btn) => {
      btn.disabled = true;
      btn.textContent = 'Connecting…';
      try {
        await send({ type: 'connect-drive' });
        await refresh();
      } catch (err) {
        renderError(err);
      }
    }),
  );
}

function renderAddSite(status: Status): void {
  const origin = currentOrigin!;
  app.append(
    el('h1', {}, hostOf(origin)),
    el('div', { class: 'subtitle' }, `Signed in as ${status.device?.name ?? 'unknown device'}.`),
    el(
      'div',
      { class: 'banner' },
      "This site isn't on your backup list yet. Adding it grants the extension permission to read and write its localStorage.",
    ),
    button('primary', 'Back up this site', async (btn) => {
      btn.disabled = true;
      try {
        const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
        if (!granted) {
          btn.disabled = false;
          return;
        }
        await send({ type: 'init-site', origin });
        await refresh();
      } catch (err) {
        renderError(err);
      }
    }),
  );
}

function renderActive(status: Status): void {
  const origin = currentOrigin!;
  const settings = status.settings!;
  const backups = status.backups ?? [];

  app.append(
    el('h1', {}, hostOf(origin)),
    el(
      'div',
      { class: 'subtitle' },
      `Device: ${status.device?.name ?? 'unknown'}${
        settings.lastBackupAt ? ` • Last backup ${relativeTime(settings.lastBackupAt)}` : ' • No backups yet'
      }`,
    ),
    el(
      'div',
      { class: 'row' },
      button('primary', 'Back up now', (btn) => backupNow(btn, origin, 'manual')),
      el('span', { class: 'manual-hint' }, `Keeps the last ${MAX_MANUAL_BACKUPS} manual backups.`),
    ),
    el('hr', { class: 'divider' }),
    renderSettings(origin, settings, !!status.tabOpen),
    el('hr', { class: 'divider' }),
    el('div', { class: 'row spread' }, el('strong', {}, `Backups (${backups.length})`)),
    backups.length === 0
      ? el('div', { class: 'empty' }, 'No backups yet. Click "Back up now" to create one.')
      : renderBackupList(backups, origin),
    el('hr', { class: 'divider' }),
    renderRemoveSite(origin),
  );
}

function renderRemoveSite(origin: string): HTMLElement {
  const container = el('div', { class: 'remove-site' });
  const removeBtn = button('danger', 'Remove this site', () => {
    container.innerHTML = '';
    container.append(
      el(
        'span',
        { class: 'confirm-text' },
        `Stop backing up ${hostOf(origin)}? Existing Drive backups are kept.`,
      ),
      button('danger', 'Confirm', async (btn) => {
        btn.disabled = true;
        try {
          const removed = await chrome.permissions.remove({ origins: [`${origin}/*`] });
          if (!removed) {
            throw new Error(
              `Chrome refused to revoke host access for ${hostOf(origin)}. ` +
                `Try removing it manually at chrome://extensions.`,
            );
          }
          await send({ type: 'deinit-site', origin });
          await refresh();
        } catch (err) {
          renderError(err);
        }
      }),
      button('', 'Cancel', () => {
        container.innerHTML = '';
        container.append(removeBtn);
      }),
    );
  });
  container.append(removeBtn);
  return container;
}

const INTERVAL_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Off' },
  { value: 5, label: 'Every 5 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 120, label: 'Every 2 hours' },
  { value: 240, label: 'Every 4 hours' },
  { value: 480, label: 'Every 8 hours' },
  { value: 1440, label: 'Every 24 hours' },
];

function renderSettings(origin: string, settings: SiteSettings, tabOpen: boolean): HTMLElement {
  const container = el('div', { class: 'settings' });

  const intervalLabel = el('label', { class: 'settings-row' }, el('span', {}, 'Auto backup'));
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
      await send({
        type: 'update-settings',
        origin,
        patch: { interval: Number(intervalSelect.value) as SiteSettings['interval'] },
      });
      await refresh();
    } catch (err) {
      renderError(err);
      intervalSelect.disabled = false;
    }
  });
  intervalLabel.append(intervalSelect);

  const maxLabel = el('label', { class: 'settings-row' }, el('span', {}, 'Keep last'));
  const maxInput = document.createElement('input');
  maxInput.type = 'number';
  maxInput.min = '1';
  maxInput.max = '100';
  maxInput.step = '1';
  maxInput.value = String(settings.maxAuto);
  maxInput.className = 'max-input';
  const commitMax = async () => {
    const parsed = Math.max(1, Math.min(100, Math.floor(Number(maxInput.value) || settings.maxAuto)));
    maxInput.value = String(parsed);
    if (parsed === settings.maxAuto) return;
    maxInput.disabled = true;
    try {
      await send({ type: 'update-settings', origin, patch: { maxAuto: parsed } });
      await refresh();
    } catch (err) {
      renderError(err);
      maxInput.disabled = false;
    }
  };
  maxInput.addEventListener('change', () => void commitMax());
  maxLabel.append(maxInput, el('span', { class: 'max-suffix' }, 'auto backups'));

  container.append(intervalLabel, maxLabel);

  if (settings.interval > 0) {
    const intervalMs = settings.interval * 60_000;
    const overdueThreshold = settings.interval >= 60 ? intervalMs * 1.5 : intervalMs * 3;
    const sinceLast = settings.lastBackupAt > 0 ? Date.now() - settings.lastBackupAt : Infinity;
    const overdue = !tabOpen && settings.lastBackupAt > 0 && sinceLast > overdueThreshold;

    if (overdue) {
      container.append(
        el(
          'div',
          { class: 'banner warn' },
          `Backups paused — open ${hostOf(origin)} to resume. Last backup ${relativeTime(settings.lastBackupAt)}.`,
        ),
      );
    } else if (settings.nextEligibleTime > 0) {
      const delta = settings.nextEligibleTime - Date.now();
      const note =
        delta <= 0
          ? tabOpen
            ? 'Next backup: any moment now'
            : 'Next backup: paused until tab is open'
          : `Next backup: in ${relativeFuture(delta)}`;
      container.append(el('div', { class: 'settings-note' }, note));
    }
  }

  return container;
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

function renderBackupList(backups: BackupListEntry[], origin: string): HTMLElement {
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
    const restoreBtn = button('', 'Restore', () => promptRestore(row, restoreBtn, origin, b));
    row.append(restoreBtn);
    ul.append(row);
  }
  return ul;
}

function promptRestore(row: HTMLElement, trigger: HTMLButtonElement, origin: string, backup: BackupListEntry): void {
  const when = new Date(backup.createdTime).toLocaleString();
  const confirmRow = el(
    'div',
    { class: 'confirm-row' },
    el(
      'span',
      { class: 'confirm-text' },
      `Overwrite save with ${when} (${backup.deviceName})?`,
    ),
  );
  const confirmBtn = button('danger', 'Confirm', (btn) => doRestore(btn, origin, backup));
  const cancelBtn = button('', 'Cancel', () => {
    confirmRow.replaceWith(trigger);
  });
  confirmRow.append(confirmBtn, cancelBtn);
  trigger.replaceWith(confirmRow);
}

async function doRestore(btn: HTMLButtonElement, origin: string, backup: BackupListEntry): Promise<void> {
  btn.disabled = true;
  btn.textContent = 'Restoring…';
  try {
    await send({ type: 'restore', origin, fileId: backup.id });
    window.close();
  } catch (err) {
    renderError(err);
  }
}

async function backupNow(btn: HTMLButtonElement, origin: string, kind: BackupKind): Promise<void> {
  btn.disabled = true;
  btn.textContent = 'Backing up…';
  try {
    await send({ type: 'backup-now', origin, kind });
    await refresh();
  } catch (err) {
    renderError(err);
  }
}

function renderError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const banner = el('div', { class: 'banner error' }, msg);
  app.prepend(banner);
}

type ChildLike = Node | string | undefined | false;

function el(tag: string, attrs: Record<string, string> = {}, ...children: ChildLike[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) {
    if (c === undefined || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function button(
  variant: 'primary' | 'danger' | '',
  label: string,
  onClick: (btn: HTMLButtonElement) => void | Promise<void>,
): HTMLButtonElement {
  const b = document.createElement('button');
  if (variant) b.className = variant;
  b.textContent = label;
  b.addEventListener('click', () => void onClick(b));
  return b;
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
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
