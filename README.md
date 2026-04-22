# LocalStorage Backup

Back up and restore website `localStorage` to your own Google Drive. Ships as both a Chrome extension and a mobile-friendly bookmarklet.

## Components

- **Chrome extension** (`src/extension/`) — auto-backup on a schedule via `chrome.alarms`, restore + tab reload, per-site settings. Uses `chrome.identity` for OAuth.
- **Bookmarklet** (`src/bookmarklet/`) — lightweight overlay injected into any page. Manual backup + catchup-on-tap auto backup. Uses Google Identity Services (GIS) token flow — no client secret needed.
- **Core** (`src/core/`) — shared Drive client, rotation logic, types.

## Develop

```sh
yarn install       # or npm install
yarn build         # builds extension + bookmarklet to dist/
yarn watch         # rebuild on save
yarn typecheck     # tsc --noEmit
```

Loading the extension: Chrome → `chrome://extensions` → enable Developer mode → "Load unpacked" → select `dist/`.

Local bookmarklet testing: `cd dist/bookmarklet && npx serve -p 3000`, set `AUTH_URL` in `src/bookmarklet/config.ts` to the localhost URL, rebuild.

## Setup

1. **Google Cloud OAuth client** for the extension: type "Chrome extension", paste extension ID. Put client ID in `src/extension/manifest.json`.
2. **Google Cloud OAuth client** for the bookmarklet: type "Web application". Add your hosting origin to "Authorized JavaScript origins" (e.g. `https://<you>.github.io`). Put client ID + hosted `auth.html` URL in `src/bookmarklet/config.ts`.
3. **OAuth consent screen**: External user type, scope `.../auth/drive.file`. Keep in Testing mode and add your own email as a test user; publishing requires Google verification that's not needed for `drive.file`.

## Architecture notes

- `drive.file` scope limits access to files the app creates — no broad Drive access.
- Extension background backups use `chrome.alarms` (30s min period); catchup-once semantics so missed intervals trigger one backup, not a pile-up.
- Bookmarklet uses Shadow DOM + `visualViewport`-aware positioning to survive host pages that force a `<meta viewport>`.
- Both code paths share `src/core/drive-client.ts` which is platform-agnostic (callback-injected token getter).
