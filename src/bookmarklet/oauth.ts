import { storage, type AuthTokens } from './platform.js';
import { AUTH_URL, DRIVE_SCOPE, OAUTH_CLIENT_ID } from './config.js';

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export interface ConnectResult {
  accessToken: string;
}

// Must be called from a user-gesture handler (click) so the popup is allowed.
export async function connectInteractive(): Promise<ConnectResult> {
  const tokens = await openAuthPopup('');
  await storage.setAuth(tokens);
  const email = await fetchUserEmail(tokens.accessToken);
  if (email) await storage.setEmail(email);
  return { accessToken: tokens.accessToken };
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

async function openAuthPopup(prompt: '' | 'none' | 'consent' | 'select_account'): Promise<AuthTokens> {
  const state = randomState();
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', OAUTH_CLIENT_ID);
  url.searchParams.set('scope', DRIVE_SCOPE);
  url.searchParams.set('state', state);
  if (prompt) url.searchParams.set('prompt', prompt);

  const popup = window.open(url.toString(), 'oauth', 'width=480,height=640');
  if (!popup) throw new Error('Popup blocked. Allow popups for this site and try again.');

  return waitForToken(popup, state);
}

function waitForToken(popup: Window, expectedState: string): Promise<AuthTokens> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== popup) return;
      const data = e.data as {
        type?: string;
        access_token?: string;
        expires_in?: number;
        state?: string;
        error?: string;
      };
      if (data?.type !== 'localstorage-backup-oauth') return;
      if (data.state !== expectedState) return;
      cleanup();
      if (data.error) reject(new Error(data.error));
      else if (data.access_token) {
        resolve({
          accessToken: data.access_token,
          expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
        });
      } else {
        reject(new Error('No token returned'));
      }
    };
    const interval = setInterval(() => {
      if (popup.closed && !settled) {
        cleanup();
        reject(new Error('Popup closed before authorization completed'));
      }
    }, 500);
    const cleanup = () => {
      settled = true;
      window.removeEventListener('message', onMessage);
      clearInterval(interval);
      try { popup.close(); } catch { /* ignore */ }
    };
    window.addEventListener('message', onMessage);
  });
}

// Called by DriveClient when it needs a token. If cached token is still valid,
// return it. If expired or forceRefresh, throw an error that the popup layer
// can catch and turn into a Reconnect prompt (silent refresh requires a user
// gesture to open a popup, so we can't do it here).
export async function getAccessToken(opts?: { forceRefresh?: boolean }): Promise<string> {
  const auth = await storage.getAuth();
  if (!auth) throw new Error('Not connected to Google Drive');
  if (!opts?.forceRefresh && Date.now() < auth.expiresAt) return auth.accessToken;
  throw new Error('Session expired — reconnect to Google Drive.');
}

export async function disconnect(): Promise<void> {
  const auth = await storage.getAuth();
  if (auth?.accessToken) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(auth.accessToken)}`, {
      method: 'POST',
    }).catch(() => undefined);
  }
  await storage.clearAuth();
  await storage.clearEmail();
}
