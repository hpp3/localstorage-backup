import { context, build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const srcDir = resolve(root, 'src');
const distDir = resolve(root, 'dist');
const watchMode = process.argv.includes('--watch');

const extensionBuild = {
  entryPoints: {
    sw: resolve(srcDir, 'extension/sw.ts'),
    'popup/popup': resolve(srcDir, 'extension/popup/popup.ts'),
  },
  bundle: true,
  outdir: distDir,
  format: 'esm',
  target: 'chrome120',
  platform: 'browser',
  sourcemap: watchMode ? 'inline' : false,
  minify: !watchMode,
  logLevel: 'info',
};

const bookmarkletDist = resolve(distDir, 'bookmarklet');
const bookmarkletBuild = {
  entryPoints: { main: resolve(srcDir, 'bookmarklet/main.ts') },
  bundle: true,
  outdir: bookmarkletDist,
  format: 'iife',
  target: ['chrome100', 'safari15', 'firefox100'],
  platform: 'browser',
  sourcemap: watchMode ? 'inline' : false,
  minify: !watchMode,
  logLevel: 'info',
};

async function copyExtensionStatic() {
  await mkdir(distDir, { recursive: true });
  await cp(resolve(srcDir, 'extension/manifest.json'), resolve(distDir, 'manifest.json'));
  await mkdir(resolve(distDir, 'popup'), { recursive: true });
  await cp(resolve(srcDir, 'extension/popup/index.html'), resolve(distDir, 'popup/index.html'));
  await cp(resolve(srcDir, 'extension/popup/popup.css'), resolve(distDir, 'popup/popup.css'));
  if (existsSync(resolve(root, 'icons'))) {
    await cp(resolve(root, 'icons'), resolve(distDir, 'icons'), { recursive: true });
  }
}

async function copyBookmarkletStatic() {
  await mkdir(bookmarkletDist, { recursive: true });
  await cp(
    resolve(srcDir, 'bookmarklet/auth.html'),
    resolve(bookmarkletDist, 'auth.html'),
  );
  // Disable `npx serve`'s cleanUrls so `/auth.html` isn't 301'd
  // (which strips query params).
  await writeFile(
    resolve(bookmarkletDist, 'serve.json'),
    JSON.stringify({ cleanUrls: false, trailingSlash: false }, null, 2),
  );
}

async function emitBookmarkletInstallPage() {
  const configSrc = await readFile(resolve(srcDir, 'bookmarklet/config.ts'), 'utf8');
  const authMatch = configSrc.match(/AUTH_URL\s*=\s*'([^']+)'/);
  const authUrl = authMatch?.[1] ?? '';
  let mainUrl = 'REPLACE_WITH_HOSTED_MAIN_JS_URL';
  if (authUrl && !authUrl.includes('REPLACE_ME')) {
    mainUrl = authUrl.replace(/\/auth\.html$/, '/main.js');
  }
  const loader =
    `javascript:(function(){var s=document.createElement('script');s.src='${mainUrl}?t='+Date.now();document.body.appendChild(s);})();`;
  const installHtml = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LocalStorage Backup — install bookmarklet</title>
<style>
  body { font-family: system-ui; max-width: 640px; margin: 40px auto; padding: 0 16px; color: #1f2328; }
  a.bm { display: inline-block; padding: 8px 16px; background: #0969da; color: #fff; border-radius: 6px; text-decoration: none; }
  pre { white-space: pre-wrap; word-break: break-all; background: #f6f8fa; padding: 12px; border-radius: 6px; }
  .row { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
  button { font: inherit; padding: 8px 14px; border: 1px solid #d0d7de; background: #f6f8fa; border-radius: 6px; cursor: pointer; }
  button:hover:not(:disabled) { background: #e4e8ec; }
  button.copied { background: #1a7f37; color: #fff; border-color: #1a7f37; }
</style>
<h1>Install the bookmarklet</h1>
<p><b>Desktop:</b> drag this link to your bookmarks bar.</p>
<p><b>Mobile:</b> bookmark any regular page, then edit the saved bookmark and paste the raw URL below as its address.</p>
<p><a class="bm" href="${loader.replace(/"/g, '&quot;')}">LocalStorage Backup</a></p>
<h2>Raw URL</h2>
<div class="row">
  <button id="copy">Copy to clipboard</button>
  <span id="copy-status" style="color:#656d76;font-size:12px"></span>
</div>
<pre id="raw">${loader}</pre>
<h2>What it points to</h2>
<p>Main script: <code>${mainUrl}</code></p>
<p>Auth page: <code>${authUrl || '(not set)'}</code></p>
<script>
document.getElementById('copy').addEventListener('click', async function () {
  var btn = this;
  var text = document.getElementById('raw').textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add('copied');
    btn.textContent = 'Copied!';
    setTimeout(function () { btn.classList.remove('copied'); btn.textContent = 'Copy to clipboard'; }, 1500);
  } catch (err) {
    document.getElementById('copy-status').textContent = 'Copy failed — select the text manually.';
  }
});
</script>
`;
  await writeFile(resolve(bookmarkletDist, 'index.html'), installHtml);
  await writeFile(resolve(bookmarkletDist, 'bookmarklet.txt'), loader + '\n');
}

async function run() {
  await rm(distDir, { recursive: true, force: true });
  await copyExtensionStatic();
  await copyBookmarkletStatic();

  if (watchMode) {
    const ext = await context(extensionBuild);
    const bm = await context(bookmarkletBuild);
    await Promise.all([ext.watch(), bm.watch()]);
    await emitBookmarkletInstallPage();
    console.log('watching...');
  } else {
    await build(extensionBuild);
    await build(bookmarkletBuild);
    await emitBookmarkletInstallPage();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
