# Privacy Policy

_Last updated: 2026-04-23_

## What the extension does

**LocalStorage Backup** is a Chrome extension that snapshots a website's `localStorage` and saves it to **your own Google Drive** on a schedule you choose, so you can restore it later. It is designed primarily for preserving save data from web-based idle/incremental games.

## What data is accessed

- **Website localStorage** — on sites you explicitly opt in to. The extension requests host permission one site at a time; sites you haven't opted in to are never read.
- **Your Google account email address** — shown in the popup so you know which account you're connected to. Retrieved via the `userinfo.email` scope once on connect.
- **Google Drive** — limited to the `drive.file` scope. This scope restricts the extension to files it creates itself. It cannot read, modify, or delete any other files in your Drive.

## Where data goes

- Backups are uploaded **exclusively to your own Google Drive**, under a folder the extension creates called `local-storage-backups`.
- The extension has **no backend server**. No data is transmitted anywhere other than Google's servers (Drive API, identity).
- No analytics, tracking, ads, or third-party services.

## What is stored locally

- Extension settings (per-site backup interval, device name) — `chrome.storage.sync` / `chrome.storage.local`. This is local to your Chrome profile.
- Cached Google OAuth token — managed by Chrome's `chrome.identity` API.

## Google API Services User Data Policy

The use of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

Specifically:
- Google user data is used **only** to provide the user-facing feature (snapshot, upload, restore).
- Google user data is **not** sold, used for advertising, used to train AI models, transferred to third parties, or used for any purpose unrelated to the user-facing feature.
- Human reading of user data is prohibited except (1) with explicit user consent, (2) for security purposes, (3) to comply with law, or (4) where the data is aggregated and de-identified.

## Data deletion

- **Uninstall the extension**: clears all locally stored settings.
- **Revoke access at Google**: https://myaccount.google.com/permissions — removes the extension's ability to access your Drive going forward. Existing backup files in your Drive remain under your control; delete them manually if desired.
- **Per-site removal**: the popup's "Remove this site" button revokes host permission for that origin and clears its settings. Backup files are not deleted (you can delete them in Drive).

## Contact

File an issue: https://github.com/hpp3/localstorage-backup/issues
