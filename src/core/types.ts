export const SCHEMA_VERSION = 1;

export type BackupKind = 'auto' | 'manual';

export interface DeviceInfo {
  id: string;
  name: string;
}

export interface BackupSource {
  gameOrigin: string;
  topLevelHost: string;
  pageUrl: string;
}

export interface BackupFile {
  schemaVersion: typeof SCHEMA_VERSION;
  kind: BackupKind;
  createdAt: string;
  device: DeviceInfo;
  source: BackupSource;
  localStorage: Record<string, string>;
}

export interface BackupListEntry {
  id: string;
  name: string;
  createdTime: string;
  kind: BackupKind;
  deviceName: string;
}

export type IntervalMinutes = 0 | 0.5 | 5 | 30 | 60 | 120 | 240 | 480 | 1440;

export interface SiteSettings {
  enabled: boolean;
  interval: IntervalMinutes;
  maxAuto: number;
  nextEligibleTime: number;
  lastBackupAt: number;
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  enabled: true,
  interval: 0,
  maxAuto: 10,
  nextEligibleTime: 0,
  lastBackupAt: 0,
};

export const MAX_MANUAL_BACKUPS = 3;

export const ROOT_FOLDER_NAME = 'local-storage-backups';
