# Chrome Web Store Listing

## Title

```
LocalStorage Backup
```

## Short description (132 char max)

```
Back up any website's localStorage to your own Google Drive on a schedule. Perfect for preserving idle/incremental game saves.
```

## Detailed description

```
Back up and restore any website's localStorage to your own Google Drive, automatically and on a schedule you choose.

Built for players of browser-based idle and incremental games (Cookie Clicker, Universal Paperclips, Candy Box, etc.) whose progress is stored in localStorage and can vanish on a bad sync, a wiped cookie, or a lost device.

━━━ Features ━━━

• Per-site auto-backup: choose an interval from every 5 minutes to every 24 hours
• Manual "Back up now" button for on-demand snapshots
• Restore any previous backup with one click (the tab reloads automatically)
• Keeps the last N automatic backups + the last 3 manual backups, with older ones rotated out
• Backups stored exclusively in your own Google Drive under a folder called "local-storage-backups"
• Auto-backup scheduling with catchup-once semantics: missed intervals are caught up on the next opportunity, never piled up
• Visual overdue warning when a scheduled backup can't run because the tab is closed
• Multi-device friendly: each backup is tagged with a device name you choose

━━━ Privacy ━━━

• Uses the Google Drive "drive.file" scope — the extension can only access files it created itself. Your other Drive files are never touched.
• Requests permission one site at a time. Sites you haven't opted in to are never read.
• No analytics, no tracking, no backend server. Your data goes to your Drive and nowhere else.
• Full privacy policy: https://hpp3.github.io/localstorage-backup/PRIVACY

━━━ Open source ━━━

Source code: https://github.com/hpp3/localstorage-backup

━━━ How to use ━━━

1. Install extension, click the toolbar icon, connect your Google Drive.
2. On a game's page, click the extension icon → "Back up this site" (grants host permission for that site only).
3. Pick an auto-backup interval, or click "Back up now" for a manual snapshot.
4. To restore, click any row in the backup list and confirm.

Works great with Cookie Clicker, Universal Paperclips, A Dark Room, Kittens Game, and any other browser game that stores state in localStorage.
```

## Category

```
Productivity
```

## Language

```
English
```

## Permission justifications (for CWS review)

These go in the "Permission justification" section of the CWS developer dashboard.

### `storage`

Used to store per-site settings (backup interval, max backups to keep, last backup timestamp) locally in the user's Chrome profile. No remote storage.

### `alarms`

Used to schedule periodic backups at the user-chosen interval. Alarms trigger the backup flow when the interval elapses and the site's tab is open.

### `scripting`

Used to inject a small function into the user-opted-in tab that reads or writes `localStorage`. Only runs on sites the user has explicitly granted host permission for.

### `identity`

Used to obtain a Google OAuth token (via `chrome.identity.getAuthToken`) so the extension can upload backups to the user's own Google Drive.

### `activeTab`

Used to determine the currently-active tab's URL when the user opens the popup, so the popup can show settings for the correct site. Applied only on user invocation.

### `optional_host_permissions: ["<all_urls>"]`

Declared as **optional**, not granted at install. The extension requests host permission one site at a time via `chrome.permissions.request` only when the user clicks "Back up this site" for that specific site. Users can revoke it per-site at any time.

## Privacy practices disclosure

- **Personally identifiable information**: The extension collects the user's email address via the OAuth `userinfo.email` scope for the sole purpose of displaying it in the popup (so the user knows which Google account is connected). The email is stored in `chrome.storage.sync` and is never transmitted anywhere other than Google's OAuth servers.
- **Authentication information**: OAuth tokens managed by Chrome's `chrome.identity` API. Not transmitted by the extension to any party other than Google.
- **Website content**: `localStorage` of opted-in sites, for the purpose of backup/restore. Transmitted only to the user's own Google Drive.

## Single purpose

```
Back up and restore the localStorage of user-opted-in websites to the user's own Google Drive.
```

## Homepage URL

```
https://github.com/hpp3/localstorage-backup
```
