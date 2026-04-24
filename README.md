# LocalStorage Backup

Back up and restore any website's `localStorage` to your own Google Drive. Ships as a **Chrome extension** (background auto-backup on a schedule) and a **mobile bookmarklet** (manual + catchup-on-tap).

Primary use case: preserving save data from browser-based idle/incremental games like Cookie Clicker, Universal Paperclips, A Dark Room.

## Components

- **Chrome extension** (`src/extension/`) — auto-backup on a schedule via `chrome.alarms`, restore + tab reload, per-site settings. OAuth via `chrome.identity`.
- **Bookmarklet** (`src/bookmarklet/`) — lightweight Shadow-DOM overlay injected into any page. Manual backup + catchup-on-tap auto backup. OAuth via Google Identity Services token flow (no client secret needed).
- **Core** (`src/core/`) — shared Drive client, rotation logic, types.

## Develop

```sh
npm install
npm run build         # builds extension + bookmarklet into dist/
npm run watch         # rebuild on save
npm run typecheck     # tsc --noEmit
```

Loading the extension locally: `chrome://extensions` → enable Developer mode → "Load unpacked" → select `dist/`.

Local bookmarklet testing:

```sh
cd dist/bookmarklet && npx serve -p 3000
```

Set `AUTH_URL` in `src/bookmarklet/config.ts` to `http://localhost:3000/auth.html`, rebuild, visit `http://localhost:3000/`, drag the install link to your bookmarks bar.

## Google Cloud setup

Two separate OAuth clients — one per surface.

### Extension (Chrome extension OAuth client)

1. Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID → **Application type: Chrome extension**.
2. Paste the extension ID. For unpacked dev, this is shown in `chrome://extensions` after loading.
3. Copy client ID into `src/extension/manifest.json` under `oauth2.client_id`.
4. Rebuild + reload.

**Chicken-and-egg for CWS submission**: the Chrome extension OAuth client is bound to a specific extension ID. Your unpacked local dev ID is different from the stable ID CWS assigns on upload. Two ways to handle this:

- **Option A (recommended)**: upload a first draft to CWS (unlisted), note the stable ID, create a CWS-tied OAuth client for it, update `manifest.json`, re-upload.
- **Option B**: add a `"key"` field to `manifest.json` with a fixed public key to pin the extension ID across unpacked and CWS.

### Bookmarklet (Web application OAuth client)

1. Credentials → Create credentials → OAuth client ID → **Application type: Web application**.
2. Authorized JavaScript origins: wherever you host `auth.html` (e.g. `https://hpp3.github.io`, `http://localhost:3000`).
3. No redirect URIs needed (GIS token flow).
4. Copy client ID into `src/bookmarklet/config.ts`.

### OAuth consent screen

- External user type.
- Scopes: `.../auth/drive.file` and `.../auth/userinfo.email`. Both are non-sensitive; no Google verification required.
- Keep in Testing mode for development. **Publish to Production** before CWS submission so any user can authorize.

## Chrome Web Store submission checklist

1. `npm run build`, verify `dist/` loads cleanly as an unpacked extension.
2. Zip `dist/` contents: `cd dist && zip -r ../localstorage-backup.zip .`
3. Register a [Chrome Web Store developer account](https://chrome.google.com/webstore/devconsole) ($5 one-time fee).
4. Create a new item, upload `localstorage-backup.zip`.
5. Fill in the store listing using copy from [`STORE.md`](./STORE.md). Privacy policy URL: `https://hpp3.github.io/localstorage-backup/PRIVACY`.
6. Upload 1–5 screenshots (1280×800 or 640×400) showing the popup in action.
7. Paste permission justifications from `STORE.md`.
8. Submit for review. Non-sensitive scopes typically clear in 1–5 business days.
9. After approval: the CWS-assigned extension ID becomes stable. Verify the OAuth client is tied to this ID.

## Architecture notes

- `drive.file` scope restricts the extension to files it created — no broad Drive access.
- Extension background backups use `chrome.alarms` (30s min period); catchup-once semantics so missed intervals trigger one backup, not a pile-up.
- Bookmarklet uses Shadow DOM + `visualViewport`-aware positioning to survive host pages that force a `<meta viewport>`.
- Both share `src/core/drive-client.ts` — platform-agnostic (callback-injected token getter).

## License

MIT — see [`LICENSE`](./LICENSE).
