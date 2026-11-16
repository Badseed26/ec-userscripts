// ==UserScript==
// @name         WRE solar orders
// @namespace    wre
// @version      0.1
// @description  Solar orders button on the AroFlo calendar: lists the solar replacement jobs booked in the next X days with the lads' notes, the PO, photos and your notes, works out the panels and inverter from the label photos and notes (Haiku sorts the photos, Opus reads them), adds rails and TIN kits by rule, matches it all on Tradezone with Gold Coast stock, runs a checklist, keeps approved orders in Todoist and loads one job at a time into the Tradezone cart with the PO ref. Never orders, you do that.
// @match        https://office.aroflo.com/ims/Site/Calendar/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      www.tradezone.com.au
// @connect      api.anthropic.com
// @connect      api.todoist.com
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Badseed26/wre-userscripts/main/wre-solar-orders.user.js
// @downloadURL  https://raw.githubusercontent.com/Badseed26/wre-userscripts/main/wre-solar-orders.user.js
// ==/UserScript==

// Built from src/wre-solar-orders.js by build.py. Change src/wre-solar-orders.js, not this file.
(function () {
  // Live updates (23/10): Tampermonkey only checks for a new version every few hours. This checks the repo's latest commit every
  // 2 min (free when nothing's changed) and keeps the newest code here, so a push runs on the next page load. If the new code needs
  // a permission this install hasn't got, or this browser won't run it, the built in copy below runs like before.
  const __wreName = "wre-solar-orders", __wreVer = "0.1", __wreHave = new Set(["// @connect api.anthropic.com", "// @connect api.github.com", "// @connect api.todoist.com", "// @connect raw.githubusercontent.com", "// @connect www.tradezone.com.au", "// @grant GM_getValue", "// @grant GM_setValue", "// @grant GM_xmlhttpRequest", "// @grant unsafeWindow", "// @match https://office.aroflo.com/ims/Site/Calendar/*", "// @run-at document-idle"]);
  const __wreInfo0 = typeof GM_info != 'undefined' ? GM_info : null;
  const __wreSay = m => { try { console.log('[WRE live update] ' + __wreName + ': ' + m); } catch (e) {} };
  const __wreCmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
  const __wreMeta = c => { const h = (String(c).match(/==UserScript==([\s\S]*?)==\/UserScript==/) || [])[1] || ''; return { v: (h.match(/^\/\/ @version\s+(\S+)/m) || [])[1] || '', need: (h.match(/^\/\/ @(grant|connect|match|exclude|include|run-at|sandbox)\s+.+$/gm) || []).map(s => s.replace(/\s+/g, ' ').trim()) }; };
  const __wreMissing = need => need.filter(x => !__wreHave.has(x) && !(/^\/\/ @connect /.test(x) && __wreHave.has('// @connect *')));
  // the newer code, run with GM_info saying its own version
  function __wreRun(__wreCode, __wreV) { const GM_info = __wreInfo0 ? Object.assign({}, __wreInfo0, { script: Object.assign({}, __wreInfo0.script, { version: __wreV }) }) : undefined; eval(__wreCode); }
  function __wreLive() {
    let c = null; try { c = GM_getValue('wreLiveCode', null); } catch (e) { return false; }
    if (!c || !c.code || __wreCmp(c.v, __wreVer) <= 0) return false;
    const miss = __wreMissing(__wreMeta(c.code).need); if (miss.length) { __wreSay(c.v + ' needs ' + miss.join(', ') + ', running the built in ' + __wreVer + ' till Tampermonkey updates'); return false; }
    try { eval('0'); } catch (e) { __wreSay('this browser won\'t run live code (' + e.message + '), running the built in ' + __wreVer); return false; }
    try { __wreRun(c.code, c.v); } catch (e) { if (e instanceof SyntaxError) { __wreSay(c.v + ' won\'t parse, running the built in ' + __wreVer); return false; } __wreSay(c.v + ' threw: ' + e.message); }
    __wreSay('running ' + c.v + ' (built in is ' + __wreVer + ')'); return true;
  }
  // keep newer code once it's been fetched (sha = the commit, or raw:<version> when it came the fallback way)
  function __wreTake(code, sha, tag) {
    if (!/==\/UserScript==/.test(code)) return;
    const m = __wreMeta(code); if (!m.v) return;
    if (__wreCmp(m.v, __wreVer) > 0) {
      let ok = true; try { new Function(code); } catch (e) { ok = !(e instanceof SyntaxError); }
      if (!ok) { __wreSay(m.v + ' won\'t parse, not keeping it'); GM_setValue('wreLiveSha', sha); return; }
      const old = GM_getValue('wreLiveCode', null); if (!old || old.v != m.v) __wreSay('got ' + m.v + ', it runs on the next page load');
      GM_setValue('wreLiveCode', { v: m.v, code, sha, at: Date.now() });
    } else GM_setValue('wreLiveCode', null); // Tampermonkey's copy has caught up
    GM_setValue('wreLiveSha', sha); if (tag) GM_setValue('wreLiveEtag', tag);
  }
  // GitHub's commit check is limited per internet address, and on 4G/5G that address is shared with lots of other
  // phones, so it can get turned away. Then the newest file is fetched straight off main instead (5/11).
  function __wreRaw() {
    GM_xmlhttpRequest({ method: 'GET', url: 'https://raw.githubusercontent.com/Badseed26/wre-userscripts/main/src/' + __wreName + '.js?t=' + Date.now(), timeout: 30000, headers: { 'Cache-Control': 'no-cache' }, onload: q => {
      try { if (q.status != 200) return; const v = __wreMeta(q.responseText || '').v; if (v) __wreTake(q.responseText, 'raw:' + v); } catch (e) {} } });
  }
  function __wreCheck() {
    try {
      if (Date.now() - GM_getValue('wreLiveAt', 0) < 2 * 60e3) return; GM_setValue('wreLiveAt', Date.now());
      const et = GM_getValue('wreLiveEtag', ''), hd = { Accept: 'application/vnd.github+json' }; if (et) hd['If-None-Match'] = et;
      GM_xmlhttpRequest({ method: 'GET', url: 'https://api.github.com/repos/Badseed26/wre-userscripts/commits/main', headers: hd, timeout: 20000, onerror: __wreRaw, ontimeout: __wreRaw, onload: r => {
        try {
          if (r.status == 304) return; // nothing new, and it doesn't count against GitHub's limit
          if (r.status != 200) { __wreSay('GitHub said ' + r.status + ', checking the file directly'); return __wreRaw(); }
          const sha = (JSON.parse(r.responseText) || {}).sha, tag = (((r.responseHeaders || '').match(/^etag:\s*(.+)$/mi) || [])[1] || '').trim();
          if (!sha) return; if (sha == GM_getValue('wreLiveSha', '')) { if (tag) GM_setValue('wreLiveEtag', tag); return; }
          GM_xmlhttpRequest({ method: 'GET', url: 'https://raw.githubusercontent.com/Badseed26/wre-userscripts/' + sha + '/src/' + __wreName + '.js', timeout: 30000, onload: q => {
            try { if (q.status == 200) __wreTake(q.responseText || '', sha, tag); } catch (e) {} } });
        } catch (e) {} } });
    } catch (e) {}
  }
  if (window.top === window.self) { __wreCheck(); setInterval(__wreCheck, 2 * 60e3 + 5000); }
  if (__wreLive()) return;
  // ---------- the built in copy (src/wre-solar-orders.js at 0.1) ----------

(function () {
  'use strict';

  // How it works (16/11):
  // AroFlo: the calendar's own feed (AJAX_JSON_ims_events.cfm, needs the calendar page's settings) gives the bookings for the
  //   next X days. Each task's details, notes (AJAX_HTML_get_notes.cfm) and documents (AJAX_JSON_search_documents.cfm) are read
  //   the same way the NPT and photo grab scripts do. Read only, nothing in AroFlo gets changed.
  // AI: Haiku tags the label photos off the small thumbnails, Opus (medium) reads the marked or tagged label photos, the notes,
  //   your notes and the PO PDF and says what panels and inverter to order. Rails and TIN kits are added by script.
  // Tradezone: search pages for the products (signed in prices), the product page for Gold Coast stock, and the cart's own
  //   calls: /checkout/cart/add/product/<id>/?options=cart&qty=N&location=DC1 and /checkout/cart/updateCustomerOrderReference.
  //   It only loads into an empty cart and never checks out.
  // Todoist: approved orders sit in WRE job tracker > Solar orders so the PC and phone see the same list.

  const W = typeof unsafeWindow != 'undefined' ? unsafeWindow : window;
  if (W.__wreSolar || window.top !== window.self) return;
  W.__wreSolar = 1;

  const ORANGE = '#e8731a', GREY = '#4a4541';
  const TZ = 'https://www.tradezone.com.au';
  const TRACK = '6hfHgcxH8W9q4qf5';          // Todoist: WRE job tracker
  const SEC_NAME = 'Solar orders';
  const TDA = 'https://api.todoist.com/api/v1/';
  const AI = { sort: 'claude-haiku-5-5', read: 'claude-opus-5-5' };
  const AIPRICE = { 'claude-opus-5-5': [4, 20, 5, 0.2], 'claude-haiku-5-5': [0.1, 0.5, 0.125, 0.01] };   // USD per MTok: in, out, cache write, cache read
  const TZLOC = { 'Gold Coast': 'DC1', Melbourne: 'DC3', Sydney: 'DC5', Perth: 'DC6', Brisbane: 'DC7', Adelaide: 'DC8' };
  const DEF = { days: 14, rail: 'PW4700RAIL', kit: 'PW-6P-30&35MM-TIN-BLK', branch: 'Gold Coast', others: false, done: false };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const money = n => (n == null || isNaN(n) || n === '') ? '' : '$' + Number(n).toFixed(2);
  const p2 = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dShort = s => { const d = new Date(s + 'T00:00:00'); return DAYS[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1); };
  const html = t => new DOMParser().parseFromString(t || '', 'text/html');
  const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const hashOf = s => String(String(s).split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
  async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { await fn(items[k], k); } catch (e) { items[k] && typeof items[k] == 'object' && (items[k].err = String(e.message || e)); } } })); }

  // ---------- settings and saved state (this device's Tampermonkey) ----------
  const S = () => Object.assign({}, DEF, GM_getValue('set', {}));
  const setS = o => GM_setValue('set', Object.assign(GM_getValue('set', {}), o));
  const keyClean = k => String(k || '').replace(/[\s​-‍⁠﻿]/g, '').replace(/^["']|["']$/g, '');
  const aiKey = () => keyClean(GM_getValue('anthropicKey', ''));
  const tdToken = () => clean(GM_getValue('todoistToken', ''));
  // per job: your notes, the multi box, photo marks, the AI's tags and plan, the order lines, the checklist, PO ref
  let ST = GM_getValue('jobs', {});
  const st = w => (ST[w] = ST[w] || { notes: '', multi: false, marks: {}, at: Date.now() });
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => {
    const cut = Date.now() - 60 * 864e5; Object.keys(ST).forEach(k => { if ((ST[k].at || 0) < cut) delete ST[k]; });
    GM_setValue('jobs', ST); }, 300); };
  const touch = w => { st(w).at = Date.now(); save(); };
  // remembered product picks: what you swapped to for a need, used first next time
  const learn = () => GM_getValue('learn', {});
  const learnKey = s => clean(s).toLowerCase().replace(/[^a-z0-9.]/g, ' ').replace(/\s+/g, ' ').trim();
  const remember = (need, it) => { const m = learn(); m[learnKey(need)] = { code: it.code, id: it.id, at: Date.now() }; GM_setValue('learn', m); };
  const monthKey = () => new Date().toISOString().slice(0, 7);
  const addCost = usd => { const c = GM_getValue('cost', {}); c[monthKey()] = (c[monthKey()] || 0) + usd; GM_setValue('cost', c); };
  const monthCost = () => (GM_getValue('cost', {})[monthKey()] || 0);

  // ---------- requests ----------
  const afText = url => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('AroFlo took too long')), 25000);
    (W.fetch || fetch).call(W, new URL(url, location.origin).href, { credentials: 'include', cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error('AroFlo said ' + r.status); return r.text(); })
      .then(x => { clearTimeout(t); if (/name=["']?password|loginForm/i.test(x) && !/noteItem|wrCoded|rows/.test(x)) rej(new Error('AroFlo looks signed out')); else res(x); }, e => { clearTimeout(t); rej(e); });
  });
  const afBlob = url => (W.fetch || fetch).call(W, new URL(url, location.origin).href, { credentials: 'include' }).then(r => { if (!r.ok) throw new Error('AroFlo said ' + r.status); return r.blob(); });
  const b64 = blob => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1]); f.onerror = rej; f.readAsDataURL(blob); });
  function gm(o) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest(Object.assign({ timeout: 30000 }, o, {
      onload: r => resolve(r), onerror: () => reject(new Error('couldn\'t reach ' + new URL(o.url).host)), ontimeout: () => reject(new Error(new URL(o.url).host + ' took too long')),
    })));
  }
  const tzGet = (url, json) => gm({ method: 'GET', url, headers: json ? { Accept: 'application/json, text/javascript, */*', 'X-Requested-With': 'XMLHttpRequest' } : { Accept: 'text/html' } });
  const tzPost = (url, data) => gm({ method: 'POST', url, data: data || '', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*' } });
  const form = o => Object.keys(o).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');
  const td = (method, path, body) => new Promise((res, rej) => GM_xmlhttpRequest({
    method, url: TDA + path, timeout: 20000,
    headers: { Authorization: 'Bearer ' + tdToken(), 'Content-Type': 'application/json' },
    data: body ? JSON.stringify(body) : undefined,
    onload: r => { if (r.status === 401 || r.status === 403) return rej(new Error('Todoist token not accepted')); if (r.status < 200 || r.status >= 300) return rej(new Error('Todoist said ' + r.status)); try { res(r.responseText ? JSON.parse(r.responseText) : null); } catch (e) { res(null); } },
    onerror: () => rej(new Error('couldn\'t reach Todoist')), ontimeout: () => rej(new Error('Todoist timed out')),
  }));

  // ---------- AroFlo: bookings, task details, notes, documents ----------
  async function calEvents(days) {
    for (let i = 0; i < 40 && !(W.jsonSettings && document.getElementById('calBoxContainer')); i++) await sleep(250);
    const box = document.getElementById('calBoxContainer');
    if (!W.jsonSettings || !box) throw new Error('couldn\'t read the calendar settings, give the calendar a sec to load then hit Refresh');
    const q = new URLSearchParams();
    q.set('jsonSettings', JSON.stringify(W.jsonSettings));
    q.set('masterusercoded', box.getAttribute('data-master-user-id') || '');
    const t = new Date(), list = [];
    for (let i = 0; i < days; i++) { const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + i); list.push(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 1000); } // AroFlo's days are UTC midnight
    q.set('range', list.join(','));
    q.set('eventtypes_task', '1');
    const r = await (W.fetch || fetch).call(W, '/ims/Site/Calendar/AJAX/AJAX_JSON_ims_events.cfm', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, body: q.toString() });
    let evs; try { evs = JSON.parse(await r.text()); } catch (e) { evs = null; }
    if (!Array.isArray(evs)) throw new Error('the calendar feed didn\'t come back, AroFlo might be signed out');
    return evs.filter(e => e.type == 'task');
  }
  const detCache = {};
  async function details(wrid) {
    const c = detCache[wrid]; if (c && Date.now() - c.at < 10 * 60e3) return c;
    const h = await afText('/ims/Site/Calendar/AJAX/AJAX_HTML_task_details.cfm?wrid=' + wrid);
    const d = html(h); d.querySelectorAll('script,style').forEach(x => x.remove());
    const inp = d.getElementById('wrCoded');
    const m = h.match(/wrCoded=([^&"']+)/);
    const code = inp && inp.value ? decodeURIComponent(inp.value) : m ? decodeURIComponent(m[1].replace(/&amp;/g, '&')) : '';
    const t = (d.body.innerText || d.body.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
    const one = re => clean((t.match(re) || [])[1] || '').slice(0, 140);
    const ref = one(/Ref \/ JN:?\s*([^\n]+)/);
    const desc = ((t.match(/Task Description:?\s*([\s\S]*?)(?:\s*Task Notes \(last three\)|\s*Quote Description:|$)/) || [])[1] || '').trim();
    const quoteDesc = ((t.match(/Quote Description:?\s*([\s\S]*?)(?:\s*Task Notes \(last three\)|$)/) || [])[1] || '').trim();
    const link = [...d.querySelectorAll('a')].map(a => a.getAttribute('href') || '').find(x => /workrequest/i.test(x) && /wrCoded=/i.test(x) && !/printview/i.test(x)) || '';
    const out = { at: Date.now(), wrid, code, jn: (ref.match(/(\d{3,})\s*$/) || [])[1] || '', name: one(/(?:Task )?Name:?\s*([^\n]+)/), status: one(/Status:?\s*([^\n]+)/), loc: one(/Location:?\s*([^\n]+)/), desc, quoteDesc, link };
    detCache[wrid] = out; return out;
  }
  // replacement work (new panels or inverter going on), not just an iso, store and reinstate, or a test and report
  const SOLAR = /\bsolar\b|\bpv\b|inverter|invertor/i;
  const REPL = /supply\s*(?:&|and)?\s*install[^.\n]{0,80}(?:solar|\bpanels?\b|\bpv\b|invert)|replac\w*[^.\n]{0,40}(?:solar|\bpanels?\b|\bpv\b|invert)|(?:solar|\bpv\b)[^.\n]{0,30}replac|\d{3}\s?w[^.\n]{0,30}(?:solar|panels?)|new solar|solar upgrade|inverter upgrade/i;
  async function notes(code) {
    const d = html(await afText('/ims/Site/Service/Notes/AJAX_HTML_get_notes.cfm?dateorder=0&last3notes=0&isLoaded=1&wrCoded=' + encodeURIComponent(code) + '&_=' + Date.now()));
    return [...d.querySelectorAll('.noteItem')].map(n => {
      const hs = [...n.querySelectorAll('.heading3')].map(x => clean(x.textContent));
      const out = n.querySelector('.noteOutput');
      const text = out ? (out.innerText || out.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : '';
      return { when: (hs[0] || '').replace(/^(\d{1,2} \w+ \d{4}).*$/, '$1'), who: hs[1] || '', text };
    }).filter(n => n.text);
  }
  const IMG = /\.(jpe?g|png|heic|heif|webp|gif)$/i;
  async function docs(code) {
    const q = 'searchdocumenttype=task&idcoded=' + encodeURIComponent(code) + '&customfield_id=0&columns=document,comment,uploadedby,imgdatetimetaken,datetimeinserted' +
      '&category_id=0&searchTaskBUs=childbus&_search=true&nd=' + Date.now() + '&rows=500&page=1&sidx=sortOrder&sord=asc';
    let j; try { j = JSON.parse(await afText('/ims/Site/Documents/AJAX_JSON_search_documents.cfm?' + q)); } catch (e) { throw new Error('AroFlo didn\'t send the document list'); }
    const txt = s => clean(String(s == null ? '' : s).replace(/<[^>]+>/g, ' '));
    const rows = (j.rows || []).map(r => ({ id: String(r.document_id || r.id || r.docToken || ''), name: txt(r.documentname), by: txt(r.uploadedby), taken: txt(r.imgdatetimetaken) || txt(r.datetimeinserted),
      caption: txt(r.comment), orig: String(r.timedlinkoriginal || ''), sm: String(r.timedlinkthumbnailsmall || ''), lg: String(r.timedlinkthumbnaillarge || r.timedlinkoriginal || ''), size: +r.filesizebytes || 0 }));
    return { photos: rows.filter(r => IMG.test(r.name) && r.orig), pdfs: rows.filter(r => /\.pdf$/i.test(r.name) && r.orig) };
  }
  async function taskSearch(term, field) {
    const body = new URLSearchParams({ taskString: term, SearchParam: field, searchtasks: 'Search', searchtasks_btn: 'Search' });
    const r = await (W.fetch || fetch).call(W, '/ims/Site/Home/index.cfm?tid=IMS.STK.CUR', { method: 'POST', body, credentials: 'include' });
    const d = html(await r.text());
    return [...d.querySelectorAll('tr')].filter(tr => tr.querySelectorAll('td').length >= 6).map(tr => {
      const c = [...tr.querySelectorAll('td')].map(x => clean(x.textContent)).filter(Boolean);
      const a = [...tr.querySelectorAll('a')].find(x => /workrequest/i.test(x.getAttribute('href') || '') && !/printview/i.test(x.getAttribute('href')));
      return { jn: c[1], task: c[4] || '', status: c[c.length - 1] || '', href: a ? a.getAttribute('href') : '' };
    }).filter(t => /^\d+$/.test(t.jn || ''));
  }
  // other tasks at the same address (an accepted upgrade quote, a return visit) change the order
  async function others(job) {
    const a = (job.loc || job.name).replace(/^\s*\d{6,}[-\w]*\s*-?\s*/, '');
    const m = a.match(/^(?:\w+\/)?(\d+[A-Za-z]?)\s+(.+?)\s+(St|Street|Rd|Road|Dr|Drive|Ave|Avenue|Ct|Court|Cres|Crescent|Pl|Place|Tce|Terrace|Esplanade|Row|Way|Cct|Circuit|Pde|Parade|Cl|Close|Lane|Ln|Hwy|Highway|Bvd|Boulevard|Grove|Gr)\b/i);
    if (!m) return [];
    const list = await taskSearch(m[2], 'Location');
    return list.filter(t => t.jn != job.jn && new RegExp('(^|\\D)' + m[1] + '\\b').test(t.task) && !/Archived|Cancel/i.test(t.status)).map(t => ({ jn: t.jn, task: t.task, status: t.status }));
  }

  // what the AI gets to read, private bits stripped (same as the supplier window)
  function strip(t) {
    return String(t || '')
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
      .replace(/(\+?61\s?|\b0)[2-478](?:[\s-]?\d){8}\b/g, '[phone]')
      .replace(/\b(gate code|door code|code|key ?safe|lock ?box|alarm|password|pin)\b\s*(?:is|[:\-])?\s*[\w#*-]*\d[\w#*-]*/gi, '$1 [removed]')
      .replace(/\b(site contact|contact|tenant|owner|customer|client|insured)\b\s*[:\-]\s*[^\n;,.]*/gi, '$1: [removed]')
      .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ---------- AI ----------
  async function claude(model, system, content, maxTokens, effort) {
    if (typeof W.__wsoFakeAI == 'function') return W.__wsoFakeAI(model, system, content);   // tests only
    if (!aiKey()) throw new Error('No Anthropic key. Add it under Settings');
    const body = { model, max_tokens: maxTokens, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content }] };
    if (effort) body.output_config = { effort };
    const r = await gm({ method: 'POST', url: 'https://api.anthropic.com/v1/messages', timeout: 180000, data: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-api-key': aiKey(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } });
    let j = null; try { j = JSON.parse(r.responseText); } catch (e) {}
    if (r.status == 401 || r.status == 403) throw new Error('Anthropic didn\'t accept the key. Check it under Settings');
    if (!j || r.status >= 300) throw new Error('the AI said ' + r.status + (j && j.error ? ': ' + j.error.message : ''));
    const u = j.usage || {}, pr = AIPRICE[model] || [0, 0, 0, 0];
    const cost = ((u.input_tokens || 0) * pr[0] + (u.output_tokens || 0) * pr[1] + (u.cache_creation_input_tokens || 0) * pr[2] + (u.cache_read_input_tokens || 0) * pr[3]) / 1e6;
    addCost(cost);
    const text = (j.content || []).filter(c => c.type == 'text').map(c => c.text).join('');
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [0, text];
    const s = m[1].slice(m[1].indexOf('{'), m[1].lastIndexOf('}') + 1);
    try { const o = JSON.parse(s); o._cost = cost; return o; } catch (e) { throw new Error('the AI\'s answer couldn\'t be read'); }
  }
  const imgBlock = (data, type) => ({ type: 'image', source: { type: 'base64', media_type: type || 'image/jpeg', data } });

  const SORT_SYS = `You sort job photos from an Australian solar replacement. Each photo is numbered. Say which photos show a readable label or sticker:
"inverter" = the inverter's rating label or model sticker (or a clear photo of the inverter's front showing make and model),
"panel" = a solar panel's rating label on the back of a panel (watts, model).
Skip everything else (roofs, switchboards, people, general shots). If unsure, skip it.
Answer with JSON only: {"tags":{"3":"inverter","7":"panel"}}`;

  const READ_SYS = `You work out the solar gear to order for an insurance solar replacement (Wired Rite Electrical, Queensland). New gear comes from Tradezone.
What's on site beats the PO: builder POs very rarely state the right kW or inverter. Go by, in this order: Ethan's notes, the label photos (read make, model, kW, watts and phase off the stickers), the lads' notes (e.g. "removed 32x rec 400w panels"), then the task description and the PO.
Panels: size the new panels to the existing array's kW (count x watts). Current panels are around 440 to 475W. Use whole panels, not under the existing kW by more than half a panel. Name a make only if Ethan's notes, the lads or the PO name one for the new panels, otherwise go like for like quality.
Inverter: like for like make and kW where it's still sold, else the closest current model (Sungrow is the usual). Match single or three phase to the existing inverter.
{MULTI}
Only list panels and inverters. Rails, mounting kits, cable, isolators and the rest are added by script or by Ethan, never list them.
For each line give 1 to 3 short Tradezone search terms, most specific first (e.g. "Jinko 475", "SG5.0RS").
"source" says where the numbers came from in a few words, e.g. "inverter label photo 3", "Pearce's note 16/9", "PO only". "inferred": true when a line rests on the PO alone or on a guess.
Also give:
"existing": what's on site now, one short line each (e.g. "32 x REC 400W, Pearce's note"),
"panels_total": total new panels (rails and kits are worked out from it),
"phase": "single", "three" or "unknown",
"tile": true if anything says the roof is tiled, with "tile_why",
"po": the PO's solar lines with their prices if the PO PDF shows them, [{"text":"...","price":"$..."}],
"checks": anything else Ethan should look at before ordering, a few words each.
Answer with JSON only:
{"existing":["..."],"lines":[{"kind":"panel","qty":14,"need":"Jinko 475W panel","terms":["jinko 475","JKM475N"],"source":"...","inferred":false}],"panels_total":14,"phase":"single","tile":false,"tile_why":"","po":[{"text":"...","price":""}],"checks":[]}`;
  const MULTI_ON = 'Ethan ticked "more than 1 panel type or inverter": there can be several panel and inverter lines. Use every label photo he marked (they\'re numbered by type), and size each group separately.';
  const MULTI_OFF = 'Assume one panel type and one inverter. If the photos or notes plainly show more than one, still give your best single order and add a check saying so.';

  // Haiku tags the label photos off the small thumbnails (cheap), cached per job
  async function sortPhotos(job, say) {
    const s = st(job.wrid), ph = job.photos || [];
    if (!ph.length) return {};
    const key = ph.map(p => p.id).join(',');
    if (s.sort && s.sort.key == key) return s.sort.tags;
    say('Sorting ' + ph.length + ' photos for the labels (Haiku)…');
    const use = ph.slice(0, 80), content = [];
    await pool(use, 6, async (p, i) => { p._sm = p._sm || await b64(await afBlob(p.sm || p.lg)); });
    use.forEach((p, i) => { if (!p._sm) return; content.push({ type: 'text', text: 'Photo ' + (i + 1) + ':' }); content.push(imgBlock(p._sm)); });
    content.push({ type: 'text', text: 'Which of these are inverter or panel labels?' });
    const r = await claude(AI.sort, SORT_SYS, content, 800);
    const tags = {};
    Object.entries(r.tags || {}).forEach(([n, v]) => { const p = use[+n - 1]; if (p && /^(inverter|panel)$/.test(v)) tags[p.id] = v; });
    s.sort = { key, tags }; touch(job.wrid);
    return tags;
  }
  // photos that go to Opus: your marks win, else Haiku's tags (max 6, inverter first)
  function labelPhotos(job) {
    const s = st(job.wrid), ph = job.photos || [];
    const marked = ph.filter(p => s.marks[p.id]);
    const pick = marked.length ? marked.map(p => ({ p, tag: s.marks[p.id] })) : ph.filter(p => s.sort && s.sort.tags[p.id]).map(p => ({ p, tag: s.sort.tags[p.id] }));
    const n = { inverter: 0, panel: 0 };
    return pick.sort((a, b) => (a.tag == 'inverter' ? 0 : 1) - (b.tag == 'inverter' ? 0 : 1)).slice(0, 6).map(x => ({ p: x.p, tag: x.tag, label: x.tag + ' label ' + (++n[x.tag]), mine: !!marked.length }));
  }
  function poPdf(job) { return (job.pdfs || []).filter(d => /purchase order|work order|\bpo\b/i.test(d.name)).sort((a, b) => b.size - a.size)[0] || null; }

  async function readJob(job, say, force) {
    const s = st(job.wrid);
    if (!s.multi && !Object.keys(s.marks).length) await sortPhotos(job, say);
    const labels = labelPhotos(job);
    const pdf = poPdf(job);
    const noteTxt = (job.notes || []).map(n => n.when + ' ' + n.who + ': ' + n.text).join('\n\n');
    const text = [
      'TASK DESCRIPTION:\n' + strip(job.desc || '(none)'),
      job.quoteDesc ? 'QUOTE DESCRIPTION:\n' + strip(job.quoteDesc) : '',
      'NOTES ON THE TASK (newest first):\n' + (strip(noteTxt) || '(none)'),
      s.notes ? 'ETHAN\'S NOTES FOR THIS ORDER:\n' + strip(s.notes) : '',
      'LABEL PHOTOS: ' + (labels.length ? labels.map((x, i) => 'photo ' + (i + 1) + ' = ' + x.label + (x.mine ? ' (marked by Ethan)' : ' (picked by the photo sort)')).join(', ') : 'none found'),
    ].filter(Boolean).join('\n\n');
    const key = hashOf([text, s.multi, labels.map(x => x.p.id + x.tag).join(','), pdf ? pdf.id : ''].join('|'));
    if (!force && s.plan && s.plan.key == key) { say('Nothing\'s changed since the last run, reusing it (no AI cost)…'); return s.plan.r; }
    const content = [{ type: 'text', text }];
    say('Grabbing ' + labels.length + ' label photo' + (labels.length == 1 ? '' : 's') + (pdf ? ' and the PO' : '') + '…');
    for (const [i, x] of labels.entries()) { try { content.push({ type: 'text', text: 'Photo ' + (i + 1) + ' (' + x.label + '):' }); content.push(imgBlock(await b64(await afBlob(x.p.lg)))); } catch (e) {} }
    if (pdf && pdf.size < 4.5e6) { try { content.push({ type: 'text', text: 'The builder\'s PO:' }); content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await b64(await afBlob(pdf.orig)) } }); } catch (e) {} }
    say('Working out the gear (Opus)…');
    const r = await claude(AI.read, READ_SYS.replace('{MULTI}', s.multi ? MULTI_ON : MULTI_OFF), content, 3000, 'medium');
    s.plan = { key, r, at: Date.now() }; touch(job.wrid);
    return r;
  }

  // ---------- Tradezone ----------
  const tzOut = r => /customer\/account\/login/.test(r && r.finalUrl || '');
  const sCache = {};
  async function searchTz(term) {
    const k = term.toLowerCase(), c = sCache[k];
    if (c && Date.now() - c.at < 10 * 60e3) return c.r;
    const r = await tzGet(TZ + '/catalogsearch/result/?q=' + encodeURIComponent(term));
    if (tzOut(r)) throw new Error('Signed out of Tradezone. Sign in on tradezone.com.au in this browser, then try again');
    const doc = html(r.responseText), items = [], seen = new Set();
    doc.querySelectorAll('.product_item[data-product-id]').forEach(el => {
      if (el.closest('.itemslider-wrapper, .owl-wrapper')) return;
      const id = el.getAttribute('data-product-id'); if (seen.has(id)) return; seen.add(id);
      const a = el.querySelector('.name a') || el.querySelector('a.hover_link') || el.querySelector('a.product-image');
      const m = clean(el.textContent).match(/\$\s*([\d,]+\.\d{2})\s*ex/i);
      const stk = el.querySelector('.stock_wrapper');
      const img = el.querySelector('a.product-image img');
      items.push({ id, code: clean((el.querySelector('h6.part') || {}).textContent), name: clean(a && (a.getAttribute('title') || a.textContent)) || clean((img || { getAttribute: () => '' }).getAttribute('alt')),
        href: a ? new URL(a.getAttribute('href'), TZ).href : '', price: m ? Number(m[1].replace(/,/g, '')) : null, stock: stk ? clean(stk.textContent) : '', img: img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '' });
    });
    sCache[k] = { at: Date.now(), r: items };
    return items;
  }
  // a product page has the stock per branch
  async function tzStock(it) {
    if (!it || !it.href || it.bq != null) return;
    const r = await tzGet(it.href); const d = html(r.responseText);
    const want = S().branch.toLowerCase();
    const rows = [...d.querySelectorAll('label.selector_row, .selector_rows .selector_row')].map(row => {
      const qt = clean((row.querySelector('.qty') || {}).textContent);
      const name = clean(clean((row.querySelector('.location_and_qty') || row).textContent).replace(qt, '').replace(/add to cart/i, ''));
      return { name, qty: Number(((qt.match(/\d[\d,]*/) || ['0'])[0]).replace(/,/g, '')) };
    });
    const b = rows.find(x => x.name.toLowerCase() == want) || rows.find(x => x.name.toLowerCase().includes(want));
    it.bq = b ? b.qty : (rows.length ? 0 : null);
    if (!it.price) { const m = clean((d.querySelector('.price_and_points') || {}).textContent).match(/\$\s*([\d,]+\.\d{2})\s*ex/i); if (m) it.price = Number(m[1].replace(/,/g, '')); }
  }
  // closest result for a need: the numbers (watts, kW) and the words have to line up
  function score(need, terms, x) {
    const n = (need + ' ' + terms.join(' ')).toLowerCase(), t = (x.name + ' ' + x.code).toLowerCase();
    let s = 0;
    (n.match(/\d+(?:\.\d+)?/g) || []).forEach(num => { if (new RegExp('(^|[^\\d.])' + num.replace('.', '\\.') + '(?![\\d])').test(t)) s += 3; });
    (n.match(/[a-z]{3,}/g) || []).forEach(w => { if (!/^(panel|panels|solar|inverter|with|for|the|and|phase|single|watt|mono)$/.test(w) && t.includes(w)) s += 1; });
    if (/three|3 ?phase/.test(n) == /three|3 ?phase/.test(t)) s += 1;
    if (x.price) s += 0.5;
    return s;
  }
  async function match(line) {
    const terms = (line.terms && line.terms.length ? line.terms : [line.need]).slice(0, 3);
    const lk = learn()[learnKey(line.need)];
    let cand = [];
    if (lk) { try { const r = await searchTz(lk.code); const x = r.find(y => normCode(y.code) == normCode(lk.code)); if (x) { line.pick = x; line.how = 'used before'; } cand = r; } catch (e) { if (/Signed out/.test(e.message)) throw e; } }
    for (const term of terms) {
      let r = []; try { r = await searchTz(term); } catch (e) { if (/Signed out/.test(e.message)) throw e; }
      r.forEach(x => { if (!cand.find(y => y.id == x.id)) cand.push(x); });
      if (cand.length >= 8) break;
    }
    cand = cand.map(x => ({ x, s: score(line.need, terms, x) })).sort((a, b) => b.s - a.s).map(c => c.x).slice(0, 8);
    line.cand = cand;
    if (!line.pick) { line.pick = cand[0] || null; line.how = cand[0] ? 'best match' : ''; }
    await tzStock(line.pick).catch(() => {});
  }
  async function byCode(code) {
    const r = await searchTz(code);
    const x = r.find(y => normCode(y.code) == normCode(code)) || null;
    if (x) await tzStock(x).catch(() => {});
    return x;
  }
  async function cartRead() {
    const r = await tzGet(TZ + '/checkout/cart/');
    if (tzOut(r)) return { out: true, items: [] };
    const d = html(r.responseText);
    const items = [...d.querySelectorAll('.cart-location-item')].map(it => {
      const t = clean(it.textContent);
      return { id: it.getAttribute('data-item-id'), part: (t.match(/Part Number:\s*(\S+)/) || [])[1] || '', name: t.slice(0, 80), qty: +((it.querySelector('input[type=number]') || {}).value || 0) };
    });
    const ref = (d.querySelector('.cart-order-message-input') || {}).value || '';
    return { out: false, items, ref };
  }

  // ---------- the order for one job ----------
  async function workOut(job, force) {
    const say = t => { job.msg = t; draw(job.wrid); };
    const s = st(job.wrid);
    job.busy = true; job.err = '';
    try {
      if (!job.loaded) await loadJob(job);
      const r = await readJob(job, say, force);
      say('Matching on Tradezone…');
      const lines = (r.lines || []).filter(l => /panel|inverter/i.test(l.kind || l.need)).map(l => ({ kind: /invert/i.test(l.kind || l.need) ? 'inverter' : 'panel', qty: Math.max(1, Math.round(+l.qty || 1)), need: clean(l.need), terms: l.terms || [], source: clean(l.source), inferred: !!l.inferred }));
      await pool(lines, 3, l => match(l));
      const panels = Math.max(0, Math.round(+r.panels_total || lines.filter(l => l.kind == 'panel').reduce((a, l) => a + l.qty, 0)));
      if (panels) {
        const [rail, kit] = await Promise.all([byCode(S().rail).catch(() => null), byCode(S().kit).catch(() => null)]);
        lines.push({ kind: 'rail', qty: Math.ceil(panels / 2), need: 'Rails (' + panels + ' panels ÷ 2)', source: 'rule', pick: rail, cand: rail ? [rail] : [], how: rail ? 'rule' : '' });
        lines.push({ kind: 'kit', qty: Math.ceil(panels / 6), need: 'TIN kits (1 per 6 panels)', source: 'rule', pick: kit, cand: kit ? [kit] : [], how: kit ? 'rule' : '' });
      }
      s.lines = lines.map(slimLine); s.ai = { existing: r.existing || [], phase: r.phase || 'unknown', tile: !!r.tile, tile_why: r.tile_why || '', po: r.po || [], checks: r.checks || [], panels, cost: r._cost || 0 };
      s.checked = {}; touch(job.wrid);
      job.msg = '';
    } catch (e) { job.err = String(e.message || e); job.msg = ''; }
    job.busy = false; draw(job.wrid);
  }
  const slimLine = l => ({ kind: l.kind, qty: l.qty, need: l.need, terms: l.terms || [], source: l.source || '', inferred: !!l.inferred, how: l.how || '', pick: l.pick ? slimIt(l.pick) : null, cand: (l.cand || []).map(slimIt) });
  const slimIt = x => ({ id: x.id, code: x.code, name: x.name, href: x.href, price: x.price, stock: x.stock, bq: x.bq == null ? null : x.bq, img: x.img || '' });

  // checklist: only the ones that apply to this job, each one ticked or agreed past before the cart
  function checks(job) {
    const s = st(job.wrid), a = s.ai, out = [];
    if (!a) return out;
    const all = [job.desc, job.quoteDesc, (job.notes || []).map(n => n.text).join(' '), s.notes].join(' ');
    if (a.tile || /\btiled\b|\btiles?\s+roof|roof[^.\n]{0,25}\btiles?\b/i.test(all)) out.push({ k: 'tile', t: 'Tile roof mentioned' + (a.tile_why ? ' (' + a.tile_why + ')' : '') + '. TIN kits loaded', red: true });
    const lp = labelPhotos(job);
    if (!lp.some(x => x.tag == 'inverter')) out.push({ k: 'noinv', t: 'No inverter label photo found. Inverter is off the notes or PO' });
    if (!lp.some(x => x.tag == 'panel')) out.push({ k: 'nopan', t: 'No panel label photo found. Panels are off the notes or PO' });
    if (s.multi) out.push({ k: 'multi', t: 'More than 1 panel type or inverter: every label marked and every group on the order?' });
    if (a.phase == 'unknown') out.push({ k: 'phase', t: 'Single or 3 phase not stated, check the inverter' });
    (s.lines || []).forEach((l, i) => {
      if (l.inferred) out.push({ k: 'inf' + i + l.need, t: 'Inferred: ' + l.need + (l.source ? ' (' + l.source + ')' : '') });
      if (l.pick && l.pick.bq != null && l.pick.bq < l.qty) out.push({ k: 'stk' + i + l.pick.code + l.qty, t: (l.pick.code || l.need) + ': only ' + l.pick.bq + ' at ' + S().branch + ', need ' + l.qty, red: true });
      if (l.pick && l.how == 'best match' && (l.kind == 'panel' || l.kind == 'inverter')) out.push({ k: 'mt' + i + l.pick.code, t: 'Check the match: ' + l.need + ' → ' + l.pick.name });
    });
    (job.others || []).forEach(o => out.push({ k: 'oth' + o.jn, t: 'Other task at this address: JN ' + o.jn + ' ' + o.task + ' (' + o.status + ')', red: true }));
    (a.checks || []).forEach((c, i) => out.push({ k: 'ai' + i + hashOf(c), t: c }));
    return out;
  }
  const blockers = job => { const s = st(job.wrid), b = [];
    if (!(s.lines || []).length) b.push('no order yet');
    (s.lines || []).forEach(l => { if (!l.pick) b.push('no Tradezone match for ' + l.need); });
    if (!clean(s.ref)) b.push('PO ref is blank');
    const open = checks(job).filter(c => !(s.checked || {})[c.k]); if (open.length) b.push(open.length + ' checklist item' + (open.length == 1 ? '' : 's') + ' to tick');
    return b; };
  const total = s => (s.lines || []).reduce((a, l) => a + (l.pick && l.pick.price ? l.pick.price * l.qty : 0), 0);

  // ---------- Todoist: approved orders, shared across devices ----------
  let SEC = GM_getValue('secId', ''), approved = {};
  async function section() {
    if (SEC) return SEC;
    const r = await td('GET', 'sections?project_id=' + TRACK);
    const f = (r && (r.results || r) || []).find(x => x.name == SEC_NAME);
    SEC = f ? f.id : (await td('POST', 'sections', { name: SEC_NAME, project_id: TRACK })).id;
    GM_setValue('secId', SEC); return SEC;
  }
  async function loadApproved() {
    if (!tdToken()) return;
    try {
      const sec = await section(); let cur = null, all = [];
      do { const r = await td('GET', 'tasks?project_id=' + TRACK + '&section_id=' + sec + (cur ? '&cursor=' + encodeURIComponent(cur) : '')); all = all.concat(r.results || []); cur = r.next_cursor; } while (cur);
      approved = {};
      all.forEach(t => { const m = String(t.description || '').match(/^data: (\{.*\})$/m); if (!m) return; try { const d = JSON.parse(m[1]); approved[d.w] = { id: t.id, d, title: t.content }; } catch (e) {} });
    } catch (e) { apErr = String(e.message || e); if (/not accepted/.test(apErr)) { SEC = ''; GM_setValue('secId', ''); } }
  }
  let apErr = '';
  function apText(job) {
    const s = st(job.wrid);
    const lines = (s.lines || []).filter(l => l.pick).map(l => l.qty + ' x ' + l.pick.name + ' [' + l.pick.code + ']' + (l.pick.price ? ' ' + money(l.pick.price) + ' ex' : ''));
    const d = { v: 1, w: job.wrid, jn: job.jn, name: job.name, first: job.first, ref: s.ref || '', at: Date.now(), l: (s.lines || []).filter(l => l.pick).map(l => ({ k: l.kind, q: l.qty, n: l.need, id: l.pick.id, c: l.pick.code, nm: l.pick.name, p: l.pick.price, h: l.pick.href })) };
    return 'JN ' + job.jn + ' | wrid ' + job.wrid + ' | first visit ' + (job.first ? dShort(job.first) : '?') + ' | PO ref ' + (s.ref || '(blank)') + '\n' + lines.join('\n') + '\nTotal ' + money(total(s)) + ' ex GST\ndata: ' + JSON.stringify(d);
  }
  async function approve(job) {
    if (!tdToken()) { job.err = 'Add your Todoist token under Settings to keep approved orders'; return draw(job.wrid); }
    job.busy = true; job.msg = 'Saving to Todoist…'; draw(job.wrid);
    try {
      const sec = await section(), ap = approved[job.wrid];
      const content = 'Solar order: ' + street(job) + ' (JN ' + job.jn + ')', description = apText(job);
      if (ap) await td('POST', 'tasks/' + ap.id, { content, description });
      else { const t = await td('POST', 'tasks', { content, description, project_id: TRACK, section_id: sec }); approved[job.wrid] = { id: t.id }; }
      approved[job.wrid].d = JSON.parse(description.match(/^data: (.*)$/m)[1]);
      job.msg = 'Approved and saved to Todoist.';
    } catch (e) { job.err = String(e.message || e); job.msg = ''; }
    job.busy = false; draw(job.wrid);
  }
  async function markOrdered(job) {
    const s = st(job.wrid), ap = approved[job.wrid];
    job.busy = true; job.msg = 'Marking it ordered…'; draw(job.wrid);
    try {
      if (ap && tdToken()) { await td('POST', 'comments', { task_id: ap.id, content: 'Ordered ' + new Date().toLocaleDateString('en-AU') + ', PO ref ' + (s.ref || '(blank)') + ', ' + money(total(s)) + ' ex' }); await td('POST', 'tasks/' + ap.id + '/close'); delete approved[job.wrid]; }
      s.ordered = Date.now(); touch(job.wrid); job.msg = 'Marked ordered.';
    } catch (e) { job.err = String(e.message || e); job.msg = ''; }
    job.busy = false; if (st(job.wrid).ordered && !S().done) drawAll(); else draw(job.wrid);
  }
  // an approved order from another device fills in this device's lines
  function fromApproved(job) {
    const ap = approved[job.wrid], s = st(job.wrid);
    if (!ap || !ap.d || (s.lines && s.lines.length && (s.approvedAt || 0) >= ap.d.at)) return;
    s.lines = ap.d.l.map(x => ({ kind: x.k, qty: x.q, need: x.n, source: 'approved', pick: { id: x.id, code: x.c, name: x.nm, price: x.p, href: x.h, bq: null }, cand: [] }));
    s.ref = ap.d.ref || s.ref; s.approvedAt = ap.d.at; s.ai = s.ai || { existing: [], phase: 'single', tile: false, po: [], checks: [] };
    s.checked = Object.fromEntries(checks(job).map(c => [c.k, true])); touch(job.wrid);
  }

  // ---------- load into the Tradezone cart ----------
  async function loadCart(job) {
    const s = st(job.wrid), b = blockers(job);
    if (b.length) { job.err = 'Not yet: ' + b.join(', '); return draw(job.wrid); }
    job.busy = true; job.err = ''; job.msg = 'Checking the Tradezone cart is empty…'; draw(job.wrid);
    try {
      const c0 = await cartRead();
      if (c0.out) throw new Error('Signed out of Tradezone. Sign in on tradezone.com.au in this browser, then hit Load again');
      if (c0.items.length) { job.cartBusy = c0.items.length; throw new Error('The cart already has ' + c0.items.length + ' line' + (c0.items.length == 1 ? '' : 's') + ' in it. Order or clear them first, nothing was added'); }
      const loc = TZLOC[S().branch] || 'DC1', res = [];
      for (const l of s.lines) {
        job.msg = 'Adding ' + l.qty + ' x ' + l.pick.code + '…'; draw(job.wrid);
        const r = await tzPost(TZ + '/checkout/cart/add/product/' + l.pick.id + '/?options=cart&qty=' + l.qty + '&location=' + loc);
        let j = null; try { j = JSON.parse(r.responseText); } catch (e) {}
        res.push({ l, ok: !!(j && j.r == 'success'), why: j ? (j.r == 'success' ? '' : clean(j.message || j.msg || j.r)) : 'Tradezone said ' + r.status });
      }
      job.msg = 'Putting the PO ref on…'; draw(job.wrid);
      await tzPost(TZ + '/checkout/cart/updateCustomerOrderReference', form({ reference: clean(s.ref).slice(0, 15) }));
      const c1 = await cartRead();
      const miss = s.lines.filter(l => !c1.items.some(it => normCode(it.part) == normCode(l.pick.code) && it.qty >= l.qty));
      const refOk = clean(c1.ref) == clean(s.ref).slice(0, 15);
      s.loaded = Date.now(); touch(job.wrid);
      job.msg = (miss.length ? 'Loaded, but these didn\'t show right in the cart: ' + miss.map(l => l.qty + ' x ' + l.pick.code).join(', ') + '. ' : 'All ' + s.lines.length + ' lines in the cart. ') + (refOk ? 'PO ref on. ' : 'PO ref didn\'t stick, put it on in the cart. ') + 'Check the cart and order it there, then hit Mark ordered.';
      if (res.some(x => !x.ok && x.why)) job.err = res.filter(x => !x.ok && x.why).map(x => x.l.pick.code + ': ' + x.why).join(', ');
      W.open(TZ + '/checkout/cart/', '_blank');
    } catch (e) { job.err = String(e.message || e); job.msg = ''; }
    job.busy = false; draw(job.wrid);
  }

  // ---------- the list ----------
  let JOBS = [], scanMsg = '', scanning = false;
  const street = job => clean((job.loc || job.name || '').replace(/^\s*\d{6,}[-\w]*\s*-?\s*/, '').replace(/\b(QLD|NSW)\b.*$/i, '')) || job.name;
  async function scan() {
    if (scanning) return; scanning = true;
    scanMsg = 'Reading the calendar…'; drawAll();
    try {
      const evs = await calEvents(S().days), by = {};
      evs.forEach(e => {
        const hd = (e.headers || []).map(h => h.headerText).filter(Boolean).join(' / ');
        if (/cancel/i.test(hd + ' ' + e.title)) return;
        const w = String(e.wrid); if (!w || w == 'undefined') return;
        const j = by[w] = by[w] || { wrid: w, dates: new Set(), staff: new Set(), sched: [] };
        const d = ymd(new Date(e.start)); j.dates.add(d); if (e.resourcename) j.staff.add(String(e.resourcename).split(' ')[0]);
        if (e.note) j.sched.push(dShort(d) + ': ' + clean(e.note));
      });
      const ids = Object.keys(by);
      scanMsg = 'Reading ' + ids.length + ' booked tasks…'; drawAll();
      const found = [];
      let n = 0, fails = 0;
      await pool(ids, 5, async w => {
        let d; try { d = await details(w); } catch (er) { fails++; return; } n++;
        if (n % 5 == 0) { scanMsg = 'Reading booked tasks, ' + n + ' of ' + ids.length + '…'; drawAll(); }
        const all = [d.name, d.desc, d.quoteDesc].join('\n');
        if (!SOLAR.test(all)) return;
        const b = by[w], old = JOBS.find(j => j.wrid == w);
        found.push(Object.assign(old || {}, d, { dates: [...b.dates].sort(), first: [...b.dates].sort()[0], staff: [...b.staff], sched: [...new Set(b.sched)], repl: REPL.test(all) }));
      });
      await loadApproved();
      JOBS = found.sort((a, b) => a.first.localeCompare(b.first) || a.wrid.localeCompare(b.wrid));
      JOBS.forEach(fromApproved);
      const nr = JOBS.filter(j => j.repl).length;
      scanMsg = nr + ' solar replacement' + (nr == 1 ? '' : 's') + ' booked in the next ' + S().days + ' days' + (JOBS.length > nr ? ', plus ' + (JOBS.length - nr) + ' other solar job' + (JOBS.length - nr == 1 ? '' : 's') + ' (isos, reinstates)' : '') + '.' + (fails ? ' Couldn\'t read ' + fails + ' task' + (fails == 1 ? '' : 's') + ', hit Refresh.' : '');
    } catch (e) { scanMsg = 'Couldn\'t read the jobs: ' + (e.message || e); }
    scanning = false; drawAll();
  }
  async function loadJob(job) {
    const [n, d, o] = await Promise.all([notes(job.code).catch(e => { job.nErr = e.message; return []; }), docs(job.code).catch(e => { job.dErr = e.message; return { photos: [], pdfs: [] }; }), others(job).catch(() => [])]);
    job.notes = n; job.photos = d.photos; job.pdfs = d.pdfs; job.others = o; job.loaded = Date.now();
  }

  // ---------- UI ----------
  const CSS = `
#wso-btn{position:fixed;left:14px;bottom:14px;z-index:2147483000;background:${ORANGE};color:#fff;border:0;border-radius:22px;padding:10px 16px;font:700 14px -apple-system,Segoe UI,sans-serif;box-shadow:0 3px 10px #0004;cursor:pointer}
#wso{position:fixed;top:0;right:0;bottom:0;width:min(660px,100vw);z-index:2147483001;background:#f6f4f2;box-shadow:-4px 0 18px #0004;display:flex;flex-direction:column;font:14px/1.4 -apple-system,Segoe UI,sans-serif;color:#222}
#wso *{box-sizing:border-box}
#wso .hd{background:${GREY};color:#fff;padding:10px 12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#wso .hd b{font-size:16px;margin-right:auto}
#wso .hd input[type=number]{width:52px;padding:4px;border-radius:6px;border:0}
#wso .hd label{font-size:13px}
#wso .bd{flex:1;overflow:auto;padding:10px}
#wso .msg{padding:6px 2px 10px;color:#555;font-size:13px}
#wso .btn{background:${ORANGE};color:#fff;border:0;border-radius:8px;padding:7px 12px;font:600 13px -apple-system,Segoe UI,sans-serif;cursor:pointer}
#wso .btn.grey{background:#8a827c}#wso .btn.ghost{background:#fff;color:${GREY};border:1px solid #ccc}
#wso .btn:disabled{opacity:.45;cursor:default}
#wso .card{background:#fff;border-radius:10px;margin:0 0 10px;border-left:5px solid ${ORANGE};box-shadow:0 1px 3px #0002}
#wso .card.oth{border-left-color:#bbb;opacity:.85}#wso .card.ap{border-left-color:#2f8f4e}#wso .card.ord{border-left-color:#999;opacity:.6}
#wso .ch{padding:10px 12px;cursor:pointer;display:flex;gap:8px;align-items:flex-start}
#wso .ch .t{flex:1}#wso .ch .nm{font-weight:700}#wso .sub{color:#666;font-size:12.5px}
#wso .chip{display:inline-block;font-size:11.5px;font-weight:700;border-radius:10px;padding:1px 8px;margin-left:4px;background:#eee;color:#555;white-space:nowrap}
#wso .chip.g{background:#dff1e5;color:#21703b}#wso .chip.o{background:#fde7d6;color:#a94c08}#wso .chip.r{background:#fbdada;color:#a11}
#wso .cb{padding:0 12px 12px}
#wso h4{margin:12px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:${GREY}}
#wso .pre{white-space:pre-wrap;background:#faf9f8;border:1px solid #eee;border-radius:6px;padding:6px 8px;font-size:12.5px;max-height:220px;overflow:auto}
#wso .note{border-bottom:1px solid #eee;padding:4px 0;font-size:12.5px}#wso .note b{color:${GREY}}
#wso .ph{display:flex;gap:6px;overflow-x:auto;padding:4px 0}
#wso .ph div{position:relative;flex:0 0 auto}
#wso .ph img{height:78px;border-radius:6px;cursor:zoom-in;display:block;border:3px solid transparent}
#wso .ph img.mk{border-color:${ORANGE}}#wso .ph img.ai{border-color:#e9b98f}
#wso .ph span{position:absolute;left:3px;bottom:3px;background:#000a;color:#fff;font-size:10.5px;border-radius:4px;padding:0 4px}
#wso textarea,#wso .in{width:100%;border:1px solid #ccc;border-radius:6px;padding:6px 8px;font:13px -apple-system,Segoe UI,sans-serif}
#wso .ln{display:flex;gap:8px;align-items:flex-start;border-bottom:1px solid #eee;padding:6px 0}
#wso .ln input.q{width:56px;padding:4px;border:1px solid #ccc;border-radius:6px}
#wso .ln .t{flex:1;min-width:0}#wso .ln select{max-width:100%;font-size:12px;margin-top:3px}
#wso .ln .x{background:none;border:0;color:#a11;font-size:18px;cursor:pointer}
#wso .inf{color:#a94c08;font-weight:600}#wso .red{color:#a11;font-weight:600}#wso .ok{color:#21703b;font-weight:600}
#wso .ck{display:flex;gap:8px;align-items:flex-start;padding:3px 0;font-size:13px}
#wso .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}
#wso .err{background:#fbdada;color:#811;border-radius:6px;padding:6px 8px;margin-top:8px;font-size:13px}
#wso .say{background:#fff4ea;color:#7a3a05;border-radius:6px;padding:6px 8px;margin-top:8px;font-size:13px}
#wso .res{border:1px solid #ddd;border-radius:6px;margin-top:4px;max-height:220px;overflow:auto;background:#fff}
#wso .res div{padding:5px 8px;border-bottom:1px solid #eee;cursor:pointer;font-size:12.5px}#wso .res div:hover{background:#fff4ea}
#wso-lb{position:fixed;inset:0;z-index:2147483002;background:#000d;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px}
#wso-lb img{max-width:96vw;max-height:80vh;border-radius:6px}
#wso-lb .row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
#wso-lb button{background:#fff;color:${GREY};border:0;border-radius:8px;padding:8px 12px;font:600 13px -apple-system,Segoe UI,sans-serif;cursor:pointer}
#wso-lb button.on{background:${ORANGE};color:#fff}
#wso .set input{width:100%;margin:2px 0 8px}`;
  let P = null, open = {}, showSet = false, searchFor = null;
  function mount() {
    if (document.getElementById('wso-btn')) return;
    const st_ = document.createElement('style'); st_.textContent = CSS; document.head.appendChild(st_);
    const b = document.createElement('button'); b.id = 'wso-btn'; b.textContent = '☀ Solar orders'; b.onclick = toggle; document.body.appendChild(b);
  }
  function toggle() {
    if (P) { P.remove(); P = null; return; }
    P = document.createElement('div'); P.id = 'wso'; document.body.appendChild(P);
    P.addEventListener('click', onClick); P.addEventListener('change', onChange); P.addEventListener('input', onInput);
    drawAll(); if (!JOBS.length) scan();
  }
  function drawAll() {
    if (!P) return;
    const s = S(), shown = JOBS.filter(j => (s.others || j.repl || approved[j.wrid]) && (s.done || !st(j.wrid).ordered));
    const extra = Object.values(approved).filter(a => a.d && !JOBS.find(j => j.wrid == a.d.w));
    P.innerHTML = `<div class="hd"><b>Solar orders</b><label>Next <input type="number" min="1" max="60" data-set="days" value="${s.days}"> days</label>
<label><input type="checkbox" data-set="others" ${s.others ? 'checked' : ''}> other solar</label><label><input type="checkbox" data-set="done" ${s.done ? 'checked' : ''}> ordered</label>
<button class="btn" data-a="scan" ${scanning ? 'disabled' : ''}>Refresh</button><button class="btn grey" data-a="set">Settings</button><button class="btn grey" data-a="close">✕</button></div>
<div class="bd">${showSet ? setHtml() : ''}<div class="msg">${esc(scanMsg)}${apErr ? ' <span class="red">Todoist: ' + esc(apErr) + '</span>' : ''} <span class="sub">AI this month ${money(monthCost())} USD</span></div>
${extra.map(apCard).join('')}
<div id="wso-list">${shown.map(j => `<div class="card ${cls(j)}" data-w="${j.wrid}">${cardHtml(j)}</div>`).join('') || (scanning ? '' : '<div class="msg">Nothing to show.</div>')}</div></div>`;
  }
  const cls = j => st(j.wrid).ordered ? 'ord' : approved[j.wrid] ? 'ap' : j.repl ? '' : 'oth';
  function draw(w) {
    if (!P) return; const el = P.querySelector('.card[data-w="' + w + '"]'); const job = JOBS.find(j => j.wrid == w);
    if (!el || !job) return drawAll();
    const y = P.querySelector('.bd').scrollTop; el.className = 'card ' + cls(job); el.innerHTML = cardHtml(job); P.querySelector('.bd').scrollTop = y;
  }
  function setHtml() {
    const s = S();
    return `<div class="card set"><div class="cb" style="padding-top:10px">
<h4>Settings (this device only)</h4>
Anthropic key <input class="in" type="password" data-key="anthropicKey" value="${esc(aiKey())}">
Todoist token <input class="in" type="password" data-key="todoistToken" value="${esc(tdToken())}">
Rail part no <input class="in" data-set="rail" value="${esc(s.rail)}">
Kit part no (TIN) <input class="in" data-set="kit" value="${esc(s.kit)}">
Tradezone branch <select class="in" data-set="branch">${Object.keys(TZLOC).map(b => `<option ${b == s.branch ? 'selected' : ''}>${b}</option>`).join('')}</select>
<div class="row"><button class="btn" data-a="set">Done</button></div></div></div>`;
  }
  function apCard(a) {
    const d = a.d; const w = d.w;
    return `<div class="card ap"><div class="ch"><div class="t"><div class="nm">${esc(a.title || d.name)}</div><div class="sub">Approved, not in the next ${S().days} days. PO ref ${esc(d.ref || '(blank)')}</div>
<div class="pre" style="margin-top:6px">${esc(d.l.map(x => x.q + ' x ' + x.nm + ' [' + x.c + ']').join('\n'))}</div><div class="sub">Widen the days to load it from here.</div></div></div></div>`;
  }
  function cardHtml(j) {
    const s = st(j.wrid), o = open[j.wrid], ap = approved[j.wrid];
    const chips = [];
    if (s.ordered) chips.push('<span class="chip">Ordered</span>');
    else if (ap) chips.push('<span class="chip g">Approved</span>');
    else if ((s.lines || []).length) chips.push('<span class="chip o">Order worked out</span>');
    if (!j.repl) chips.push('<span class="chip">Not a replacement?</span>');
    if (s.loaded && !s.ordered) chips.push('<span class="chip g">In cart</span>');
    let h = `<div class="ch" data-a="tog"><div class="t"><div class="nm">${esc(dShort(j.first))} · JN ${esc(j.jn)} · ${esc(street(j))}</div>
<div class="sub">${esc(j.staff.join(', '))}${j.dates.length > 1 ? ' · also ' + j.dates.slice(1).map(dShort).join(', ') : ''} · ${esc(j.status)}</div></div><div>${chips.join('')}</div><div>${o ? '▾' : '▸'}</div></div>`;
    if (!o) return h;
    h += '<div class="cb">';
    if (j.busy || j.msg) h += `<div class="say">${esc(j.msg || 'Working…')}</div>`;
    if (j.err) h += `<div class="err">${esc(j.err)}${j.cartBusy ? ' <a href="' + TZ + '/checkout/cart/" target="_blank">Open the cart</a>' : ''}</div>`;
    if (!j.loaded) return h + (j.loading ? '<div class="say">Loading notes and photos…</div>' : '') + '</div>';
    // PO and description
    const pdf = poPdf(j);
    h += `<h4>PO wording</h4><div class="pre">${esc(j.desc || '(no description)')}</div>`;
    if (j.sched.length) h += `<div class="sub">Schedule notes: ${esc(j.sched.join(' · '))}</div>`;
    h += `<div class="row">${pdf ? '<button class="btn ghost" data-a="pdf">Open PO PDF</button>' : '<span class="sub">No PO PDF on the task.</span>'}<button class="btn ghost" data-a="task">Open task</button></div>`;
    if (s.ai && s.ai.po && s.ai.po.length) h += `<h4>PO pricing</h4><div class="pre">${esc(s.ai.po.map(x => x.text + (x.price ? '  ' + x.price : '')).join('\n'))}</div>`;
    // notes
    h += `<h4>Notes (${(j.notes || []).length})</h4>` + ((j.notes || []).length ? `<div class="pre" style="white-space:normal">${j.notes.map(n => `<div class="note"><b>${esc(n.when)} ${esc(n.who)}</b><br>${esc(n.text).replace(/\n/g, '<br>')}</div>`).join('')}</div>` : `<div class="sub">${esc(j.nErr || 'No notes.')}</div>`);
    // photos
    const lp = labelPhotos(j), lpId = Object.fromEntries(lp.map(x => [x.p.id, x.label]));
    h += `<h4>Photos (${(j.photos || []).length})</h4>` + ((j.photos || []).length ? `<div class="ph">${j.photos.map((p, i) => `<div><img src="${esc(p.sm)}" data-a="ph" data-i="${i}" loading="lazy" class="${s.marks[p.id] ? 'mk' : lpId[p.id] ? 'ai' : ''}">${lpId[p.id] ? `<span>${esc(lpId[p.id])}</span>` : ''}</div>`).join('')}</div><div class="sub">Tap a photo to see it big and mark it as a label. Orange = marked by you, light orange = picked by the photo sort.</div>` : `<div class="sub">${esc(j.dErr || 'No photos.')}</div>`);
    h += `<label class="ck"><input type="checkbox" data-f="multi" ${s.multi ? 'checked' : ''}> More than 1 panel type or inverter (mark every label photo, only your marked ones get read)</label>`;
    h += `<h4>Your notes for the AI</h4><textarea rows="2" data-f="notes" placeholder="e.g. 2 x 3kW Fronius, replace with 1 x 5kW Sungrow. Front roof only.">${esc(s.notes)}</textarea>`;
    h += `<div class="row"><button class="btn" data-a="go" ${j.busy ? 'disabled' : ''}>${s.lines && s.lines.length ? 'Re-run' : 'Work out order'}</button>${s.plan ? '<a href="#" data-a="force" class="sub">redo with the AI anyway</a>' : ''}</div>`;
    if (!(s.lines || []).length) return h + '</div>';
    // the order
    const a = s.ai || {};
    if ((a.existing || []).length) h += `<h4>On site now</h4><div class="sub">${esc(a.existing.join(' · '))}${a.phase ? ' · ' + esc(a.phase) + ' phase' : ''}</div>`;
    h += `<h4>Order (Tradezone ${esc(S().branch)})</h4>`;
    s.lines.forEach((l, i) => {
      const x = l.pick;
      h += `<div class="ln"><input class="q" type="number" min="1" data-q="${i}" value="${l.qty}"><div class="t">`;
      h += x ? `<div><b>${esc(x.name)}</b></div><div class="sub">${esc(x.code)} · ${x.price ? money(x.price) + ' ex' : 'no price'} · ${x.bq == null ? esc(x.stock || 'stock ?') : (x.bq >= l.qty ? '<span class="ok">' : '<span class="red">') + esc(S().branch) + ' ' + x.bq + '</span>'}</div>` : `<div class="red">No Tradezone match for ${esc(l.need)}</div>`;
      h += `<div class="sub">${esc(l.need)}${l.source ? ' · from ' + esc(l.source) : ''}${l.inferred ? ' · <span class="inf">inferred</span>' : ''}</div>`;
      if ((l.cand || []).length > 1) h += `<select data-sw="${i}">${l.cand.map((c, k) => `<option value="${k}" ${x && c.id == x.id ? 'selected' : ''}>${esc(c.code + ' · ' + c.name.slice(0, 60) + (c.price ? ' · ' + money(c.price) : ''))}</option>`).join('')}</select>`;
      h += ` <a href="#" data-a="srch" data-i="${i}" class="sub">search</a>${searchFor && searchFor.w == j.wrid && searchFor.i == i ? srchHtml() : ''}</div><button class="x" data-a="del" data-i="${i}" title="Remove">×</button></div>`;
    });
    h += `<div class="row"><a href="#" data-a="srch" data-i="new" class="sub">+ add a line</a></div>${searchFor && searchFor.w == j.wrid && searchFor.i == 'new' ? srchHtml() : ''}`;
    h += `<div class="row"><b>Total ${money(total(s))} ex GST</b></div>`;
    // checklist
    const ck = checks(j), done = s.checked || {};
    h += `<h4>Checklist</h4>` + (ck.length ? ck.map(c => `<label class="ck"><input type="checkbox" data-ck="${esc(c.k)}" ${done[c.k] ? 'checked' : ''}><span class="${c.red ? 'red' : ''}">${esc(c.t)}</span></label>`).join('') : '<div class="sub">Nothing flagged.</div>');
    // ref and buttons
    const b = blockers(j);
    h += `<h4>PO ref for Tradezone (max 15)</h4><input class="in" maxlength="15" data-f="ref" value="${esc(s.ref || '')}" placeholder="e.g. 4462">`;
    h += `<div class="row"><button class="btn grey" data-a="ap" ${j.busy ? 'disabled' : ''}>${approved[j.wrid] ? 'Update approved' : 'Approve'}</button>
<button class="btn" data-a="cart" ${j.busy || b.length ? 'disabled' : ''}>Load to Tradezone</button>
<button class="btn ghost" data-a="ord" ${j.busy ? 'disabled' : ''}>${s.ordered ? 'Ordered ✓' : 'Mark ordered'}</button></div>`;
    if (b.length) h += `<div class="sub" style="margin-top:4px">Before the cart: ${esc(b.join(', '))}.</div>`;
    return h + '</div>';
  }
  let srch = { q: '', res: [], busy: false, err: '' };
  const srchHtml = () => `<div style="margin-top:4px"><input class="in" data-f="srch" placeholder="Search Tradezone" value="${esc(srch.q)}"> ${srch.busy ? '<span class="sub">Searching…</span>' : ''}${srch.err ? '<span class="red">' + esc(srch.err) + '</span>' : ''}
<div class="res">${srch.res.map((x, k) => `<div data-a="pick" data-k="${k}"><b>${esc(x.code)}</b> ${esc(x.name)} ${x.price ? money(x.price) + ' ex' : ''} <span class="sub">${esc(x.stock)}</span></div>`).join('')}</div></div>`;

  function lightbox(job, i) {
    const s = st(job.wrid), ph = job.photos;
    const lb = document.createElement('div'); lb.id = 'wso-lb'; document.body.appendChild(lb);
    const show = () => {
      const p = ph[i], m = s.marks[p.id] || '';
      lb.innerHTML = `<img src="${esc(p.lg)}"><div style="color:#fff;font-size:13px">${i + 1} of ${ph.length} · ${esc(p.by)} ${esc(p.taken)}${p.caption ? ' · ' + esc(p.caption) : ''}</div>
<div class="row"><button data-m="inverter" class="${m == 'inverter' ? 'on' : ''}">Inverter label</button><button data-m="panel" class="${m == 'panel' ? 'on' : ''}">Panel label</button><button data-m="">Not a label</button></div>
<div class="row"><button data-n="-1">◀ Prev</button><button data-o="1">Full size</button><button data-n="1">Next ▶</button><button data-c="1">Close</button></div>`;
    };
    lb.onclick = e => {
      const t = e.target;
      if (t === lb || t.dataset.c) { lb.remove(); return draw(job.wrid); }
      if (t.dataset.n) { i = (i + +t.dataset.n + ph.length) % ph.length; return show(); }
      if (t.dataset.o) return W.open(ph[i].orig, '_blank');
      if (t.dataset.m != null) { if (t.dataset.m) s.marks[ph[i].id] = t.dataset.m; else delete s.marks[ph[i].id]; touch(job.wrid); show(); }
    };
    document.addEventListener('keydown', function k(e) { if (!document.getElementById('wso-lb')) return document.removeEventListener('keydown', k); if (e.key == 'Escape') { lb.remove(); draw(job.wrid); } if (e.key == 'ArrowRight') { i = (i + 1) % ph.length; show(); } if (e.key == 'ArrowLeft') { i = (i - 1 + ph.length) % ph.length; show(); } });
    show();
  }

  const jobOf = el => { const c = el.closest('.card[data-w]'); return c && JOBS.find(j => j.wrid == c.dataset.w); };
  async function onClick(e) {
    const t = e.target.closest('[data-a]'); if (!t) return;
    const a = t.dataset.a, job = jobOf(t);
    if (t.tagName == 'A') e.preventDefault();
    if (a == 'close') return toggle();
    if (a == 'scan') return scan();
    if (a == 'set') { showSet = !showSet; return drawAll(); }
    if (!job) return;
    const s = st(job.wrid);
    if (a == 'tog') {
      open[job.wrid] = !open[job.wrid]; draw(job.wrid);
      if (open[job.wrid] && !job.loaded && !job.loading) { job.loading = true; draw(job.wrid); try { await loadJob(job); } catch (er) { job.err = er.message; } job.loading = false; draw(job.wrid); }
      return;
    }
    if (a == 'pdf') { const p = poPdf(job); if (p) W.open(p.orig, '_blank'); return; }
    if (a == 'task') { const tab = W.open('about:blank', '_blank'); let href = job.link; if (!href) { try { const r = (await taskSearch(job.jn, 'JobNo')).find(x => x.jn == job.jn); href = r && r.href; } catch (er) {} } if (href && tab) tab.location.href = new URL(href, location.origin).href; else if (tab) tab.close(); return; }
    if (a == 'ph') return lightbox(job, +t.dataset.i);
    if (a == 'go') return workOut(job, e.shiftKey);
    if (a == 'force') return workOut(job, true);
    if (a == 'del') { s.lines.splice(+t.dataset.i, 1); touch(job.wrid); return draw(job.wrid); }
    if (a == 'srch') { const i = t.dataset.i == 'new' ? 'new' : +t.dataset.i; searchFor = searchFor && searchFor.w == job.wrid && searchFor.i === i ? null : { w: job.wrid, i }; srch = { q: i === 'new' ? '' : (s.lines[i].terms || [])[0] || s.lines[i].need, res: [], busy: false, err: '' }; draw(job.wrid); const inp = P.querySelector('input[data-f="srch"]'); if (inp) inp.focus(); return; }
    if (a == 'pick') {
      const x = srch.res[+t.dataset.k]; if (!x) return;
      await tzStock(x).catch(() => {});
      if (searchFor.i === 'new') s.lines.push({ kind: 'extra', qty: 1, need: x.name, source: 'added by you', pick: slimIt(x), cand: [slimIt(x)] });
      else { const l = s.lines[searchFor.i]; l.pick = slimIt(x); l.how = 'picked'; if (!l.cand.find(c => c.id == x.id)) l.cand.unshift(slimIt(x)); if (l.kind == 'panel' || l.kind == 'inverter') remember(l.need, x); }
      searchFor = null; touch(job.wrid); return draw(job.wrid);
    }
    if (a == 'ap') return approve(job);
    if (a == 'cart') return loadCart(job);
    if (a == 'ord') { if (s.ordered) { s.ordered = 0; touch(job.wrid); return draw(job.wrid); } return markOrdered(job); }
  }
  let sT = null;
  function onInput(e) {
    const t = e.target, job = jobOf(t);
    if (t.dataset.f == 'srch') { srch.q = t.value; clearTimeout(sT); sT = setTimeout(async () => { if (!clean(srch.q)) return; srch.busy = true; srch.err = ''; try { srch.res = (await searchTz(clean(srch.q))).slice(0, 15); } catch (er) { srch.err = er.message; } srch.busy = false; if (job) { draw(job.wrid); const inp = P.querySelector('input[data-f="srch"]'); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } } }, 500); return; }
    if (job && (t.dataset.f == 'notes' || t.dataset.f == 'ref')) { st(job.wrid)[t.dataset.f] = t.value; touch(job.wrid); }
  }
  function onChange(e) {
    const t = e.target, job = jobOf(t);
    if (t.dataset.set) { setS({ [t.dataset.set]: t.type == 'checkbox' ? t.checked : t.type == 'number' ? Math.max(1, Math.min(60, +t.value || 14)) : t.value }); if (t.dataset.set == 'days') { JOBS = []; return scan(); } if (t.dataset.set == 'branch') Object.values(sCache).forEach(c => c.r.forEach(x => delete x.bq)); return drawAll(); }
    if (t.dataset.key) { GM_setValue(t.dataset.key, keyClean(t.value)); if (t.dataset.key == 'todoistToken') { SEC = ''; GM_setValue('secId', ''); apErr = ''; } return; }
    if (!job) return;
    const s = st(job.wrid);
    if (t.dataset.f == 'multi') { s.multi = t.checked; touch(job.wrid); return draw(job.wrid); }
    if (t.dataset.f == 'ref' || t.dataset.f == 'notes') { s[t.dataset.f] = t.value; touch(job.wrid); return draw(job.wrid); }
    if (t.dataset.q != null) { s.lines[+t.dataset.q].qty = Math.max(1, Math.round(+t.value || 1)); touch(job.wrid); return draw(job.wrid); }
    if (t.dataset.sw != null) { const l = s.lines[+t.dataset.sw], x = l.cand[+t.value]; l.pick = x; l.how = 'picked'; if (l.kind == 'panel' || l.kind == 'inverter') remember(l.need, x); touch(job.wrid); draw(job.wrid); tzStock(x).then(() => { touch(job.wrid); draw(job.wrid); }).catch(() => {}); return; }
    if (t.dataset.ck != null) { s.checked = s.checked || {}; s.checked[t.dataset.ck] = t.checked; touch(job.wrid); return draw(job.wrid); }
  }

  // test hook for Claude: read only bits, nothing here runs by itself
  W.wreSolar = { scan, jobs: () => JOBS, st, workOut, fromApproved, loadApproved, approved: () => approved, details, notes, docs, others, searchTz, tzStock, byCode, cartRead, checks, blockers, labelPhotos, toggle };

  if (document.readyState == 'complete') mount(); else addEventListener('load', mount);
})();
})();
