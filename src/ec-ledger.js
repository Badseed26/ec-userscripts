// ==UserScript==
// @name         EC Ledger
// @namespace    ec
// @version      0.1
// @description  A pretend bank account on the AroFlo home page: invoices in, supplier accounts, pays, tax and estimated running costs out, replayed from the start date every run. Read only on AroFlo, Tradezone and CNW. Names and pay figures stay on this device.
// @match        https://office.aroflo.com/ims/Site/Home/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @connect      www.tradezone.com.au
// @connect      shop.cnw.com.au
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Badseed26/ec-userscripts/main/ec-ledger.user.js
// @downloadURL  https://raw.githubusercontent.com/Badseed26/ec-userscripts/main/ec-ledger.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;

  // What it does (20/11): everything is read only, nothing is saved or changed on AroFlo, Tradezone or CNW.
  // Every run reads the lot again from the quarter before the start date, then replays it into a statement:
  //   in:  invoices (inc GST) on their payment terms, STC money 2 days after the job
  //   out: Tradezone and CNW accounts 30 days end of month, other suppliers off AroFlo's purchase orders on the day,
  //        pays every Wednesday for the Wednesday to Tuesday before, super with each pay, held tax and GST on the ATO's dates,
  //        and the running costs nobody can see from here as estimates.
  // Each line is tagged data (read off a system), set (your pay settings) or est (a guess), so the guesses can be switched off.
  // No names or pay figures live in this file: they are typed in under Settings and kept in this device's Tampermonkey only.

  // ===== ENGINE START (pure maths: no page, no storage. tools/ec_ledger_test.js runs this part in Node) =====
  const ENGINE = (() => {
    const DAY = 864e5;
    const p2 = n => String(n).padStart(2, '0');
    const toD = s => { const a = String(s).split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1, a[2])); };
    const iso = d => d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
    const add = (s, n) => iso(new Date(toD(s).getTime() + n * DAY));
    const dow = s => toD(s).getUTCDay(); // 0 Sun to 6 Sat
    const isWe = s => { const w = dow(s); return w == 0 || w == 6; };
    const nextBiz = s => { while (isWe(s)) s = add(s, 1); return s; };
    const prevBiz = s => { while (isWe(s)) s = add(s, -1); return s; };
    const eom = ym => iso(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)));
    const addMonth = (ym, n) => { let y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + p2(m + 1); };
    const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const mName = ym => MN[+ym.slice(5, 7) - 1];
    const dShort = s => +s.slice(8) + '/' + +s.slice(5, 7);
    const r2 = n => Math.round(n * 100) / 100;
    const dead = st => /void|cancel|delet/i.test(st || '');
    const draft = st => /in_progress|pending/i.test(st || ''); // an invoice still being written or waiting on approval hasn't gone out

    // Queensland wide public holidays. Show day and anything local goes in Settings (extra days off).
    const HOLS = ['2026-01-01', '2026-01-26', '2026-04-03', '2026-04-04', '2026-04-05', '2026-04-06', '2026-04-25', '2026-05-04', '2026-10-05', '2026-12-25', '2026-12-26', '2026-12-28',
      '2027-01-01', '2027-01-26', '2027-03-26', '2027-03-27', '2027-03-28', '2027-03-29', '2027-04-25', '2027-04-26', '2027-05-03', '2027-10-04', '2027-12-25', '2027-12-26', '2027-12-27', '2027-12-28'];

    // The ATO's weekly withholding formula for someone claiming the tax free threshold (scale 2, payments from 1 July 2026):
    // y = a * x - b, where x is the week's pay with cents dropped plus 99 cents. [earnings under, a, b]
    const SCALE2 = [[362, 0, 0], [538, 0.15, 54.3462], [673, 0.25, 108.2135], [721, 0.17, 54.3473], [865, 0.179, 60.8377], [1282, 0.3227, 185.1935], [2596, 0.32, 181.7319], [3653, 0.39, 363.4627], [Infinity, 0.47, 655.7704]];
    const withhold = gross => { const x = Math.floor(gross) + 0.99, row = SCALE2.find(r => x < r[0]); return Math.max(0, Math.round(row[1] * x - row[2])); };

    // The start of the financial year today sits in, and what a fresh install starts with. The estimates are guesses to edit.
    const fyStart = today => (+today.slice(5, 7) >= 7 ? +today.slice(0, 4) : +today.slice(0, 4) - 1) + '-07-01';
    const DEFAULTS = today => ({
      v: 1, start: fyStart(today), open: 0, terms: 14, clientTerms: [], superRate: 12, stcDelay: 2, horizon: 42,
      people: [], // { name, type: 'hourly' or 'salary', rate (an hour) or weekly (a week), from, to }
      ownSup: 'trade\\s?zone|cnw', // suppliers read off their own account pages, so their AroFlo purchase orders are left out
      estimates: [
        { name: 'Ute finance', kind: 'fixed', amt: 1420, per: 'month', gst: false },
        { name: 'Van finance (2 vans)', kind: 'fixed', amt: 2350, per: 'month', gst: false },
        { name: 'Fuel', kind: 'fuel', veh: 3, km: 700, l100: 10, price: 2.65, gst: true },
        { name: 'Rego and CTP (3 vehicles)', kind: 'fixed', amt: 2640, per: 'year', gst: false },
        { name: 'Vehicle insurance (3 vehicles)', kind: 'fixed', amt: 7500, per: 'year', gst: true },
        { name: 'Servicing and tyres (3 vehicles)', kind: 'fixed', amt: 6000, per: 'year', gst: true },
        { name: 'Workers comp', kind: 'pct', pct: 1.727, gst: true },
        { name: 'Public liability', kind: 'fixed', amt: 2000, per: 'year', gst: true },
        { name: 'Job software', kind: 'fixed', amt: 400, per: 'month', gst: true },
        { name: 'Accounts software, phones, accountant', kind: 'fixed', amt: 1000, per: 'month', gst: true },
      ],
      extraHols: [], stc: {}, // stc: { jobNumber: { amt } or { none: true } }, typed in for solar jobs with no STC line in AroFlo
    });

    // hours by person and day, off the timesheet lines ({ who, s, e } with s and e as local 'YYYY-MM-DDTHH:MM:SS')
    function hoursByDay(times) {
      const o = {};
      (times || []).forEach(t => {
        const h = (Date.parse(String(t.e).slice(0, 19) + 'Z') - Date.parse(String(t.s).slice(0, 19) + 'Z')) / 36e5;
        if (!(h > 0) || h > 24) return;
        const d = String(t.s).slice(0, 10), p = o[t.who] = o[t.who] || {};
        p[d] = (p[d] || 0) + h;
      });
      return o;
    }

    // One person's pay for the week starting Wednesday ws. Hourly: 7.6 hours a weekday guaranteed (leave, public holidays and
    // short days get paid anyway), weekday hours up to 8 at the plain rate, then the award's overtime: time and a half for the
    // first 2 hours and double after, Saturday the same from the first hour, Sunday double, public holidays double time and a
    // half, with 4 hours the least paid for any weekend or public holiday worked. Travel is in the hours like any other time.
    function payWeek(p, ws, H, hols, superRate) {
      let ord = 0, otEq = 0, cred = 0, logged = 0, wd = 0;
      for (let i = 0; i < 7; i++) {
        const d = add(ws, i); if ((p.from && d < p.from) || (p.to && d > p.to)) continue;
        const w = dow(d), we = w == 0 || w == 6, h = (H && H[d]) || 0, ph = hols.has(d);
        logged += h; if (!we) wd++;
        if (ph) { if (h > 0) otEq += Math.max(h, 4) * 2.5; if (!we) { if (h > 0) cred += 7.6; else ord += 7.6; } }
        else if (w == 6) { if (h > 0) { const x = Math.max(h, 4); otEq += Math.min(x, 2) * 1.5 + Math.max(x - 2, 0) * 2; } }
        else if (w == 0) { if (h > 0) otEq += Math.max(h, 4) * 2; }
        else { ord += Math.min(h, 8); const ot = Math.max(h - 8, 0); otEq += Math.min(ot, 2) * 1.5 + Math.max(ot - 2, 0) * 2; }
      }
      const out = { who: p.name, ws, pay: add(ws, 7), logged: r2(logged), ord: 0, top: 0, ot: 0, gross: 0, tax: 0, net: 0, sup: 0 };
      if (!wd) return out;
      let base;
      if (p.type == 'salary') { out.gross = base = r2((+p.weekly || 0) * wd / 5); }
      else {
        const top = Math.max(0, 7.6 * wd - ord - cred), rate = +p.rate || 0;
        out.ord = r2(ord + top); out.top = r2(top); out.ot = r2(otEq);
        base = rate * (ord + top); out.gross = r2(base + rate * otEq);
      }
      out.tax = Math.min(withhold(out.gross), out.gross); out.net = r2(out.gross - out.tax); out.sup = r2(base * superRate / 100);
      return out;
    }

    // data = { from, invoices, pos, times, sup, stc }, set = the saved settings, today = 'YYYY-MM-DD'
    function run(data, set, today) {
      const S = Object.assign(DEFAULTS(today), set || {});
      const hols = new Set(HOLS.concat(S.extraHols || []));
      const from = data.from || add(S.start, -7), end = add(today, +S.horizon || 0);
      const tx = [];
      const push = (d, amt, tag, kind, label, extra) => { if (!d || !amt || !isFinite(amt)) return; tx.push(Object.assign({ d, amt: r2(amt), tag, kind, label }, extra || {})); };
      // GST by calendar quarter, counted when the money moves. Kept apart for data and estimates so each can stand alone.
      const gst = { data: {}, est: {} };
      const addGst = (b, d, g) => { const k = d.slice(0, 4) + '-Q' + Math.ceil(+d.slice(5, 7) / 3); gst[b][k] = (gst[b][k] || 0) + g; };

      // ---- money in: invoices, on the builder's terms, landing on a weekday ----
      const termFor = cl => { const c = (S.clientTerms || []).find(t => t && t.match && String(cl || '').toLowerCase().includes(String(t.match).toLowerCase())); return c ? +c.days || 0 : +S.terms || 0; };
      const jobs = {}, status = {}, drafts = { n: 0, inc: 0 };
      (data.invoices || []).forEach(i => {
        status[i.st || '?'] = (status[i.st || '?'] || 0) + 1;
        if (dead(i.st)) return;
        const ex = +i.ex || 0, inc = +i.inc || ex * 1.1; if (!inc) return;
        if (draft(i.st)) { drafts.n++; drafts.inc = r2(drafts.inc + inc); return; }
        const d = nextBiz(add(i.d, termFor(i.cl)));
        push(d, inc, 'data', 'inv', 'Invoice ' + i.n + (i.cl ? ', ' + i.cl : ''), { ref: i.jn || '', sub: i.tn || '' });
        addGst('data', d, inc - (ex || inc / 1.1));
        if (i.jn) { const j = jobs[i.jn] = jobs[i.jn] || { jn: i.jn, name: i.tn || '', text: '', first: i.d, last: i.d, inc: 0 }; j.inc = r2(j.inc + inc); j.text += ' ' + (i.tn || '') + ' ' + (i.desc || ''); if (i.d < j.first) j.first = i.d; if (i.d > j.last) j.last = i.d; }
      });

      // ---- STC money: 2 days after the last day on the job. From AroFlo's STC line, or the figure typed in for that job ----
      const lastOn = {};
      (data.times || []).forEach(t => { if (!t.jn) return; const d = String(t.s).slice(0, 10); (lastOn[t.jn] = lastOn[t.jn] || []).push(d); });
      const solar = [];
      Object.values(jobs).forEach(j => {
        const line = (data.stc || {})[j.jn], mine = (S.stc || {})[j.jn];
        if (!line && !mine && !/solar|\bpv\b|inverter|\bstcs?\b/i.test(j.text)) return;
        const days = (lastOn[j.jn] || []).filter(d => d <= add(j.last, 3)).sort(), jobDay = days.length ? days[days.length - 1] : j.first;
        const how = mine ? (mine.none ? 'none' : 'set') : line ? 'line' : 'need';
        const amt = how == 'set' ? Math.abs(+mine.amt || 0) : how == 'line' ? Math.abs(+line.amt || 0) : 0, d = add(jobDay, +S.stcDelay || 0);
        solar.push({ jn: j.jn, name: j.name, how, amt, d, jobDay, inc: j.inc });
        push(d, amt, how == 'set' ? 'set' : 'data', 'stc', 'STCs, job ' + j.jn, { ref: j.jn, sub: j.name });
      });

      // ---- supplier accounts: a month's orders are paid on the last weekday of the next month ----
      const supM = {};
      (data.sup || []).forEach(o => { const inc = +o.inc || 0; if (!inc || !o.d) return; const ym = o.d.slice(0, 7), k = o.sup + '|' + ym, m = supM[k] = supM[k] || { sup: o.sup, ym, inc: 0, n: 0 }; m.inc += inc; m.n++; });
      Object.values(supM).forEach(m => { const d = prevBiz(eom(addMonth(m.ym, 1))); push(d, -m.inc, 'data', 'sup', m.sup + ' account, ' + mName(m.ym) + ' (' + m.n + ' orders)'); addGst('data', d, -m.inc / 11); });

      // ---- other suppliers: AroFlo's purchase orders, paid on the day, GST added ----
      let own; try { own = new RegExp(S.ownSup || 'trade\\s?zone|cnw', 'i'); } catch (e) { own = /trade\s?zone|cnw/i; }
      (data.pos || []).forEach(o => { const ex = +o.ex || 0; if (!ex || !o.d || dead(o.st) || own.test(o.sup || '')) return; push(o.d, -ex * 1.1, 'data', 'po', (o.sup || 'Supplier') + (o.no ? ', PO ' + o.no : ''), { ref: o.jn || '' }); addGst('data', o.d, -ex * 0.1); });

      // ---- pays: every Wednesday for the Wednesday to Tuesday before it, super the same day ----
      const H = hoursByDay(data.times), people = (S.people || []).filter(p => p && p.name);
      const wageWeeks = [], held = {}, grossM = {};
      let ws = from; while (dow(ws) != 3) ws = add(ws, 1);
      for (; add(ws, 7) <= end; ws = add(ws, 7)) {
        const pd = add(ws, 7);
        people.forEach(p => {
          const w = payWeek(p, ws, H[p.name], hols, +S.superRate || 0); if (!w.gross) return;
          w.type = p.type; w.short = p.type != 'salary' && w.top > 0.05 && add(ws, 6) < today; wageWeeks.push(w);
          push(pd, -w.net, 'set', 'wage', 'Pay, ' + p.name, { who: p.name, sub: 'week to ' + dShort(add(ws, 6)) });
          push(pd, -w.sup, 'set', 'super', 'Super, ' + p.name, { who: p.name });
          const ym = pd.slice(0, 7); held[ym] = (held[ym] || 0) + w.tax; grossM[ym] = (grossM[ym] || 0) + w.gross;
        });
      }
      // tax held from pays: to the ATO by the 21st of the next month, or with the BAS on the 28th for the last month of a quarter
      Object.keys(held).forEach(ym => { const m = +ym.slice(5, 7), q = m % 3 == 0; push(nextBiz(addMonth(ym, m == 12 ? 2 : 1) + (q ? '-28' : '-21')), -held[ym], 'set', 'payg', 'Tax held from ' + mName(ym) + ' pays, to the ATO'); });

      // ---- the running costs nobody can see from here: estimates ----
      const months = []; for (let ym = from.slice(0, 7); ym <= end.slice(0, 7); ym = addMonth(ym, 1)) months.push(ym);
      (S.estimates || []).forEach(e => {
        if (!e || e.off) return;
        const one = (d, a) => { push(d, -a, 'est', 'est', e.name || 'Estimate'); if (e.gst) addGst('est', d, -a / 11); };
        if (e.kind == 'pct') return months.forEach(ym => { if (grossM[ym]) one(prevBiz(eom(ym)), grossM[ym] * (+e.pct || 0) / 100 * (e.gst ? 1.1 : 1)); });
        const fuel = e.kind == 'fuel', amt = fuel ? (+e.veh || 0) * (+e.km || 0) * (+e.l100 || 0) / 100 * (+e.price || 0) : +e.amt || 0, per = fuel ? 'week' : e.per;
        if (!amt) return;
        if (per == 'week') { let d = from; while (dow(d) != 5) d = add(d, 1); for (; d <= end; d = add(d, 7)) one(d, amt); }
        else months.forEach(ym => one(nextBiz(ym + '-' + (per == 'year' ? '01' : p2(Math.min(Math.max(+e.dom || 15, 1), 28)))), per == 'year' ? amt / 12 : amt)); // a yearly bill is spread over the months
      });

      // ---- GST: each quarter's lot is paid with the BAS (28 April, July and October, and 28 February for October to December) ----
      [...new Set(Object.keys(gst.data).concat(Object.keys(gst.est)))].forEach(k => {
        const y = +k.slice(0, 4), q = +k.slice(6), due = nextBiz(q == 4 ? (y + 1) + '-02-28' : y + '-' + ['04', '07', '10'][q - 1] + '-28'), nm = ['January to March', 'April to June', 'July to September', 'October to December'][q - 1];
        push(due, -(gst.data[k] || 0), 'data', 'gst', 'GST, ' + nm + ' (invoices less supplier bills)');
        push(due, -(gst.est[k] || 0), 'est', 'gst', 'GST back on the estimates, ' + nm);
      });

      // ATO bills already building that land after the window ends (the current quarter's GST and the latest held tax)
      const atoLater = r2(tx.filter(t => (t.kind == 'gst' || t.kind == 'payg') && t.d > end).reduce((a, t) => a - t.amt, 0));
      const out = tx.filter(t => t.d >= S.start && t.d <= end).sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : b.amt - a.amt);
      out.forEach(t => { t.proj = t.d > today; });
      // hours logged by anyone not on the pay list, so they can be added if wanted
      const names = new Set(people.map(p => p.name)), others = {};
      Object.keys(H).forEach(n => { if (names.has(n)) return; const h = Object.keys(H[n]).filter(d => d >= S.start).reduce((a, d) => a + H[n][d], 0); if (h > 0) others[n] = r2(h); });
      return { set: S, today, end, from, tx: out, wageWeeks: wageWeeks.filter(w => w.pay >= S.start && w.pay <= end), solar: solar.sort((a, b) => (a.how == 'need') != (b.how == 'need') ? (a.how == 'need' ? -1 : 1) : a.how == 'need' ? b.inc - a.inc : a.d < b.d ? 1 : -1), others, atoLater, status, drafts };
    }

    // The running balance and headline numbers for a set of lines: all of them, or only the ones a filter keeps.
    function tally(res, keep) {
      let bal = +res.set.open || 0, now = bal, inn = 0, out = 0, low = { d: res.set.start, bal };
      const kinds = {}, weeks = {};
      const rows = res.tx.filter(keep || (() => true)).map(t => {
        bal = r2(bal + t.amt);
        if (!t.proj) { now = bal; if (t.amt > 0) inn += t.amt; else out -= t.amt; if (bal < low.bal) low = { d: t.d, bal }; kinds[t.kind] = r2((kinds[t.kind] || 0) + t.amt); }
        const mon = add(t.d, -((dow(t.d) + 6) % 7)), w = weeks[mon] = weeks[mon] || { ws: mon, in: 0, out: 0, bal: 0, proj: t.proj };
        if (t.amt > 0) w.in = r2(w.in + t.amt); else w.out = r2(w.out - t.amt); w.bal = bal;
        return Object.assign({}, t, { bal });
      });
      return { rows, now: r2(now), in: r2(inn), out: r2(out), low, end: bal, kinds, weeks: Object.values(weeks).sort((a, b) => a.ws < b.ws ? -1 : 1) };
    }

    return { run, tally, payWeek, withhold, hoursByDay, DEFAULTS, HOLS, add, dow, nextBiz, prevBiz, eom, addMonth, fyStart, mName, dShort, r2 };
  })();
  // ===== ENGINE END =====

  // ---------- small helpers ----------
  const E = ENGINE;
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const p2 = n => String(n).padStart(2, '0');
  const num = s => parseFloat(String(s).replace(/[^0-9.\-]/g, '')) || 0;
  const todayIso = () => { try { return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Brisbane' }); } catch (e) { const d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); } };
  // an AroFlo timestamp as the Brisbane day
  const bne = s => { if (!s) return ''; const d = new Date(s); if (isNaN(d)) return String(s).slice(0, 10); try { return d.toLocaleDateString('en-CA', { timeZone: 'Australia/Brisbane' }); } catch (e) { return String(s).slice(0, 10); } };
  const $0 = n => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-AU');
  const $2 = n => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dNice = s => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][E.dow(s)] + ' ' + E.dShort(s);
  const doc = t => new DOMParser().parseFromString(t || '', 'text/html');
  // first date in a bit of text as YYYY-MM-DD: day first the Aussie way, or month first for CNW
  function parseDate(t, mdy) {
    const m = String(t || '').match(/(?:^|\D)(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/); if (!m) return '';
    const dd = mdy ? m[2] : m[1], mm = mdy ? m[1] : m[2];
    return +mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31 ? (m[3].length == 2 ? '20' + m[3] : m[3]) + '-' + p2(mm) + '-' + p2(dd) : '';
  }
  function gm(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({ method: 'GET', url, timeout: 30000, headers: { Accept: 'text/html' }, onload: resolve,
        onerror: () => reject(new Error('couldn\'t reach ' + new URL(url).host)), ontimeout: () => reject(new Error(new URL(url).host + ' took too long')) });
    });
  }
  // AroFlo off the page's own sign in
  async function af(path) {
    const r = await fetch(path, { credentials: 'include', headers: { accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } }), t = await r.text();
    try { return JSON.parse(t); } catch (e) { throw new Error('AroFlo wouldn\'t answer ' + path.split('?')[0] + ' (' + r.status + ')'); }
  }
  async function afText(path) { const r = await fetch(path, { credentials: 'include' }); if (r.status != 200) throw new Error('came back ' + r.status); return r.text(); }
  // run jobs a few at a time
  async function pool(list, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const x = list[i++]; try { await fn(x); } catch (e) { x.err = e.message; } } })); }
  const SOLAR = /solar|\bpv\b|inverter|\bstcs?\b/i;

  // ---------- AroFlo: invoices, purchase orders, timesheets and the STC lines on solar jobs. All read only. ----------
  async function readAroflo(from, today, say) {
    const out = { invoices: [], pos: [], times: [], stc: {}, warn: [] };
    say('AroFlo: finding the invoice feed…');
    const bu = await af('/cf-api/businessunits/'), buId = bu && bu.items && bu.items[0] && bu.items[0].id;
    if (!buId) throw new Error('couldn\'t read the business unit from AroFlo');
    // invoices: the same feed the month pull reads, newest end first, stopping two pages after it runs past the start
    const feed = page => af('/cf-api/internal/invoices?' + new URLSearchParams({ businessUnitId: buId, zoneName: 'BU', allStatus: '1', userBuAccessType: 'thisbu', limit: '100', page: String(page) }));
    const first = await feed(1), items1 = first.items || [], count = Math.min((first.page && first.page.count) || 1, 400);
    const dOf = i => bne(i.invoicedDateTime || i.invoiceDate || i.createdDateTime || '');
    const d1 = items1.map(dOf).filter(Boolean);
    let desc = true;
    if (d1.length > 1 && d1[0] != d1[d1.length - 1]) desc = d1[0] > d1[d1.length - 1];
    else if (count > 1) { const lp = await feed(count), dl = (lp.items || []).map(dOf).filter(Boolean); if (dl.length && d1.length) desc = d1[0] >= dl[dl.length - 1]; }
    const order = Array.from({ length: count }, (_, k) => desc ? k + 1 : count - k);
    let older = 0, seen = 0;
    for (const pg of order) {
      if (seen >= 250) { out.warn.push('Invoices: stopped at 250 pages'); break; }
      const j = pg == 1 ? first : await feed(pg), items = j.items || []; seen++;
      say('AroFlo: invoices, page ' + seen + '…');
      let any = false, newest = '';
      items.forEach(i => {
        const d = dOf(i); if (d > newest) newest = d;
        if (!d || d < from) return;
        any = true; const t = i.task || {};
        out.invoices.push({ n: String(i.invoiceNumber || ''), d, st: i.status || '', ex: +(i.totalAmountEx || 0), inc: +(i.totalAmountInc || 0), tid: t.id || i.taskId || '', jn: String(t.jobNumber || ''), tn: clean(t.name || '').slice(0, 90), cl: clean((i.client && i.client.name) || i.clientName || '').slice(0, 60),
          desc: clean(String(i.description || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')).slice(0, 160) });
      });
      if (!any && newest && newest < from) { if (++older >= 2) break; } else older = 0;
      if (!items.length) break;
    }
    // purchase orders: every page, kept from the start on
    try {
      const poPage = n => af('/cf-api/purchaseorders?limit=100&page=' + n), p1 = await poPage(1), pc = Math.min((p1.page && p1.page.count) || 1, 80);
      for (let n = 1; n <= pc; n++) {
        say('AroFlo: purchase orders, page ' + n + ' of ' + pc + '…');
        const j = n == 1 ? p1 : await poPage(n);
        (j.items || []).forEach(o => { const d = String(o.purchaseDate || o.timestampCreated || '').slice(0, 10); if (!d || d < from) return; out.pos.push({ no: String(o.referenceNumber || o.orderNumber || ''), d, sup: clean(o.supplierName || '').slice(0, 50), jn: String(o.jobNumber || ''), ex: +(o.totalAmountEx || 0), st: o.status || '' }); });
        if (!(j.items || []).length) break;
      }
    } catch (e) { out.warn.push('Purchase orders: ' + e.message); }
    // timesheets: the calendar's own feed hands them over when asked, job time and office time, a month a read.
    // The ask to show timesheets only rides on these reads, the saved calendar view isn't touched.
    try {
      say('AroFlo: timesheets…');
      const box = doc(await afText('/ims/Site/Calendar/index.cfm?viewfullcalendar=1&tid=IMS.CAL')).getElementById('calBoxContainer'), master = box && box.getAttribute('data-master-user-id');
      const vw = await af('/ims/Site/Calendar/AJAX/AJAX_JSON_get_calendar_view.cfm?view_id=0'), vs = vw && vw.view && vw.view.settings;
      if (!master || !vs || !vs.settings) throw new Error('calendar settings not found');
      const now = new Date();
      const js = Object.assign({}, vs.settings, { resources: vs.resources, filters: vs.filters, externalcalendars: vs.externalcalendars, returntype: 'json', showtasktimesheets: 1, showoverheads: 1, curcalyear: now.getFullYear(), curcalmonth: now.getMonth(), curcalday: now.getDate() });
      for (let ym = from.slice(0, 7); ym <= today.slice(0, 7); ym = E.addMonth(ym, 1)) {
        say('AroFlo: timesheets, ' + E.mName(ym) + '…');
        const days = []; for (let d = ym + '-01'; d.slice(0, 7) == ym; d = E.add(d, 1)) if (d >= from && d <= today) days.push(Date.parse(d + 'T00:00:00Z') / 1000); // AroFlo's days are UTC midnight
        if (!days.length) continue;
        const q = new URLSearchParams(); q.set('jsonSettings', JSON.stringify(js)); q.set('masterusercoded', master); q.set('range', days.join(','));
        ['task', 'overhead', 'event', 'externalevent'].forEach(t => q.set('eventtypes_' + t, '1'));
        const r = await fetch('/ims/Site/Calendar/AJAX/AJAX_JSON_ims_events.cfm', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, body: q.toString() });
        let evs = null; try { evs = JSON.parse(await r.text()); } catch (e) {}
        if (!Array.isArray(evs)) { out.warn.push('Timesheets for ' + E.mName(ym) + ' didn\'t come back'); continue; }
        evs.forEach(e => {
          const hd = (e.headers || []).map(h => clean(h && h.headerText)).filter(Boolean), job = e.type == 'tasktimesheet', office = e.type == 'overhead' && /timesheet/i.test(hd.join(' '));
          if ((!job && !office) || !e.resourcename || !e.start || !e.end) return;
          out.times.push({ who: clean(e.resourcename), s: String(e.start).slice(0, 19), e: String(e.end).slice(0, 19), jn: job ? (hd.find(x => /^\d{3,6}$/.test(x)) || '') : '' });
        });
      }
    } catch (e) { out.warn.push('Timesheets: ' + e.message); }
    // STC lines: only jobs that look like solar get their costing sheet opened, for an STC line under Expense
    const sol = {}; out.invoices.forEach(i => { if (!/void|cancel|delet/i.test(i.st) && i.tid && i.jn && SOLAR.test(i.tn + ' ' + i.desc)) sol[i.jn] = i.tid; });
    const list = Object.keys(sol).map(jn => ({ jn, tid: sol[jn] })); let done = 0;
    await pool(list, 4, async x => {
      const j = await af('/cf-api/tasks/' + x.tid), cm = String((j._links && (j._links.office || j._links.field)) || '').match(/wrCoded=([^&"']+)/i);
      if (cm) {
        const sheet = doc(await afText('/ims/Site/Resource/Jobsheet/AJAX/view_jobsheet.cfm?wrCoded=' + encodeURIComponent(decodeURIComponent(cm[1]))));
        let part = '', amt = 0, n = 0;
        sheet.querySelectorAll('tr').forEach(tr => {
          const c = [...tr.children].filter(td => /^(TD|TH)$/.test(td.tagName)).map(td => clean(td.textContent)).filter(Boolean);
          if (c.length == 1 && /^(Labour|Material|Expense)$/.test(c[0])) { part = c[0]; return; }
          if (part != 'Expense' || c.length < 7 || !/\bstcs?\b/i.test(c.join(' '))) return;
          const v = num(c[c.length - 4]); if (v) { amt += v; n++; } // the cost column, same spot the job report reads
        });
        if (n) out.stc[x.jn] = { amt: E.r2(amt) };
      }
      say('AroFlo: solar jobs, ' + (++done) + ' of ' + list.length + '…');
    });
    const bad = list.filter(x => x.err).length; if (bad) out.warn.push(bad + ' solar job' + (bad > 1 ? 's' : '') + ' couldn\'t be opened for an STC line');
    return out;
  }

  // ---------- Tradezone and CNW: the order list off My Account, newest first, each order's date and total (inc GST, as listed) ----------
  const SUPS = [
    { name: 'Tradezone', base: 'https://www.tradezone.com.au', first: 1, path: p => '/sales/order/history/?limit=50&p=' + p, out: r => /customer\/account\/login/.test((r && r.finalUrl) || '') },
    { name: 'CNW', base: 'https://shop.cnw.com.au', first: 0, path: p => '/my-account/orders?page=' + p, mdy: true, // CNW writes dates month first and counts pages from 0
      out: r => /\/login\b/.test((r && r.finalUrl) || '') || /<body[^>]*class="[^"]*\blogged-out\b/i.test((r && r.responseText) || '') },
  ];
  async function readSupplier(S, from, say) {
    const orders = [], seen = new Set(); let prev = '', oldest = '9';
    for (let p = S.first, pages = 1; pages <= 60; p++, pages++) {
      say(S.name + ': orders, page ' + pages + '…');
      const r = await gm(S.base + S.path(p));
      if (S.out(r)) throw new Error(S.name + ' is signed out. Open ' + new URL(S.base).host + ' in this browser, sign in, then hit Refresh');
      if (r.status >= 400) throw new Error(S.name + ' came back ' + r.status);
      const rows = [...doc(r.responseText).querySelectorAll('table tr')].map(tr => [...tr.children].filter(x => x.tagName == 'TD').map(td => clean(td.textContent))).filter(c => c.length >= 3);
      const key = rows.map(c => c.join('|')).join('\n');
      if (!rows.length || key == prev) break; // an empty page, or the same page again, is the end of the list
      prev = key; let got = 0;
      rows.forEach(c => {
        const line = c.join(' | '), d = parseDate(line, S.mdy), m = line.match(/\$\s?-?[\d,]+\.\d{2}/g);
        if (!d || !m) return;
        got++; if (d < oldest) oldest = d;
        if (d < from || seen.has(line) || /cancel/i.test(line)) return;
        seen.add(line); orders.push({ sup: S.name, d, inc: num(m[m.length - 1]), ref: c[0].slice(0, 30) });
      });
      if (!got || oldest < from) break;
    }
    return orders;
  }

  // ---------- one full read. Goes back to the quarter before the start date, since that quarter's supplier accounts,
  // held tax and GST all leave the bank after the start. ----------
  async function readAll(set, say) {
    const today = todayIso(), S = Object.assign(E.DEFAULTS(today), set || {});
    const qm = Math.floor((+S.start.slice(5, 7) - 1) / 3) * 3 + 1, from = E.addMonth(S.start.slice(0, 4) + '-' + p2(qm), -3) + '-01';
    const A = await readAroflo(from, today, say);
    const data = { v: 1, from, start: S.start, at: Date.now(), invoices: A.invoices, pos: A.pos, times: A.times, stc: A.stc, sup: [], warn: A.warn.slice() };
    for (const sp of SUPS) { try { data.sup.push(...await readSupplier(sp, from, say)); } catch (e) { data.warn.push(e.message); } }
    return data;
  }

  // ---------- what's kept on this device: the settings (names and pay figures included) and the last read ----------
  const SETKEY = 'ecLedgerSet', DATAKEY = 'ecLedgerData';
  let set = Object.assign(E.DEFAULTS(todayIso()), GM_getValue(SETKEY, null) || {}), data = GM_getValue(DATAKEY, null), res = null;
  let tab = 'over', hard = false, more = 150, busy = false, box, note = '';
  const saveSet = () => { try { GM_setValue(SETKEY, set); } catch (e) {} };
  const calc = () => { res = data ? E.run(data, set, todayIso()) : null; };
  const encode = o => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
  const decode = s => JSON.parse(decodeURIComponent(escape(atob(String(s).replace(/\s+/g, '')))));

  // ---------- the window ----------
  const css = `
#ec-lg-btn{position:fixed;right:118px;bottom:12px;z-index:99998;background:#0f766e;color:#fff;border:0;border-radius:18px;padding:8px 14px;font:600 13px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);cursor:pointer}
#ec-lg{position:fixed;inset:0;z-index:99999;background:#f8fafc;color:#0f172a;font:14px/1.35 system-ui,sans-serif;display:none;flex-direction:column}
@media(min-width:840px){#ec-lg{inset:12px 12px 12px auto;width:800px;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.4);overflow:hidden}}
#ec-lg *{box-sizing:border-box}
#ec-lg .hd{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#0f172a;color:#fff}
#ec-lg .hd b{font-size:15px;flex:1}
#ec-lg .hd button{border:0;border-radius:6px;padding:7px 11px;font:600 13px system-ui,sans-serif;cursor:pointer;background:#0d9488;color:#fff}
#ec-lg .hd button.x{background:none;font-size:22px;line-height:1;padding:0 4px}
#ec-lg .hd button:disabled{opacity:.5}
#ec-lg .tabs{display:flex;background:#1e293b}
#ec-lg .tabs button{flex:1;border:0;background:none;color:#94a3b8;padding:9px 4px;font:600 13px system-ui,sans-serif;cursor:pointer;border-bottom:3px solid transparent}
#ec-lg .tabs button.on{color:#fff;border-bottom-color:#2dd4bf}
#ec-lg .msg{padding:6px 12px;font-size:12.5px;color:#475569;background:#e2e8f0;min-height:28px}
#ec-lg .bd{flex:1;overflow:auto;padding:12px;-webkit-overflow-scrolling:touch}
#ec-lg .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px}
#ec-lg .tile{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px}
#ec-lg .tile .v{font:700 20px system-ui,sans-serif}
#ec-lg .tile .l{font-size:12px;color:#64748b}
#ec-lg .neg{color:#b91c1c}#ec-lg .pos{color:#047857}
#ec-lg .card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px;margin-bottom:12px}
#ec-lg h4{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#475569}
#ec-lg .row{display:flex;gap:8px;align-items:baseline;padding:6px 0;border-top:1px solid #f1f5f9}
#ec-lg .row:first-of-type{border-top:0}
#ec-lg .row .d{width:62px;flex:none;color:#64748b;font-size:12.5px}
#ec-lg .row .t{flex:1;min-width:0}
#ec-lg .row .t small{display:block;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#ec-lg .row .a{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
#ec-lg .row .a small{display:block;color:#94a3b8}
#ec-lg .row.proj{opacity:.6}
#ec-lg .chip{display:inline-block;font-size:10.5px;font-weight:700;border-radius:8px;padding:1px 6px;margin-left:4px;vertical-align:1px}
#ec-lg .chip.data{background:#dbeafe;color:#1e40af}#ec-lg .chip.set{background:#ede9fe;color:#5b21b6}#ec-lg .chip.est{background:#fef3c7;color:#92400e}
#ec-lg .warn{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:13px}
#ec-lg label.tg{display:flex;gap:6px;align-items:center;margin:0 0 12px;font-weight:600}
#ec-lg input,#ec-lg select,#ec-lg textarea{font:16px system-ui,sans-serif;padding:5px 6px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#0f172a;min-width:0}
#ec-lg input[type=checkbox]{width:18px;height:18px;padding:0}
#ec-lg .f{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:7px 0;border-top:1px solid #f1f5f9}
#ec-lg .f:first-of-type{border-top:0}
#ec-lg .f .g{flex:1 1 140px}#ec-lg .f .s{width:86px}#ec-lg .f .m{width:132px}
#ec-lg .f span{font-size:12.5px;color:#64748b}
#ec-lg .btn{border:0;border-radius:6px;padding:7px 10px;font:600 13px system-ui,sans-serif;cursor:pointer;background:#0f766e;color:#fff}
#ec-lg .btn.g2{background:#64748b}#ec-lg .btn.rm{background:none;color:#b91c1c;padding:4px 6px;font-size:18px;line-height:1}
#ec-lg textarea{width:100%;height:70px;font:11px ui-monospace,monospace}
#ec-lg svg{display:block;width:100%;height:auto}
#ec-lg .hint{font-size:12.5px;color:#64748b;margin:0 0 8px}`;

  const say = m => { note = m || ''; const el = box && box.querySelector('.msg'); if (el) el.textContent = note; };
  const amt = (n, f) => `<span class="${n < 0 ? 'neg' : 'pos'}">${(f || $2)(n)}</span>`;
  const TAG = { data: 'data', set: 'your pay', est: 'estimate' };
  const KIND = { inv: 'Invoices', stc: 'STCs', sup: 'Tradezone and CNW accounts', po: 'Other suppliers', wage: 'Pays', super: 'Super', payg: 'Tax held from pays', gst: 'GST', est: 'Estimated running costs' };

  // the balance over time as a stepped line, dashed once it's past today
  function chart(T) {
    if (!T.rows.length) return '';
    const W = 760, Hh = 190, L = 8, R = 8, Tp = 14, B = 20, t0 = Date.parse(res.set.start), t1 = Date.parse(res.end), td = Date.parse(res.today);
    const open = +res.set.open || 0, vals = T.rows.map(r => r.bal).concat([open, 0]), lo = Math.min(...vals), hi = Math.max(...vals), sp = hi - lo || 1;
    const X = t => L + (W - L - R) * (t - t0) / (t1 - t0 || 1), Y = v => Tp + (Hh - Tp - B) * (1 - (v - lo) / sp);
    let a = 'M' + X(t0).toFixed(1) + ' ' + Y(open).toFixed(1), b = '', last = open, split = false;
    T.rows.forEach(r => {
      const t = Date.parse(r.d);
      if (r.proj && !split) { split = true; a += 'H' + X(td).toFixed(1); b = 'M' + X(td).toFixed(1) + ' ' + Y(last).toFixed(1); }
      const seg = 'H' + X(t).toFixed(1) + 'V' + Y(r.bal).toFixed(1); if (split) b += seg; else a += seg; last = r.bal;
    });
    if (!split) a += 'H' + X(Math.min(td, t1)).toFixed(1); else b += 'H' + X(t1).toFixed(1);
    return `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Balance over time">
<line x1="${L}" x2="${W - R}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="#94a3b8" stroke-width="1"/>
<line x1="${X(td).toFixed(1)}" x2="${X(td).toFixed(1)}" y1="${Tp}" y2="${Hh - B}" stroke="#cbd5e1" stroke-dasharray="3 3"/>
<path d="${a}" fill="none" stroke="#0d9488" stroke-width="2"/>${b ? `<path d="${b}" fill="none" stroke="#0d9488" stroke-width="2" stroke-dasharray="5 4"/>` : ''}
<text x="${L}" y="11" font-size="11" fill="#64748b">high ${$0(hi)}, low ${$0(lo)}</text>
<text x="${L}" y="${Hh - 5}" font-size="11" fill="#64748b">${E.dShort(res.set.start)}</text><text x="${X(td).toFixed(1)}" y="${Hh - 5}" font-size="11" fill="#64748b" text-anchor="middle">today</text><text x="${W - R}" y="${Hh - 5}" font-size="11" fill="#64748b" text-anchor="end">${E.dShort(res.end)}</text></svg>`;
  }

  function vOver() {
    if (!res) return `<div class="card">Nothing read yet. Hit <b>Refresh</b> up top: it reads AroFlo, Tradezone and CNW (read only, nothing is changed) and takes a minute or two. Sign in to Tradezone and CNW in this browser first.</div>`;
    const T = E.tally(res, hard ? t => t.tag == 'data' : null), W = [];
    if (!(set.people || []).length) W.push('No one is on the pay list yet. Add people and their rates under Settings, they stay on this device.');
    const need = res.solar.filter(s => s.how == 'need').length;
    if (need) W.push(need + ' solar job' + (need > 1 ? 's have' : ' has') + ' no STC line in AroFlo, counted as $0 for now. Set the figures under Settings, Solar jobs.');
    const shortW = res.wageWeeks.filter(w => w.short).length;
    if (shortW) W.push(shortW + ' pay week' + (shortW > 1 ? 's' : '') + ' had less than the guaranteed hours logged, so those were paid at the guarantee (see Pays).');
    const oth = Object.keys(res.others);
    if (oth.length) W.push('Hours logged by people not on the pay list (not paid here): ' + oth.map(n => esc(n) + ' ' + Math.round(res.others[n]) + ' h').join(', ') + '.');
    if (res.drafts.n) W.push(res.drafts.n + ' invoice' + (res.drafts.n > 1 ? 's' : '') + ' still in progress or waiting on approval in AroFlo (' + $0(res.drafts.inc) + ') ' + (res.drafts.n > 1 ? 'are' : 'is') + ' not counted until approved.');
    (data.warn || []).forEach(w => W.push(esc(w)));
    if (data.start != set.start) W.push('The start date has changed since the last read. Hit Refresh to read again.');
    const kinds = Object.keys(KIND).filter(k => T.kinds[k]).map(k => `<div class="row"><div class="t">${KIND[k]}</div><div class="a">${amt(T.kinds[k], $0)}</div></div>`).join('');
    const at = new Date(data.at), sups = {}; (data.sup || []).forEach(o => { sups[o.sup] = (sups[o.sup] || 0) + 1; });
    return `<label class="tg"><input type="checkbox" data-act="hard" ${hard ? 'checked' : ''}> Hard data only (leave out my pay settings and the estimates)</label>
<div class="tiles">
<div class="tile"><div class="v ${T.now < 0 ? 'neg' : ''}">${$0(T.now)}</div><div class="l">Balance today</div></div>
<div class="tile"><div class="v">${$0(T.in)}</div><div class="l">In since ${E.dShort(res.set.start)}</div></div>
<div class="tile"><div class="v">${$0(T.out)}</div><div class="l">Out since ${E.dShort(res.set.start)}</div></div>
<div class="tile"><div class="v ${T.low.bal < 0 ? 'neg' : ''}">${$0(T.low.bal)}</div><div class="l">Lowest point, ${dNice(T.low.d)}</div></div>
<div class="tile"><div class="v ${T.end < 0 ? 'neg' : ''}">${$0(T.end)}</div><div class="l">Projected, ${dNice(res.end)}</div></div>
${hard ? '' : `<div class="tile"><div class="v">${$0(res.atoLater)}</div><div class="l">ATO bills building, due later</div></div>`}
</div>
${W.map(w => `<div class="warn">${w}</div>`).join('')}
<div class="card"><h4>Balance</h4>${chart(T)}</div>
<div class="card"><h4>Where it went, to today</h4>${kinds || 'No lines yet.'}</div>
<p class="hint">Read ${at.toLocaleDateString('en-AU')} ${at.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}: ${data.invoices.length} invoices, ${data.times.length} timesheet lines, ${data.pos.length} purchase orders${Object.keys(sups).map(k => ', ' + sups[k] + ' ' + k + ' orders').join('')}. Money is inc GST, the way a bank sees it. Every invoice is counted as paid on its terms.</p>`;
  }

  function vStatement() {
    if (!res) return vOver();
    const T = E.tally(res, hard ? t => t.tag == 'data' : null), rows = T.rows.slice().reverse();
    return `<label class="tg"><input type="checkbox" data-act="hard" ${hard ? 'checked' : ''}> Hard data only</label>
<div class="card">${rows.slice(0, more).map(r => `<div class="row${r.proj ? ' proj' : ''}"><div class="d">${dNice(r.d)}</div><div class="t">${esc(r.label)}<span class="chip ${r.tag}">${TAG[r.tag]}</span>${r.proj ? '<span class="chip" style="background:#e2e8f0;color:#475569">projected</span>' : ''}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</div><div class="a">${amt(r.amt)}<small>${$2(r.bal)}</small></div></div>`).join('') || 'No lines yet.'}</div>
${rows.length > more ? `<button class="btn g2" data-act="more">Show more (${rows.length - more} older)</button>` : ''}`;
  }

  function vPays() {
    if (!res) return vOver();
    if (!res.wageWeeks.length) return `<div class="card">No one is on the pay list yet. Add people under Settings.</div>`;
    const by = {}; res.wageWeeks.forEach(w => { (by[w.pay] = by[w.pay] || []).push(w); });
    const days = Object.keys(by).sort().reverse().slice(0, 30);
    const oth = Object.keys(res.others);
    return `<p class="hint">Payday is Wednesday for the Wednesday to Tuesday before. Hourly people are guaranteed 7.6 hours a weekday, travel counts as worked time, and overtime is anything over 8 hours on a weekday plus weekends and public holidays at the award rates.</p>
${days.map(pd => `<div class="card"><h4>${dNice(pd)}${pd > res.today ? ' (projected)' : ''}, week ${E.dShort(E.add(pd, -7))} to ${E.dShort(E.add(pd, -1))}</h4>${by[pd].map(w => `<div class="row"><div class="t">${esc(w.who)}<small>${w.type == 'salary' ? 'salary' : w.logged + ' h logged, ' + w.ord + ' h plain' + (w.ot ? ', overtime worth ' + w.ot + ' h' : '') + (w.short ? ', topped up ' + w.top + ' h' : '')}</small></div><div class="a">${$2(w.gross)}<small>net ${$2(w.net)}, tax ${$2(w.tax)}, super ${$2(w.sup)}</small></div></div>`).join('')}</div>`).join('')}
${oth.length ? `<div class="card"><h4>Logging hours but not on the pay list</h4>${oth.map(n => `<div class="row"><div class="t">${esc(n)}</div><div class="a">${Math.round(res.others[n])} h since ${E.dShort(res.set.start)}</div></div>`).join('')}</div>` : ''}`;
  }

  // Settings: every field carries data-k (where it lives in the settings) and saves on change
  const inp = (k, v, cls, type, ph) => `<input class="${cls || 'g'}" type="${type || 'text'}" data-k="${k}" value="${esc(v == null ? '' : v)}"${type == 'number' ? ' step="any" inputmode="decimal"' : ''}${ph ? ` placeholder="${esc(ph)}"` : ''}>`;
  const chk = (k, on, inv) => `<input type="checkbox" data-k="${k}"${inv ? ' data-inv="1"' : ''}${on ? ' checked' : ''}>`;
  const sel = (k, v, opts, cls) => `<select class="${cls || 'm'}" data-k="${k}">${opts.map(o => `<option value="${esc(o[0])}"${o[0] == v ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
  function vSet() {
    const names = [...new Set(((data && data.times) || []).map(t => t.who))].sort();
    const people = (set.people || []).map((p, i) => `<div class="f">${sel('people.' + i + '.name', p.name, [['', 'Pick a name']].concat([...new Set(names.concat(p.name ? [p.name] : []))].map(n => [n, n])), 'g')}${sel('people.' + i + '.type', p.type, [['hourly', 'Hourly'], ['salary', 'Salary']], 's')}
${p.type == 'salary' ? inp('people.' + i + '.weekly', p.weekly, 's', 'number') + '<span>a week, gross</span>' : inp('people.' + i + '.rate', p.rate, 's', 'number') + '<span>an hour, gross</span>'}
<span>from</span>${inp('people.' + i + '.from', p.from, 'm', 'date')}<span>to</span>${inp('people.' + i + '.to', p.to, 'm', 'date')}<button class="btn rm" data-act="rm" data-list="people" data-i="${i}" title="Remove">&times;</button></div>`).join('');
    const terms = (set.clientTerms || []).map((t, i) => `<div class="f">${inp('clientTerms.' + i + '.match', t.match, 'g', 'text', 'part of the client name')}${inp('clientTerms.' + i + '.days', t.days, 's', 'number')}<span>days</span><button class="btn rm" data-act="rm" data-list="clientTerms" data-i="${i}" title="Remove">&times;</button></div>`).join('');
    const est = (set.estimates || []).map((e, i) => `<div class="f">${chk('estimates.' + i + '.off', !e.off, true)}${inp('estimates.' + i + '.name', e.name)}${sel('estimates.' + i + '.kind', e.kind, [['fixed', 'Fixed amount'], ['fuel', 'Fuel'], ['pct', '% of gross pays']], 'm')}
${e.kind == 'fuel' ? inp('estimates.' + i + '.veh', e.veh, 's', 'number') + '<span>vehicles</span>' + inp('estimates.' + i + '.km', e.km, 's', 'number') + '<span>km a week each</span>' + inp('estimates.' + i + '.l100', e.l100, 's', 'number') + '<span>L/100 km</span>' + inp('estimates.' + i + '.price', e.price, 's', 'number') + '<span>$ a litre</span>'
    : e.kind == 'pct' ? inp('estimates.' + i + '.pct', e.pct, 's', 'number') + '<span>%</span>'
    : inp('estimates.' + i + '.amt', e.amt, 's', 'number') + sel('estimates.' + i + '.per', e.per, [['week', 'a week'], ['month', 'a month'], ['year', 'a year, spread by month']], 'm')}
<label><span>GST in it</span> ${chk('estimates.' + i + '.gst', e.gst)}</label><button class="btn rm" data-act="rm" data-list="estimates" data-i="${i}" title="Remove">&times;</button></div>`).join('');
    const solar = res ? res.solar.map(s => { const m = (set.stc || {})[s.jn] || {}; return `<div class="f"><div class="g"><b>${esc(s.jn)}</b> ${esc(s.name).slice(0, 60)}<br><span>${s.how == 'line' ? 'AroFlo STC line: ' + $2(s.amt) : s.how == 'set' ? 'Your figure' : s.how == 'none' ? 'Marked no STCs' : 'No STC line in AroFlo, needs a figure'}, job day ${dNice(s.jobDay)}, invoiced ${$0(s.inc)}</span></div>
<input class="s" type="number" step="any" inputmode="decimal" data-stc="${esc(s.jn)}" value="${m.amt == null ? '' : esc(m.amt)}" placeholder="$"><label><span>No STCs</span> <input type="checkbox" data-stcnone="${esc(s.jn)}"${m.none ? ' checked' : ''}></label></div>`; }).join('') : '';
    return `<div class="card"><h4>The basics</h4>
<div class="f"><span>Start date</span>${inp('start', set.start, 'm', 'date')}<span>Opening balance</span>${inp('open', set.open, 's', 'number')}</div>
<div class="f"><span>Invoices paid after</span>${inp('terms', set.terms, 's', 'number')}<span>days, unless a client below says different</span></div>
<div class="f"><span>Super</span>${inp('superRate', set.superRate, 's', 'number')}<span>%</span><span>STC money lands</span>${inp('stcDelay', set.stcDelay, 's', 'number')}<span>days after the job</span><span>Look ahead</span>${inp('horizon', set.horizon, 's', 'number')}<span>days</span></div></div>
<div class="card"><h4>Pay list</h4><p class="hint">Names and pay figures stay in this device's Tampermonkey. They are never in the script or sent anywhere.</p>${people}<div class="f"><button class="btn" data-act="add" data-list="people">Add a person</button>${names.length ? '' : '<span>Hit Refresh first so the names off the timesheets show here.</span>'}</div></div>
<div class="card"><h4>Clients on different terms</h4>${terms}<div class="f"><button class="btn" data-act="add" data-list="clientTerms">Add a client</button></div></div>
<div class="card"><h4>Estimated running costs</h4><p class="hint">Guesses for what can't be read from here. Untick one to leave it out. Amounts are what leaves the bank.</p>${est}<div class="f"><button class="btn" data-act="add" data-list="estimates">Add an estimate</button></div></div>
<div class="card"><h4>Extra days off</h4><p class="hint">Queensland public holidays are built in. Add show day or anything local, as dates like 2026-08-12, with commas between.</p><div class="f"><input class="g" type="text" data-hols="1" value="${esc((set.extraHols || []).join(', '))}"></div></div>
${res ? `<div class="card"><h4>Solar jobs</h4><p class="hint">A job with an STC line in AroFlo uses it. Type a figure to use yours instead (or where there's no line), or tick No STCs. It's remembered for every refresh. Jobs still needing a figure are on top, biggest first.</p>${solar || 'No solar jobs found.'}</div>` : ''}
<div class="card"><h4>Move the settings to another device</h4><p class="hint">Copy the code here, then paste it in the same box on the other device and tap Load. It holds the pay list, so treat it like the figures themselves.</p><textarea class="code" placeholder="Paste a settings code here to load it"></textarea><div class="f"><button class="btn" data-act="export">Copy my settings code</button><button class="btn g2" data-act="import">Load the code in the box</button></div></div>`;
  }

  function draw() {
    if (!box) return;
    box.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab == tab));
    box.querySelector('.bd').innerHTML = tab == 'over' ? vOver() : tab == 'st' ? vStatement() : tab == 'pay' ? vPays() : vSet();
    box.querySelector('.go').disabled = busy;
    box.querySelector('.msg').textContent = note;
  }
  async function refresh() {
    if (busy) return;
    busy = true; draw(); const t0 = Date.now();
    try {
      data = await readAll(set, say);
      try { GM_setValue(DATAKEY, data); } catch (e) {}
      calc(); say('Read in ' + Math.round((Date.now() - t0) / 1000) + ' sec.' + (data.warn.length ? ' ' + data.warn.length + ' thing' + (data.warn.length > 1 ? 's' : '') + ' to check on the Overview.' : ''));
    } catch (e) { say('Stopped: ' + (e && e.message || e)); }
    busy = false; draw();
  }
  // put a changed field into the settings by its data-k path, e.g. people.0.rate
  function put(k, el) {
    const path = k.split('.'), last = path.pop(); let o = set;
    path.forEach(p => { o = o[p]; });
    let v = el.type == 'checkbox' ? el.checked : el.type == 'number' ? (el.value === '' ? '' : +el.value) : el.value;
    if (el.dataset.inv) v = !v;
    o[last] = v;
  }
  const NEW = { people: () => ({ name: '', type: 'hourly', rate: 0, from: '', to: '' }), clientTerms: () => ({ match: '', days: 30 }), estimates: () => ({ name: 'New estimate', kind: 'fixed', amt: 0, per: 'month', gst: true }) };
  function build() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const b = document.createElement('button'); b.id = 'ec-lg-btn'; b.textContent = 'Ledger'; document.body.appendChild(b);
    box = document.createElement('div'); box.id = 'ec-lg';
    box.innerHTML = `<div class="hd"><b>EC Ledger</b><button class="go">Refresh</button><button class="x" title="Close">&times;</button></div>
<div class="tabs"><button data-tab="over">Overview</button><button data-tab="st">Statement</button><button data-tab="pay">Pays</button><button data-tab="set">Settings</button></div>
<div class="msg"></div><div class="bd"></div>`;
    document.body.appendChild(box);
    b.onclick = () => { const open = box.style.display != 'flex'; box.style.display = open ? 'flex' : 'none'; if (open) { calc(); draw(); } };
    box.querySelector('.x').onclick = () => { box.style.display = 'none'; };
    box.querySelector('.go').onclick = refresh;
    box.querySelector('.tabs').onclick = e => { const t = e.target.closest('button'); if (t) { tab = t.dataset.tab; more = 150; draw(); } };
    box.querySelector('.bd').addEventListener('click', async e => {
      const t = e.target.closest('[data-act]'); if (!t || t.tagName == 'INPUT') return;
      const a = t.dataset.act;
      if (a == 'more') { more += 300; draw(); }
      if (a == 'add') { (set[t.dataset.list] = set[t.dataset.list] || []).push(NEW[t.dataset.list]()); saveSet(); calc(); draw(); }
      if (a == 'rm') { set[t.dataset.list].splice(+t.dataset.i, 1); saveSet(); calc(); draw(); }
      if (a == 'export') {
        const code = encode(set), ta = box.querySelector('.code'); ta.value = code;
        let ok = false; try { await navigator.clipboard.writeText(code); ok = true; } catch (er) { try { GM_setClipboard(code, 'text'); ok = true; } catch (e2) {} }
        ta.focus(); ta.select(); say(ok ? 'Settings code copied. Paste it into the Ledger on your other device.' : 'Select all in the box and copy it.');
      }
      if (a == 'import') {
        try { const s = decode(box.querySelector('.code').value); if (!s || typeof s != 'object' || !Array.isArray(s.people) || !Array.isArray(s.estimates)) throw new Error('not a settings code'); set = Object.assign(E.DEFAULTS(todayIso()), s); saveSet(); calc(); say('Settings loaded.'); draw(); }
        catch (er) { say('That code didn\'t load (' + er.message + ').'); }
      }
    });
    box.querySelector('.bd').addEventListener('change', e => {
      const el = e.target;
      if (el.dataset.act == 'hard') { hard = el.checked; return draw(); }
      if (el.dataset.k) put(el.dataset.k, el);
      else if (el.dataset.hols) set.extraHols = el.value.split(/[,\s]+/).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
      else if (el.dataset.stc) { set.stc = set.stc || {}; if (el.value === '') delete set.stc[el.dataset.stc]; else set.stc[el.dataset.stc] = { amt: +el.value }; }
      else if (el.dataset.stcnone) { set.stc = set.stc || {}; if (el.checked) set.stc[el.dataset.stcnone] = { none: true }; else delete set.stc[el.dataset.stcnone]; }
      else return;
      saveSet(); calc(); say('Saved.'); draw();
    });
    if (data) say('Showing the last read. Hit Refresh for a fresh one.');
  }
  // for checking the reads from a browser console: set window.__ecLedgerDev = true before this runs
  try { if (window.__ecLedgerDev === true) window.__ecLedgerDev = { ENGINE, readAroflo, readSupplier, readAll, parseDate }; } catch (e) {}
  const ready = () => { if (document.body && !document.getElementById('ec-lg-btn')) build(); };
  if (document.readyState == 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
