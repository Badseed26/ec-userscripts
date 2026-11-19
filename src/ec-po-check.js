// ==UserScript==
// @name         EC PO check
// @namespace    ec
// @version      0.1
// @description  PO check button on the AroFlo calendar: lists the PO jobs booked in the last and next few days, reads the builder's PO (the PDFs on the task plus the description) against what the lads have noted on site, and flags anything they scoped, removed or stored that the PO doesn't cover. Flagged jobs go red in the list, on the button and on their bookings, with a builder draft and a follow up a tap away. Read only on AroFlo.
// @match        https://office.aroflo.com/ims/Site/Calendar/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      api.anthropic.com
// @connect      api.todoist.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Badseed26/ec-userscripts/main/ec-po-check.user.js
// @downloadURL  https://raw.githubusercontent.com/Badseed26/ec-userscripts/main/ec-po-check.user.js
// ==/UserScript==

(function () {
  'use strict';

  // How it works (19/11):
  // AroFlo: the calendar's own feed (AJAX_JSON_ims_events.cfm) gives the bookings from X days back to X days ahead. Each
  //   task's details (AJAX_HTML_task_details.cfm), notes (AJAX_HTML_get_notes.cfm) and documents (AJAX_JSON_search_documents.cfm)
  //   are read the same way Solar orders reads them. Read only, nothing in AroFlo gets changed.
  // AI: one call per job (Sonnet 5.5 at medium by default) gets the description, the PO PDFs, the notes marked FIELD or
  //   OFFICE and your notes, and says what the PO allows, what's on site, and the gaps. A job only goes back to the AI when
  //   something's changed (new notes, a new PO PDF, your notes), so a re-run costs nothing.
  // Flags: red on the job card, a count on the button, and a red PO tag on that job's bookings in the calendar (tap it to
  //   open the job). Copy builder draft and Add follow up (Todoist follow ups, p2, due today, close-reply) per job.

  const W = typeof unsafeWindow != 'undefined' ? unsafeWindow : window;
  if (W.__ecPo || window.top !== window.self) return;
  W.__ecPo = 1;

  const ORANGE = '#e8731a', GREY = '#4a4541', RED = '#c8201e';
  const FU = '6hfHcM9Gf74fgcJw';          // Todoist: follow ups
  const TDA = 'https://api.todoist.com/api/v1/';
  const MODELS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' };
  const AIPRICE = { 'claude-haiku-5-5': [0.1, 0.5], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20] };   // USD per MTok, in and out
  const DEF = { back: 21, ahead: 14, model: 'sonnet', office: 'Lisa Navie', invoiced: false, onlyFlag: false };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const money = n => '$' + Number(n || 0).toFixed(2);
  const p2 = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dShort = s => { const d = new Date(s + 'T00:00:00'); return DAYS[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1); };
  const html = t => new DOMParser().parseFromString(t || '', 'text/html');
  const hashOf = s => String(String(s).split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
  async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { await fn(items[k], k); } catch (e) { items[k] && typeof items[k] == 'object' && (items[k].err = String(e.message || e)); } } })); }

  // ---------- settings and saved state (this device's Tampermonkey) ----------
  const S = () => Object.assign({}, DEF, GM_getValue('set', {}));
  const setS = o => GM_setValue('set', Object.assign(GM_getValue('set', {}), o));
  const keyClean = k => String(k || '').replace(/[\s​-‍⁠﻿]/g, '').replace(/^["']|["']$/g, '');
  const aiKey = () => keyClean(GM_getValue('anthropicKey', ''));
  const tdToken = () => clean(GM_getValue('todoistToken', ''));
  // per job (by wrid): your notes, the last check (its input hash and the AI's answer), gaps you've cleared, follow up id
  let ST = GM_getValue('jobs', {});
  const st = w => (ST[w] = ST[w] || { notes: '', clear: {}, at: Date.now() });
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => {
    const cut = Date.now() - 120 * 864e5; Object.keys(ST).forEach(k => { if ((ST[k].at || 0) < cut) delete ST[k]; });
    GM_setValue('jobs', ST); }, 300); };
  const touch = w => { st(w).at = Date.now(); save(); };
  const peek = w => ST[w] || { notes: '', clear: {} };   // read only, so drawing the list doesn't save anything
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
  const td = (method, path, body) => new Promise((res, rej) => GM_xmlhttpRequest({
    method, url: TDA + path, timeout: 20000,
    headers: { Authorization: 'Bearer ' + tdToken(), 'Content-Type': 'application/json' },
    data: body ? JSON.stringify(body) : undefined,
    onload: r => { if (r.status === 401 || r.status === 403) return rej(new Error('Todoist token not accepted')); if (r.status < 200 || r.status >= 300) return rej(new Error('Todoist said ' + r.status)); try { res(r.responseText ? JSON.parse(r.responseText) : null); } catch (e) { res(null); } },
    onerror: () => rej(new Error('couldn\'t reach Todoist')), ontimeout: () => rej(new Error('Todoist timed out')),
  }));

  // ---------- AroFlo: bookings, task details, notes, documents (same calls as Solar orders) ----------
  async function calEvents(back, ahead) {
    for (let i = 0; i < 40 && !(W.jsonSettings && document.getElementById('calBoxContainer')); i++) await sleep(250);
    const box = document.getElementById('calBoxContainer');
    if (!W.jsonSettings || !box) throw new Error('couldn\'t read the calendar settings, give the calendar a sec to load then hit Refresh');
    const q = new URLSearchParams();
    q.set('jsonSettings', JSON.stringify(W.jsonSettings));
    q.set('masterusercoded', box.getAttribute('data-master-user-id') || '');
    const t = new Date(), list = [];
    for (let i = -back; i <= ahead; i++) { const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + i); list.push(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 1000); } // AroFlo's days are UTC midnight
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
    const out = { at: Date.now(), wrid, code, jn: (ref.match(/(\d{3,})\s*$/) || [])[1] || '', name: one(/(?:Task )?Name:?\s*([^\n]+)/), status: one(/Status:?\s*([^\n]+)/), loc: one(/Location:?\s*([^\n]+)/),
      custOn: one(/Cust(?:omer)? ON:?\s*([^\n]+)/), client: one(/Client:?\s*([^\n]+)/), desc, quoteDesc, link };
    detCache[wrid] = out; return out;
  }
  async function notes(code) {
    const d = html(await afText('/ims/Site/Service/Notes/AJAX_HTML_get_notes.cfm?dateorder=0&last3notes=0&isLoaded=1&wrCoded=' + encodeURIComponent(code) + '&_=' + Date.now()));
    return [...d.querySelectorAll('.noteItem')].map(n => {
      const hs = [...n.querySelectorAll('.heading3')].map(x => clean(x.textContent));
      const out = n.querySelector('.noteOutput');
      const text = out ? (out.innerText || out.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : '';
      return { when: (hs[0] || '').replace(/^(\d{1,2} \w+ \d{4}).*$/, '$1'), who: hs[1] || '', text };
    }).filter(n => n.text);
  }
  async function docs(code) {
    const q = 'searchdocumenttype=task&idcoded=' + encodeURIComponent(code) + '&customfield_id=0&columns=document,comment,uploadedby,imgdatetimetaken,datetimeinserted' +
      '&category_id=0&searchTaskBUs=childbus&_search=true&nd=' + Date.now() + '&rows=500&page=1&sidx=sortOrder&sord=asc';
    let j; try { j = JSON.parse(await afText('/ims/Site/Documents/AJAX_JSON_search_documents.cfm?' + q)); } catch (e) { throw new Error('AroFlo didn\'t send the document list'); }
    const txt = s => clean(String(s == null ? '' : s).replace(/<[^>]+>/g, ' '));
    return (j.rows || []).map(r => ({ id: String(r.document_id || r.id || r.docToken || ''), name: txt(r.documentname), at: txt(r.datetimeinserted), orig: String(r.timedlinkoriginal || ''), size: +r.filesizebytes || 0 }))
      .filter(r => /\.pdf$/i.test(r.name) && r.orig);
  }
  async function taskSearch(term, field) {
    const body = new URLSearchParams({ taskString: term, SearchParam: field, searchtasks: 'Search', searchtasks_btn: 'Search' });
    const r = await (W.fetch || fetch).call(W, '/ims/Site/Home/index.cfm?tid=IMS.STK.CUR', { method: 'POST', body, credentials: 'include' });
    const d = html(await r.text());
    return [...d.querySelectorAll('tr')].filter(tr => tr.querySelectorAll('td').length >= 6).map(tr => {
      const c = [...tr.querySelectorAll('td')].map(x => clean(x.textContent)).filter(Boolean);
      const a = [...tr.querySelectorAll('a')].find(x => /workrequest/i.test(x.getAttribute('href') || '') && !/printview/i.test(x.getAttribute('href')));
      return { jn: c[1], href: a ? a.getAttribute('href') : '' };
    }).filter(t => /^\d+$/.test(t.jn || ''));
  }

  // which PDFs on the task are the builder's PO (every revision, -01, -02, counts). Job packs, quotes, invoices and reports aren't.
  function poPdfs(job) {
    const nums = (String(job.custOn + ' ' + job.name + ' ' + job.desc).match(/\b\d{6,10}\b/g) || []).map(n => n.slice(0, 8));
    return (job.pdfs || []).filter(d => !/job ?pack|quote|invoice|tax inv|report|swms|certificate|\bcoc\b|form ?12|esa|safety advice/i.test(d.name) &&
      (/purchase ?order|work ?order|\bp\.?o\b|variation/i.test(d.name) || nums.some(n => d.name.includes(n))))
      .sort((a, b) => b.size - a.size).slice(0, 4);
  }
  const hasPo = j => /P\.?\s?O\.?\s*(No|Number|#)|purchase order|work order/i.test(j.desc + ' ' + j.quoteDesc) || /\b\d{6,10}\b/.test(j.custOn || '') || /^\s*\d{8}/.test(j.name || '');
  const officeRe = () => { const n = S().office.split(',').map(clean).filter(Boolean); return n.length ? new RegExp('^(' + n.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'i') : /^$/; };
  const isField = n => !officeRe().test(clean(n.who));
  const fieldNotes = j => (j.notes || []).filter(isField);

  // what the AI gets to read, private bits stripped (same as Solar orders)
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
    if (typeof W.__ecPoFakeAI == 'function') return W.__ecPoFakeAI(model, system, content);   // tests only
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
    addCost(cost);
    const text = (j.content || []).filter(c => c.type == 'text').map(c => c.text).join('');
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [0, text];
    const s = m[1].slice(m[1].indexOf('{'), m[1].lastIndexOf('}') + 1);
    try { const o = JSON.parse(s); o._cost = cost; return o; } catch (e) { throw new Error('the AI\'s answer couldn\'t be read'); }
  }

  const CHECK_SYS = `You check jobs for an electrical contractor in Queensland doing insurance repair work for builders (mostly Ambrose). The builder's PO (purchase order) says what electrical work is allowed for and paid. The electricians' notes say what they actually found, removed, disconnected, stored or did on site. Your job: find anything the electricians scoped, removed, disconnected, stored or did that the PO doesn't cover, so the office can get a revised PO before the work is done for free.

What you get:
- The task description: the PO lines as the office typed them, plus the PO numbers.
- The PO PDFs when they're on the task. They beat the description if the two differ. A later PO suffix (-02, -03) adds to the earlier ones unless it plainly replaces them. Read every PO.
- The notes on the task, newest first, each marked FIELD (the electricians, what's really on site) or OFFICE, with who and when.
- The booking notes, and Ethan's notes for this check. Ethan is the boss: his notes beat everything.

Match items sensibly. A line "disconnect, store and reconnect downlights x6" covers 6 downlights removed, stored and refitted. "Isolate" covers isolations, "make safe" covers making safe. Trade shorthand: GPO = power point, DL = downlight, SA = smoke alarm, HWS = hot water, SB = switchboard, iso = isolation. An allowance or "as required" line covers that type of work without a count. Preliminaries, travel, admin and labour rate allowance lines don't cover any specific item.

A gap is one of:
- "not_on_po": the notes show an item removed, disconnected, stored, replaced or worked on (or scoped for the fit off) with no PO line for that type of item, or in a room the PO doesn't cover for it.
- "over_qty": more of an item than the PO allows, e.g. 8 downlights removed and the PO says 6.
- "different": the PO allows a different item or job than what's there, e.g. PO says reconnect but the note says it's damaged and needs replacing, PO says single GPO and it's a double with USB, PO says light and it's a fan light.
- "extra_visit": the notes show another visit or a return needed that the PO doesn't allow for.
Not a gap: PO work that hasn't been done or noted yet, anything plainly covered, the electricians' admin (timesheets, photos, travel).
If any note, or Ethan's notes, show the builder already approved the extra in writing or a revised PO is on the way, still list it with "approved": true.
Only flag what the notes actually say. Don't guess at what might be in the ceiling. If a note is too vague to tell (e.g. "removed lights" with no count where the PO gives one), put it under "unclear", not gaps.

Write every text field short and plain, the way a sparky would say it to his boss. No em dashes. "what" reads like "8 downlights removed, PO allows 6" or "Ceiling fan in bed 2 removed, not on the PO". "extra" is the extra written as a PO line for a revised PO, e.g. "Disconnect, store and reconnect downlight x2". "from" is whose note and the date, e.g. "Lachie 12/11".

Answer with JSON only:
{"po_used":"PO PDFs -01 and -02","allowed":["Downlights x6, disconnect, store and reconnect"],"site":["Lachie 12/11: removed 8 downlights, stored in the garage"],"gaps":[{"type":"over_qty","what":"8 downlights removed, PO allows 6","extra":"Disconnect, store and reconnect downlight x2","room":"Kitchen","from":"Lachie 12/11","approved":false}],"unclear":[],"summary":"one short line"}`;

  // the job as the AI reads it, and a hash of it so an unchanged job isn't sent twice
  function inputOf(job) {
    const s = peek(job.wrid);
    const noteTxt = (job.notes || []).map(n => (isField(n) ? 'FIELD ' : 'OFFICE ') + n.when + ' ' + n.who + ':\n' + n.text).join('\n\n');
    const text = [
      'TASK: JN ' + job.jn + ', ' + street(job) + (job.custOn ? ', Cust ON ' + job.custOn : '') + (job.client ? ', client ' + job.client : ''),
      'TASK DESCRIPTION:\n' + strip(job.desc || '(none)'),
      job.quoteDesc ? 'QUOTE DESCRIPTION:\n' + strip(job.quoteDesc) : '',
      'BOOKINGS: ' + (job.sched.length ? job.sched.join(' | ') : 'no booking notes'),
      'NOTES ON THE TASK (newest first):\n' + (strip(noteTxt) || '(none)'),
      s.notes ? 'ETHAN\'S NOTES FOR THIS CHECK:\n' + strip(s.notes) : '',
    ].filter(Boolean).join('\n\n');
    const pdfs = poPdfs(job);
    return { text, pdfs, key: hashOf([text, pdfs.map(p => p.id + ':' + p.size).join(','), S().model].join('|')) };
  }
  const gapId = g => hashOf(clean(g.type + ' ' + g.what).toLowerCase());

  async function check(job, force) {
    const say = t => { job.msg = t; draw(job.wrid); };
    const s = st(job.wrid);
    job.busy = true; job.err = '';
    try {
      if (!job.loaded) { say('Loading notes and PDFs…'); await loadJob(job); }
      if (!fieldNotes(job).length && !s.notes) throw new Error('No notes from the lads yet, nothing to check against');
      const inp = inputOf(job);
      if (!force && s.res && s.key == inp.key) { say(''); job.busy = false; return draw(job.wrid); }
      const content = [{ type: 'text', text: inp.text }];
      let got = 0;
      for (const p of inp.pdfs) {
        if (p.size > 4.5e6) continue;
        say('Grabbing ' + p.name + '…');
        try { content.push({ type: 'text', text: 'PO PDF: ' + p.name }); content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await b64(await afBlob(p.orig)) } }); got++; } catch (e) { content.pop(); }
      }
      if (!got) content.push({ type: 'text', text: 'No PO PDF found on the task, go off the task description for the PO.' });
      say('Checking the PO against the notes (' + S().model + ')…');
      const r = await claude(MODELS[S().model] || MODELS.sonnet, CHECK_SYS, content, 3000, S().model == 'haiku' ? null : 'medium');
      const gaps = (r.gaps || []).filter(g => g && clean(g.what)).map(g => ({ type: clean(g.type) || 'not_on_po', what: clean(g.what), extra: clean(g.extra), room: clean(g.room), from: clean(g.from), approved: !!g.approved }));
      gaps.forEach(g => { g.id = gapId(g); });
      s.res = { po: clean(r.po_used) || (got ? got + ' PO PDF' + (got == 1 ? '' : 's') : 'description only'), pdfs: got, allowed: (r.allowed || []).map(clean).filter(Boolean), site: (r.site || []).map(clean).filter(Boolean),
        gaps, unclear: (r.unclear || []).map(clean).filter(Boolean), summary: clean(r.summary), cost: r._cost || 0, at: Date.now(), nf: fieldNotes(job).length };
      s.key = inp.key; touch(job.wrid);
      job.msg = '';
      tagCal();
    } catch (e) { job.err = String(e.message || e); job.msg = ''; }
    job.busy = false; draw(job.wrid); drawBtn();
  }

  // a job's open gaps: not cleared by you, not already approved by the builder
  const openGaps = w => { const s = ST[w]; return s && s.res ? s.res.gaps.filter(g => !g.approved && !(s.clear || {})[g.id]) : []; };
  // before the first scan only jobs seen in the last few days count, so an old invoiced job doesn't keep the button red
  const flagged = () => Object.keys(ST).filter(w => openGaps(w).length && (JOBS.length ? JOBS.some(j => j.wrid == w) : Date.now() - (ST[w].seen || 0) < 4 * 864e5));
  // where a job's at: flag, new notes since the last check, ok, not checked, nothing to check
  function stateOf(j) {
    const s = peek(j.wrid);
    if (j.busy) return 'busy';
    if (s.res && openGaps(j.wrid).length) return 'flag';
    if (!j.loaded) return s.res ? 'ok?' : 'unknown';
    if (!fieldNotes(j).length && !s.notes) return 'none';
    if (!s.res) return 'new';
    if (s.key != inputOf(j).key) return 'changed';
    return 'ok';
  }

  // ---------- builder draft and follow up ----------
  const street = job => clean((job.loc || job.name || '').replace(/^\s*\d{6,}[-\w]*\s*-?\s*/, '').replace(/\b(QLD|NSW)\b.*$/i, '').replace(/,\s*$/, '')) || job.name;
  // PO numbers on the task, the bare base dropped when a -01 style one is there too
  const poNums = job => { const all = [...new Set(String(job.desc + ' ' + job.name + ' ' + job.custOn).match(/\b\d{8}(?:-\d{2})?\b/g) || [])];
    return all.filter(n => /-/.test(n) || !all.some(x => x.startsWith(n + '-'))).slice(0, 3); };
  const supFirst = job => { const m = String(job.desc).match(/SUPERVISOR:?\s*([A-Za-z'-]+)/i); return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : ''; };
  function builderText(job) {
    const g = openGaps(job.wrid), first = supFirst(job), pos = poNums(job);
    return (first ? 'Hey ' + first + ',' : 'Hey mate,') + '\n\nJust a heads up on ' + street(job) + (pos.length ? ' (PO ' + pos.join(', ') + ')' : '') + '. The boys found a bit more on site than the PO allows for:\n' +
      g.map(x => '- ' + x.what.replace(/\.$/, '')).join('\n') +
      '\n\nAre you able to send through a revised PO for the extra? Happy to send a price over first if you need it.\n\n' + (first ? 'Cheers,' : 'Cheers mate,');
  }
  async function copy(t) { try { await navigator.clipboard.writeText(t); return true; } catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (er) {} a.remove(); return ok; } }
  async function followUp(job) {
    if (!tdToken()) { job.err = 'Add your Todoist token under Settings first'; return draw(job.wrid); }
    const s = st(job.wrid), g = openGaps(job.wrid);
    job.busy = true; job.msg = 'Adding the follow up…'; draw(job.wrid);
    try {
      const desc = 'JN ' + job.jn + (poNums(job).length ? ' | PO ' + poNums(job).join(', ') : '') + '\nPO check: ' + g.map(x => x.what + (x.extra ? ' (extra: ' + x.extra + ')' : '')).join('; ') + '\n\nDraft:\n' + builderText(job);
      const who = supFirst(job) || 'the builder';
      if (s.fu) { await td('POST', 'comments', { task_id: s.fu, content: new Date().toLocaleDateString('en-AU') + ' PO check again: ' + g.map(x => x.what).join('; ') }); job.msg = 'Already had a follow up, added a comment to it.'; }
      else { const t = await td('POST', 'tasks', { project_id: FU, content: 'Ask ' + who + ' for a revised PO: ' + street(job).split(/\s+/).slice(0, 4).join(' '), description: desc, priority: 3, due_string: 'today', labels: ['close-reply'] }); s.fu = t && t.id; job.msg = 'Follow up added, due today.'; }
      touch(job.wrid);
    } catch (e) { job.err = String(e.message || e); job.msg = ''; }
    job.busy = false; draw(job.wrid);
  }

  // ---------- the list ----------
  let JOBS = [], scanMsg = '', scanning = false, runAll = false;
  async function scan() {
    if (scanning) return; scanning = true;
    scanMsg = 'Reading the calendar…'; drawAll();
    try {
      const s = S(), evs = await calEvents(s.back, s.ahead), by = {}, today = ymd(new Date());
      evs.forEach(e => {
        const hd = (e.headers || []).map(h => h.headerText).filter(Boolean).join(' / ');
        if (/cancel/i.test(hd + ' ' + e.title)) return;
        const w = String(e.wrid); if (!w || w == 'undefined') return;
        const j = by[w] = by[w] || { wrid: w, dates: new Set(), staff: new Set(), sched: [] };
        const d = ymd(new Date(e.start)); j.dates.add(d); if (e.resourcename) j.staff.add(String(e.resourcename).split(' ')[0]);
        if (e.note) j.sched.push(dShort(d) + ' ' + String(e.resourcename || '').split(' ')[0] + ': ' + clean(e.note));
      });
      const ids = Object.keys(by);
      scanMsg = 'Reading ' + ids.length + ' booked tasks…'; drawAll();
      const found = []; let n = 0, fails = 0;
      await pool(ids, 5, async w => {
        let d; try { d = await details(w); } catch (er) { fails++; return; } n++;
        if (n % 5 == 0) { scanMsg = 'Reading booked tasks, ' + n + ' of ' + ids.length + '…'; drawAll(); }
        if (!hasPo(d)) return;
        if (!s.invoiced && /invoic|archiv/i.test(d.status)) return;
        const b = by[w], old = JOBS.find(j => j.wrid == w), dates = [...b.dates].sort();
        found.push(Object.assign(old || {}, d, { dates, last: dates.filter(x => x <= today).pop() || '', next: dates.find(x => x >= today) || '', staff: [...b.staff], sched: [...new Set(b.sched)] }));
      });
      JOBS = found;
      // the notes for every job, so the list knows what's new without opening each one
      scanMsg = 'Reading the lads\' notes on ' + JOBS.length + ' PO jobs…'; drawAll();
      await pool(JOBS.filter(j => !j.loaded || Date.now() - j.loaded > 5 * 60e3), 5, j => loadJob(j).catch(e => { j.err = e.message; }));
      JOBS.forEach(j => { if (ST[j.wrid]) { ST[j.wrid].seen = Date.now(); touch(j.wrid); } });
      sortJobs();
      const f = JOBS.filter(j => stateOf(j) == 'flag').length, todo = JOBS.filter(j => /new|changed/.test(stateOf(j))).length;
      scanMsg = JOBS.length + ' PO job' + (JOBS.length == 1 ? '' : 's') + ' booked from ' + s.back + ' days back to ' + s.ahead + ' ahead. ' + (f ? f + ' flagged. ' : '') + (todo ? todo + ' to check.' : 'Nothing new to check.') + (fails ? ' Couldn\'t read ' + fails + ' task' + (fails == 1 ? '' : 's') + ', hit Refresh.' : '');
      tagCal();
    } catch (e) { scanMsg = 'Couldn\'t read the jobs: ' + (e.message || e); }
    scanning = false; drawAll(); drawBtn();
  }
  const ORDER = { flag: 0, busy: 1, changed: 2, new: 3, ok: 4, 'ok?': 4, unknown: 5, none: 6 };
  const sortJobs = () => JOBS.sort((a, b) => (ORDER[stateOf(a)] - ORDER[stateOf(b)]) || ((a.last || a.next) > (b.last || b.next) ? -1 : 1));
  async function loadJob(job) {
    const [n, d] = await Promise.all([notes(job.code).catch(e => { job.nErr = e.message; return []; }), docs(job.code).catch(e => { job.dErr = e.message; return []; })]);
    job.notes = n; job.pdfs = d; job.loaded = Date.now();
  }
  // Check new: every job with new or changed notes, two at a time
  async function checkAll() {
    if (runAll) return; runAll = true; drawAll();
    const list = JOBS.filter(j => /new|changed/.test(stateOf(j)));
    await pool(list, 2, j => check(j));
    runAll = false; sortJobs(); drawAll(); drawBtn();
  }

  // ---------- the calendar: a red PO tag on a flagged job's bookings ----------
  // Chained onto AroFlo's eventAfterRender the same way EC Calendar NPT does, so both scripts' bits draw. It keeps NPT's
  // "already hooked" mark so NPT doesn't wrap it again, and marks the calendar itself so this only hooks once per calendar.
  let fcObj = null;
  function hookCal() {
    const c = W.jQuery && W.jQuery('#calBox'); const fc = c && c.length && c.data('fullCalendar');
    if (!fc) return false;
    if (fc.__ecPo) return true;
    const o = fc.options, prev = o.eventAfterRender;
    const wrap = function (ev, el) { if (prev) { try { prev.apply(this, arguments); } catch (e) {} } try { tagEl(ev, el); } catch (e) {} };
    if (prev && prev.__ec) wrap.__ec = prev.__ec;
    o.eventAfterRender = wrap; fc.__ecPo = 1; fcObj = c;
    return true;
  }
  function tagEl(ev, el) {
    const e = el && (el[0] || el); if (!e || !e.querySelector || !ev || ev.type != 'task') return;
    const old = e.querySelector(':scope > .ec-po-tag'); if (old) old.remove();
    const g = openGaps(String(ev.wrid));
    if (!g.length) { e.classList.remove('ec-po-flag'); return; }
    if (getComputedStyle(e).position == 'static') e.style.position = 'relative';
    e.classList.add('ec-po-flag');
    const t = document.createElement('span'); t.className = 'ec-po-tag'; t.textContent = 'PO ⚠ ' + g.length;
    t.title = 'PO doesn\'t cover: ' + g.map(x => x.what).join('; '); t.dataset.w = String(ev.wrid);
    e.appendChild(t);
  }
  // A tap or click on a PO tag opens the list on that job and nothing else. Caught on window in the capture phase, which
  // runs before AroFlo's own handlers and NPT's phone tap (that one listens on document), so the booking popup doesn't open too.
  const onTag = x => { const t = x.target && x.target.closest && x.target.closest('.ec-po-tag'); if (!t) return null; x.stopPropagation(); if (x.cancelable) x.preventDefault(); return t; };
  ['mousedown', 'mouseup', 'touchstart'].forEach(k => W.addEventListener(k, onTag, { capture: true, passive: false }));
  W.addEventListener('click', x => { const t = onTag(x); if (t) openTo(t.dataset.w); }, { capture: true, passive: false });
  W.addEventListener('touchend', x => { const t = onTag(x); if (t) openTo(t.dataset.w); }, { capture: true, passive: false });
  let tagT = null;
  const busyUI = () => [...document.querySelectorAll('.ui-dialog, .modal, [role="dialog"], .ui-draggable-dragging')].some(el => el.offsetParent !== null);
  function tagCal() { clearTimeout(tagT); tagT = setTimeout(() => { try { if (busyUI()) return tagCal(); if (hookCal() && fcObj) fcObj.fullCalendar('rerenderEvents'); } catch (e) {} }, 600); }
  function startCal() {
    if (hookCal()) { if (flagged().length) tagCal(); return; }
    const mo = new MutationObserver(() => { if (hookCal()) { mo.disconnect(); if (flagged().length) tagCal(); } });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 60000);
  }
  // AroFlo can rebuild the calendar (changing views): hook the new one after a click, cheaply
  document.addEventListener('click', () => setTimeout(() => { const c = W.jQuery && W.jQuery('#calBox'); const fc = c && c.length && c.data('fullCalendar'); if (fc && !fc.__ecPo && hookCal() && flagged().length) tagCal(); }, 0), true);

  // ---------- UI ----------
  const CSS = `
#ecpo-btn{position:fixed;left:14px;bottom:110px;z-index:2147483000;background:${GREY};color:#fff;border:0;border-radius:22px;padding:10px 16px;font:700 14px -apple-system,Segoe UI,sans-serif;box-shadow:0 3px 10px #0004;cursor:pointer}
#ecpo-btn.hot{background:${RED};animation:ecpoPulse 1.6s ease-in-out infinite}
@keyframes ecpoPulse{0%,100%{box-shadow:0 3px 10px #0004,0 0 0 0 #c8201e88}50%{box-shadow:0 3px 10px #0004,0 0 0 9px #c8201e00}}
.ec-po-flag{box-shadow:inset 0 0 0 3px ${RED} !important}
.ec-po-tag{position:absolute;left:1px;bottom:1px;z-index:7;background:${RED};color:#fff;font:700 9px/12px Arial,sans-serif;padding:0 3px;border-radius:3px;cursor:pointer;white-space:nowrap}
#ecpo{position:fixed;top:0;right:0;bottom:0;width:min(640px,100vw);z-index:2147483001;background:#f6f4f2;box-shadow:-4px 0 18px #0004;display:flex;flex-direction:column;font:14px/1.4 -apple-system,Segoe UI,sans-serif;color:#222}
#ecpo *{box-sizing:border-box}
#ecpo .hd{background:${GREY};color:#fff;padding:10px 12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#ecpo .hd b{font-size:16px;margin-right:auto}
#ecpo .hd input[type=number]{width:48px;padding:4px;border-radius:6px;border:0}
#ecpo .hd label{font-size:13px}
#ecpo .bd{flex:1;overflow:auto;padding:10px}
#ecpo .msg{padding:6px 2px 10px;color:#555;font-size:13px}
#ecpo .btn{background:${ORANGE};color:#fff;border:0;border-radius:8px;padding:7px 12px;font:600 13px -apple-system,Segoe UI,sans-serif;cursor:pointer}
#ecpo .btn.grey{background:#8a827c}#ecpo .btn.ghost{background:#fff;color:${GREY};border:1px solid #ccc}#ecpo .btn.red{background:${RED}}
#ecpo .btn:disabled{opacity:.45;cursor:default}#ecpo .btn.sm{padding:4px 10px;font-size:12px}
#ecpo .card{background:#fff;border-radius:10px;margin:0 0 10px;border-left:5px solid #bbb;box-shadow:0 1px 3px #0002}
#ecpo .card.flag{border-left-color:${RED};box-shadow:0 0 0 2px ${RED},0 1px 3px #0002}#ecpo .card.ok{border-left-color:#2f8f4e}#ecpo .card.new,#ecpo .card.changed{border-left-color:${ORANGE}}#ecpo .card.none{opacity:.6}
#ecpo .ch{padding:10px 12px;cursor:pointer;display:flex;gap:8px;align-items:flex-start}
#ecpo .ch .t{flex:1;min-width:0}#ecpo .ch .nm{font-weight:700}#ecpo .sub{color:#666;font-size:12.5px}
#ecpo .chip{display:inline-block;font-size:11.5px;font-weight:700;border-radius:10px;padding:1px 8px;margin-left:4px;background:#eee;color:#555;white-space:nowrap}
#ecpo .chip.g{background:#dff1e5;color:#21703b}#ecpo .chip.o{background:#fde7d6;color:#a94c08}#ecpo .chip.r{background:${RED};color:#fff}
#ecpo .ban{background:${RED};color:#fff;font-weight:800;letter-spacing:.03em;padding:7px 12px;font-size:13.5px}
#ecpo .ban div{font-weight:600;letter-spacing:0;font-size:13px;margin-top:2px}
#ecpo .cb{padding:0 12px 12px}
#ecpo h4{margin:12px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:${GREY}}
#ecpo .pre{white-space:pre-wrap;background:#faf9f8;border:1px solid #eee;border-radius:6px;padding:6px 8px;font-size:12.5px;max-height:220px;overflow:auto}
#ecpo .note{border-bottom:1px solid #eee;padding:4px 0;font-size:12.5px}#ecpo .note b{color:${GREY}}#ecpo .note.off{opacity:.6}
#ecpo .gap{display:flex;gap:8px;align-items:flex-start;border:1px solid #f1c4c3;background:#fff5f5;border-radius:8px;padding:7px 8px;margin:5px 0}
#ecpo .gap.done{background:#f4f4f4;border-color:#ddd;opacity:.7}#ecpo .gap .t{flex:1}#ecpo .gap b{color:${RED}}#ecpo .gap.done b{color:#666;text-decoration:line-through}
#ecpo ul{margin:2px 0 4px 18px;padding:0;font-size:12.5px}
#ecpo textarea,#ecpo .in{width:100%;border:1px solid #ccc;border-radius:6px;padding:6px 8px;font:13px -apple-system,Segoe UI,sans-serif}
#ecpo .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}
#ecpo .err{background:#fbdada;color:#811;border-radius:6px;padding:6px 8px;margin-top:8px;font-size:13px}
#ecpo .say{background:#fff4ea;color:#7a3a05;border-radius:6px;padding:6px 8px;margin-top:8px;font-size:13px}
#ecpo .ok{color:#21703b;font-weight:600}
#ecpo .set input,#ecpo .set select{width:100%;margin:2px 0 8px}
#ecpo.mob{right:auto;bottom:auto;transform-origin:0 0;font-size:15px}#ecpo.mob .hd{padding:12px}#ecpo.mob .hd b{flex:1 0 100%;font-size:18px}
#ecpo.mob .btn{padding:10px 14px;font-size:14px}#ecpo.mob .btn.sm{padding:8px 12px;font-size:13px}
#ecpo.mob input[type=checkbox]{width:22px;height:22px}#ecpo.mob .hd label{display:flex;gap:6px;align-items:center;font-size:14px}
#ecpo.mob textarea,#ecpo.mob .in,#ecpo.mob .hd input[type=number]{font-size:16px;padding:8px}
#ecpo.mob .ch{padding:14px 12px}#ecpo.mob .nm{font-size:15.5px}#ecpo.mob .sub{font-size:13.5px}
#ecpo-btn.mob{transform-origin:0 0;bottom:auto;padding:12px 18px;font-size:16px}`;
  let P = null, open = {}, showSet = false;

  // ---------- phones (same as Solar orders and Job packs) ----------
  const MOBILE = (navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 700) || /iPhone|iPod|Android.+Mobile/.test(navigator.userAgent);
  const view = () => { const vv = W.visualViewport || { width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0 }; const sw = vv.width > vv.height ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height); return { vv, sw, k: vv.width / sw }; };
  function fitEl(el) {
    if (!MOBILE || !el || !el.isConnected) return;
    const { vv, sw, k } = view();
    Object.assign(el.style, { left: vv.offsetLeft + 'px', top: vv.offsetTop + 'px', width: sw + 'px', height: (vv.height / k) + 'px', transform: 'scale(' + k + ')' });
  }
  function fitBtn() {   // just above Job packs
    const b = document.getElementById('ecpo-btn'); if (!MOBILE || !b) return;
    const { vv, k } = view();
    Object.assign(b.style, { left: (vv.offsetLeft + 14 * k) + 'px', top: (vv.offsetTop + vv.height - 180 * k) + 'px', transform: 'scale(' + k + ')' });
  }
  const fitAll = () => { fitEl(P); fitBtn(); };
  let locked = null;
  function lockPage() {
    if (!MOBILE || locked) return;
    const b = document.body, h = document.documentElement;
    locked = { y: W.scrollY || h.scrollTop || 0, x: W.scrollX || 0, b: b.getAttribute('style'), h: h.getAttribute('style') };
    h.style.overflow = 'hidden';
    Object.assign(b.style, { position: 'fixed', top: -locked.y + 'px', left: -locked.x + 'px', width: '100%', overflow: 'hidden' });
  }
  function unlockPage() {
    if (!locked) return;
    const b = document.body, h = document.documentElement, l = locked; locked = null;
    if (l.b == null) b.removeAttribute('style'); else b.setAttribute('style', l.b);
    if (l.h == null) h.removeAttribute('style'); else h.setAttribute('style', l.h);
    W.scrollTo(l.x, l.y);
  }
  function guardTouch(bx) {
    let y0 = 0, x0 = 0;
    const scroller = t => { for (let e = t; e && e !== bx.parentNode; e = e.parentElement) { const cs = getComputedStyle(e); const v = /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1, hz = /(auto|scroll)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1; if (v || hz) return { e, v, hz }; } return null; };
    bx.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; }, { passive: true });
    bx.addEventListener('touchmove', e => {
      const ae = document.activeElement, vv = W.visualViewport;
      if ((ae && bx.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.type != 'checkbox') || (vv && vv.height < innerHeight * 0.8)) return;
      const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0, sc = scroller(e.target);
      if (!sc) { e.preventDefault(); return; }
      if (Math.abs(dx) > Math.abs(dy)) { if (!sc.hz) e.preventDefault(); return; }
      if (!sc.v) { e.preventDefault(); return; }
      if ((dy > 0 && sc.e.scrollTop <= 0) || (dy < 0 && sc.e.scrollTop + sc.e.clientHeight >= sc.e.scrollHeight - 1)) e.preventDefault();
    }, { passive: false });
  }
  if (MOBILE) { const vv = W.visualViewport; if (vv) { vv.addEventListener('resize', fitAll); vv.addEventListener('scroll', fitAll); } addEventListener('resize', fitAll); addEventListener('orientationchange', () => setTimeout(fitAll, 300)); }

  function mount() {
    if (document.getElementById('ecpo-btn')) return;
    const st_ = document.createElement('style'); st_.textContent = CSS; document.head.appendChild(st_);
    const b = document.createElement('button'); b.id = 'ecpo-btn'; b.onclick = toggle; document.body.appendChild(b);
    if (MOBILE) { b.classList.add('mob'); fitBtn(); }
    drawBtn(); startCal();
  }
  // the button goes red and pulses while any job has an open gap, so it's seen without opening anything
  function drawBtn() {
    const b = document.getElementById('ecpo-btn'); if (!b) return;
    const n = flagged().length;
    b.textContent = n ? '⚠ PO check · ' + n + ' not covered' : '✓ PO check';
    b.classList.toggle('hot', !!n);
    b.title = n ? n + ' job' + (n == 1 ? '' : 's') + ' where the lads noted work the PO doesn\'t cover' : 'Check the POs against the lads\' notes';
  }
  function toggle() {
    if (P) { P.remove(); P = null; unlockPage(); const b = document.getElementById('ecpo-btn'); if (b) b.style.display = ''; return; }
    P = document.createElement('div'); P.id = 'ecpo'; document.body.appendChild(P);
    P.addEventListener('click', onClick); P.addEventListener('change', onChange); P.addEventListener('input', onInput);
    if (MOBILE) { lockPage(); P.classList.add('mob'); guardTouch(P); fitEl(P); const b = document.getElementById('ecpo-btn'); if (b) b.style.display = 'none'; }
    drawAll(); if (!JOBS.length) scan();
  }
  // a PO tag on the calendar opens the list on that job
  async function openTo(w) {
    if (!P) toggle();
    open[w] = true;
    if (!JOBS.length) await scan();
    const el = P && P.querySelector('.card[data-w="' + w + '"]'); if (el) el.scrollIntoView({ block: 'start' }); else drawAll();
  }
  function drawAll() {
    if (!P) return;
    const s = S(), y = P.querySelector('.bd') ? P.querySelector('.bd').scrollTop : 0;
    const shown = JOBS.filter(j => !s.onlyFlag || stateOf(j) == 'flag');
    const todo = JOBS.filter(j => /new|changed/.test(stateOf(j))).length;
    P.innerHTML = `<div class="hd"><b>PO check</b><label><input type="number" min="0" max="90" data-set="back" value="${s.back}"> days back</label><label><input type="number" min="0" max="60" data-set="ahead" value="${s.ahead}"> ahead</label>
<label><input type="checkbox" data-set="onlyFlag" ${s.onlyFlag ? 'checked' : ''}> flagged only</label>
<button class="btn" data-a="all" ${runAll || scanning || !todo ? 'disabled' : ''}>${runAll ? 'Checking…' : 'Check new (' + todo + ')'}</button><button class="btn grey" data-a="scan" ${scanning ? 'disabled' : ''}>Refresh</button><button class="btn grey" data-a="set">Settings</button><button class="btn grey" data-a="close">✕</button></div>
<div class="bd">${showSet ? setHtml() : ''}<div class="msg">${esc(scanMsg)} <span class="sub">AI this month ${money(monthCost())} USD</span></div>
${shown.map(j => `<div class="card ${stateOf(j)}" data-w="${j.wrid}">${cardHtml(j)}</div>`).join('') || (scanning ? '' : '<div class="msg">Nothing to show.</div>')}</div>`;
    P.querySelector('.bd').scrollTop = y;
  }
  function draw(w) {
    if (!P) return; const el = P.querySelector('.card[data-w="' + w + '"]'); const job = JOBS.find(j => j.wrid == w);
    if (!el || !job) return drawAll();
    const y = P.querySelector('.bd').scrollTop; el.className = 'card ' + stateOf(job); el.innerHTML = cardHtml(job); P.querySelector('.bd').scrollTop = y;
  }
  function setHtml() {
    const s = S();
    return `<div class="card set"><div class="cb" style="padding-top:10px">
<h4>Settings (this device only)</h4>
Anthropic key <input class="in" type="password" data-key="anthropicKey" value="${esc(aiKey())}">
Todoist token (for Add follow up) <input class="in" type="password" data-key="todoistToken" value="${esc(tdToken())}">
AI <select class="in" data-set="model">${[['haiku', 'Haiku 5.5 (cheapest)'], ['sonnet', 'Sonnet 5.5 at medium (default)'], ['opus', 'Opus 5.5 at medium (best, dearest)']].map(([k, t]) => `<option value="${k}" ${k == s.model ? 'selected' : ''}>${t}</option>`).join('')}</select>
Office staff, their notes are context not site notes (comma between names) <input class="in" data-set="office" value="${esc(s.office)}">
<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-set="invoiced" ${s.invoiced ? 'checked' : ''}> Include invoiced and archived tasks</label>
<div class="row"><button class="btn" data-a="set">Done</button></div></div></div>`;
  }
  function cardHtml(j) {
    const s = peek(j.wrid), o = open[j.wrid], state = stateOf(j), r = s.res, g = openGaps(j.wrid);
    const chips = [];
    if (state == 'flag') chips.push('<span class="chip r">⚠ ' + g.length + ' not covered</span>');
    else if (state == 'ok') chips.push('<span class="chip g">PO covers it</span>');
    else if (state == 'ok?') chips.push('<span class="chip g">Covered last check</span>');
    else if (state == 'changed') chips.push('<span class="chip o">New notes, check again</span>');
    else if (state == 'new') chips.push('<span class="chip o">Not checked</span>');
    else if (state == 'none') chips.push('<span class="chip">No site notes yet</span>');
    else if (state == 'busy') chips.push('<span class="chip o">Checking…</span>');
    if (s.fu) chips.push('<span class="chip">Follow up added</span>');
    const when = [j.last ? 'last ' + dShort(j.last) : '', j.next && j.next != j.last ? 'next ' + dShort(j.next) : ''].filter(Boolean).join(' · ');
    let h = state == 'flag' ? `<div class="ban">PO DOESN'T COVER IT<div>${esc(g.map(x => x.what).join(' · '))}</div></div>` : '';
    h += `<div class="ch" data-a="tog"><div class="t"><div class="nm">JN ${esc(j.jn)} · ${esc(street(j))}</div>
<div class="sub">${esc(when)} · ${esc(j.staff.join(', '))} · ${esc(j.status)} · ${fieldNotes(j).length} site note${fieldNotes(j).length == 1 ? '' : 's'}</div></div><div>${chips.join('')}</div><div>${o ? '▾' : '▸'}</div></div>`;
    if (!o) return h;
    h += '<div class="cb">';
    if (j.busy || j.msg) h += `<div class="say">${esc(j.msg || 'Working…')}</div>`;
    if (j.err) h += `<div class="err">${esc(j.err)}</div>`;
    // the result
    if (r) {
      const all = r.gaps || [];
      if (all.length) {
        h += `<h4>Not covered by the PO</h4>` + all.map(x => { const done = x.approved || (s.clear || {})[x.id];
          return `<div class="gap ${done ? 'done' : ''}"><div class="t"><b>${esc(x.what)}</b>${x.room ? ' <span class="sub">(' + esc(x.room) + ')</span>' : ''}
<div class="sub">${x.extra ? 'For a revised PO: ' + esc(x.extra) : ''}${x.from ? (x.extra ? ' · ' : '') + 'from ' + esc(x.from) : ''}${x.approved ? ' · builder already OK\'d it' : ''}</div></div>
${x.approved ? '' : `<button class="btn ghost sm" data-a="clr" data-g="${esc(x.id)}">${done ? 'Undo' : 'Sorted'}</button>`}</div>`; }).join('');
        if (g.length) h += `<div class="row"><button class="btn red" data-a="draft">Copy builder draft</button><button class="btn grey" data-a="fu" ${j.busy ? 'disabled' : ''}>${s.fu ? 'Comment on follow up' : 'Add follow up'}</button></div>`;
      } else h += `<div class="say" style="background:#e8f5ec;color:#21703b">PO covers everything the lads have noted.</div>`;
      if (r.unclear.length) h += `<h4>Too vague to tell</h4><ul>${r.unclear.map(x => '<li>' + esc(x) + '</li>').join('')}</ul>`;
      h += `<div class="sub" style="margin-top:6px">${esc(r.summary)}${r.summary ? ' · ' : ''}Went off ${esc(r.po)} · checked ${esc(new Date(r.at).toLocaleString('en-AU', { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' }))} · ${money(r.cost)} USD</div>`;
      if (r.allowed.length || r.site.length) h += `<details style="margin-top:6px"><summary class="sub">What the PO allows and what's on site</summary><h4>PO allows</h4><ul>${r.allowed.map(x => '<li>' + esc(x) + '</li>').join('')}</ul><h4>On site</h4><ul>${r.site.map(x => '<li>' + esc(x) + '</li>').join('')}</ul></details>`;
    }
    if (!j.loaded) return h + '<div class="say">Loading notes…</div></div>';
    // the inputs
    const pdfs = poPdfs(j);
    h += `<h4>PO</h4><div class="pre">${esc(j.desc || '(no description)')}</div>`;
    h += `<div class="row">${pdfs.map((p, i) => `<button class="btn ghost sm" data-a="pdf" data-i="${i}">${esc(p.name.slice(0, 40))}</button>`).join('') || '<span class="sub">No PO PDF found on the task, it goes off the description.</span>'}<button class="btn ghost sm" data-a="task">Open task</button></div>`;
    if (j.sched.length) h += `<div class="sub" style="margin-top:4px">Bookings: ${esc(j.sched.join(' · '))}</div>`;
    h += `<h4>Notes (${(j.notes || []).length})</h4>` + ((j.notes || []).length ? `<div class="pre" style="white-space:normal">${j.notes.map(n => `<div class="note${isField(n) ? '' : ' off'}"><b>${esc(n.when)} ${esc(n.who)}</b>${isField(n) ? '' : ' <span class="sub">(office)</span>'}<br>${esc(n.text).replace(/\n/g, '<br>')}</div>`).join('')}</div>` : `<div class="sub">${esc(j.nErr || 'No notes.')}</div>`);
    h += `<h4>Your notes for the check</h4><textarea rows="2" data-f="notes" placeholder="e.g. Haydn OK'd the extra 2 downlights on the phone. Fan in bed 2 is ours to supply.">${esc(s.notes || '')}</textarea>`;
    h += `<div class="row"><button class="btn" data-a="go" ${j.busy ? 'disabled' : ''}>${r ? 'Check again' : 'Check it'}</button>${r ? '<a href="#" data-a="force" class="sub">redo with the AI anyway</a>' : ''}</div>`;
    return h + '</div>';
  }

  const jobOf = el => { const c = el.closest('.card[data-w]'); return c && JOBS.find(j => j.wrid == c.dataset.w); };
  async function onClick(e) {
    const t = e.target.closest('[data-a]'); if (!t) return;
    const a = t.dataset.a, job = jobOf(t);
    if (t.tagName == 'A') e.preventDefault();
    if (a == 'close') return toggle();
    if (a == 'scan') { JOBS.forEach(j => { j.loaded = 0; }); return scan(); }
    if (a == 'all') return checkAll();
    if (a == 'set') { showSet = !showSet; return drawAll(); }
    if (!job) return;
    const s = st(job.wrid);
    if (a == 'tog') {
      open[job.wrid] = !open[job.wrid]; draw(job.wrid);
      if (open[job.wrid] && !job.loaded) { try { await loadJob(job); } catch (er) { job.err = er.message; } draw(job.wrid); }
      return;
    }
    if (a == 'pdf') { const p = poPdfs(job)[+t.dataset.i]; if (p) W.open(p.orig, '_blank'); return; }
    if (a == 'task') { const tab = W.open('about:blank', '_blank'); let href = job.link; if (!href) { try { const r = (await taskSearch(job.jn, 'JobNo')).find(x => x.jn == job.jn); href = r && r.href; } catch (er) {} } if (href && tab) tab.location.href = new URL(href, location.origin).href; else if (tab) tab.close(); return; }
    if (a == 'go') return check(job, e.shiftKey);
    if (a == 'force') return check(job, true);
    if (a == 'clr') { s.clear = s.clear || {}; if (s.clear[t.dataset.g]) delete s.clear[t.dataset.g]; else s.clear[t.dataset.g] = Date.now(); touch(job.wrid); draw(job.wrid); drawBtn(); tagCal(); return; }
    if (a == 'draft') { const ok = await copy(builderText(job)); job.msg = ok ? 'Builder draft copied.' : 'Couldn\'t copy, here it is:\n' + builderText(job); return draw(job.wrid); }
    if (a == 'fu') return followUp(job);
  }
  function onInput(e) {
    const t = e.target, job = jobOf(t);
    if (job && t.dataset.f == 'notes') { st(job.wrid).notes = t.value; touch(job.wrid); }
  }
  function onChange(e) {
    const t = e.target, job = jobOf(t);
    if (t.dataset.set) {
      const v = t.type == 'checkbox' ? t.checked : t.type == 'number' ? Math.max(0, Math.min(90, Math.round(+t.value || 0))) : t.value;
      setS({ [t.dataset.set]: v });
      if (/^(back|ahead|invoiced|office)$/.test(t.dataset.set)) { JOBS = []; return scan(); }
      return drawAll();
    }
    if (t.dataset.key) { GM_setValue(t.dataset.key, keyClean(t.value)); return; }
    if (job && t.dataset.f == 'notes') { st(job.wrid).notes = t.value; touch(job.wrid); return draw(job.wrid); }
  }

  // test hook for Claude: read only bits, nothing here runs by itself
  W.ecPoCheck = { scan, jobs: () => JOBS, st, check, checkAll, details, notes, docs, poPdfs, inputOf, openGaps, flagged, builderText, stateOf, toggle, tagCal };

  if (document.readyState == 'complete') mount(); else addEventListener('load', mount);
})();
