// ==UserScript==
// @name         WRE job packs
// @namespace    wre
// @version      0.4
// @description  Job pack PDFs for Ambrose jobs. A Job packs button on the AroFlo calendar (above Solar orders) lists the Ambrose jobs booked in the next X days with tick boxes, and a Job pack button sits on each Ambrose task. Run reads the task, pulls the Ambrose site photos and mud map, gets an aerial of the address (Queensland Government photos, or Google with a key), has Haiku pick the photos for the PO rooms, write the job scope and flag anything odd, builds the pack in FieldViser through its API, then puts a share link on top of the task description and the PDF in the task's documents.
// @match        https://office.aroflo.com/ims/Site/Calendar/*
// @match        https://office.aroflo.com/ims/Site/Service/workrequest/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @grant        window.close
// @connect      production-reportapi.ambrosebuilding.com.au
// @connect      ambrose-production.s3-ap-southeast-2.amazonaws.com
// @connect      ddxqoilvgipf7.cloudfront.net
// @connect      maps.googleapis.com
// @connect      spatial-gis.information.qld.gov.au
// @connect      spatial-img.information.qld.gov.au
// @connect      api.anthropic.com
// @connect      testing.fieldviser.com
// @connect      fieldviser.com
// @connect      api.todoist.com
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Badseed26/wre-userscripts/main/wre-job-packs.user.js
// @downloadURL  https://raw.githubusercontent.com/Badseed26/wre-userscripts/main/wre-job-packs.user.js
// ==/UserScript==

// Built from src/wre-job-packs.js by build.py. Change src/wre-job-packs.js, not this file.
(function () {
  // Live updates (23/10): Tampermonkey only checks for a new version every few hours. This checks the repo's latest commit every
  // 2 min (free when nothing's changed) and keeps the newest code here, so a push runs on the next page load. If the new code needs
  // a permission this install hasn't got, or this browser won't run it, the built in copy below runs like before.
  const __wreName = "wre-job-packs", __wreVer = "0.4", __wreHave = new Set(["// @connect ambrose-production.s3-ap-southeast-2.amazonaws.com", "// @connect api.anthropic.com", "// @connect api.github.com", "// @connect api.todoist.com", "// @connect ddxqoilvgipf7.cloudfront.net", "// @connect fieldviser.com", "// @connect maps.googleapis.com", "// @connect production-reportapi.ambrosebuilding.com.au", "// @connect raw.githubusercontent.com", "// @connect spatial-gis.information.qld.gov.au", "// @connect spatial-img.information.qld.gov.au", "// @connect testing.fieldviser.com", "// @grant GM_addValueChangeListener", "// @grant GM_getValue", "// @grant GM_openInTab", "// @grant GM_setValue", "// @grant GM_xmlhttpRequest", "// @grant unsafeWindow", "// @grant window.close", "// @match https://office.aroflo.com/ims/Site/Calendar/*", "// @match https://office.aroflo.com/ims/Site/Service/workrequest/*", "// @run-at document-idle"]);
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
  // ---------- the built in copy (src/wre-job-packs.js at 0.4) ----------

(function () {
  'use strict';

  // How it works (16/11):
  // AroFlo: the calendar's own feed for the Ambrose bookings in the next X days, each task's details (AJAX_HTML_task_details.cfm)
  //   for the description and the Ambrose Site Images link. The jobRecID on that link is all Ambrose needs.
  // Ambrose: production-reportapi.ambrosebuilding.com.au/ReportData/ImagesReport?jobRecID= gives every photo with its room, caption
  //   and S3 link (the images report page reads the same). The mud map is the FRONT ELEVATION photo captioned "MudMap for company".
  //   Ambrose has never supplied an aerial (23 jobs checked 16/11), so the aerial comes off the task address: the Queensland
  //   Government's public aerials (Qld Globe, free, no key, photos 3 years old or more) by default, Google Static Maps when a
  //   Google key is under Settings (newer photos, needs billing on the Google account). 0.2, 16/11.
  // AI: one call. Haiku 5.5 (or Sonnet 5.5 on high, Settings) gets the PO wording with phones and contacts stripped, each photo's
  //   room and caption, and 512px thumbnails. It picks the photos (General plus each PO room), writes the job scope by room, a
  //   heads up line if the description has something critical, and flags only clear mismatches (an oven in the study).
  // FieldViser: /api/v1 with your key. Job by reference aroflo/<JN>, cover, Aerial page with a pin in the middle, Mud map page,
  //   photo sections, photos by external id amb-<Ambrose recID> so a re-run replaces instead of doubling, then export and the
  //   share link (always the newest PDF). Photos dropped on a re-run go to the job's bin, never deleted.
  // AroFlo writes (the task's own pages, one step a page load): the share link as the top line of the description through the
  //   Edit Task Header page's own Save (old text and other header fields checked unchanged first), then the PDF through the
  //   task's own Documents & Photos Add (same way as the inbox filer). From the calendar list each job's AroFlo step runs in a
  //   background tab that closes itself. Never touches status, bookings, notes or anything else.

  const W = typeof unsafeWindow != 'undefined' ? unsafeWindow : window;
  if (W.__wreJobPacks || window.top !== window.self) return;
  W.__wreJobPacks = 1;

  const ORANGE = '#e8731a', GREY = '#4a4541';
  const AMB = 'https://production-reportapi.ambrosebuilding.com.au/ReportData/ImagesReport?jobRecID=';
  const CF = 'https://ddxqoilvgipf7.cloudfront.net/800x800/media/';
  const TDA = 'https://api.todoist.com/api/v1/';
  const FU = '6hfHcM9Gf74fgcJw';          // Todoist: WRE follow ups
  const MODELS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5' };
  const AIPRICE = { 'claude-haiku-5-5': [0.1, 0.5], 'claude-sonnet-5-5': [2, 10] };   // USD per MTok, in and out
  const DEF = { days: 14, model: 'haiku', fvBase: 'https://testing.fieldviser.com' };
  const HASH = '#wre-jobpack';

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const now = () => Date.now();
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = t => new DOMParser().parseFromString(t || '', 'text/html');
  const plain = h => clean(html(h).body.textContent || '');
  const p2 = n => String(n).padStart(2, '0');
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dShort = d => DAYS[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1);
  const jq = () => W.jQuery;

  // ---------- settings and per job state (this device's Tampermonkey) ----------
  const S = () => Object.assign({}, DEF, GM_getValue('set', {}));
  const setS = o => GM_setValue('set', Object.assign(GM_getValue('set', {}), o));
  const keyClean = k => String(k || '').replace(/[\s​-‍⁠﻿]/g, '').replace(/^["']|["']$/g, '');
  const aiKey = () => keyClean(GM_getValue('anthropicKey', ''));
  const mapsKey = () => keyClean(GM_getValue('googleKey', ''));
  const fvKey = () => keyClean(GM_getValue('fvKey', ''));
  const tdToken = () => clean(GM_getValue('todoistToken', ''));
  const fvBase = () => String(S().fvBase || DEF.fvBase).replace(/\/+$/, '');
  const jst = jn => GM_getValue('jp:' + jn, null);
  const setJst = (jn, o) => { const v = Object.assign({}, jst(jn) || {}, o, { at: now() }); GM_setValue('jp:' + jn, v); return v; };

  // ---------- requests ----------
  function gm(o) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest(Object.assign({ timeout: 60000 }, o, {
      onload: r => resolve(r), onerror: () => reject(new Error('couldn\'t reach ' + new URL(o.url).host)), ontimeout: () => reject(new Error(new URL(o.url).host + ' took too long')),
    })));
  }
  const afText = async url => {
    const r = await (W.fetch || fetch).call(W, new URL(url, location.origin).href, { credentials: 'include', cache: 'no-store' });
    if (!r.ok) throw new Error('AroFlo said ' + r.status);
    const x = await r.text();
    if (/name=["']?password|loginForm/i.test(x) && !/wrCoded|noteItem|rows/.test(x)) throw new Error('AroFlo looks signed out');
    return x;
  };
  const b64Of = blob => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1]); f.onerror = rej; f.readAsDataURL(blob); });
  const abToB64 = ab => { const u = new Uint8Array(ab); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  async function getBlob(url) {
    const r = await gm({ method: 'GET', url, responseType: 'blob', timeout: 90000 });
    if (r.status < 200 || r.status >= 300 || !r.response) throw new Error(new URL(url).host + ' said ' + r.status);
    return r.response;
  }
  // shrink a picture to L px on its long edge, JPEG, base64
  async function jpeg(blob, L, q) {
    const bm = await createImageBitmap(blob);
    const s = Math.min(1, L / Math.max(bm.width, bm.height));
    const c = document.createElement('canvas'); c.width = Math.round(bm.width * s); c.height = Math.round(bm.height * s);
    c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
    const out = await new Promise(r => c.toBlob(r, 'image/jpeg', q || 0.82));
    return { b64: await b64Of(out), w: c.width, h: c.height };
  }

  // FieldViser /api/v1
  async function fv(method, path, body, raw) {
    if (!fvKey()) throw new Error('No FieldViser key. Add it under Settings');
    const r = await gm({ method, url: fvBase() + '/api/v1' + path, timeout: raw ? 180000 : 90000, responseType: raw ? 'arraybuffer' : undefined,
      headers: Object.assign({ Authorization: 'Bearer ' + fvKey() }, body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      data: body !== undefined ? JSON.stringify(body) : undefined });
    if (r.status == 401 || r.status == 403) throw new Error('FieldViser didn\'t accept the key (or the key can\'t do that). Check it under Settings');
    if (raw) {
      if (r.status < 200 || r.status >= 300) throw new Error('FieldViser export said ' + r.status);
      const ver = ((r.responseHeaders || '').match(/x-pdf-version:\s*(\d+)/i) || [])[1] || '';
      return { b64: abToB64(r.response), ver: +ver || 0 };
    }
    let j = null; try { j = r.responseText ? JSON.parse(r.responseText) : {}; } catch (e) {}
    if (r.status == 404) return null;
    if (r.status < 200 || r.status >= 300) throw new Error('FieldViser said ' + r.status + (j && j.error ? ': ' + j.error.message : ''));
    return j || {};
  }

  const td = (method, path, body) => gm({ method, url: TDA + path, timeout: 20000, headers: { Authorization: 'Bearer ' + tdToken(), 'Content-Type': 'application/json' }, data: body ? JSON.stringify(body) : undefined })
    .then(r => { if (r.status < 200 || r.status >= 300) throw new Error('Todoist said ' + r.status); try { return JSON.parse(r.responseText); } catch (e) { return null; } });

  // ---------- AroFlo ----------
  async function calEvents(days) {
    for (let i = 0; i < 40 && !(W.jsonSettings && document.getElementById('calBoxContainer')); i++) await sleep(250);
    const box = document.getElementById('calBoxContainer');
    if (!W.jsonSettings || !box) throw new Error('couldn\'t read the calendar settings, give the calendar a sec to load then hit Refresh');
    const q = new URLSearchParams();
    q.set('jsonSettings', JSON.stringify(W.jsonSettings));
    q.set('masterusercoded', box.getAttribute('data-master-user-id') || '');
    const t = new Date(), list = [];
    for (let i = 0; i < days; i++) { const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + i); list.push(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 1000); }
    q.set('range', list.join(','));
    q.set('eventtypes_task', '1');
    const r = await (W.fetch || fetch).call(W, '/ims/Site/Calendar/AJAX/AJAX_JSON_ims_events.cfm', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, body: q.toString() });
    let evs; try { evs = JSON.parse(await r.text()); } catch (e) { evs = null; }
    if (!Array.isArray(evs)) throw new Error('the calendar feed didn\'t come back, AroFlo might be signed out');
    return evs.filter(e => e.type == 'task');
  }
  // the task as the calendar popup shows it: name, location, description and the Ambrose links
  async function details(wrid) {
    const h = await afText('/ims/Site/Calendar/AJAX/AJAX_HTML_task_details.cfm?wrid=' + wrid);
    const d = html(h);
    const recs = [...new Set([...d.querySelectorAll('a')].map(a => a.getAttribute('href') || '').filter(x => /images-report/i.test(x))
      .map(x => { try { return new URL(x).searchParams.get('jobRecID'); } catch (e) { return ''; } }).filter(Boolean))];
    d.querySelectorAll('script,style').forEach(x => x.remove());
    const t = (d.body.innerText || d.body.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
    const one = re => clean((t.match(re) || [])[1] || '').slice(0, 160);
    const ref = one(/Ref \/ JN:?\s*([^\n]+)/);
    const desc = ((t.match(/Task Description:?\s*([\s\S]*?)(?:\s*Task Notes \(last three\)|\s*Quote Description:|$)/) || [])[1] || '').trim();
    return { wrid, jn: (ref.match(/(\d{3,})\s*$/) || [])[1] || '', name: one(/(?:Task )?Name:?\s*([^\n]+)/), client: one(/Client:?\s*([^\n]+)/), loc: one(/Location:?\s*([^\n]+)/), status: one(/Status:?\s*([^\n]+)/), desc, recs };
  }
  async function taskSearch(term, field) {
    const body = new URLSearchParams({ taskString: term, SearchParam: field, searchtasks: 'Search', searchtasks_btn: 'Search' });
    const r = await (W.fetch || fetch).call(W, '/ims/Site/Home/index.cfm?tid=IMS.STK.CUR', { method: 'POST', body, credentials: 'include' });
    const d = html(await r.text());
    return [...d.querySelectorAll('tr')].filter(tr => tr.querySelectorAll('td').length >= 6).map(tr => {
      const c = [...tr.querySelectorAll('td')].map(x => clean(x.textContent)).filter(Boolean);
      const a = [...tr.querySelectorAll('a')].find(x => /workrequest/i.test(x.getAttribute('href') || '') && !/printview/i.test(x.getAttribute('href')));
      return { jn: c[1], status: c[c.length - 1] || '', href: a ? a.getAttribute('href') : '' };
    }).filter(t => /^\d+$/.test(t.jn || ''));
  }
  const taskHref = async jn => { const r = (await taskSearch(String(jn), 'JobNo')).find(x => x.jn == String(jn)); return r && r.href ? r.href : ''; };

  // what the AI gets to read, private bits stripped
  function strip(t) {
    return String(t || '')
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
      .replace(/(\+?61\s?|\b0)[2-478](?:[\s-]?\d){8}\b/g, '[phone]')
      .replace(/\b(gate code|door code|code|key ?safe|lock ?box|alarm|password|pin)\b\s*(?:is|[:\-])?\s*[\w#*-]*\d[\w#*-]*/gi, '$1 [removed]')
      .replace(/\b(site contact|contact|tenant|owner|customer|client|insured|supervisor)\b\s*[:\-]\s*[^\n;,.]*/gi, '$1: [removed]')
      .replace(/View (Repair Schedule|Site Images)[^\n]*/gi, '')
      .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  // the job's facts off the task, no AI
  function facts(d) {
    const desc = d.desc || '';
    const poBase = (d.name.match(/^\s*(\d{6,})/) || [])[1] || '';
    const addr = clean(d.name.replace(/^\s*\d{6,}[-\w]*\s*-?\s*/, '')) || clean(d.loc);
    const pos = [...new Set((desc.match(/P\.?O\.? No:?\s*([\d]{6,}-?\d*)/gi) || []).map(x => x.replace(/P\.?O\.? No:?\s*/i, '').replace(/-$/, '')))];
    const line = re => clean((desc.match(re) || [])[1] || '');
    return { jn: d.jn, wrid: d.wrid, name: d.name, addr, poBase, pos: pos.length ? pos : (poBase ? [poBase] : []),
      contact: line(/SITE CONTACT:?\s*([^\n]+)/i), supervisor: line(/SUPERVISOR:?\s*([^\n]+)/i), desc, recs: d.recs };
  }

  // ---------- Ambrose ----------
  async function ambrose(recs) {
    const out = { photos: [], mud: null, claim: '', newest: '' };
    for (const id of recs) {
      const r = await gm({ method: 'GET', url: AMB + encodeURIComponent(id), headers: { Accept: 'application/json' } });
      if (r.status < 200 || r.status >= 300) throw new Error('Ambrose images said ' + r.status);
      const j = JSON.parse(r.responseText);
      out.claim = out.claim || (j.job && j.job.claimNumber) || '';
      (j.locationImages || []).forEach(l => (l.images || []).forEach(i => {
        const p = { rec: i.recID, room: clean(l.name || i.location), cap: clean(i.comments), url: i.externalUrl, when: i.createdDateTime || '' };
        if (p.when > out.newest) out.newest = p.when;
        if (/mud\s*map/i.test(p.cap) && !out.mud) out.mud = p; else if (p.url) out.photos.push(p);
      }));
    }
    out.photos.forEach((p, i) => { p.n = i + 1; });
    return out;
  }
  const cfThumb = url => CF + String(url || '').split('/media/')[1];
  const capOf = p => /for company/i.test(p.cap) ? (/front elevation/i.test(p.room + p.cap) ? 'Front of house' : p.room) : (p.cap || p.room);

  // ---------- AI ----------
  const PICK_SYS = `You set up a job pack PDF for the electricians at Wired Rite Electrical (Queensland) on an insurance repair job from the builder Ambrose. You get the AroFlo task description (the builder's PO lines, contacts removed) and the site photos the builder's estimator took, numbered, each with the room it was filed under and the estimator's caption, as small thumbnails.

1. Pick the photos.
Keep:
- "general": the front of house, plus supply gear wherever it shows up: switchboard, meter box, main switch, point of attachment or overhead service, solar inverter and isolators.
- every room the PO lists, matched loosely (a study can be filed as Office, a lounge as Living Room). For each, the overviews that show where the work is, and close ups of the spot the work sits in (cabinet or island panels coming off around a GPO or oven isolator).
- skirting or floor shots only when they show electrical the PO wording covers (a skirting GPO, a floor box).
Drop: electrical fittings outside the area of works (downlights, GPOs, fans in rooms the PO doesn't list), moisture meter readings, near duplicates of a shot already kept, skirting and floor close ups that show nothing the PO covers, rooms the PO doesn't list. Leave a room out if none of its photos help.

2. Write the job scope from the PO lines, grouped by room, as a formal job scope: plain, exact, quantities kept, one dot point per line of work. Leave out preliminaries and labour rate allowance lines. A removal says whether the item is stored or disposed of and how many. Don't add work that isn't on the PO, and don't add promises (no "confirm with owner", no "make safe old points"). If there are two or more POs and a line comes off a later one, end it with (PO -09) style using the PO's suffix.

3. heads_up: one short line only if the description holds something the electrician must not miss on arrival (the wrong half of a duplex, an access warning, a dog, asbestos). Otherwise "".

4. flags: only clear mismatches Ethan should sort with the builder: an item in a room it can't be in (an oven in a study), a PO room with no photos at all, the same item on two POs, a PO line the photos plainly contradict, a quantity that can't be right. Not picky: no flags for wording, style, or anything that's just unclear. Each with a best guess of what was meant. Usually there are none.

Answer with JSON only:
{"general":[1,5],"rooms":[{"name":"Kitchen","photos":[3,4]}],"scope":[{"heading":"Kitchen","points":["Disconnect, store, label and reconnect GPO x2"]}],"heads_up":"","flags":[{"text":"Oven listed under the study","guess":"Probably the kitchen oven, study GPO only"}]}`;

  const AIR_SYS = `You check an aerial photo for an electrician's job pack. The photo is about 90 m square, centred on the street address's map point, and a pin gets drawn at the exact centre. On big rural blocks the map point can sit out by the road, away from the house.
Say whether the centre of the photo is on (or right beside) the main house, and how much of the main house is in the photo. If there are several buildings, the main house is the biggest roofed dwelling near the centre. "note" is a few words on where the house is if the pin misses it (e.g. "house is top left, pin is on the driveway"), else "".
Answer with JSON only: {"pin_on_house":true,"house_in_frame":"whole","note":""}  (house_in_frame is whole, part or none)`;
  async function claude(model, system, content, maxTokens, effort) {
    if (!aiKey()) throw new Error('No Anthropic key. Add it under Settings');
    const body = { model, max_tokens: maxTokens, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content }] };
    if (effort) body.output_config = { effort };
    const r = await gm({ method: 'POST', url: 'https://api.anthropic.com/v1/messages', timeout: 180000, data: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-api-key': aiKey(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } });
    let j = null; try { j = JSON.parse(r.responseText); } catch (e) {}
    if (r.status == 401 || r.status == 403) throw new Error('Anthropic didn\'t accept the key. Check it under Settings');
    if (!j || r.status >= 300) throw new Error('the AI said ' + r.status + (j && j.error ? ': ' + j.error.message : ''));
    const u = j.usage || {}, pr = AIPRICE[model] || [0, 0];
    const cost = ((u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1) * pr[0] / 1e6 + (u.output_tokens || 0) * pr[1] / 1e6;
    const text = (j.content || []).filter(c => c.type == 'text').map(c => c.text).join('');
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [0, text];
    const s = m[1].slice(m[1].indexOf('{'), m[1].lastIndexOf('}') + 1);
    try { const o = JSON.parse(s); o._cost = cost; return o; } catch (e) { throw new Error('the AI\'s answer couldn\'t be read'); }
  }
  async function pick(F, A, say) {
    const content = [{ type: 'text', text: 'Task description:\n' + strip(F.desc).slice(0, 6000) + '\n\nPhotos (number | room | caption):\n' + A.photos.map(p => p.n + ' | ' + p.room + ' | ' + p.cap).join('\n') }];
    let done = 0;
    const thumbs = new Array(A.photos.length);
    await pool(A.photos, 6, async (p, i) => { try { thumbs[i] = (await jpeg(await getBlob(cfThumb(p.url)), 512, 0.7)).b64; } catch (e) { thumbs[i] = null; } say('Thumbnails ' + (++done) + ' of ' + A.photos.length); });
    A.photos.forEach((p, i) => { if (!thumbs[i]) return; content.push({ type: 'text', text: 'Photo ' + p.n }); content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: thumbs[i] } }); });
    say('AI picking photos and writing the scope');
    const s = S();
    const o = await claude(MODELS[s.model] || MODELS.haiku, PICK_SYS, content, 4000, s.model == 'sonnet' ? 'high' : null);
    const byN = n => A.photos.find(p => p.n == n);
    const sections = [];
    const gen = (o.general || []).map(byN).filter(Boolean); if (gen.length) sections.push({ name: 'General', photos: gen });
    (o.rooms || []).forEach(r => { const ph = (r.photos || []).map(byN).filter(Boolean).filter(p => !sections.some(x => x.photos.includes(p))); if (ph.length) sections.push({ name: clean(r.name) || ph[0].room, photos: ph }); });
    return { sections, scope: (o.scope || []).filter(x => x && x.points && x.points.length).map(x => ({ heading: clean(x.heading), points: x.points.map(clean).filter(Boolean) })),
      heads: clean(o.heads_up), flags: (o.flags || []).filter(f => f && f.text).map((f, i) => ({ id: 'f' + i, text: clean(f.text), guess: clean(f.guess), state: '' })), cost: o._cost };
  }
  async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }

  // ---------- aerial ----------
  // Queensland Government: the address search gives the spot in web mercator metres, then a 90 m square of the latest public
  // aerial around it, 1280 px (about 7 cm a pixel). The address goes in the middle, where FieldViser's pin goes.
  const QLD_GEO = 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Location/QldLocator/GeocodeServer/findAddressCandidates';
  const QLD_IMG = 'https://spatial-img.information.qld.gov.au/arcgis/rest/services/Basemaps/LatestStateProgram_AllUsers/ImageServer/exportImage';
  async function aerial(addr) {
    if (mapsKey()) {
      const u = 'https://maps.googleapis.com/maps/api/staticmap?center=' + encodeURIComponent(addr + ', QLD, Australia') + '&zoom=20&size=640x640&scale=2&maptype=satellite&format=jpg&key=' + encodeURIComponent(mapsKey());
      const r = await gm({ method: 'GET', url: u, responseType: 'blob', timeout: 30000 });
      if (r.status != 200 || !r.response || !/image/.test(r.response.type || 'image')) throw new Error('Google Maps said ' + r.status + ' (check the key has the Maps Static API on, or clear it to use the Queensland photos)');
      return { b64: await b64Of(r.response), when: null, google: true };
    }
    const g = await gm({ method: 'GET', url: QLD_GEO + '?SingleLine=' + encodeURIComponent(addr + ', QLD') + '&outSR=3857&maxLocations=1&f=json', timeout: 30000 });
    let c = null; try { c = (JSON.parse(g.responseText).candidates || [])[0]; } catch (e) {}
    if (!c || !c.location || (c.score || 0) < 80) throw new Error('the Queensland address search couldn\'t find ' + addr);
    const x = c.location.x, y = c.location.y, h = 45;
    const r = await gm({ method: 'GET', url: QLD_IMG + '?bbox=' + [x - h, y - h, x + h, y + h].join(',') + '&bboxSR=3857&imageSR=3857&size=1280,1280&format=jpg&f=image', responseType: 'blob', timeout: 60000 });
    if (r.status != 200 || !r.response || !/image/.test(r.response.type || 'image')) throw new Error('the Queensland aerial photos said ' + r.status);
    // which flyover that is: the photo sets over the spot, the one drawn on top has the lowest zorder (the 2017 satellite
    // mosaic sits underneath everything at 2.4 m a pixel, only showing where there's no flyover). 0.3, 16/11.
    let when = null;
    try {
      const q = JSON.parse((await gm({ method: 'GET', url: QLD_IMG.replace(/exportImage$/, 'query') + '?geometry=' + x + ',' + y + '&geometryType=esriGeometryPoint&inSR=3857&spatialRel=esriSpatialRelIntersects&outFields=name,captureend,zorder,res_value,res_unit&returnGeometry=false&f=json', timeout: 30000 })).responseText);
      const f = (q.features || []).map(z => z.attributes).sort((a, b) => a.zorder - b.zorder)[0];
      if (f && f.captureend) { const d = new Date(f.captureend); when = { at: f.captureend, txt: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ' ' + d.getFullYear(), sat: /QSat|Planet/i.test(f.name || ''), name: f.name || '' }; }
    } catch (e) {}
    return { b64: await b64Of(r.response), when };
  }

  // ---------- FieldViser ----------
  function coverOf(F, A, P, alertExtra) {
    const fields = [['Job number', F.jn], ['Builder', 'Ambrose Construct Group'], ['PO', F.pos.join(', ')], ['Claim', A.claim], ['Site contact', F.contact], ['Supervisor', F.supervisor]]
      .filter(x => clean(x[1])).map(x => ({ label: x[0], value: clean(x[1]) }));
    const alert = [P.heads].concat(alertExtra || []).filter(Boolean).join(' ');
    return { on: true, title: 'JOB PACK', alert: alert || '', fields, notes: P.scope, version_line: true };
  }
  async function fvBuild(F, A, P, say) {
    const ref = '/jobs/ref/aroflo/' + encodeURIComponent(F.jn);
    say('FieldViser: job and cover');
    let job = (await fv('PUT', ref, { title: F.addr, site: F.addr, number: F.poBase, notes: [], cover: coverOf(F, A, P), photo_pages: { on: true, section_per: 2, loose: false } })).job;
    const id = job.id;
    let pages = job.pages || (await fv('GET', '/jobs/' + id + '/pages')).pages || [];
    // aerial page, with a pin on the address (the middle of the picture)
    say('FieldViser: aerial');
    const AIR = await aerial(F.addr), air = AIR.b64;
    let ap = pages.find(p => /^aerial$/i.test(p.name));
    if (!ap && pages.length == 1 && !pages[0].has_image && !(pages[0].markers || []).length) { ap = pages[0]; await fv('PATCH', '/jobs/' + id + '/pages/' + ap.id, { name: 'Aerial', in_pdf: true }); }
    if (ap) await fv('PUT', '/jobs/' + id + '/pages/' + ap.id + '/image', { image: air });
    else ap = (await fv('POST', '/jobs/' + id + '/pages', { name: 'Aerial', image: air, in_pdf: true })).page;
    if (!(ap.markers || []).some(m => m.type == 'pin')) await fv('POST', '/jobs/' + id + '/pages/' + ap.id + '/markers', { type: 'pin', fx: 0.5, fy: 0.5 });
    // mud map page
    let mp = pages.find(p => /^mud ?map$/i.test(p.name));
    if (A.mud) {
      say('FieldViser: mud map');
      const mm = (await jpeg(await getBlob(A.mud.url), 2400, 0.88)).b64;
      if (mp) { await fv('PUT', '/jobs/' + id + '/pages/' + mp.id + '/image', { image: mm }); await fv('PATCH', '/jobs/' + id + '/pages/' + mp.id, { in_pdf: true }); }
      else mp = (await fv('POST', '/jobs/' + id + '/pages', { name: 'Mud map', image: mm, in_pdf: true })).page;
    } else if (mp) await fv('PATCH', '/jobs/' + id + '/pages/' + mp.id, { in_pdf: false });
    await fv('PUT', '/jobs/' + id + '/pages/order', { ids: [ap.id].concat(mp ? [mp.id] : []) });
    // sections, keeping the ids of ones already there so their photos stay put
    const have = job.sections || [];
    const secs = (await fv('PUT', '/jobs/' + id + '/sections', { sections: P.sections.map(s => { const h = have.find(x => x.name.toLowerCase() == s.name.toLowerCase()); return h ? { id: h.id, name: s.name } : { name: s.name }; }) })).sections || [];
    const secId = name => { const x = secs.find(s => s.name.toLowerCase() == name.toLowerCase()); return x ? x.id : name; };
    // photos: new ones up, kept ones re-captioned, dropped ones to the bin
    const old = (job.photos || []).filter(p => /^amb-/.test(p.external_id || ''));
    const want = [];
    P.sections.forEach(s => s.photos.forEach(p => want.push({ ext: 'amb-' + p.rec, p, sec: s.name })));
    let n = 0;
    for (const w of want) {
      say('FieldViser: photo ' + (++n) + ' of ' + want.length);
      const body = { caption: capOf(w.p), section: secId(w.sec) };
      if (old.find(o => o.external_id == w.ext)) await fv('PATCH', '/jobs/' + id + '/photos/' + encodeURIComponent(w.ext), body);
      else await fv('POST', '/jobs/' + id + '/photos', Object.assign({ image: (await jpeg(await getBlob(w.p.url), 1600, 0.85)).b64, external_id: w.ext }, body));
    }
    for (const o of old) if (!want.find(w => w.ext == o.external_id)) await fv('DELETE', '/jobs/' + id + '/photos/' + encodeURIComponent(o.external_id));
    if (want.length) await fv('PUT', '/jobs/' + id + '/photos/order', { ids: want.map(w => w.ext) });
    return Object.assign(await fvFinish(id, say), { air: AIR });
  }
  async function fvFinish(id, say) {
    say('FieldViser: building the PDF');
    const pdf = await fv('POST', '/jobs/' + id + '/export', undefined, true);
    const sh = (await fv('POST', '/jobs/' + id + '/share', {})).share;
    if (!sh || !sh.url) throw new Error('FieldViser didn\'t give a share link');
    return { fvId: id, ver: pdf.ver, pdf: pdf.b64, share: sh.url };
  }

  // ---------- the whole run for one job ----------
  const pdfName = (F, ver) => ('JOB PACK - ' + F.poBase + ' - ' + F.addr.replace(/[\\/:*?"<>|]+/g, ' ')).replace(/\s+/g, ' ').slice(0, 90) + (ver > 1 ? ' v' + ver : '') + '.pdf';
  async function build(wrid, say) {
    say('Reading the task');
    const F = facts(await details(wrid));
    if (!F.recs.length) throw new Error('no Ambrose Site Images link on the task');
    say('Reading the Ambrose photos');
    const A = await ambrose(F.recs);
    if (!A.photos.length && !A.mud) throw new Error('Ambrose has no photos on this job yet');
    const P = await pick(F, A, say);
    const R = await fvBuild(F, A, P, say);
    // Haiku looks at the finished aerial: a big rural block can have its address point out on the road, so the pin (the
    // middle of the picture) misses the house or the house is half out of frame. Info flag only, Ignore. 0.4, 16/11.
    try {
      const small = (await jpeg(await (await fetch('data:image/jpeg;base64,' + R.air.b64)).blob(), 768, 0.8)).b64;
      const o = await claude(MODELS.haiku, AIR_SYS, [{ type: 'text', text: 'Address: ' + F.addr }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: small } }], 300);
      P.cost = (P.cost || 0) + (o._cost || 0);
      if (o.pin_on_house === false || (o.house_in_frame && o.house_in_frame != 'whole')) P.flags.push({ id: 'pin', info: true, state: '',
        text: o.pin_on_house === false ? 'The aerial\'s pin doesn\'t look like it\'s on the house' : 'The house is only partly in the aerial', guess: clean(o.note) || 'Big block maybe, check the aerial page' });
    } catch (e) {}
    // old or blurry aerial: an info flag (Ignore only), the date shows on every result either way
    const aw = R.air && R.air.when;
    if (aw && (aw.sat || now() - aw.at > 5 * 365.25 * 864e5)) P.flags.push({ id: 'air', info: true, state: '',
      text: aw.sat ? 'No flyover photo here, the aerial is the blurry 2017 satellite one' : 'Aerial photo is from ' + aw.txt + ', over 5 years old',
      guess: 'Check Google Maps for anything new on the block (extension, granny flat, pool, solar)' });
    const st = setJst(F.jn, { F, claim: A.claim, P: { sections: P.sections.map(s => ({ name: s.name, photos: s.photos.map(p => p.rec) })), scope: P.scope, heads: P.heads },
      flags: P.flags, aerial: aw ? aw.txt : (R.air && R.air.google ? 'Google' : ''), seen: A.photos.map(p => p.rec).concat(A.mud ? [A.mud.rec] : []), newest: A.newest, fvId: R.fvId, ver: R.ver, share: R.share, cost: P.cost, err: '', pushed: null });
    GM_setValue('jpPush:' + F.jn, { pdf: R.pdf, name: pdfName(F, R.ver), line: 'JOB PACK: ' + R.share, ver: R.ver, at: now() });
    return st;
  }
  // a flag's Add to heads up: the cover's alert line gets it, a fresh PDF, and the AroFlo copy goes up again
  async function addToHeads(jn, flagId, say) {
    const s = jst(jn); const f = (s.flags || []).find(x => x.id == flagId); if (!f) return;
    const extra = (s.flags || []).filter(x => x.state == 'heads' || x.id == flagId).map(x => x.guess || x.text);
    await fv('PUT', '/jobs/' + s.fvId + '/cover', { alert: [s.P.heads].concat(extra).filter(Boolean).join(' ') });
    const R = await fvFinish(s.fvId, say);
    f.state = 'heads';
    setJst(jn, { flags: s.flags, ver: R.ver, share: R.share, pushed: null });
    GM_setValue('jpPush:' + jn, { pdf: R.pdf, name: pdfName(s.F, R.ver), line: 'JOB PACK: ' + R.share, ver: R.ver, at: now() });
  }
  function builderText(s, f) {
    const sup = clean((s.F.supervisor || '').replace(/[\d\s+()-]{8,}$/, '')); const first = (sup.split(/\s+/)[0] || '').replace(/^./, c => c.toUpperCase()).replace(/^(.)(.*)$/, (m, a, b) => a + b.toLowerCase());
    return (first ? 'Hey ' + first + ', ' : 'Hey mate, ') + 'quick one on ' + s.F.addr + ' (PO ' + s.F.pos.join(', ') + '). ' + f.text.replace(/\.?$/, '.') + (f.guess ? ' Is it ' + f.guess.replace(/^probably\s+/i, '').replace(/\.?$/, '') + '?' : ' Can you confirm?') + ' Cheers mate';
  }
  async function askBuilder(jn, flagId) {
    const s = jst(jn); const f = (s.flags || []).find(x => x.id == flagId); if (!f) return '';
    const text = builderText(s, f);
    try { await navigator.clipboard.writeText(text); } catch (e) {}
    if (tdToken()) {
      await td('POST', 'tasks', { project_id: FU, content: 'Ask ' + (clean((s.F.supervisor || '').split(/\s+/)[0]) || 'the builder') + ' re ' + s.F.addr.split(/\s+/).slice(0, 3).join(' ') + ': ' + f.text.slice(0, 60),
        description: 'JN ' + jn + ' | PO ' + s.F.pos.join(', ') + '\nJob pack flag: ' + f.text + (f.guess ? '\nGuess: ' + f.guess : '') + '\n\nDraft:\n' + text, priority: 3, due_string: 'today', labels: ['close-reply'] });
    }
    f.state = 'asked'; setJst(jn, { flags: s.flags });
    return text;
  }

  // ---------- AroFlo writes, on the task's own pages (one step a page load) ----------
  const ss = (k, v) => v === undefined ? JSON.parse(sessionStorage.getItem(k) || 'null') : sessionStorage.setItem(k, JSON.stringify(v));
  const waitFor = (cond, max) => new Promise(res => { if (cond()) return res(true); let done = false; const mo = new MutationObserver(() => { if (!done && cond()) { done = true; mo.disconnect(); res(true); } }); mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true }); setTimeout(() => { if (!done) { done = true; mo.disconnect(); res(cond()); } }, max); });
  const ckReady = name => waitFor(() => !!(W.CKEDITOR && W.CKEDITOR.instances[name] && W.CKEDITOR.instances[name].status == 'ready'), 15000);
  const setData = (ed, h) => new Promise(r => { ed.setData(h, { callback: r }); setTimeout(r, 2500); });
  const hdrFields = () => { const f = document.forms.editwr; return f ? [...f.elements].filter(e => e.name && !/^(hidden|button|submit)$/.test(e.type) && !/^(description|thisnote)$/.test(e.name)).map(e => e.name + '=' + (/radio|checkbox/.test(e.type) ? e.checked : e.value)).join('|') : ''; };
  const isHeader = () => /^Edit - JN/.test(document.title) || !!document.getElementById('updateheader__btn');
  const isTask = () => / - Task - AroFlo/.test(document.title) || !!document.getElementById('btnAddNoteHTML');
  const thisJn = () => (document.title.match(/\bJN (\d+)/) || [])[1] || '';
  const taskDocs = async () => {
    const wc = new URLSearchParams(location.search).get('wrCoded'); if (!wc) return null;
    const q = new URLSearchParams({ searchdocumenttype: 'task', idcoded: wc, customfield_id: '0', columns: 'document', category_id: '0', searchTaskBUs: 'childbus', _search: 'true', rows: '300', page: '1', sidx: 'sortOrder', sord: 'asc' });
    try { const r = await fetch('/ims/Site/Documents/AJAX_JSON_search_documents.cfm?' + q, { credentials: 'include' }); return r.ok ? await r.text() : null; } catch (e) { return null; }
  };
  const hasDoc = (list, name) => !!list && list.toLowerCase().includes(name.toLowerCase().replace(/\.pdf$/, ''));

  // op = {jn, step: 'desc' | 'up', fired, bg}
  function opEnd(op, res) {
    const s = jst(op.jn) || {};
    setJst(op.jn, { pushed: Object.assign({}, s.pushed || {}, res, { ver: (GM_getValue('jpPush:' + op.jn, {}) || {}).ver, done: true }) });
    if (!res.err && !res.upErr) GM_setValue('jpPush:' + op.jn, null);
    ss('jpOp', null);
    GM_setValue('jpDone', { jn: op.jn, at: now() });
    if (op.bg) { setTimeout(() => { try { window.close(); } catch (e) {} }, 400); return; }
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    taskButton(true);
  }
  async function runOp() {
    const op = ss('jpOp'); if (!op) return;
    const push = GM_getValue('jpPush:' + op.jn, null);
    if (!push) return opEnd(op, { err: 'nothing waiting to go to AroFlo' });
    status('JN ' + op.jn + ': ' + (op.step == 'desc' ? 'share link on the task' : 'PDF into the documents'));
    if (op.step == 'desc') {
      if (!op.fired) {
        if (isTask()) { // read the description off the header page first, only go there if the line isn't on yet
          const a = [...document.querySelectorAll('a')].find(e => /^\s*Edit Task Header\s*$/i.test(e.textContent || ''));
          if (!a) return opEnd(op, { err: 'no Edit Task Header link on the task' });
          const d2 = html(await afText(a.getAttribute('href')));
          const cur = ((d2.querySelector('textarea[name=description]') || {}).value) || '';
          if (plain(cur).includes(push.line.replace(/^JOB PACK: /, ''))) { op.step = 'up'; op.desc = 'already there'; ss('jpOp', op); return runOp(); }
          ss('jpOp', op); location.href = a.getAttribute('href'); return;
        }
        if (!isHeader()) return opEnd(op, { err: 'landed on "' + document.title.slice(0, 40) + '"' });
        if (thisJn() && thisJn() != op.jn) return opEnd(op, { err: 'header page is JN ' + thisJn() + ', not ' + op.jn + ', nothing saved' });
        if (!(await ckReady('description'))) return opEnd(op, { err: 'description editor didn\'t load' });
        const ed = W.CKEDITOR.instances.description; const old = ed.getData(); const f0 = hdrFields();
        // an older JOB PACK line (a revoked link) comes off so there's only ever one
        const tmp = html(old); [...tmp.body.children].filter(e => /^\s*JOB PACK:/i.test(e.textContent || '')).forEach(e => e.remove());
        const rest = tmp.body.innerHTML;
        const want = '<p><strong>JOB PACK:</strong> <a href="' + esc(push.line.replace(/^JOB PACK: /, '')) + '">' + esc(push.line.replace(/^JOB PACK: /, '')) + '</a></p>' + rest;
        await setData(ed, want);
        const nw = plain(ed.getData());
        const ok = nw.startsWith(plain('<p>' + esc(push.line) + '</p>')) && nw.endsWith(plain(rest)) && hdrFields() == f0;
        if (!ok) { await setData(ed, old); ed.resetDirty(); return opEnd(op, { err: 'check before saving failed, nothing saved' }); }
        op.fired = true; ss('jpOp', op); ed.updateElement();
        setTimeout(() => jq()(document.getElementById('updateheader__btn')).trigger('click'), 50);
        return;
      }
      // after the save: read the description back off AroFlo, then on to the upload on the task page
      const href = await taskHref(op.jn); if (!href) return opEnd(op, { err: 'saved, but couldn\'t find JN ' + op.jn + ' to check it' });
      const td2 = html(await afText(href)); const ha = [...td2.querySelectorAll('a')].find(e => /^\s*Edit Task Header\s*$/i.test(e.textContent || ''));
      const back = ha ? (((html(await afText(ha.getAttribute('href'))).querySelector('textarea[name=description]')) || {}).value || '') : '';
      if (!plain(back).startsWith(plain('<p>' + esc(push.line) + '</p>'))) return opEnd(op, { err: 'saved, but the share link isn\'t on top when read back, check JN ' + op.jn });
      op.step = 'up'; op.fired = false; op.desc = 'added'; ss('jpOp', op);
      if (!isTask() || thisJn() != op.jn) { location.href = href; return; }
    }
    if (op.step == 'up') {
      if (!isTask() && !(await waitFor(isTask, 20000))) return opEnd(op, { desc: op.desc, upErr: 'task page didn\'t open' });
      if (op.fired) {
        let docs = null; for (let i = 0; i < 8 && !hasDoc(docs, push.name); i++) { await sleep(2500); docs = await taskDocs(); }
        if (hasDoc(docs, push.name)) return opEnd(op, { desc: op.desc, up: push.name });
        if ((op.again || 0) < 1) { op.again = 1; op.fired = false; ss('jpOp', op); location.reload(); return; }
        return opEnd(op, { desc: op.desc, upErr: push.name + ' never showed in the task\'s documents' });
      }
      if (hasDoc(await taskDocs(), push.name)) return opEnd(op, { desc: op.desc, up: push.name });
      const addBtn = () => { const a = document.getElementById('areaDocumentManagement'); return a && a.querySelector('#btnUploadNew,.btnUploadNew'); };
      if (!addBtn()) { const tab = document.getElementById('documents_tab'); if (!tab) return opEnd(op, { desc: op.desc, upErr: 'no Documents & Photos tab' }); (tab.querySelector('a') || tab).click(); await waitFor(() => !!addBtn(), 20000); await sleep(800); }
      const add = addBtn(); if (!add) return opEnd(op, { desc: op.desc, upErr: 'Documents & Photos didn\'t load its Add button' });
      if (!/idcoded=/.test(add.getAttribute('data-s3postprocessredirecturl') || '')) return opEnd(op, { desc: op.desc, upErr: 'that Add button isn\'t the task\'s, nothing uploaded' });
      add.click();
      if (!(await waitFor(() => !!document.getElementById('s3FileUpload'), 10000))) return opEnd(op, { desc: op.desc, upErr: 'upload box didn\'t open' });
      const inp = document.getElementById('s3FileUpload'); const bin = Uint8Array.from(atob(push.pdf), c => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bin], push.name, { type: 'application/pdf' })); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
      const box = () => inp.closest('.ui-dialog') || document.body;
      const row = () => [...box().querySelectorAll('.uploadProgressObj')].find(r => !r.classList.contains('uploadProgressObjTemplate') && r.innerText.includes(push.name.replace(/\.pdf$/i, '')));
      const state = () => { const r = row(); if (!r) return ''; return String((jq() && jq()(r).data('statuskey')) || '') || ((r.querySelector('.uploadProgressBarText') || {}).innerText || '').trim(); };
      let last = '', changed = now(); const t0 = now();
      while (now() - t0 < 360000) { const st = state() || (row() ? 'row' : 'no row'); if (st != last) { last = st; changed = now(); } if (/^(COMPLETE|FAILED)$/.test(st) || now() - changed > 150000) break; await sleep(1000); }
      if (last != 'COMPLETE') return opEnd(op, { desc: op.desc, upErr: 'AroFlo\'s upload box stopped at "' + last + '", Done not pressed' });
      const done = [...box().querySelectorAll('button,a')].find(b => /^\s*Done\s*$/i.test(b.innerText || '')); if (!done) return opEnd(op, { desc: op.desc, upErr: 'no Done button' });
      op.fired = true; ss('jpOp', op); done.click(); await sleep(4000); return runOp();
    }
  }

  // ---------- UI ----------
  const CSS = `
#wjp-btn{position:fixed;left:14px;bottom:62px;z-index:2147483000;background:${GREY};color:#fff;border:0;border-radius:22px;padding:10px 16px;font:700 14px -apple-system,Segoe UI,sans-serif;box-shadow:0 3px 10px #0004;cursor:pointer}
#wjp{position:fixed;top:0;right:0;bottom:0;width:min(640px,100vw);z-index:2147483001;background:#f6f4f2;box-shadow:-4px 0 18px #0004;display:flex;flex-direction:column;font:14px/1.4 -apple-system,Segoe UI,sans-serif;color:#222}
#wjp .hd{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 12px;background:${GREY};color:#fff}
#wjp .hd b{font-size:16px;margin-right:auto}
#wjp .hd input{width:46px}
#wjp .bd{overflow:auto;padding:10px 12px;flex:1}
#wjp .btn{background:${ORANGE};color:#fff;border:0;border-radius:8px;padding:7px 12px;font:600 13px -apple-system,Segoe UI,sans-serif;cursor:pointer}
#wjp .btn.grey{background:#8a827c}#wjp .btn.ghost{background:#fff;color:${GREY};border:1px solid #cfc8c2}#wjp .btn:disabled{opacity:.5;cursor:default}
#wjp .btn.sm{padding:4px 9px;font-size:12px}
#wjp .job{background:#fff;border-radius:10px;padding:10px 12px;margin:0 0 10px;box-shadow:0 1px 3px #0002}
#wjp .top{display:flex;gap:10px;align-items:flex-start}
#wjp .top input[type=checkbox]{width:20px;height:20px;margin-top:2px;accent-color:${ORANGE}}
#wjp .ad{font-weight:700}#wjp .sub{color:#777;font-size:12px}
#wjp .chip{display:inline-block;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:700;margin-left:6px;background:#eee;color:#555}
#wjp .chip.no{background:#fde3d2;color:#b4510c}#wjp .chip.ok{background:#dcefdc;color:#2c6b2c}#wjp .chip.new{background:#fff1c2;color:#8a6500}#wjp .chip.err{background:#f8d7d7;color:#a12}
#wjp .say{font-size:12px;color:${ORANGE};margin-top:4px}
#wjp .flag{border-left:3px solid ${ORANGE};background:#fff7f0;padding:6px 8px;margin:6px 0;border-radius:4px}
#wjp .row{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center}
#wjp a{color:${ORANGE}}
#wjp .set label{display:block;margin:8px 0 2px;font-weight:600}#wjp .set input,#wjp .set select{width:100%;box-sizing:border-box;padding:6px;border:1px solid #cfc8c2;border-radius:6px}
#wjp .note{background:#fff;border-radius:10px;padding:10px 12px;margin:0 0 10px}
#wjp.mob{width:100vw;font-size:15px}#wjp.mob .btn{padding:10px 14px;font-size:15px}`;
  let P = null, jobs = [], busy = false, showSet = false, onTask = false, taskJob = null;
  const isMob = () => /iPhone|iPad|Android/i.test(navigator.userAgent) || innerWidth < 700;

  function mountCss() { if (document.getElementById('wjp-css')) return; const s = document.createElement('style'); s.id = 'wjp-css'; s.textContent = CSS; document.head.appendChild(s); }
  function panel() {
    mountCss();
    if (!P) { P = document.createElement('div'); P.id = 'wjp'; document.body.appendChild(P); P.addEventListener('click', onClick); P.addEventListener('change', onChange); }
    P.classList.toggle('mob', isMob());
    return P;
  }
  function status(t) { if (!P) return; const x = P.querySelector('.hd .st'); if (x) x.textContent = t; }

  function chipOf(j) {
    const s = jst(j.jn);
    if (j.err) return '<span class="chip err">Error</span>';
    if (!j.pack && !(s && s.ver)) return '<span class="chip no">No pack</span>';
    if (j.newPhotos) return '<span class="chip new">New photos</span>';
    return '<span class="chip ok">' + (s && s.ver ? 'Pack v' + s.ver : 'Has a pack') + '</span>';
  }
  function resultHtml(jn) {
    const s = jst(jn); if (!s || !s.share) return '';
    let h = '<div class="row"><a href="' + esc(s.share) + '" target="_blank">Open the pack</a><span class="sub">v' + s.ver + (s.cost ? ', AI US$' + s.cost.toFixed(3) : '') + '</span></div>';
    const pu = s.pushed;
    if (pu && pu.done) h += '<div class="sub">' + [pu.err ? 'AroFlo: ' + esc(pu.err) : pu.desc ? 'Share link on the task (' + esc(pu.desc) + ')' : '', pu.upErr ? 'PDF: ' + esc(pu.upErr) : pu.up ? 'PDF in documents' : ''].filter(Boolean).join(' | ') + '</div>';
    else if (GM_getValue('jpPush:' + jn, null)) h += '<div class="sub">AroFlo step waiting</div><div class="row"><button class="btn sm ghost" data-a="push" data-jn="' + jn + '">Put it in AroFlo</button></div>';
    (s.flags || []).filter(f => f.state != 'ignored').forEach(f => {
      h += '<div class="flag"><b>' + esc(f.text) + '</b>' + (f.guess ? '<div class="sub">' + esc(f.guess) + '</div>' : '') +
        (f.info ? '<div class="row"><button class="btn sm ghost" data-a="ign" data-jn="' + jn + '" data-f="' + f.id + '">Ignore</button></div>' : f.state == 'heads' ? '<div class="sub">On the cover heads up</div>' : f.state == 'asked' ? '<div class="sub">Draft copied' + (tdToken() ? ', follow up added' : '') + '</div>' :
        '<div class="row"><button class="btn sm" data-a="heads" data-jn="' + jn + '" data-f="' + f.id + '">Add to heads up</button><button class="btn sm grey" data-a="ask" data-jn="' + jn + '" data-f="' + f.id + '">Ask the builder</button><button class="btn sm ghost" data-a="ign" data-jn="' + jn + '" data-f="' + f.id + '">Ignore</button></div>') + '</div>';
    });
    return h;
  }
  function setHtml() {
    const s = S();
    return '<div class="note set"><b>Settings (this device only)</b>' +
      '<label>Anthropic key</label><input type="password" data-key="anthropicKey" value="' + esc(aiKey()) + '">' +
      '<label>Google Maps key (optional: newer aerials than the Queensland photos, needs billing on the Google account)</label><input type="password" data-key="googleKey" value="' + esc(mapsKey()) + '">' +
      '<label>FieldViser API key</label><input type="password" data-key="fvKey" value="' + esc(fvKey()) + '">' +
      '<label>FieldViser address</label><input data-set="fvBase" value="' + esc(s.fvBase) + '">' +
      '<label>Todoist token (for Ask the builder follow ups)</label><input type="password" data-key="todoistToken" value="' + esc(tdToken()) + '">' +
      '<label>AI for picking photos</label><select data-set="model"><option value="haiku"' + (s.model == 'haiku' ? ' selected' : '') + '>Haiku 5.5 (about 0.2c a pack)</option><option value="sonnet"' + (s.model == 'sonnet' ? ' selected' : '') + '>Sonnet 5.5 on high (about 5 to 7c a pack)</option></select>' +
      '<div class="row"><button class="btn" data-a="set">Done</button></div></div>';
  }
  function drawList() {
    const p = panel(), s = S();
    let h = '<div class="hd"><b>Job packs</b>' + (onTask ? '' : '<label>Next <input type="number" min="1" max="60" data-set="days" value="' + s.days + '"> days</label>') +
      (onTask ? '' : '<button class="btn" data-a="scan"' + (busy ? ' disabled' : '') + '>Refresh</button>') + '<button class="btn grey" data-a="set">Settings</button><button class="btn grey" data-a="close">✕</button><span class="st sub" style="width:100%;color:#ddd"></span></div><div class="bd">';
    if (showSet) h += setHtml();
    if (!onTask) {
      const ticked = jobs.filter(j => j.tick).length;
      h += '<div class="row" style="margin:0 0 10px"><button class="btn" data-a="run"' + (busy || !ticked ? ' disabled' : '') + '>Run ' + ticked + ' ticked</button><span class="sub">Builds in FieldViser, then each job\'s AroFlo step runs in its own tab and closes.</span></div>';
      if (!jobs.length) h += '<div class="note">' + (busy ? 'Loading the Ambrose bookings…' : 'No Ambrose jobs booked in the next ' + s.days + ' days.') + '</div>';
      jobs.forEach(j => {
        h += '<div class="job"><div class="top"><input type="checkbox" data-tick="' + j.jn + '"' + (j.tick ? ' checked' : '') + (busy ? ' disabled' : '') + '><div style="flex:1"><div><span class="ad">' + esc(j.addr) + '</span>' + chipOf(j) + '</div>' +
          '<div class="sub">JN ' + j.jn + ' | ' + esc(j.when) + ' | ' + esc(j.staff.join(', ')) + '</div>' + (j.say ? '<div class="say">' + esc(j.say) + '</div>' : '') + (j.err ? '<div class="sub" style="color:#a12">' + esc(j.err) + '</div>' : '') + resultHtml(j.jn) + '</div></div></div>';
      });
    } else if (taskJob) {
      const j = taskJob;
      h += '<div class="job"><div><span class="ad">' + esc(j.addr || 'This job') + '</span>' + chipOf(j) + '</div>' + (j.say ? '<div class="say">' + esc(j.say) + '</div>' : '') + (j.err ? '<div class="sub" style="color:#a12">' + esc(j.err) + '</div>' : '') +
        '<div class="row"><button class="btn" data-a="one"' + (busy ? ' disabled' : '') + '>' + (jst(j.jn) && jst(j.jn).ver ? 'Rebuild the pack' : 'Build the pack') + '</button></div>' + resultHtml(j.jn) + '</div>';
    }
    p.innerHTML = h + '</div>';
  }

  async function scan() {
    busy = true; jobs = []; drawList();
    try {
      const evs = (await calEvents(S().days)).filter(e => /ambrose/i.test(JSON.stringify(e.title || '')));
      const by = {};
      evs.forEach(e => { const hs = (e.headers || []).map(h => h.headerText).filter(Boolean); const jn = hs[0]; if (!jn) return; const st = new Date(e.start);
        const j = by[jn] = by[jn] || { jn, wrid: e.wrid, first: st, staff: [], title: clean(String(e.title || '').replace(/<[^>]+>/g, ' ')) };
        if (st < j.first) j.first = st; const who = (e.resourcename || '').split(' ')[0]; if (who && !j.staff.includes(who)) j.staff.push(who); });
      jobs = Object.values(by).sort((a, b) => a.first - b.first).map(j => Object.assign(j, { when: dShort(j.first), addr: clean(j.title.replace(/^.*?Ambrose Construct Group Pty Ltd\s*/i, '').replace(/^\d{6,}[-\w]*\s*-?\s*/, '')) }));
      drawList();
      // what FieldViser already has, and whether Ambrose has added photos since
      let packs = {}; try { ((await fv('GET', '/jobs?source=aroflo&limit=200')) || {}).jobs.forEach(x => { packs[x.ref] = x; }); } catch (e) { status(e.message); }
      await pool(jobs, 4, async j => {
        j.pack = packs[j.jn] || null;
        const s = jst(j.jn);
        if (j.pack || (s && s.ver)) {
          try { const d = await details(j.wrid); const A = await ambrose(d.recs); const seen = (s && s.seen) || [];
            j.newPhotos = seen.length ? A.photos.some(p => !seen.includes(p.rec)) : !!(A.newest && j.pack && j.pack.updated_at && A.newest > j.pack.updated_at); } catch (e) {}
        }
        j.tick = !j.pack && !(s && s.ver);
        drawList();
      });
    } catch (e) { status(e.message); }
    busy = false; drawList();
  }
  async function runTicked() {
    busy = true; drawList();
    for (const j of jobs.filter(x => x.tick)) {
      j.err = ''; const say = t => { j.say = t; drawList(); };
      try {
        await build(j.wrid, say);
        say('AroFlo: share link and PDF (own tab)');
        await pushInTab(j.jn);
        j.say = ''; j.tick = false; j.pack = j.pack || { ref: j.jn }; j.newPhotos = false;
      } catch (e) { j.err = e.message; j.say = ''; }
      drawList();
    }
    busy = false; drawList();
  }
  // the AroFlo step in its own background tab; waits for it to say it's done (6 min tops)
  async function pushInTab(jn) {
    const href = await taskHref(jn); if (!href) throw new Error('couldn\'t find JN ' + jn + ' in AroFlo');
    setJst(jn, { pushed: null });
    GM_setValue('jpQueue', { jn, at: now() });
    GM_openInTab(new URL(href, location.origin).href + HASH, { active: false, insert: true, setParent: true });
    const t0 = now();
    while (now() - t0 < 400000) { await sleep(2000); const s = jst(jn); if (s && s.pushed && s.pushed.done) return; }
    throw new Error('the AroFlo tab didn\'t finish in time, check JN ' + jn);
  }

  async function onClick(e) {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a, jn = b.dataset.jn;
    if (a == 'close') { P.remove(); P = null; return; }
    if (a == 'set') { showSet = !showSet; return drawList(); }
    if (a == 'scan') return scan();
    if (a == 'run') return runTicked();
    if (a == 'one') return runHere();
    const j = onTask ? taskJob : jobs.find(x => x.jn == jn);
    const say = t => { if (j) { j.say = t; } status(t); drawList(); };
    try {
      if (a == 'push') { if (onTask) return startOp(jn); say('AroFlo: share link and PDF (own tab)'); await pushInTab(jn); say(''); }
      if (a == 'heads') { b.disabled = true; await addToHeads(jn, b.dataset.f, say); say(onTask ? '' : 'AroFlo: new PDF (own tab)'); if (onTask) return startOp(jn); await pushInTab(jn); say(''); }
      if (a == 'ask') { const t = await askBuilder(jn, b.dataset.f); say(t ? 'Draft copied: ' + t : ''); }
      if (a == 'ign') { const s = jst(jn); (s.flags || []).forEach(f => { if (f.id == b.dataset.f) f.state = 'ignored'; }); setJst(jn, { flags: s.flags }); drawList(); }
    } catch (err) { if (j) j.err = err.message; status(err.message); drawList(); }
  }
  function onChange(e) {
    const t = e.target;
    if (t.dataset.tick) { const j = jobs.find(x => x.jn == t.dataset.tick); if (j) j.tick = t.checked; return drawList(); }
    if (t.dataset.key) { GM_setValue(t.dataset.key, keyClean(t.value)); return; }
    if (t.dataset.set) { setS({ [t.dataset.set]: t.dataset.set == 'days' ? Math.max(1, Math.min(60, +t.value || 14)) : t.value }); }
  }

  // ---------- task page ----------
  async function runHere() {
    const wrid = (document.getElementById('workrequest_id') || {}).value;
    if (!wrid) { taskJob.err = 'couldn\'t find the task\'s id on the page'; return drawList(); }
    busy = true; taskJob.err = ''; drawList();
    try { await build(wrid, t => { taskJob.say = t; drawList(); }); busy = false; taskJob.say = 'AroFlo: share link and PDF'; drawList(); startOp(taskJob.jn); }
    catch (e) { taskJob.err = e.message; taskJob.say = ''; busy = false; drawList(); }
  }
  function startOp(jn) { setJst(jn, { pushed: null }); ss('jpOp', { jn, step: 'desc', fired: false, bg: false }); runOp(); }
  function taskButton(open) {
    const jn = thisJn(); if (!jn) return;
    if (!/Ambrose Construct/i.test(document.body.textContent || '')) return;
    mountCss();
    onTask = true; taskJob = taskJob || { jn, addr: clean(document.title.replace(/^JN \d+ - \d{6,}[-\w]*\s*-?\s*/, '').replace(/ - Task - AroFlo.*$/, '')) };
    if (!document.getElementById('wjp-btn')) { const b = document.createElement('button'); b.id = 'wjp-btn'; b.textContent = '📦 Job pack'; b.onclick = () => { if (P) { P.remove(); P = null; } else drawList(); }; document.body.appendChild(b); }
    if (open) { taskJob.say = ''; drawList(); }
  }

  // ---------- start ----------
  const onCal = /\/Calendar\//i.test(location.pathname);
  if (onCal) {
    mountCss();
    const b = document.createElement('button'); b.id = 'wjp-btn'; b.textContent = '📦 Job packs';
    b.onclick = () => { if (P) { P.remove(); P = null; } else { drawList(); if (!jobs.length) scan(); } };
    document.body.appendChild(b);
    GM_addValueChangeListener('jpDone', () => { if (P) drawList(); });
    return;
  }
  // a task page or its header page
  (async () => {
    if (location.hash == HASH) { // opened from the calendar list: run the waiting AroFlo step, then close
      const q = GM_getValue('jpQueue', null); history.replaceState(null, '', location.pathname + location.search);
      await waitFor(isTask, 20000);
      if (q && q.jn == thisJn() && now() - q.at < 600000) { GM_setValue('jpQueue', null); ss('jpOp', { jn: q.jn, step: 'desc', fired: false, bg: true }); }
    }
    if (ss('jpOp')) { if (!isTask() && !isHeader()) await waitFor(() => isTask() || isHeader(), 20000); return runOp(); }
    if (isTask() || await waitFor(isTask, 8000)) taskButton(false);
  })();
})();
})();
