// ==UserScript==
// @name         EC page helpers
// @namespace    ec
// @version      0.1
// @description  Loads the AroFlo script helpers (task search, task page read, notes, site info, scheduling, moving bookings, calendar index, PC time) on every AroFlo page by itself, so nothing has to be pasted in or set up after a page load. Does nothing on its own, just has them ready. PC only.
// @match        https://office.aroflo.com/*
// @noframes
// @grant        unsafeWindow
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Badseed26/ec-userscripts/main/ec-page-helpers.user.js
// @downloadURL  https://raw.githubusercontent.com/Badseed26/ec-userscripts/main/ec-page-helpers.user.js
// ==/UserScript==

(function () {
  'use strict';

  // How it works (27/11):
  // The helpers below are the same ones the house rules used to paste in by hand. They have to live on the page itself
  // (not in Tampermonkey's sandbox) so jQuery, CKEditor and the calendar are there for them, so this drops them in with a
  // script tag once the page has loaded. They also save themselves in the tab's sessionStorage as _afSetup like before, so
  // the old "await eval(sessionStorage.getItem('_afSetup'))" call still works, it's just not needed any more.
  // window._afReady is true once they're all on, window._afVer says which version, window._ecHelp() lists them.

  const VER = (typeof GM_info != 'undefined' && GM_info.script && GM_info.script.version) || '0.1';

  // Runs on the page itself, not in the sandbox. Keep it self contained (nothing from outside this function).
  function pageMain(VER) {
    const AF = async () => {
      const w = (cond, max) => new Promise(res => { if (cond()) return res(true); let d = false; const mo = new MutationObserver(() => { if (!d && cond()) { d = true; mo.disconnect(); res(true); } }); mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true }); setTimeout(() => { if (!d) { d = true; mo.disconnect(); res(cond()); } }, max); });
      await w(() => document.readyState == 'complete' && !!document.body, 15000);
      const txt = () => document.body.innerText.replace(/\s+/g, ' ');
      // TASK SEARCH: posts the dashboard's own Search Tasks form in the background. field = JobNo | CustOn | Location | Desc | Client | RefNo | TaskID | CustF
      window._taskSearch = async (term, field) => { const fd = new URLSearchParams({ taskString: term, SearchParam: field, searchtasks: 'Search', searchtasks_btn: 'Search' }); const h = await (await fetch('/ims/Site/Home/index.cfm?tid=IMS.STK.CUR', { method: 'POST', body: fd })).text(); const d = new DOMParser().parseFromString(h, 'text/html'); return [...d.querySelectorAll('tr')].filter(tr => tr.querySelectorAll('td').length >= 6).map(tr => { const c = [...tr.querySelectorAll('td')].map(x => x.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean); const a = [...tr.querySelectorAll('a')].find(a => /workrequest/.test(a.getAttribute('href') || '') && !/printview/.test(a.getAttribute('href'))); return { ref: c[0], jn: c[1], req: c[2], task: c[4], status: c[c.length - 1], href: a ? a.getAttribute('href') : '' }; }); };
      // Open a task page by job number. The link never goes in a result.
      window._goTask = async jn => { const r = (await window._taskSearch(String(jn), 'JobNo')).find(x => x.jn == String(jn)); if (!r || !r.href) return 'JN ' + jn + ' not found'; setTimeout(() => { location.href = r.href }, 50); return 'opening JN ' + r.jn + ' ' + r.task.slice(0, 45) + ' (' + r.status + ')'; };
      const notesPart = () => { const t = txt(); const i = t.indexOf('Task Notes'), j = t.indexOf('Add Note (Text)'); return i < 0 ? '' : t.slice(i, j > i ? j : i + 400); };
      // Title, completion line, upcoming schedules and the last notes on the open task page.
      window._task = (n = 700) => { const t = txt(); const u = t.indexOf('Upcoming Schedules'); return { title: document.title.replace(/ - Task - AroFlo.*$/, '').slice(0, 70), done: (t.match(/Completion Date:[^|]{0,40}?(?= Edit|$)/) || [''])[0], upcoming: u < 0 ? '' : t.slice(u, u + 160), notes: notesPart().slice(-n) }; };
      // Add an Internal Only HTML note, then re-read the notes list to confirm it landed. dry=true fills, checks, empties, saves nothing.
      window._addNote = async (text, dry) => { const b = document.getElementById('btnAddNoteHTML'); if (!b) return 'no Add Note (HTML) button';
        if (notesPart().includes(text.slice(0, 60))) return 'already noted, skipped';
        b.scrollIntoView({ block: 'center' }); jQuery(b).trigger('click');
        if (!await w(() => !!(window.CKEDITOR && CKEDITOR.instances.thisnote && CKEDITOR.instances.thisnote.status == 'ready'), 8000)) return 'editor did not open';
        const ed = CKEDITOR.instances.thisnote; ed.setData('<p>' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>');
        const f = document.querySelector('select[name=NoteFilter]'), s = document.querySelector('input[name=NoteSticky]'); const filt = f ? f.options[f.selectedIndex].text : '?'; const sticky = !!(s && s.checked);
        const btn = document.getElementById('btnAddNote');
        if (filt != 'Internal Only' || sticky || !btn) { ed.setData(''); return 'STOPPED, not saved: filter ' + filt + ', sticky ' + sticky + ', save button ' + !!btn; }
        if (dry) { const filled = ed.getData().length > 0; ed.setData(''); return 'dry run ok: editor opened and filled ' + filled + ', Internal Only, not sticky, Save Note found, nothing saved'; }
        btn.click(); const ok = await w(() => notesPart().includes(text.slice(0, 60)), 10000); return { saved: ok, last: notesPart().slice(-(text.length + 90)) }; };
      // CALENDAR INDEX (calendar page only): loads W weeks from FROM ('YYYY-MM-DD', default today), about 3 sec a week. Then _booked(term) looks up a JN, PO or street.
      window._calIndex = async (W = 5, FROM = null) => { const sleep = ms => new Promise(r => setTimeout(r, ms)); const t0 = Date.now();
        for (let i = 0; i < 40 && !(window.jQuery && jQuery('.fc').length && jQuery('.fc').first().fullCalendar('clientEvents').length); i++) await sleep(250);
        const $c = jQuery('.fc').first(); const fc = () => $c.fullCalendar('clientEvents'); const idx = new Map();
        const grab = () => fc().filter(e => e.type == 'task').forEach(e => { const k = e.wrid + '|' + new Date(e.start).getTime(); if (!idx.has(k)) idx.set(k, { wrid: e.wrid, staff: (e.resourcename || '').split(' ')[0], start: new Date(e.start), end: e.end ? new Date(e.end) : null, h: (e.headers || []).map(h => h.headerText).filter(Boolean).join(' / '), t: (e.title || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 140), cancel: /cancel/i.test(JSON.stringify(e.headers) + e.title) }); });
        const from = FROM ? new Date(FROM + 'T00:00') : new Date(); from.setHours(0, 0, 0, 0); const weeks = [];
        for (let w = 0; w < W; w++) { const d = new Date(from.getTime() + w * 7 * 864e5); const h0 = document.querySelector('.fc-header-title').innerText; $c.fullCalendar('gotoDate', d); for (let i = 0; i < 40; i++) { await sleep(250); const h = document.querySelector('.fc-header-title').innerText; if ((h != h0 || w == 0) && fc().some(e => new Date(e.start) >= d)) break; } await sleep(600); grab(); weeks.push(document.querySelector('.fc-header-title').innerText); }
        $c.fullCalendar('gotoDate', from);
        window._book = [...idx.values()].filter(v => v.start >= from).sort((a, b) => a.start - b.start).map(v => ({ ...v, jn: (v.h.match(/^\d+/) || [''])[0], when: v.start.toString().slice(0, 21) }));
        return { sec: (Date.now() - t0) / 1000, weeks, visits: window._book.length }; };
      const norm = s => s.toLowerCase().replace(/\bstreet\b/g, 'st').replace(/\bdrive\b/g, 'dr').replace(/\broad\b/g, 'rd').replace(/\bavenue\b/g, 'ave').replace(/\bterrace\b/g, 'tce').replace(/\bcourt\b/g, 'ct').replace(/\bplace\b/g, 'pl').replace(/\bcrescent\b/g, 'cres').replace(/\s+/g, ' ');
      window._booked = term => { const t = norm(String(term)); return (window._book || []).filter(v => v.jn == t || norm(v.t).includes(t) || norm(v.h).includes(t)).map(v => v.when.slice(0, 10) + ' ' + v.when.slice(16) + ' ' + v.staff + ' JN' + v.jn + ' ' + v.h.replace(/^\d+ \/ /, '').slice(0, 40)); };
      // SITE INFO (top of the task description), open tasks only. _goHeader(jn) opens the task's Edit Task Header page.
      window._goHeader = async jn => { const r = (await window._taskSearch(String(jn), 'JobNo')).find(x => x.jn == String(jn)); if (!r || !r.href) return 'JN ' + jn + ' not found'; if (/Completed|Archived|Cancel|Quote/i.test(r.status)) return 'JN ' + jn + ' is ' + r.status + ': site info only goes on open tasks'; const h = await (await fetch(r.href)).text(); const a = [...new DOMParser().parseFromString(h, 'text/html').querySelectorAll('a')].find(e => /^\s*Edit Task Header\s*$/i.test(e.textContent || '')); if (!a) return 'no Edit Task Header link on JN ' + jn; const u = a.getAttribute('href'); setTimeout(() => { location.href = u }, 50); return 'opening Edit Task Header for JN ' + r.jn + ' (' + r.status + ')'; };
      const plain = s => String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\u00a0/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
      // Every header field on the page except hidden ones, the description and the note box. A save must leave these exactly as they were.
      const hdrFields = () => { const f = document.forms.editwr; return f ? [...f.elements].filter(e => e.name && !/^(hidden|button|submit)$/.test(e.type) && !/^(description|thisnote)$/.test(e.name)).map(e => e.name + '=' + (/radio|checkbox/.test(e.type) ? e.checked : e.value)).join('|') : ''; };
      const setD = (ed, html) => new Promise(r => { ed.setData(html, { callback: r }); setTimeout(r, 2500); });
      // On the Edit Task Header page: one line on top of the description, old text kept, no other field moved, then the header's own Save. dry=true saves nothing.
      window._addSiteInfo = async (text, dry) => { const ed = window.CKEDITOR && CKEDITOR.instances.description; const btn = document.getElementById('updateheader__btn');
        if (!/^Edit - JN/.test(document.title) || !ed || !btn || !document.forms.editwr) return 'not on an Edit Task Header page (run _goHeader first)';
        if (!await w(() => ed.status == 'ready', 8000)) return 'editor not ready';
        const old = ed.getData(); if (plain(old).toLowerCase().includes(plain(text).slice(0, 40).toLowerCase())) return 'already there, skipped';
        const f0 = hdrFields(); const line = '<p>' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>';
        await setD(ed, line + old); const now = plain(ed.getData()); const top = now.startsWith(plain(text)); const kept = now.endsWith(plain(old)); const same = hdrFields() == f0;
        if (!top || !kept || !same) { await setD(ed, old); ed.resetDirty(); return 'STOPPED, not saved: line on top ' + top + ', old text kept ' + kept + ', other fields unchanged ' + same; }
        if (dry) { await setD(ed, old); ed.resetDirty(); const back = plain(ed.getData()) == plain(old) && hdrFields() == f0; return 'dry run ok: line went on top, old text kept, other fields unchanged, put back ' + back + ', nothing saved'; }
        sessionStorage.setItem('_siCheck', JSON.stringify({ text, f0, old: plain(old) })); ed.updateElement(); setTimeout(() => jQuery(btn).trigger('click'), 50); return 'saving: once the page loads, _goHeader(jn) again, then _siCheck()'; };
      // After a save, back on the Edit Task Header page. Leave the page without saving.
      window._siCheck = () => { const s = JSON.parse(sessionStorage.getItem('_siCheck') || 'null'); const ed = window.CKEDITOR && CKEDITOR.instances.description; if (!s) return 'nothing to check'; if (!ed) return 'open the header page with _goHeader first'; const d = plain(ed.getData()); return { lineOnTop: d.startsWith(plain(s.text)), oldKept: d.endsWith(s.old), otherFieldsSame: hdrFields() == s.f0 }; };
      // SCHEDULING (only when a skill or Ethan asks). _goSched(jn,'YYYY-MM-DD') opens a new schedule window for the task on that date.
      window._goSched = async (jn, date) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return 'date must be YYYY-MM-DD'; const r = (await window._taskSearch(String(jn), 'JobNo')).find(x => x.jn == String(jn)); if (!r || !r.href) return 'JN ' + jn + ' not found'; if (/Completed|Archived|Cancel|Quote/i.test(r.status)) return 'JN ' + jn + ' is ' + r.status + ': not scheduling it'; const m = r.href.match(/wrCoded=([^&]+)/i); if (!m) return 'no task code for JN ' + jn; const [y, mo, d] = date.split('-').map(Number); const u = '/ims/Site/Calendar/index.cfm?viewfullcalendar=1&tid=IMS.CAL&wrcoded=' + m[1] + '&initdate=' + d + '/' + mo + '/' + y + '&newtasksched=1'; setTimeout(() => { location.href = u }, 50); return 'opening a new schedule for JN ' + r.jn + ' on ' + new Date(y, mo - 1, d).toDateString().slice(0, 10) + ' (' + r.status + ')'; };
      const schedEvents = (jn, staff, day) => jQuery('.fc').first().fullCalendar('clientEvents').filter(e => e.type == 'task' && (e.headers || []).map(h => h.headerText).filter(Boolean)[0] == String(jn) && (e.resourcename || '') == staff && new Date(e.start).toDateString() == day.toDateString());
      const tfmt = t => t.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase();
      // In that window: o = {jn, staff, date, start, end, note}. dry=true stops before Done and saves nothing (leave with _goTask).
      window._schedule = async (o, dry) => { const sleep = ms => new Promise(r => setTimeout(r, ms));
        if (window._schedFired) return 'STOPPED: already fired on this page load, run _goSched again first';
        if (!/newtasksched=1/.test(location.search)) return 'not on a new schedule window (run _goSched first)';
        const [y, mo, d] = String(o.date).split('-').map(Number); const day = new Date(y, mo - 1, d); const dm = d + '/' + mo;
        let dlg; await w(() => !!(dlg = [...document.querySelectorAll('.ui-dialog')].find(x => x.offsetParent && /Task Schedules/.test(x.innerText))), 10000);
        if (!dlg) return 'schedule window did not open';
        if (!new RegExp('Ref / JN: [^:]*?/ ' + o.jn + ' ').test(dlg.innerText.replace(/\s+/g, ' '))) return 'STOPPED: window is not for JN ' + o.jn;
        const res = g => +((g.innerText.match(/Resources:\s*(\d+)/) || [0, -1])[1]);
        const gs = [...dlg.querySelectorAll('.imsMultiSchedule__schedule')].filter(x => x.offsetParent); const empty = gs.filter(g => res(g) == 0 && !g.querySelector('input.schedStartTime'));
        if (empty.length != 1) return 'STOPPED: expected one new empty schedule group, found ' + empty.length;
        const others = gs.filter(x => x !== empty[0]); const snap = () => others.map(x => [...x.querySelectorAll('input')].map(i => i.type == 'checkbox' ? i.checked : i.value).join('|') + x.innerText.replace(/\s+/g, ' ')).join('#'); const snap0 = snap();
        const g = empty[0]; const dates = () => ((g.innerText.match(/Dates:\s*([^|\n]*)/) || [0, ''])[1]).trim();
        if (dates() != dm) return 'STOPPED: window date is ' + dates() + ', wanted ' + dm;
        const cbx = [...g.querySelectorAll('input[id^=cbxEvent],input[id^=cbxHidden]')]; if (cbx.some(c => c.checked)) return 'STOPPED: Send Event Messages or Hidden is ticked';
        const fc = () => jQuery('.fc').first().fullCalendar('clientEvents'); for (let i = 0; i < 24 && !fc().some(e => new Date(e.start).toDateString() == day.toDateString()); i++) await sleep(250);
        const before = schedEvents(o.jn, o.staff, day).length; if (before) return 'STOPPED: ' + o.staff + ' is already on JN ' + o.jn + ' on ' + dm;
        g.querySelector('button[title="Add resources to schedule"]').click(); await sleep(400);
        const us = g.querySelector('span[title="Users"]'); if (!us) return 'STOPPED: no Users option'; us.click();
        const [f, ...l] = o.staff.split(' '); let ud, row;
        await w(() => { ud = [...document.querySelectorAll('.ui-dialog')].find(x => x.offsetParent && /Search Users/.test(x.innerText)); row = ud && [...ud.querySelectorAll('tr')].find(t => { const c = [...t.querySelectorAll('td')].map(x => x.innerText.trim()); return c.includes(f) && c.includes(l.join(' ')); }); return !!row; }, 9000);
        const closeUd = () => { const c = ud && [...ud.querySelectorAll('a,button,span')].find(e => /^\s*close\s*$/i.test(e.innerText || '') || /titlebar-close/.test(e.className)); c && c.click(); };
        if (!row) { closeUd(); return 'STOPPED: ' + o.staff + ' not in the user list, nothing saved (leave with _goTask)'; }
        jQuery(row.closest('table')).jqGrid('setSelection', row.id, true);
        await w(() => res(g) == 1 && g.querySelectorAll('input.schedStartTime').length == 1, 4000); closeUd(); await sleep(400);
        if (res(g) != 1 || !g.innerText.includes(o.staff)) return 'STOPPED: ' + o.staff + ' did not go on (resources ' + res(g) + '), nothing saved (leave with _goTask)';
        const tr = g.querySelector('input.schedStartTime').closest('tr'); const S = tr.querySelector('input.schedStartTime'), E = tr.querySelector('input.schedEndTime'), N = tr.querySelector('input.schedNote');
        const setv = (el, v) => { el.focus(); el.value = v; ['input', 'keyup', 'change'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true }))); jQuery(el).trigger('change'); el.blur(); };
        if (o.start) { setv(S, o.start); await sleep(300); } if (o.end) { setv(E, o.end); await sleep(300); } if (o.note) { setv(N, o.note); await sleep(200); }
        document.querySelectorAll('.ui-timepicker-wrapper').forEach(x => x.style.display = 'none');
        const got = { staff: o.staff, date: dates(), start: S.value, end: E.value, note: N.value, otherGroups: others.length, othersSame: snap() == snap0 }; window._schedFired = true;
        const ok = got.date == dm && (!o.start || S.value == o.start) && (!o.end || E.value == o.end) && N.value == (o.note || '') && res(g) == 1 && !cbx.some(c => c.checked) && got.othersSame;
        if (!ok) return 'STOPPED, not saved: ' + JSON.stringify(got) + ' (leave with _goTask)';
        if (dry) return 'dry run ok, nothing saved: ' + JSON.stringify(got) + ' (leave with _goTask)';
        const done = [...dlg.querySelectorAll('button,a')].find(b => /^\s*(save\s*)?Done\s*$/i.test(b.innerText || '')); if (!done) return 'STOPPED: no Done button, not saved';
        sessionStorage.setItem('_schedCheck', JSON.stringify({ jn: o.jn, staff: o.staff, date: o.date, start: S.value, end: E.value, note: N.value, before })); done.click();
        return (await w(() => !dlg.offsetParent, 8000)) ? 'saved: run _schedCheck() on this page' : 'Done clicked but the window is still open: check it on screen'; };
      // Straight after Done, same page: exactly one new schedule with the right staff, date, start, end and note.
      window._schedCheck = async () => { const s = JSON.parse(sessionStorage.getItem('_schedCheck') || 'null'); if (!s) return 'nothing to check'; const [y, mo, d] = s.date.split('-').map(Number); const day = new Date(y, mo - 1, d); const $c = jQuery('.fc').first(); $c.fullCalendar('gotoDate', day); $c.fullCalendar('refetchEvents'); await new Promise(r => setTimeout(r, 3000));
        const hit = schedEvents(s.jn, s.staff, day); const last = hit[hit.length - 1]; const h = last ? (last.headers || []).map(x => x.headerText).filter(Boolean).join(' / ') : ''; const st = last ? tfmt(new Date(last.start)) : '', en = last && last.end ? tfmt(new Date(last.end)) : '';
        return { ok: hit.length == s.before + 1 && !!last && st == s.start && en == s.end && (!s.note || h.includes(s.note)), count: hit.length, before: s.before, start: st, end: en, header: h.slice(0, 80) }; };
      // MOVING AN EXISTING BOOKING (calendar page). Always through AroFlo's own schedule window, never the calendar save call directly.
      window._moveOpen = async o => { const sleep = ms => new Promise(r => setTimeout(r, ms));
        if (window._mv && window._mv.fired) return 'STOPPED: already saved on this page load, reload the calendar first';
        const $c = jQuery('#calBox'); if (!$c.length || !window.fullcalEventClick) return 'not on the calendar page';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(o.from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(o.to || '')) return 'from and to must be YYYY-MM-DD';
        const [y, mo, d] = o.from.split('-').map(Number); const day = new Date(y, mo - 1, d); const [ty, tm, td] = o.to.split('-').map(Number);
        $c.fullCalendar('gotoDate', new Date(y, mo - 1, d, 8)); $c.fullCalendar('refetchEvents'); await sleep(3500);
        const hit = schedEvents(o.jn, o.staff, day); if (hit.length != 1) return 'STOPPED: found ' + hit.length + ' bookings for ' + o.staff + ' on JN ' + o.jn + ' on ' + d + '/' + mo;
        const e = hit[0]; if (e.TotalNumInGroup > 1) return 'STOPPED: that booking is in a group of ' + e.TotalNumInGroup + ', tell Ethan';
        const before = { start: tfmt(new Date(e.start)), end: e.end ? tfmt(new Date(e.end)) : '', h: (e.headers || []).map(x => x.headerText).filter(Boolean).join(' / ').slice(0, 80) };
        fullcalEventClick(e); let dlg; await w(() => !!(dlg = [...document.querySelectorAll('.ui-dialog')].find(x => x.offsetParent && /Task Schedules/.test(x.innerText))), 10000); if (!dlg) return 'schedule window did not open'; await sleep(800);
        if (!new RegExp('Ref / JN: [^:]*?/ ' + o.jn + ' ').test(dlg.innerText.replace(/\s+/g, ' '))) return 'STOPPED: window is not for JN ' + o.jn;
        const dates = g => ((g.innerText.match(/Dates:\s*([^|\n]*)/) || [0, ''])[1]).trim();
        const gs = [...dlg.querySelectorAll('.imsMultiSchedule__schedule')].filter(x => x.offsetParent); const mine = gs.filter(g => dates(g) == d + '/' + mo && g.innerText.includes(o.staff));
        if (mine.length != 1) return 'STOPPED: expected one group for ' + o.staff + ' on ' + d + '/' + mo + ', found ' + mine.length;
        const g = mine[0]; const others = gs.filter(x => x !== g); const snap = () => others.map(x => [...x.querySelectorAll('input')].map(i => i.type == 'checkbox' ? i.checked : i.value).join('|') + dates(x)).join('#');
        window._mv = { o, g, dlg, snap, snap0: snap(), before, dates, fired: false };
        const pick = g.querySelector('[title="Show/Hide Calendar"]'); if (!pick) return 'STOPPED: no date picker button'; if (!g.querySelector('table.ui-datepicker-calendar')) pick.click(); await sleep(800);
        const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']; const want = MN[tm - 1] + ' ' + ty; const mIdx = s => { const p = s.split(' '); return +p[1] * 12 + MN.indexOf(p[0]); };
        const titles = () => [...g.querySelectorAll('.ui-datepicker-title')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
        for (let i = 0; i < 14 && !titles().includes(want); i++) { const t = titles(); if (!t.length) break; const nav = g.querySelector(mIdx(want) > mIdx(t[0]) ? '.ui-datepicker-next' : '.ui-datepicker-prev'); if (!nav) break; jQuery(nav).trigger('click'); await sleep(400); }
        const k = titles().indexOf(want); if (k < 0) return 'STOPPED: picker would not show ' + want + ' (showing ' + titles().join(', ') + ')';
        const cell = [...g.querySelectorAll('table.ui-datepicker-calendar')[k].querySelectorAll('td')].find(x => x.textContent.trim() == String(td) && x.querySelector('.dpday')); if (!cell) return 'STOPPED: no cell for ' + td + '/' + tm;
        cell.scrollIntoView({ block: 'nearest' }); await sleep(200); const r = cell.getBoundingClientRect(); const f = (o.fw || 1568) / innerWidth;
        return { x: Math.round((r.x + r.width / 2) * f), y: Math.round((r.y + r.height / 2) * f), now: dates(g), before }; };
      // After the real click on the new date: o = {start, end, note} (all optional). dry=true closes the window with its X, saving nothing.
      window._moveFill = async (o, dry) => { const sleep = ms => new Promise(r => setTimeout(r, ms)); const m = window._mv; if (!m) return 'run _moveOpen first'; if (m.fired) return 'STOPPED: already saved, reload the calendar first';
        const [ty, tm, td] = m.o.to.split('-').map(Number); const g = m.g, dlg = m.dlg; const close = () => { const c = dlg.querySelector('.ui-dialog-titlebar-close'); c && c.click(); };
        if (m.dates(g) != td + '/' + tm) { close(); return 'STOPPED, not saved: Dates shows ' + m.dates(g) + ', wanted ' + td + '/' + tm + ' (window closed)'; }
        if (!g.innerText.includes(m.o.staff)) { close(); return 'STOPPED, not saved: ' + m.o.staff + ' is not on the group (window closed)'; }
        const cbx = [...g.querySelectorAll('input[type=checkbox]')]; if (cbx.some(c => c.checked)) { close(); return 'STOPPED, not saved: a tick box (Hidden, Send Event Messages or Single) is ticked (window closed)'; }
        const rows = g.querySelectorAll('input.schedStartTime'); if (rows.length != 1) { close(); return 'STOPPED, not saved: ' + rows.length + ' staff rows on the group (window closed)'; }
        const tr = rows[0].closest('tr'); const S = tr.querySelector('input.schedStartTime'), E = tr.querySelector('input.schedEndTime'), N = tr.querySelector('input.schedNote');
        const setv = (el, v) => { el.focus(); el.value = v; ['input', 'keyup', 'change'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true }))); jQuery(el).trigger('change'); el.blur(); };
        if (o.start) { setv(S, o.start); await sleep(300); } if (o.end) { setv(E, o.end); await sleep(300); } if (o.note != null) { setv(N, o.note); await sleep(200); }
        document.querySelectorAll('.ui-timepicker-wrapper').forEach(x => x.style.display = 'none');
        const got = { date: m.dates(g), start: S.value, end: E.value, note: N.value, othersSame: m.snap() == m.snap0 };
        const ok = (!o.start || S.value == o.start) && (!o.end || E.value == o.end) && (o.note == null || N.value == o.note) && got.othersSame;
        if (!ok) { close(); return 'STOPPED, not saved: ' + JSON.stringify(got) + ' (window closed)'; }
        if (dry) { close(); return 'dry run ok, nothing saved (window closed): ' + JSON.stringify(got); }
        const done = [...dlg.querySelectorAll('button,a')].find(b => /^\s*(save\s*)?Done\s*$/i.test(b.innerText || '')); if (!done) { close(); return 'STOPPED: no Done button, not saved'; }
        m.fired = true; sessionStorage.setItem('_mvCheck', JSON.stringify({ jn: m.o.jn, staff: m.o.staff, from: m.o.from, to: m.o.to, start: S.value, end: E.value, note: N.value })); done.click();
        return (await w(() => !dlg.offsetParent, 8000)) ? 'saved: run _moveCheck() on this page' : 'Done clicked but the window is still open: check it on screen'; };
      // Straight after Done: one booking for that staff member on the new day with the right times and note, none left on the old day.
      window._moveCheck = async () => { const s = JSON.parse(sessionStorage.getItem('_mvCheck') || 'null'); if (!s) return 'nothing to check'; const sleep = ms => new Promise(r => setTimeout(r, ms)); const $c = jQuery('.fc').first(); const dd = x => { const [y, mo, d] = x.split('-').map(Number); return new Date(y, mo - 1, d); };
        $c.fullCalendar('gotoDate', dd(s.from)); $c.fullCalendar('refetchEvents'); await sleep(3500); const left = schedEvents(s.jn, s.staff, dd(s.from)).length;
        $c.fullCalendar('gotoDate', dd(s.to)); $c.fullCalendar('refetchEvents'); await sleep(3500); const hit = schedEvents(s.jn, s.staff, dd(s.to)); const e = hit[0]; const h = e ? (e.headers || []).map(x => x.headerText).filter(Boolean).join(' / ') : ''; const st = e ? tfmt(new Date(e.start)) : '', en = e && e.end ? tfmt(new Date(e.end)) : '';
        return { ok: s.from == s.to ? hit.length == 1 : (hit.length == 1 && left == 0) && st == s.start && en == s.end && (!s.note || h.includes(s.note)), onNewDay: hit.length, leftOnOldDay: s.from == s.to ? 'same day' : left, start: st, end: en, header: h.slice(0, 80) }; };
      // PC TIME (calendar page): Ethan's next free PC time from FROM, W weeks ahead, weekdays only. BY (optional, 'YYYY-MM-DD HH:MM') = needed by.
      window._pcSlot = async (FROM, W = 3, BY = null) => { const sleep = ms => new Promise(r => setTimeout(r, ms)); const p = n => String(n).padStart(2, '0'); const ymd = d => d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); const dt = s => new Date(s.length > 10 ? s.replace(' ', 'T') : s + 'T08:00');
        for (let i = 0; i < 40 && !(window.jQuery && jQuery('.fc').length && jQuery('.fc').first().fullCalendar('clientEvents').length); i++) await sleep(250);
        const $c = jQuery('.fc').first(); const fc = () => $c.fullCalendar('clientEvents'); const idx = new Map();
        const grab = () => fc().filter(e => /^Ethan\b/.test(e.resourcename || '')).forEach(e => { const k = (e.wrid || e.id) + '|' + new Date(e.start).getTime(); if (!idx.has(k)) idx.set(k, { type: e.type, start: new Date(e.start), end: new Date(e.end || e.start), what: ((e.headers || []).map(h => h.headerText).join(' ') + ' ' + (e.title || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 60) }); });
        const from = new Date(FROM + 'T00:00'); const by = BY ? new Date(BY.length > 10 ? BY.replace(' ', 'T') : BY + 'T00:00') : null;
        for (let w = 0; w < W; w++) { const d = new Date(from.getTime() + w * 7 * 864e5); const h0 = document.querySelector('.fc-header-title').innerText; $c.fullCalendar('gotoDate', d); for (let i = 0; i < 40; i++) { await sleep(250); if (w == 0 || document.querySelector('.fc-header-title').innerText != h0) break; } await sleep(900); grab(); }
        $c.fullCalendar('gotoDate', new Date()); const all = [...idx.values()]; const days = []; let slot = null, part = null, asap = null;
        for (let i = 0; i < W * 7; i++) { const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i); if (d.getDay() == 0 || d.getDay() == 6) continue;
          const same = all.filter(x => ymd(x.start) == ymd(d)); const site = same.filter(x => x.type == 'task'); const off = same.some(x => x.type != 'task' && /holiday|leave|rdo|sick/i.test(x.what));
          const first = site.length ? new Date(Math.min(...site.map(x => x.start))) : null; const last = site.length ? new Date(Math.max(...site.map(x => x.end))) : null;
          const hm = t => t ? p(t.getHours()) + ':' + p(t.getMinutes()) : ''; const mins = t => t.getHours() * 60 + t.getMinutes(); const upHr = t => p(Math.min(17, t.getHours() + (t.getMinutes() ? 1 : 0))) + ':00';
          let pick = null, pp = null; if (!off) { if (!site.length) pick = ymd(d); else if (mins(last) <= 720) pick = ymd(d) + ' 13:00'; else if (first.getHours() >= 12) pick = ymd(d) + ' 08:00';
            if (site.length && mins(last) <= 840) pp = ymd(d) + ' ' + upHr(last); else if (site.length && first.getHours() >= 11) pp = ymd(d) + ' 07:00'; }
          days.push(ymd(d).slice(5) + ': ' + (off ? 'day off' : site.length ? 'site ' + hm(first) + '-' + hm(last) : 'no site work'));
          if (pick && !slot && (!by || dt(pick) < by)) slot = pick;
          if (by && !part && (pick || pp) && dt(pick || pp) < by) part = pick || pp;
          if (!off && !asap) asap = site.length && mins(last) <= 900 ? ymd(d) + ' ' + upHr(last) : ymd(d); }
        if (!by || slot) return { slot, kind: 'pc', days };
        if (part) return { slot: part, kind: 'part day', days };
        return { slot: asap, kind: 'asap', days }; };
      // What's loaded, in one short call.
      window._ecHelp = () => ({ ver: window._afVer, ready: !!window._afReady, page: (location.pathname.split('/').slice(-2).join('/')).slice(0, 60), helpers: Object.keys(window).filter(k => /^_(taskSearch|goTask|task|addNote|calIndex|booked|goHeader|addSiteInfo|siCheck|goSched|schedule|schedCheck|moveOpen|moveFill|moveCheck|pcSlot)$/.test(k)) });
      window._afReady = true;
      return 'ready';
    };
    window._afVer = VER;
    // Same as before: after any page load, await eval(sessionStorage.getItem('_afSetup')) brings them back. Not needed with this script on.
    sessionStorage.setItem('_afSetup', '(' + AF.toString() + ')()');
    AF().catch(e => { window._afErr = String(e && e.message || e); });
  }

  const code = '(' + pageMain.toString() + ')(' + JSON.stringify(VER) + ');';
  const page = typeof unsafeWindow != 'undefined' ? unsafeWindow : window;

  function inject() {
    try {
      const s = document.createElement('script');
      s.textContent = code;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (e) {}
    // If the page blocked the script tag, run it on the page another way
    if (page._afVer !== VER) {
      try { page.eval(code); } catch (e) { console.log('[EC page helpers] could not load: ' + e.message); }
    }
  }

  if (document.readyState === 'complete') inject();
  else window.addEventListener('load', inject, { once: true });
})();
