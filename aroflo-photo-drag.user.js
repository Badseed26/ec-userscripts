// ==UserScript==
// @name         AroFlo to Ambrose photo drag
// @namespace    ec
// @version      1.6
// @description  Drag photos straight from AroFlo into upload boxes (Ambrose, Tradies Web etc), no downloading
// @match        *://*/*
// @exclude      *://*.aroflo.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @connect      *
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/Badseed26/ec-userscripts/main/aroflo-photo-drag.user.js
// @downloadURL  https://raw.githubusercontent.com/Badseed26/ec-userscripts/main/aroflo-photo-drag.user.js
// ==/UserScript==

// Built from src/aroflo-photo-drag.js by build.py. Change src/aroflo-photo-drag.js, not this file.
(function () {
  // Live updates (23/10): Tampermonkey only checks for a new version every few hours. This checks the repo's latest commit every
  // 2 min (free when nothing's changed) and keeps the newest code here, so a push runs on the next page load. If the new code needs
  // a permission this install hasn't got, or this browser won't run it, the built in copy below runs like before.
  const __ecName = "aroflo-photo-drag", __ecVer = "1.6", __ecHave = new Set(["// @connect *", "// @exclude *://*.aroflo.com/*", "// @grant GM_deleteValue", "// @grant GM_getValue", "// @grant GM_listValues", "// @grant GM_setValue", "// @grant GM_xmlhttpRequest", "// @match *://*/*", "// @run-at document-start"]);
  const __ecInfo0 = typeof GM_info != 'undefined' ? GM_info : null;
  const __ecSay = m => { try { console.log('[live update] ' + __ecName + ': ' + m); } catch (e) {} };
  const __ecCmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
  const __ecMeta = c => { const h = (String(c).match(/==UserScript==([\s\S]*?)==\/UserScript==/) || [])[1] || ''; return { v: (h.match(/^\/\/ @version\s+(\S+)/m) || [])[1] || '', need: (h.match(/^\/\/ @(grant|connect|match|exclude|include|run-at|sandbox)\s+.+$/gm) || []).map(s => s.replace(/\s+/g, ' ').trim()) }; };
  const __ecMissing = need => need.filter(x => !__ecHave.has(x) && !(/^\/\/ @connect /.test(x) && __ecHave.has('// @connect *')));
  // the newer code, run with GM_info saying its own version
  function __ecRun(__ecCode, __ecV) { const GM_info = __ecInfo0 ? Object.assign({}, __ecInfo0, { script: Object.assign({}, __ecInfo0.script, { version: __ecV }) }) : undefined; eval(__ecCode); }
  function __ecLive() {
    let c = null; try { c = GM_getValue('ecLiveCode', null); } catch (e) { return false; }
    if (!c || !c.code || __ecCmp(c.v, __ecVer) <= 0) return false;
    const miss = __ecMissing(__ecMeta(c.code).need); if (miss.length) { __ecSay(c.v + ' needs ' + miss.join(', ') + ', running the built in ' + __ecVer + ' till Tampermonkey updates'); return false; }
    try { eval('0'); } catch (e) { __ecSay('this browser won\'t run live code (' + e.message + '), running the built in ' + __ecVer); return false; }
    try { __ecRun(c.code, c.v); } catch (e) { if (e instanceof SyntaxError) { __ecSay(c.v + ' won\'t parse, running the built in ' + __ecVer); return false; } __ecSay(c.v + ' threw: ' + e.message); }
    __ecSay('running ' + c.v + ' (built in is ' + __ecVer + ')'); return true;
  }
  // keep newer code once it's been fetched (sha = the commit, or raw:<version> when it came the fallback way)
  function __ecTake(code, sha, tag) {
    if (!/==\/UserScript==/.test(code)) return;
    const m = __ecMeta(code); if (!m.v) return;
    if (__ecCmp(m.v, __ecVer) > 0) {
      let ok = true; try { new Function(code); } catch (e) { ok = !(e instanceof SyntaxError); }
      if (!ok) { __ecSay(m.v + ' won\'t parse, not keeping it'); GM_setValue('ecLiveSha', sha); return; }
      const old = GM_getValue('ecLiveCode', null); if (!old || old.v != m.v) __ecSay('got ' + m.v + ', it runs on the next page load');
      GM_setValue('ecLiveCode', { v: m.v, code, sha, at: Date.now() });
    } else GM_setValue('ecLiveCode', null); // Tampermonkey's copy has caught up
    GM_setValue('ecLiveSha', sha); if (tag) GM_setValue('ecLiveEtag', tag);
  }
  // GitHub's commit check is limited per internet address, and on 4G/5G that address is shared with lots of other
  // phones, so it can get turned away. Then the newest file is fetched straight off main instead (5/11).
  function __ecRaw() {
    GM_xmlhttpRequest({ method: 'GET', url: 'https://raw.githubusercontent.com/Badseed26/ec-userscripts/main/src/' + __ecName + '.js?t=' + Date.now(), timeout: 30000, headers: { 'Cache-Control': 'no-cache' }, onload: q => {
      try { if (q.status != 200) return; const v = __ecMeta(q.responseText || '').v; if (v) __ecTake(q.responseText, 'raw:' + v); } catch (e) {} } });
  }
  function __ecCheck() {
    try {
      if (Date.now() - GM_getValue('ecLiveAt', 0) < 2 * 60e3) return; GM_setValue('ecLiveAt', Date.now());
      const et = GM_getValue('ecLiveEtag', ''), hd = { Accept: 'application/vnd.github+json' }; if (et) hd['If-None-Match'] = et;
      GM_xmlhttpRequest({ method: 'GET', url: 'https://api.github.com/repos/Badseed26/ec-userscripts/commits/main', headers: hd, timeout: 20000, onerror: __ecRaw, ontimeout: __ecRaw, onload: r => {
        try {
          if (r.status == 304) return; // nothing new, and it doesn't count against GitHub's limit
          if (r.status != 200) { __ecSay('GitHub said ' + r.status + ', checking the file directly'); return __ecRaw(); }
          const sha = (JSON.parse(r.responseText) || {}).sha, tag = (((r.responseHeaders || '').match(/^etag:\s*(.+)$/mi) || [])[1] || '').trim();
          if (!sha) return; if (sha == GM_getValue('ecLiveSha', '')) { if (tag) GM_setValue('ecLiveEtag', tag); return; }
          GM_xmlhttpRequest({ method: 'GET', url: 'https://raw.githubusercontent.com/Badseed26/ec-userscripts/' + sha + '/src/' + __ecName + '.js', timeout: 30000, onload: q => {
            try { if (q.status == 200) __ecTake(q.responseText || '', sha, tag); } catch (e) {} } });
        } catch (e) {} } });
    } catch (e) {}
  }
  if (window.top === window.self) { __ecCheck(); setInterval(__ecCheck, 2 * 60e3 + 5000); }
  if (__ecLive()) return;
  // ---------- the built in copy (src/aroflo-photo-drag.js at 1.6) ----------

// ---------- one off (18/11/2026): moves this device's saved data over from the old names. Take this block out once every device has run it ----------
try {
  const nn = k => k.replace(/wre/g, 'ec').replace(/Wre/g, 'Ec').replace(/WRE/g, 'EC'), old = /(^|[^A-Za-z])(wre|Wre|WRE)/;
  if (typeof GM_listValues == 'function') for (const k of GM_listValues()) if (old.test(k)) { const n = nn(k); if (GM_getValue(n, undefined) === undefined) GM_setValue(n, GM_getValue(k)); GM_deleteValue(k); }
  if (/aroflo|ambrose|outlook|cnw|tradezone/.test(location.hostname)) for (const k of Object.keys(localStorage)) if (old.test(k)) { const n = nn(k); if (localStorage.getItem(n) == null) localStorage.setItem(n, localStorage.getItem(k)); localStorage.removeItem(k); }
} catch (e) {}

(function () {
  'use strict';

  // ---------- helpers ----------
  function toast(msg, bad) {
    if (!document.body) return;
    let el = document.getElementById('ec-drag-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ec-drag-toast';
      el.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;padding:10px 14px;border-radius:6px;font:14px sans-serif;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.3);transition:opacity .3s;pointer-events:none';
      document.documentElement.appendChild(el);
    }
    el.style.background = bad ? '#b3261e' : '#e8731a';
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.style.opacity = '0'), bad ? 6000 : 2500);
  }

  const types = dt => Array.from((dt && dt.types) || []);
  const hasUrl = dt => types(dt).some(t => t === 'text/uri-list' || t === 'text/html');

  function isEditable(el) {
    return !!(el && el.closest && el.closest('input:not([type=file]), textarea, [contenteditable=""], [contenteditable="true"]'));
  }

  // Nearest upload box to where the mouse is
  function findInput(el) {
    let n = el && el.nodeType === 1 ? el : el && el.parentElement;
    for (let i = 0; n && i < 10; i++, n = n.parentElement) {
      if (n.matches && n.matches('input[type=file]')) return n;
      const f = n.querySelector && n.querySelector('input[type=file]');
      if (f) return f;
    }
    const all = document.querySelectorAll('input[type=file]');
    return all.length === 1 ? all[0] : null;
  }

  function getUrl(dt) {
    const html = dt.getData('text/html');
    if (html) {
      const img = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (img) return img[1].replace(/&amp;/g, '&');
    }
    const uri = dt.getData('text/uri-list');
    if (uri) {
      const first = uri.split(/\r?\n/).map(s => s.trim()).find(s => s && !s.startsWith('#'));
      if (first) return first;
    }
    if (html) {
      const a = html.match(/href=["']([^"']+)["']/i);
      if (a) return a[1].replace(/&amp;/g, '&');
    }
    const txt = (dt.getData('text/plain') || '').trim();
    return /^https?:\/\//i.test(txt) ? txt : null;
  }

  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' };

  function fileName(url, headers, type) {
    const cd = (headers.match(/content-disposition:[^\r\n]*filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)/i) || [])[1];
    let name = cd ? decodeURIComponent(cd) : '';
    if (!name) {
      try { name = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop() || ''); } catch (e) {}
    }
    if (!name || !/\.[a-z0-9]{2,5}$/i.test(name)) name = (name || 'aroflo-photo-' + Date.now()) + '.' + (EXT[type] || 'jpg');
    return name;
  }

  // AroFlo keeps the full-res original at the bare DocStorage link; -large/-medium/-small are cut-down copies
  function fullSize(url) {
    return url.replace(/(\/DocStorage\/[^\/?#]+?)-(large|medium|small|original)(?=$|[?#])/i, '$1');
  }

  function fetchFile(url) {
    url = fullSize(url);
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'blob',
        onload: r => {
          if (r.status < 200 || r.status >= 300) return reject(new Error('AroFlo said ' + r.status + ' (logged in?)'));
          const headers = r.responseHeaders || '';
          const type = ((headers.match(/content-type:\s*([^\s;\r\n]+)/i) || [])[1] || (r.response && r.response.type) || '').toLowerCase();
          if (!type.startsWith('image/') && type !== 'application/pdf') {
            return reject(new Error('that link is a page, not a photo (' + (type || 'unknown') + ')'));
          }
          resolve(new File([r.response], fileName(url, headers, type), { type }));
        },
        onerror: () => reject(new Error('couldn\'t reach the photo')),
      });
    });
  }

  // ---------- take over web-page drags onto upload boxes ----------
  let replaying = false;
  let hinted = false;
  let outlined = null;

  function outline(el) {
    if (outlined === el) return;
    if (outlined) outlined.style.outline = outlined._ecOutline || '';
    outlined = el;
    if (el) { el._ecOutline = el.style.outline; el.style.outline = '3px dashed #e8731a'; }
  }

  // Anything dragged from a web page (it carries a link). Chrome also tags photo drags as "Files",
  // so don't skip those. Plain drags from File Explorer have no link and go through untouched.
  function ours(e) {
    const dt = e.dataTransfer;
    return !replaying && dt && hasUrl(dt) && !isEditable(e.target) && findInput(e.target);
  }

  // Capture phase + stop the page seeing it, so the uploader can't knock it back
  ['dragenter', 'dragover'].forEach(type =>
    window.addEventListener(type, e => {
      if (!ours(e)) { if (type === 'dragover') outline(null); return; }
      e.preventDefault();
      e.stopImmediatePropagation();
      e.dataTransfer.dropEffect = 'copy';
      outline(e.target.closest('[class*="drop" i], [class*="upload" i], [class*="uppy" i]') || e.target);
      if (!hinted) { hinted = true; toast('Drop it on the upload box'); }
    }, true)
  );

  window.addEventListener('dragleave', e => { if (!e.relatedTarget) outline(null); }, true);
  window.addEventListener('dragend', () => { outline(null); hinted = false; }, true);

  window.addEventListener('drop', async e => {
    if (!ours(e)) return;
    const dt = e.dataTransfer;
    const url = getUrl(dt);
    if (!url) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    outline(null);
    hinted = false;
    const target = e.target;
    const x = e.clientX, y = e.clientY;
    toast('Grabbing photo from AroFlo...');

    try {
      const file = await fetchFile(url);

      // 1. Replay the drop on the upload box with a real file in it
      const nd = new DataTransfer();
      nd.items.add(file);
      replaying = true;
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: nd, clientX: x, clientY: y });
      target.dispatchEvent(ev);
      replaying = false;

      // 2. If nothing picked it up, drop it straight into the nearest file input
      if (!ev.defaultPrevented) {
        const input = findInput(target);
        if (!input) throw new Error('no upload box found where you dropped it');
        const one = new DataTransfer();
        one.items.add(file);
        input.files = one.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      toast('Added ' + file.name);
    } catch (err) {
      replaying = false;
      toast('Couldn\'t add photo: ' + err.message, true);
    }
  }, true);
})();
})();
