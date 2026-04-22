import type { BackupListEntry } from './types.js';

export function selectForDeletion(backups: BackupListEntry[], max: number): string[] {
  if (backups.length <= max) return [];
  const sorted = [...backups].sort((a, b) => b.createdTime.localeCompare(a.createdTime));
  return sorted.slice(max).map((b) => b.id);
}

export function backupFilename(createdAt: Date, deviceName: string): string {
  const iso = createdAt.toISOString();
  const safeTime = iso.replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
  const safeName = deviceName.replace(/[^A-Za-z0-9_-]/g, '_');
  return `${safeTime}__${safeName}.json`;
}
