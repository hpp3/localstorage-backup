export interface SnapshotResult {
  origin: string;
  topLevelHost: string;
  pageUrl: string;
  localStorage: Record<string, string>;
}

export function snapshotLocalStorage(): SnapshotResult {
  const ls: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k === null) continue;
    const v = localStorage.getItem(k);
    if (v !== null) ls[k] = v;
  }
  return {
    origin: location.origin,
    topLevelHost: location.hostname,
    pageUrl: location.href,
    localStorage: ls,
  };
}

export function restoreLocalStorage(data: Record<string, string>): { writtenKeys: number } {
  localStorage.clear();
  let count = 0;
  for (const [k, v] of Object.entries(data)) {
    localStorage.setItem(k, v);
    count++;
  }
  return { writtenKeys: count };
}
