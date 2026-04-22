import type { BackupFile, BackupKind, BackupListEntry } from './types.js';
import { ROOT_FOLDER_NAME } from './types.js';

export type TokenGetter = (opts?: { forceRefresh?: boolean }) => Promise<string>;

export class DriveError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

interface DriveFileMetadata {
  id: string;
  name: string;
  createdTime?: string;
  appProperties?: Record<string, string>;
}

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class DriveClient {
  constructor(private readonly getToken: TokenGetter) {}

  async findOrCreateRootFolder(): Promise<string> {
    const existing = await this.listFolders({ name: ROOT_FOLDER_NAME, parent: 'root' });
    if (existing.length > 0) return existing[0]!.id;
    return this.createFolder(ROOT_FOLDER_NAME, 'root');
  }

  async findOrCreateSiteFolder(rootId: string, origin: string): Promise<string> {
    const name = sanitizeFolderName(origin);
    const existing = await this.listFolders({ name, parent: rootId });
    if (existing.length > 0) return existing[0]!.id;
    return this.createFolder(name, rootId);
  }

  async findOrCreateKindFolder(siteFolderId: string, kind: BackupKind): Promise<string> {
    const existing = await this.listFolders({ name: kind, parent: siteFolderId });
    if (existing.length > 0) return existing[0]!.id;
    return this.createFolder(kind, siteFolderId);
  }

  async listBackups(folderId: string): Promise<BackupListEntry[]> {
    const q = `'${folderId}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'`;
    const params = new URLSearchParams({
      q,
      orderBy: 'createdTime desc',
      fields: 'files(id,name,createdTime,appProperties)',
      pageSize: '100',
    });
    const res = await this.request(`${API}/files?${params}`);
    const data = (await res.json()) as { files?: DriveFileMetadata[] };
    return (data.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      createdTime: f.createdTime ?? '',
      kind: (f.appProperties?.kind as BackupKind) ?? 'auto',
      deviceName: f.appProperties?.deviceName ?? 'unknown',
    }));
  }

  async uploadBackup(
    folderId: string,
    filename: string,
    backup: BackupFile,
  ): Promise<string> {
    const metadata = {
      name: filename,
      parents: [folderId],
      mimeType: 'application/json',
      appProperties: {
        kind: backup.kind,
        deviceName: backup.device.name,
        deviceId: backup.device.id,
        schemaVersion: String(backup.schemaVersion),
      },
    };
    const boundary = `---gsb-${crypto.randomUUID()}`;
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${JSON.stringify(backup)}\r\n` +
      `--${boundary}--`;

    const res = await this.request(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  async downloadBackup(fileId: string): Promise<BackupFile> {
    const res = await this.request(`${API}/files/${fileId}?alt=media`);
    return (await res.json()) as BackupFile;
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.request(`${API}/files/${fileId}`, { method: 'DELETE' });
  }

  private async listFolders(opts: { name: string; parent: string }): Promise<DriveFileMetadata[]> {
    const q =
      `'${opts.parent}' in parents and ` +
      `name = '${escapeQueryString(opts.name)}' and ` +
      `mimeType = '${FOLDER_MIME}' and trashed = false`;
    const params = new URLSearchParams({
      q,
      fields: 'files(id,name)',
      pageSize: '10',
    });
    const res = await this.request(`${API}/files?${params}`);
    const data = (await res.json()) as { files?: DriveFileMetadata[] };
    return data.files ?? [];
  }

  private async createFolder(name: string, parent: string): Promise<string> {
    const res = await this.request(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
    });
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  private async request(url: string, init: RequestInit = {}, retrying = false): Promise<Response> {
    const token = await this.getToken({ forceRefresh: retrying });
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(url, { ...init, headers });

    if (res.status === 401 && !retrying) {
      return this.request(url, init, true);
    }
    if (!res.ok) {
      let details: unknown;
      try {
        details = await res.json();
      } catch {
        details = await res.text().catch(() => undefined);
      }
      throw new DriveError(`Drive API ${res.status} ${res.statusText}`, res.status, details);
    }
    return res;
  }
}

function escapeQueryString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function sanitizeFolderName(origin: string): string {
  // Folder name is the origin as-is; Drive accepts any unicode except path separators,
  // but slashes aren't meaningful to Drive (not a filesystem). Still, strip characters
  // that could confuse the user's Drive UI.
  return origin.replace(/[\x00-\x1f]/g, '_');
}
