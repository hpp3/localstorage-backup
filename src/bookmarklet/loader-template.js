// This file is not bundled. It's a template used by build.mjs to emit a
// bookmarklet URL. The {{MAIN_URL}} placeholder is replaced at build time
// with the full URL to the hosted main.js.
javascript:(function(){var s=document.createElement('script');s.src='{{MAIN_URL}}?t='+Date.now();document.body.appendChild(s);})();
