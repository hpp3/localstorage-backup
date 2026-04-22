// User-editable config. Set before building.
// OAuth client is type "Web application".
// Add AUTH_URL's origin (scheme+host+port) to "Authorized JavaScript origins" in GCC.
// No client_secret and no redirect URIs needed for the GIS token flow.

export const OAUTH_CLIENT_ID = '824592760071-rilnfnndjq3amdk260vs118mc7fdris0.apps.googleusercontent.com';

// URL of the hosted `auth.html` page. It must be on an authorized JavaScript
// origin registered in the Cloud Console. For local dev, swap in
// 'http://localhost:3000/auth.html' and rebuild.
export const AUTH_URL = 'https://hpp3.github.io/localstorage-backup-site/auth.html';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
