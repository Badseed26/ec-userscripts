// ==UserScript==
// @name         EC Ledger
// @namespace    ec
// @version      0.12
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
  // Every run reads the lot again, from a month before the quarter before the start date, then replays it into a statement.
  // A line is only counted when its money moves inside the period (start date to today, or to the end date), the way a bank
  // statement for those dates would show it. That takes in money for earlier work that lands after the start, marked as such:
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
    const HOLS = ['2025-01-01', '2025-01-27', '2025-04-18', '2025-04-19', '2025-04-20', '2025-04-21', '2025-04-25', '2025-05-05', '2025-10-06', '2025-12-25', '2025-12-26',
      '2026-01-01', '2026-01-26', '2026-04-03', '2026-04-04', '2026-04-05', '2026-04-06', '2026-04-25', '2026-05-04', '2026-10-05', '2026-12-25', '2026-12-26', '2026-12-28',
      '2027-01-01', '2027-01-26', '2027-03-26', '2027-03-27', '2027-03-28', '2027-03-29', '2027-04-25', '2027-04-26', '2027-05-03', '2027-10-04', '2027-12-25', '2027-12-26', '2027-12-27', '2027-12-28'];

    // The ATO's weekly withholding formula for someone claiming the tax free threshold (scale 2):
    // y = a * x - b, where x is the week's pay with cents dropped plus 99 cents. [earnings under, a, b]
    // One table for pays from 1 July 2026, and the one before it (1 July 2024 to 30 June 2026) for looking back.
    const SCALE2 = [[362, 0, 0], [538, 0.15, 54.3462], [673, 0.25, 108.2135], [721, 0.17, 54.3473], [865, 0.179, 60.8377], [1282, 0.3227, 185.1935], [2596, 0.32, 181.7319], [3653, 0.39, 363.4627], [Infinity, 0.47, 655.7704]];
    const SCALE2_OLD = [[361, 0, 0], [500, 0.16, 57.8462], [625, 0.26, 107.8462], [721, 0.18, 57.8462], [865, 0.189, 64.3365], [1282, 0.3227, 180.0385], [2596, 0.32, 176.5769], [3653, 0.39, 358.3077], [Infinity, 0.47, 650.6154]];
    const withhold = (gross, payDay) => { const x = Math.floor(gross) + 0.99, row = (payDay && payDay < '2026-07-01' ? SCALE2_OLD : SCALE2).find(r => x < r[0]); return Math.max(0, Math.round(row[1] * x - row[2])); };

    // The start of the financial year today sits in, and what a fresh install starts with. The estimates are guesses to edit.
    const fyStart = today => (+today.slice(5, 7) >= 7 ? +today.slice(0, 4) : +today.slice(0, 4) - 1) + '-07-01';
    const DEFAULTS = today => ({
      v: 1, start: fyStart(today), end: '', open: 0, terms: 14, clientTerms: [], superRate: 12, stcDelay: 2, horizon: 42,
      people: [], // { name, type: 'hourly' or 'salary', rate (an hour) or weekly (a week), from, to }
      ownSup: 'trade\\s?zone|cnw', // suppliers read off their own account pages, so their AroFlo purchase orders are left out
      acctSup: 'haymans|polyaire', // other suppliers on a monthly account: a month's purchase orders are paid at the end of the next month
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
      gear: {}, // gear on purchase orders with no price in AroFlo: { 'po' + order number: { amt } or { none: true } }, or { jobNumber: { amt, d } } for a whole job. Ex GST.
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
      const out = { who: p.name, ws, pay: add(ws, 7), logged: r2(logged), guar: r2(7.6 * wd), ord: 0, top: 0, ot: 0, gross: 0, tax: 0, net: 0, sup: 0 };
      if (!wd) return out;
      let base;
      if (p.type == 'salary') { out.gross = base = r2((+p.weekly || 0) * wd / 5); }
      else {
        const top = Math.max(0, 7.6 * wd - ord - cred), rate = +p.rate || 0;
        out.ord = r2(ord + top); out.top = r2(top); out.ot = r2(otEq);
        base = rate * (ord + top); out.gross = r2(base + rate * otEq);
      }
      out.tax = Math.min(withhold(out.gross, out.pay), out.gross); out.net = r2(out.gross - out.tax); out.sup = r2(base * superRate / 100);
      return out;
    }

    // data = { from, invoices, pos, times, sup, stc }, set = the saved settings, today = 'YYYY-MM-DD'
    function run(data, set, today) {
      const S = Object.assign(DEFAULTS(today), set || {});
      const hols = new Set(HOLS.concat(S.extraHols || []));
      // the period: the start date to today (plus the look ahead), or to the end date when one in the past is set
      const asAt = S.end && S.end >= S.start && S.end < today ? S.end : today, ended = asAt != today;
      const from = data.from || add(S.start, -7), end = ended ? asAt : add(today, +S.horizon || 0), startYm = S.start.slice(0, 7);
      const tx = [];
      const push = (d, amt, tag, kind, label, extra) => { if (!d || !amt || !isFinite(amt)) return; tx.push(Object.assign({ d, amt: r2(amt), tag, kind, label }, extra || {})); };
      // GST by calendar quarter, counted when the money moves. Kept apart for data and estimates so each can stand alone.
      const gst = { data: {}, est: {} };
      const addGst = (b, d, g) => { if (d > end) return; const k = d.slice(0, 4) + '-Q' + Math.ceil(+d.slice(5, 7) / 3); gst[b][k] = (gst[b][k] || 0) + g; };

      // ---- money in: invoices, on the builder's terms, landing on a weekday ----
      const termFor = cl => { const c = (S.clientTerms || []).find(t => t && t.match && String(cl || '').toLowerCase().includes(String(t.match).toLowerCase())); return c ? +c.days || 0 : +S.terms || 0; };
      const jobs = {}, status = {}, drafts = { n: 0, inc: 0, list: [] };
      (data.invoices || []).forEach(i => {
        status[i.st || '?'] = (status[i.st || '?'] || 0) + 1;
        if (dead(i.st)) return;
        const ex = +i.ex || 0, inc = +i.inc || ex * 1.1; if (!inc) return;
        const d = nextBiz(add(i.d, termFor(i.cl)));
        if (draft(i.st)) { if (d >= S.start && i.d <= asAt) { drafts.n++; drafts.inc = r2(drafts.inc + inc); drafts.list.push({ n: i.n, jn: i.jn || '', d: i.d, inc: r2(inc), st: i.st }); } return; }
        push(d, inc, 'data', 'inv', 'Invoice ' + i.n + (i.cl ? ', ' + i.cl : ''), { ref: i.jn || '', sub: i.tn || '', pre: i.d < S.start });
        addGst('data', d, inc - (ex || inc / 1.1));
        if (i.jn) { const j = jobs[i.jn] = jobs[i.jn] || { jn: i.jn, name: i.tn || '', text: '', first: i.d, last: i.d, inc: 0 }; j.inc = r2(j.inc + inc); j.text += ' ' + (i.tn || '') + ' ' + (i.desc || ''); if (i.d < j.first) j.first = i.d; if (i.d > j.last) j.last = i.d; }
      });

      // ---- STC money: 2 days after the last day on the job. From AroFlo's STC line, or the figure typed in for that job ----
      const lastOn = {};
      (data.times || []).forEach(t => { if (!t.jn) return; const d = String(t.s).slice(0, 10); (lastOn[t.jn] = lastOn[t.jn] || []).push(d); });
      const dayOf = j => { const days = (lastOn[j.jn] || []).filter(d => d <= add(j.last, 3)).sort(); return days.length ? days[days.length - 1] : j.first; };
      const solar = [];
      Object.values(jobs).forEach(j => {
        const line = (data.stc || {})[j.jn], mine = (S.stc || {})[j.jn];
        if (!line && !mine && !/solar|\bpv\b|inverter|\bstcs?\b/i.test(j.text)) return;
        const jobDay = dayOf(j);
        const how = mine ? (mine.none ? 'none' : 'set') : line ? 'line' : 'need';
        const amt = how == 'set' ? Math.abs(+mine.amt || 0) : how == 'line' ? Math.abs(+line.amt || 0) : 0, d = add(jobDay, +S.stcDelay || 0);
        if (d < S.start || d > end) return; // the read goes back before the start, but a job only belongs here when its STC money lands inside the period
        solar.push({ jn: j.jn, name: j.name, how, amt, d, jobDay, inc: j.inc });
        push(d, amt, how == 'set' ? 'set' : 'data', 'stc', 'STCs, job ' + j.jn, { ref: j.jn, sub: j.name, pre: jobDay < S.start });
      });

      // ---- supplier accounts: a month's orders are paid on the last weekday of the next month ----
      const canon = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const supM = {}, oldest = {};
      (data.sup || []).forEach(o => { const inc = +o.inc || 0; if (!inc || !o.d) return; const c = canon(o.sup), ym = o.d.slice(0, 7), k = c + '|' + ym, m = supM[k] = supM[k] || { sup: o.sup, ym, inc: 0, n: 0 }; m.inc += inc; m.n++; if (!oldest[c] || ym < oldest[c]) oldest[c] = ym; });
      Object.values(supM).forEach(m => { const d = prevBiz(eom(addMonth(m.ym, 1))); push(d, -m.inc, 'data', 'sup', m.sup + ' account, ' + mName(m.ym) + ' (' + m.n + ' orders)', { n: m.n, pre: m.ym < startYm }); addGst('data', d, -m.inc / 11); });

      // ---- AroFlo's purchase orders, GST added. Tradezone and CNW are left to their account pages above, except for months
      // those pages don't cover (signed out, or before their first order there), where the purchase orders stand in.
      // Suppliers on a monthly account are paid like one, everyone else on the day. ----
      const rx = (t, d) => { try { return new RegExp(t || d, 'i'); } catch (e) { return new RegExp(d, 'i'); } };
      const own = rx(S.ownSup, 'trade\\s?zone|cnw'), acct = rx(S.acctSup, 'haymans|polyaire');
      const poM = {}, zero = [];
      (data.pos || []).forEach(o => {
        if (!o.d || dead(o.st)) return;
        const ex = +o.ex || 0, sup = o.sup || 'Supplier', c = canon(sup), ym = o.d.slice(0, 7), isOwn = own.test(sup);
        if (isOwn) { const h = Object.keys(oldest).find(k => c.includes(k) || k.includes(c)); if (h && ym >= oldest[h]) return; }
        if (!ex) { zero.push(o); return; }
        if (isOwn || acct.test(sup)) { const k = c + '|' + ym, m = poM[k] = poM[k] || { sup, ym, ex: 0, n: 0 }; m.ex += ex; m.n++; return; }
        push(o.d, -ex * 1.1, 'data', 'po', sup + (o.no ? ', PO ' + o.no : ''), { ref: o.jn || '' }); addGst('data', o.d, -ex * 0.1);
      });
      Object.values(poM).forEach(m => { const d = prevBiz(eom(addMonth(m.ym, 1))); push(d, -m.ex * 1.1, 'data', 'sup', m.sup + ' account, ' + mName(m.ym) + ' (' + m.n + ' purchase orders)', { n: m.n, pre: m.ym < startYm }); addGst('data', d, -m.ex * 0.1); });

      // ---- gear on a purchase order with no price in AroFlo: nothing can be counted for it till a figure is set (ex GST),
      // for the order ('po' and its number) or for a whole job (the job number, which then covers that job's orders).
      // Paid on the order's day, GST added. ----
      const G = S.gear || {}, gear = [], byJob = {};
      const gPush = (d, a, label, ref, why) => { push(d, -a * 1.1, 'set', 'gear', label, { ref: ref || '', sub: why || '' }); addGst('est', d, -a * 0.1); };
      zero.forEach(o => {
        if (o.jn && G[o.jn]) { (byJob[o.jn] = byJob[o.jn] || []).push(o); return; }
        if (o.d < S.start || o.d > asAt) return;
        const key = 'po' + o.no, mine = G[key], how = mine ? (mine.none ? 'none' : 'set') : 'need', a = how == 'set' ? Math.abs(+mine.amt || 0) : 0;
        gear.push({ key, no: o.no, jn: o.jn || '', sup: o.sup || '', d: o.d, how, amt: a, li: o.li || '' });
        if (a) gPush(o.d, a, (o.sup || 'Supplier') + ', PO ' + o.no + ' (no price in AroFlo)', o.jn, mine.why);
      });
      Object.keys(G).forEach(k => {
        const g = G[k]; if (!g || !/^\d{3,6}$/.test(k)) return;
        const pos = byJob[k] || [], j = jobs[k], d = /^\d{4}-\d{2}-\d{2}$/.test(g.d || '') ? g.d : pos.length ? pos.map(o => o.d).sort()[0] : j ? dayOf(j) : '';
        if (!d || d < S.start || d > asAt) return;
        const how = g.none ? 'none' : 'set', a = how == 'set' ? Math.abs(+g.amt || 0) : 0;
        gear.push({ key: k, no: pos.map(o => o.no).join(', '), jn: k, sup: (pos[0] && pos[0].sup) || '', d, how, amt: a, li: pos.map(o => o.li).filter(Boolean).join('; ') });
        if (a) gPush(d, a, 'Gear for job ' + k + ' (no price in AroFlo)', k, g.why);
      });

      // ---- pays: every Wednesday for the Wednesday to Tuesday before it, super the same day ----
      const H = hoursByDay(data.times), people = (S.people || []).filter(p => p && p.name);
      const wageWeeks = [], held = {}, grossM = {};
      let ws = from; while (dow(ws) != 3) ws = add(ws, 1);
      for (; add(ws, 7) <= end; ws = add(ws, 7)) {
        const pd = add(ws, 7);
        people.forEach(p => {
          const w = payWeek(p, ws, H[p.name], hols, +S.superRate || 0); if (!w.gross) return;
          w.type = p.type; w.short = p.type != 'salary' && w.logged < w.guar - 0.05 && add(ws, 6) < asAt; wageWeeks.push(w); // short: a finished week with less logged than the guarantee
          push(pd, -w.net, 'set', 'wage', 'Pay, ' + p.name, { who: p.name, sub: 'week to ' + dShort(add(ws, 6)), pre: ws < S.start });
          push(pd, -w.sup, 'set', 'super', 'Super, ' + p.name, { who: p.name, pre: ws < S.start });
          const ym = pd.slice(0, 7); held[ym] = (held[ym] || 0) + w.tax; grossM[ym] = (grossM[ym] || 0) + w.gross;
        });
      }
      // tax held from pays: to the ATO by the 21st of the next month, or with the BAS on the 28th for the last month of a quarter
      Object.keys(held).forEach(ym => { const m = +ym.slice(5, 7), q = m % 3 == 0; push(nextBiz(addMonth(ym, m == 12 ? 2 : 1) + (q ? '-28' : '-21')), -held[ym], 'set', 'payg', 'Tax held from ' + mName(ym) + ' pays, to the ATO', { pre: ym < startYm }); });

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
        const pre = y + '-' + p2(q * 3) < startYm; // a quarter that finished before the start
        push(due, -(gst.data[k] || 0), 'data', 'gst', 'GST, ' + nm + ' (invoices less supplier bills)', { pre });
        push(due, -(gst.est[k] || 0), 'est', 'gst', 'GST back on the estimates, ' + nm, { pre });
      });

      // ATO bills already building that land after the window ends (the current quarter's GST and the latest held tax)
      const atoLater = r2(tx.filter(t => (t.kind == 'gst' || t.kind == 'payg') && t.d > end).reduce((a, t) => a - t.amt, 0));
      const out = tx.filter(t => t.d >= S.start && t.d <= end).sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : b.amt - a.amt);
      out.forEach(t => { t.proj = t.d > asAt; });
      // hours logged by anyone not on the pay list, so they can be added if wanted
      const names = new Set(people.map(p => p.name)), others = {};
      Object.keys(H).forEach(n => { if (names.has(n)) return; const h = Object.keys(H[n]).filter(d => d >= S.start && d <= asAt).reduce((a, d) => a + H[n][d], 0); if (h > 0) others[n] = r2(h); });
      // what's inside the period, for the note under the Overview
      const real = out.filter(t => !t.proj), counts = { inv: real.filter(t => t.kind == 'inv').length, po: real.filter(t => t.kind == 'po').length, sup: real.filter(t => t.kind == 'sup').reduce((a, t) => a + (t.n || 0), 0), times: (data.times || []).filter(t => { const d = String(t.s).slice(0, 10); return d >= S.start && d <= asAt; }).length };
      return { set: S, today: asAt, ended, counts, end, from, tx: out, wageWeeks: wageWeeks.filter(w => w.pay >= S.start && w.pay <= end), solar: solar.sort((a, b) => (a.how == 'need') != (b.how == 'need') ? (a.how == 'need' ? -1 : 1) : a.how == 'need' ? b.inc - a.inc : a.d < b.d ? 1 : -1), others, atoLater, status, drafts, gear: gear.sort((a, b) => (a.how == 'need') != (b.how == 'need') ? (a.how == 'need' ? -1 : 1) : a.d < b.d ? 1 : -1) };
    }

    // The running balance and headline numbers for a set of lines: all of them, or only the ones a filter keeps.
    function tally(res, keep) {
      let bal = +res.set.open || 0, now = bal, inn = 0, out = 0, preIn = 0, preOut = 0, low = { d: res.set.start, bal };
      const kinds = {}, weeks = {};
      const rows = res.tx.filter(keep || (() => true)).map(t => {
        bal = r2(bal + t.amt);
        if (!t.proj) { now = bal; if (t.amt > 0) inn += t.amt; else out -= t.amt; if (t.pre) { if (t.amt > 0) preIn += t.amt; else preOut -= t.amt; } if (bal < low.bal) low = { d: t.d, bal }; kinds[t.kind] = r2((kinds[t.kind] || 0) + t.amt); }
        const mon = add(t.d, -((dow(t.d) + 6) % 7)), w = weeks[mon] = weeks[mon] || { ws: mon, in: 0, out: 0, bal: 0, proj: t.proj };
        if (t.amt > 0) w.in = r2(w.in + t.amt); else w.out = r2(w.out - t.amt); w.bal = bal;
        return Object.assign({}, t, { bal });
      });
      return { rows, now: r2(now), in: r2(inn), out: r2(out), preIn: r2(preIn), preOut: r2(preOut), low, end: bal, kinds, weeks: Object.values(weeks).sort((a, b) => a.ws < b.ws ? -1 : 1) };
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
      // status=ALL, or AroFlo only hands over the ones still in progress and every processed order goes missing. Newest first,
      // so it stops three pages after it runs past the start.
      let all = '&status=ALL';
      const poPage = n => af('/cf-api/purchaseorders?limit=100' + all + '&page=' + n);
      let p1 = await poPage(1);
      if (!(p1.items || []).length) { all = ''; p1 = await poPage(1); out.warn.push('Purchase orders: AroFlo only gave the ones still in progress'); }
      const pc = Math.min((p1.page && p1.page.count) || 1, 120); let olderP = 0;
      for (let n = 1; n <= pc; n++) {
        say('AroFlo: purchase orders, page ' + n + '…');
        const j = n == 1 ? p1 : await poPage(n); let any = false;
        (j.items || []).forEach(o => { const d = String(o.purchaseDate || o.timestampCreated || '').slice(0, 10); if (!d || d < from) return; any = true; out.pos.push({ no: String(o.referenceNumber || o.orderNumber || ''), d, sup: clean(o.supplierName || '').slice(0, 50), jn: String(o.jobNumber || ''), ex: +(o.totalAmountEx || 0), st: o.status || '', id: o.id || '' }); });
        if (!(j.items || []).length) break;
        if (any) olderP = 0; else if (++olderP >= 3) break;
      }
      // an order with no price: its lines are read so there's something to price it from
      const blank = out.pos.filter(o => !o.ex && o.id && !/void|cancel|delet/i.test(o.st)); let lz = 0;
      await pool(blank, 4, async o => {
        const j = await af('/cf-api/purchaseorders/' + o.id + '/lineitems?limit=100');
        o.li = (j.items || []).map(l => clean(l.name) ? (+l.quantityOrdered || 0) + 'x ' + clean(l.name) : '').filter(Boolean).join('; ').slice(0, 240);
        say('AroFlo: purchase orders with no price, ' + (++lz) + ' of ' + blank.length + '…');
      });
      out.pos.forEach(o => { delete o.id; delete o.err; });
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
    // STC lines: only jobs that look like solar get their costing sheet opened, for an STC line under Expense or Material
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
          if ((part != 'Expense' && part != 'Material') || c.length < 7 || !/\bstc'?s?\b/i.test(c.join(' '))) return; // STCs get entered under either, as a negative line
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

  // ---------- one full read. Goes back to a month before the quarter before the start date: that quarter's supplier accounts,
  // held tax and GST all leave the bank after the start, and its own first month is paid for things from the month before.
  // Reading that far back is only so those later payments come out right. Nothing dated before the start is counted. ----------
  async function readAll(set, say) {
    const today = todayIso(), S = Object.assign(E.DEFAULTS(today), set || {});
    const qm = Math.floor((+S.start.slice(5, 7) - 1) / 3) * 3 + 1, from = E.addMonth(S.start.slice(0, 4) + '-' + p2(qm), -4) + '-01';
    const A = await readAroflo(from, today, say);
    const data = { v: 1, from, start: S.start, at: Date.now(), invoices: A.invoices, pos: A.pos, times: A.times, stc: A.stc, sup: [], warn: A.warn.slice() };
    for (const sp of SUPS) { try { data.sup.push(...await readSupplier(sp, from, say)); } catch (e) { data.warn.push(e.message); } }
    return data;
  }

  // ---------- what's kept on this device: the settings (names and pay figures included) and the last read ----------
  const SETKEY = 'ecLedgerSet', DATAKEY = 'ecLedgerData';
  let set = Object.assign(E.DEFAULTS(todayIso()), GM_getValue(SETKEY, null) || {}), data = GM_getValue(DATAKEY, null), res = null;
  let tab = 'over', hard = false, ahead = false, more = 150, busy = false, box, note = '', loaded = '', sorted = false, gsorted = false;
  const VER = (() => { try { return GM_info.script.version || ''; } catch (e) { return ''; } })(); // shown in the title, so it's clear which copy is installed
  const saveSet = () => { try { GM_setValue(SETKEY, set); } catch (e) {} };
  // Another AroFlo tab (or an older copy still open in one) can have saved since this page loaded. The whole lot is saved in one
  // go, so before anything is changed here the latest saved settings are picked up first. Otherwise this tab would write its
  // older copy over the top and wipe what the other one saved (20/11: a batch of STC figures went that way).
  const sync = () => { try { const s = GM_getValue(SETKEY, null); if (s && typeof s == 'object') set = Object.assign(E.DEFAULTS(todayIso()), s); } catch (e) {} };
  const calc = () => { res = data ? E.run(data, set, todayIso()) : null; };
  // Copy without waiting forever on it: the browser's own copy can hang or be refused, and Tampermonkey's can say it worked
  // when it didn't (iPhone). true = copied, 'maybe' = Tampermonkey's go, false = no luck.
  async function copyText(text) {
    try { if (await Promise.race([navigator.clipboard.writeText(text).then(() => true, () => false), new Promise(r => setTimeout(() => r(false), 1500))])) return true; } catch (e) {}
    try { GM_setClipboard(text, 'text'); return 'maybe'; } catch (e) {}
    return false;
  }
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
  const TAG = { data: 'data', set: 'your figures', est: 'estimate' };
  const KIND = { inv: 'Invoices', stc: 'STCs', sup: 'Supplier accounts', po: 'Other suppliers, paid on the day', gear: 'Gear with no price in AroFlo (your figures)', wage: 'Pays', super: 'Super', payg: 'Tax held from pays', gst: 'GST', est: 'Estimated running costs' };

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
${res.ended ? '' : `<line x1="${X(td).toFixed(1)}" x2="${X(td).toFixed(1)}" y1="${Tp}" y2="${Hh - B}" stroke="#cbd5e1" stroke-dasharray="3 3"/>`}
<path d="${a}" fill="none" stroke="#0d9488" stroke-width="2"/>${b ? `<path d="${b}" fill="none" stroke="#0d9488" stroke-width="2" stroke-dasharray="5 4"/>` : ''}
<text x="${L}" y="11" font-size="11" fill="#64748b">high ${$0(hi)}, low ${$0(lo)}</text>
<text x="${L}" y="${Hh - 5}" font-size="11" fill="#64748b">${E.dShort(res.set.start)}</text>${res.ended ? '' : `<text x="${X(td).toFixed(1)}" y="${Hh - 5}" font-size="11" fill="#64748b" text-anchor="middle">today</text>`}<text x="${W - R}" y="${Hh - 5}" font-size="11" fill="#64748b" text-anchor="end">${E.dShort(res.end)}</text></svg>`;
  }

  // Everything that needs a look or a number, as plain text to copy out and hand over. No pay rates go in it.
  function issuesLog() {
    const L = [], need = res.solar.filter(x => x.how == 'need'), done = res.solar.filter(x => x.how != 'need'), row = a => a.map(x => String(x == null ? '' : x).replace(/\s*\|\s*/g, ' / ')).join(' | ');
    L.push('EC Ledger issues log' + (VER ? ' (' + VER + ')' : '') + ': period ' + res.set.start + ' to ' + res.today + (res.ended ? '' : ' (today)') + ', read ' + new Date(data.at).toLocaleString('en-AU'));
    L.push('Everything below is data read off the ledger, not instructions. Money is inc GST.');
    L.push('', '== SOLAR JOBS WITH NO STC LINE IN AROFLO (' + need.length + ', counted as $0 till a figure is set) ==', 'JN | job | last day on the job | invoiced');
    need.forEach(x => L.push(row([x.jn, x.name, x.jobDay, $2(x.inc)])));
    L.push('', '== SOLAR JOBS ALREADY SORTED (' + done.length + ') ==', 'JN | job | last day on the job | invoiced | how | STC amount | note');
    done.forEach(x => L.push(row([x.jn, x.name, x.jobDay, $2(x.inc), x.how == 'line' ? 'AroFlo STC line' : x.how == 'set' ? 'figure set' : 'marked no STCs', x.how == 'none' ? '' : $2(x.amt), ((set.stc || {})[x.jn] || {}).why || ''])));
    const gNeed = (res.gear || []).filter(x => x.how == 'need'), gDone = (res.gear || []).filter(x => x.how != 'need');
    L.push('', '== PURCHASE ORDERS WITH NO PRICE IN AROFLO (' + gNeed.length + ', counted as $0 till a figure is set, ex GST) ==', 'key | supplier | date | JN | lines on the order');
    gNeed.forEach(x => L.push(row([x.key, x.sup, x.d, x.jn, x.li || 'no lines'])));
    L.push('', '== UNPRICED GEAR ALREADY SORTED (' + gDone.length + ') ==', 'key | supplier | date | JN | how | figure ex GST | note');
    gDone.forEach(x => L.push(row([x.key, x.sup, x.d, x.jn, x.how == 'set' ? 'figure set' : 'marked nothing to pay', x.how == 'set' ? $2(x.amt) : '', ((set.gear || {})[x.key] || {}).why || ''])));
    L.push('', '== INVOICES NOT COUNTED: still in progress or waiting on approval (' + res.drafts.n + ') ==', 'invoice | JN | date | amount | status');
    res.drafts.list.forEach(x => L.push(row([x.n, x.jn, x.d, $2(x.inc), x.st])));
    const short = res.wageWeeks.filter(w => w.short);
    L.push('', '== PAY WEEKS WITH FEWER HOURS LOGGED THAN THE GUARANTEE (' + short.length + ') ==', 'who | week | hours logged | guarantee');
    short.forEach(w => L.push(row([w.who, w.ws + ' to ' + E.add(w.ws, 6), w.logged, w.guar])));
    L.push('', '== HOURS LOGGED BY PEOPLE NOT ON THE PAY LIST ==');
    Object.keys(res.others).forEach(n => L.push(row([n, res.others[n] + ' h'])));
    L.push('', '== PROBLEMS ON THE LAST READ ==');
    (data.warn || []).forEach(w => L.push(w)); if (!(data.warn || []).length) L.push('none');
    const gaps = [], ppl = set.people || [];
    if (!ppl.length) gaps.push('no one on the pay list');
    ppl.filter(p => p.name && !(p.type == 'salary' ? +p.weekly : +p.rate)).forEach(p => gaps.push(p.name + ' has no ' + (p.type == 'salary' ? 'weekly salary' : 'hourly rate') + ' set'));
    if (!(+set.open)) gaps.push('opening balance is 0');
    if (!(set.clientTerms || []).length) gaps.push('no clients on their own terms, every invoice is on ' + set.terms + ' days');
    if (data.start != set.start) gaps.push('start date changed since the last read, needs a Refresh');
    L.push('', '== SETTINGS GAPS ==', gaps.length ? gaps.join('\n') : 'none');
    return L.join('\n');
  }

  function vOver() {
    if (!res) return `<div class="card">Nothing read yet. Hit <b>Refresh</b> up top: it reads AroFlo, Tradezone and CNW (read only, nothing is changed) and takes a minute or two. Sign in to Tradezone and CNW in this browser first.</div>`;
    const T = E.tally(res, hard ? t => t.tag == 'data' : null), W = [];
    if (!(set.people || []).length) W.push('No one is on the pay list yet. Add people and their rates under Settings, they stay on this device.');
    const need = res.solar.filter(s => s.how == 'need').length;
    if (need) W.push(need + ' solar job' + (need > 1 ? 's have' : ' has') + ' no STC line in AroFlo, counted as $0 for now. Set the figures under Settings, Solar jobs.');
    const gneed = (res.gear || []).filter(g => g.how == 'need').length;
    if (gneed) W.push(gneed + ' purchase order' + (gneed > 1 ? 's have' : ' has') + ' no price in AroFlo, counted as $0 for now. Set the figures under Settings, Purchase orders with no price.');
    const shortW = res.wageWeeks.filter(w => w.short).length;
    if (shortW) W.push(shortW + ' pay week' + (shortW > 1 ? 's' : '') + ' had fewer hours logged than the guarantee, so the pay for those is a floor, not what was worked (see Pays).');
    const oth = Object.keys(res.others);
    if (oth.length) W.push('Hours logged by people not on the pay list (not paid here): ' + oth.map(n => esc(n) + ' ' + Math.round(res.others[n]) + ' h').join(', ') + '.');
    if (res.drafts.n) W.push(res.drafts.n + ' invoice' + (res.drafts.n > 1 ? 's' : '') + ' still in progress or waiting on approval in AroFlo (' + $0(res.drafts.inc) + ') ' + (res.drafts.n > 1 ? 'are' : 'is') + ' not counted until approved.');
    (data.warn || []).forEach(w => W.push(esc(w)));
    if (data.start != set.start) W.push('The start date has changed since the last read. Hit Refresh to read again.');
    const kinds = Object.keys(KIND).filter(k => T.kinds[k]).map(k => `<div class="row"><div class="t">${KIND[k]}</div><div class="a">${amt(T.kinds[k], $0)}</div></div>`).join('');
    const at = new Date(data.at);
    return `<label class="tg"><input type="checkbox" data-act="hard" ${hard ? 'checked' : ''}> Hard data only (leave out my pay settings and the estimates)</label>
<div class="tiles">
<div class="tile"><div class="v ${T.now < 0 ? 'neg' : ''}">${$0(T.now)}</div><div class="l">${res.ended ? 'Balance, ' + dNice(res.today) : 'Balance today'}</div></div>
<div class="tile"><div class="v">${$0(T.in)}</div><div class="l">In since ${E.dShort(res.set.start)}</div></div>
<div class="tile"><div class="v">${$0(T.out)}</div><div class="l">Out since ${E.dShort(res.set.start)}</div></div>
<div class="tile"><div class="v ${T.low.bal < 0 ? 'neg' : ''}">${$0(T.low.bal)}</div><div class="l">Lowest point, ${dNice(T.low.d)}</div></div>
${res.ended ? '' : `<div class="tile"><div class="v ${T.end < 0 ? 'neg' : ''}">${$0(T.end)}</div><div class="l">Projected, ${dNice(res.end)}</div></div>`}
${hard ? '' : `<div class="tile"><div class="v">${$0(res.atoLater)}</div><div class="l">ATO bills building, due later</div></div>`}
</div>
${W.map(w => `<div class="warn">${w}</div>`).join('')}
<div class="f" style="margin-bottom:12px;border:0"><button class="btn g2" data-act="log">Copy the issues log</button><span>Everything that needs a look or a number, to paste to Claude.</span></div><textarea class="logbox" readonly style="display:none;height:120px;margin-bottom:12px"></textarea>
<div class="card"><h4>Balance</h4>${chart(T)}</div>
<div class="card"><h4>Where it went, ${E.dShort(res.set.start)} to ${res.ended ? E.dShort(res.today) : 'today'}</h4>${kinds || 'No lines yet.'}</div>
${T.preIn || T.preOut ? `<div class="card"><h4>From before the start date</h4><p class="hint">Only money that moved inside the period is counted, the same as a bank statement for those dates. Some of that is for work or bills from before ${E.dShort(res.set.start)} that got paid after it: <b>${$0(T.preIn)}</b> in and <b>${$0(T.preOut)}</b> out. Those lines are marked before start in the Statement. Nothing that moved before the start date is in here.</p></div>` : ''}
<p class="hint">Read ${at.toLocaleDateString('en-AU')} ${at.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}. Inside the period: ${res.counts.inv} invoices paid, ${res.counts.sup} supplier orders paid on account, ${res.counts.po} other purchase orders, ${res.counts.times} timesheet lines. Money is inc GST, the way a bank sees it. Every invoice is counted as paid on its terms.</p>`;
  }

  function vStatement() {
    if (!res) return vOver();
    const T = E.tally(res, hard ? t => t.tag == 'data' : null), rows = T.rows.filter(r => ahead || !r.proj).reverse();
    return `<label class="tg"><input type="checkbox" data-act="hard" ${hard ? 'checked' : ''}> Hard data only</label>${res.ended ? '' : `<label class="tg"><input type="checkbox" data-act="ahead" ${ahead ? 'checked' : ''}> Show what's coming up to ${dNice(res.end)} as well</label>`}
<div class="card">${rows.slice(0, more).map(r => `<div class="row${r.proj ? ' proj' : ''}"><div class="d">${dNice(r.d)}</div><div class="t">${esc(r.label)}<span class="chip ${r.tag}">${TAG[r.tag]}</span>${r.pre ? '<span class="chip" style="background:#fee2e2;color:#991b1b">before start</span>' : ''}${r.proj ? '<span class="chip" style="background:#e2e8f0;color:#475569">projected</span>' : ''}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</div><div class="a">${amt(r.amt)}<small>${$2(r.bal)}</small></div></div>`).join('') || 'No lines yet.'}</div>
${rows.length > more ? `<button class="btn g2" data-act="more">Show more (${rows.length - more} older)</button>` : ''}`;
  }

  function vPays() {
    if (!res) return vOver();
    if (!res.wageWeeks.length) return `<div class="card">No one is on the pay list yet. Add people under Settings.</div>`;
    const by = {}; res.wageWeeks.forEach(w => { (by[w.pay] = by[w.pay] || []).push(w); });
    const days = Object.keys(by).filter(d => d <= res.today).sort().reverse().slice(0, 30);
    const oth = Object.keys(res.others);
    return `<p class="hint">Payday is Wednesday for the Wednesday to Tuesday before. Hourly people are guaranteed 7.6 hours a weekday, travel counts as worked time, and overtime is anything over 8 hours on a weekday plus weekends and public holidays at the award rates. Paydays still to come are counted at the guarantee and sit in the Statement.</p>
${days.map(pd => `<div class="card"><h4>${dNice(pd)}, week ${E.dShort(E.add(pd, -7))} to ${E.dShort(E.add(pd, -1))}</h4>${by[pd].map(w => `<div class="row"><div class="t">${esc(w.who)}<small>${w.type == 'salary' ? 'salary' : w.logged + ' h logged, ' + w.ord + ' h plain' + (w.ot ? ', overtime worth ' + w.ot + ' h' : '') + (w.top > 0.05 ? ', topped up ' + w.top + ' h' : '') + (w.short ? ', under the guarantee' : '')}</small></div><div class="a">${$2(w.gross)}<small>net ${$2(w.net)}, tax ${$2(w.tax)}, super ${$2(w.sup)}</small></div></div>`).join('')}</div>`).join('')}
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
    const srow = s => { const m = (set.stc || {})[s.jn] || {}; return `<div class="f"><div class="g"><b>${esc(s.jn)}</b> ${esc(s.name).slice(0, 60)}<br><span>${s.how == 'line' ? 'AroFlo STC line: ' + $2(s.amt) : s.how == 'set' ? 'Your figure' : s.how == 'none' ? 'Marked no STCs' : 'No STC line in AroFlo, needs a figure'}, job day ${dNice(s.jobDay)}, invoiced ${$0(s.inc)}</span>${m.why ? `<br><span>Note: ${esc(m.why)}</span>` : ''}</div>
<input class="s" type="number" step="any" inputmode="decimal" data-stc="${esc(s.jn)}" value="${m.amt == null ? '' : esc(m.amt)}" placeholder="$"><label><span>No STCs</span> <input type="checkbox" data-stcnone="${esc(s.jn)}"${m.none ? ' checked' : ''}></label></div>`; };
    const grow = g => { const m = (set.gear || {})[g.key] || {}; return `<div class="f"><div class="g"><b>${g.no ? 'PO ' + esc(g.no) : 'Job ' + esc(g.jn)}</b> ${esc(g.sup)}${g.no && g.jn ? ', job ' + esc(g.jn) : ''}, ${g.d ? dNice(g.d) + ' ' + g.d.slice(0, 4) : ''}<br><span>${esc(g.li || 'Nothing listed on the order')}</span>${m.why ? `<br><span>Note: ${esc(m.why)}</span>` : ''}</div>
<input class="s" type="number" step="any" inputmode="decimal" data-gear="${esc(g.key)}" value="${m.amt == null ? '' : esc(m.amt)}" placeholder="$ ex GST"><label><span>Nothing to pay</span> <input type="checkbox" data-gearnone="${esc(g.key)}"${m.none ? ' checked' : ''}></label></div>`; };
    const gNeed = res ? (res.gear || []).filter(x => x.how == 'need') : [], gDone = res ? (res.gear || []).filter(x => x.how != 'need') : [];
    const sNeed = res ? res.solar.filter(x => x.how == 'need') : [], sDone = res ? res.solar.filter(x => x.how != 'need') : [], cnt = h => sDone.filter(x => x.how == h).length;
    return `<div class="card"><h4>The basics</h4>
<div class="f"><span>Start date</span>${inp('start', set.start, 'm', 'date')}<span>End date</span>${inp('end', set.end, 'm', 'date')}<span>blank runs to today</span></div>
<div class="f"><span>Opening balance</span>${inp('open', set.open, 's', 'number')}<span>what was in the bank on the start date, 0 if you don't know</span></div>
<div class="f"><span>Invoices paid after</span>${inp('terms', set.terms, 's', 'number')}<span>days, unless a client below says different</span></div>
<div class="f"><span>Super</span>${inp('superRate', set.superRate, 's', 'number')}<span>%</span><span>STC money lands</span>${inp('stcDelay', set.stcDelay, 's', 'number')}<span>days after the job</span><span>Look ahead</span>${inp('horizon', set.horizon, 's', 'number')}<span>days</span></div>
<div class="f"><span>Suppliers on a monthly account</span>${inp('acctSup', set.acctSup, 'g', 'text', 'haymans|polyaire')}<span>part of each name with | between. Their AroFlo purchase orders are paid at the end of the next month, everyone else's on the day.</span></div></div>
<div class="card paylist"><h4>Pay list</h4>${loaded ? `<div class="warn" style="background:#ecfdf5;border-color:#a7f3d0">${esc(loaded)}</div>` : ''}<p class="hint">Names and pay figures stay in this device's Tampermonkey. They are never in the script or sent anywhere.</p>${people}<div class="f"><button class="btn" data-act="add" data-list="people">Add a person</button>${names.length ? '' : '<span>Hit Refresh first so the names off the timesheets show here.</span>'}</div></div>
<div class="card"><h4>Clients on different terms</h4>${terms}<div class="f"><button class="btn" data-act="add" data-list="clientTerms">Add a client</button></div></div>
<div class="card"><h4>Estimated running costs</h4><p class="hint">Guesses for what can't be read from here. Untick one to leave it out. Amounts are what leaves the bank.</p>${est}<div class="f"><button class="btn" data-act="add" data-list="estimates">Add an estimate</button></div></div>
<div class="card"><h4>Extra days off</h4><p class="hint">Queensland public holidays are built in. Add show day or anything local, as dates like 2026-08-12, with commas between.</p><div class="f"><input class="g" type="text" data-hols="1" value="${esc((set.extraHols || []).join(', '))}"></div></div>
${res ? `<div class="card"><h4>Solar jobs</h4><p class="hint">Only jobs with no STC line in AroFlo are listed here, biggest first, counted as $0 till you type a figure or tick No STCs (quotes, isos and reports). It's remembered for every refresh.</p>${sNeed.map(srow).join('') || '<div class="f">Nothing waiting on a figure.</div>'}${sDone.length ? `<div class="f"><button class="btn g2" data-act="sorted">${sorted ? 'Hide' : 'Show'} the ${sDone.length} already sorted</button><span>${[cnt('line') ? cnt('line') + ' off AroFlo STC lines' : '', cnt('set') ? cnt('set') + ' with your figure' : '', cnt('none') ? cnt('none') + ' marked no STCs' : ''].filter(Boolean).join(', ')}</span></div>${sorted ? '<p class="hint">A figure typed in here is used in place of the AroFlo line.</p>' + sDone.map(srow).join('') : ''}` : ''}</div>` : ''}
${res ? `<div class="card"><h4>Purchase orders with no price</h4><p class="hint">Gear ordered on an AroFlo purchase order with no cost on it, so nothing leaves the account for it till you type what it cost (ex GST, the GST is added) or tick Nothing to pay (an empty or doubled up order). Orders to Tradezone and CNW only show for months their account pages weren't read.</p>${gNeed.map(grow).join('') || '<div class="f">Nothing waiting on a figure.</div>'}${gDone.length ? `<div class="f"><button class="btn g2" data-act="gsorted">${gsorted ? 'Hide' : 'Show'} the ${gDone.length} already sorted</button><span>${$0(gDone.reduce((a, x) => a + x.amt, 0))} ex GST set</span></div>${gsorted ? gDone.map(grow).join('') : ''}` : ''}</div>` : ''}
<div class="card"><h4>Move the settings to another device</h4><p class="hint">Copy the code here, then paste it in the same box on the other device and tap Load. It holds the pay list, so treat it like the figures themselves. A full code replaces the settings on that device. An add-on code only adds what's in it.</p><textarea class="code" placeholder="Paste a settings code here to load it"></textarea><div class="f"><button class="btn" data-act="export">Copy my settings code</button><button class="btn g2" data-act="import">Load the code in the box</button></div><div class="warn lerr" style="display:none"></div></div>`;
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
    box.innerHTML = `<div class="hd"><b>EC Ledger${VER ? ' <small style="font-weight:400;opacity:.7">' + esc(VER) + '</small>' : ''}</b><button class="go">Refresh</button><button class="x" title="Close">&times;</button></div>
<div class="tabs"><button data-tab="over">Overview</button><button data-tab="st">Statement</button><button data-tab="pay">Pays</button><button data-tab="set">Settings</button></div>
<div class="msg"></div><div class="bd"></div>`;
    document.body.appendChild(box);
    b.onclick = () => { const open = box.style.display != 'flex'; box.style.display = open ? 'flex' : 'none'; if (open) { sync(); calc(); draw(); } };
    box.querySelector('.x').onclick = () => { box.style.display = 'none'; };
    box.querySelector('.go').onclick = refresh;
    box.querySelector('.tabs').onclick = e => { const t = e.target.closest('button'); if (t) { tab = t.dataset.tab; more = 150; loaded = ''; sync(); calc(); draw(); } };
    box.querySelector('.bd').addEventListener('click', async e => {
      const t = e.target.closest('[data-act]'); if (!t || t.tagName == 'INPUT') return;
      const a = t.dataset.act;
      if (a == 'add' || a == 'rm' || a == 'import' || a == 'export') sync();
      if (a == 'more') { more += 300; draw(); }
      if (a == 'sorted') { sorted = !sorted; draw(); }
      if (a == 'gsorted') { gsorted = !gsorted; draw(); }
      if (a == 'log') {
        // the text goes in a box first, so it's there to copy by hand whatever the clipboard does
        const text = issuesLog(), ta = box.querySelector('.logbox');
        ta.style.display = 'block'; ta.value = text;
        const ok = await copyText(text); if (ok !== true) { ta.focus(); ta.select(); }
        say(ok === true ? 'Issues log copied (' + text.split('\n').length + ' lines). Paste it to Claude.' : ok ? 'Should be copied. If it won\'t paste, select all in the box and copy it.' : 'Select all in the box and copy it.');
      }
      if (a == 'add') { (set[t.dataset.list] = set[t.dataset.list] || []).push(NEW[t.dataset.list]()); saveSet(); calc(); draw(); }
      if (a == 'rm') { (set[t.dataset.list] || []).splice(+t.dataset.i, 1); saveSet(); calc(); draw(); }
      if (a == 'export') {
        const code = encode(set), ta = box.querySelector('.code'); ta.value = code;
        const ok = await copyText(code); ta.focus(); ta.select();
        say(ok === true ? 'Settings code copied. Paste it into the Ledger on your other device.' : ok ? 'Should be copied. If it won\'t paste, select all in the box and copy it.' : 'Select all in the box and copy it.');
      }
      if (a == 'import') {
        try {
          const s = decode(box.querySelector('.code').value);
          if (s && typeof s == 'object' && s.add && typeof s.add == 'object') {
            // an add-on code: only what's in it goes in, on top of what's here. Someone already on a list (same name) is updated, not doubled.
            const done = [], merge = (list, key, ok) => { if (!Array.isArray(s.add[list])) return; let n = 0; set[list] = set[list] || []; s.add[list].filter(ok).forEach(x => { const i = set[list].findIndex(y => y && y[key] == x[key]); if (i >= 0) Object.assign(set[list][i], x); else set[list].push(x); n++; }); if (n) done.push(n + ' on the ' + { people: 'pay list', clientTerms: 'client terms', estimates: 'estimates' }[list]); };
            merge('people', 'name', x => x && typeof x.name == 'string' && x.name && /^(hourly|salary)$/.test(x.type));
            merge('clientTerms', 'match', x => x && typeof x.match == 'string' && x.match);
            merge('estimates', 'name', x => x && typeof x.name == 'string' && x.name && /^(fixed|fuel|pct)$/.test(x.kind));
            if (s.add.set && typeof s.add.set == 'object') { // the plain number settings: days to pay, opening balance, super, STC delay, look ahead
              const names = { terms: 'days to pay', open: 'opening balance', superRate: 'super', stcDelay: 'STC delay', horizon: 'look ahead' }, got = [];
              Object.keys(names).forEach(k => { const v = s.add.set[k]; if (v === undefined || v === '' || !isFinite(+v) || +v < 0) return; set[k] = +v; got.push(names[k] + ' ' + (+v)); });
              ['start', 'end'].forEach(k => { const v = s.add.set[k]; if (typeof v != 'string' || !(/^\d{4}-\d{2}-\d{2}$/.test(v) || (k == 'end' && v === ''))) return; set[k] = v; got.push(k + ' date ' + (v || 'cleared')); });
              if (got.length) done.push(got.join(', '));
            }
            if (s.add.gear && typeof s.add.gear == 'object') { // figures for gear with no price in AroFlo: { 'po4279': { amt } or { none: true }, or a job number: { amt, d } }
              let n = 0; set.gear = set.gear || {};
              Object.keys(s.add.gear).forEach(k => { const v = s.add.gear[k]; if (!/^(po\w{1,12}|\d{3,6})$/.test(k) || !v || typeof v != 'object') return; const more = Object.assign({}, typeof v.why == 'string' && v.why ? { why: v.why.slice(0, 120) } : {}, /^\d{4}-\d{2}-\d{2}$/.test(v.d || '') ? { d: v.d } : {}); if (v.none === true) set.gear[k] = Object.assign({ none: true }, more); else if (isFinite(+v.amt) && +v.amt >= 0) set.gear[k] = Object.assign({ amt: +v.amt }, more); else return; n++; });
              if (n) done.push(n + ' lot' + (n > 1 ? 's' : '') + ' of unpriced gear set');
            }
            if (s.add.stc && typeof s.add.stc == 'object') { // STC figures for a batch of jobs: { jobNumber: { amt } or { none: true } }
              let n = 0; set.stc = set.stc || {};
              Object.keys(s.add.stc).forEach(jn => { const v = s.add.stc[jn]; if (!/^\d{3,6}$/.test(jn) || !v || typeof v != 'object') return; const why = typeof v.why == 'string' && v.why ? { why: v.why.slice(0, 120) } : {}; if (v.none === true) set.stc[jn] = Object.assign({ none: true }, why); else if (isFinite(+v.amt) && +v.amt >= 0) set.stc[jn] = Object.assign({ amt: +v.amt }, why); else return; n++; });
              if (n) done.push(n + ' solar job' + (n > 1 ? 's' : '') + ' set');
            }
            if (!done.length) throw new Error('nothing in it to add');
            saveSet(); calc(); loaded = 'Added from the code: ' + done.join(', ') + '. Everything else is as it was.'; say(loaded); draw();
            const pl = box.querySelector('.paylist'); if (pl) pl.scrollIntoView({ block: 'start' }); // up to the pay list, so what went in is on screen
            return;
          }
          if (!s || typeof s != 'object' || !Array.isArray(s.people) || !Array.isArray(s.estimates)) throw new Error('not a settings code');
          set = Object.assign(E.DEFAULTS(todayIso()), s); saveSet(); calc(); loaded = 'Settings loaded from the code.'; say(loaded); draw();
          const pl = box.querySelector('.paylist'); if (pl) pl.scrollIntoView({ block: 'start' });
        } catch (er) {
          // said right under the button as well as up top, so it isn't missed at the bottom of a long page
          const why = /not a settings code|nothing in it/.test(er.message) ? er.message : 'the code looks cut short or has extra bits in it, copy the whole thing again';
          const m = 'That code didn\'t load: ' + why + '.'; say(m); const le = box.querySelector('.lerr'); if (le) { le.textContent = m; le.style.display = 'block'; }
        }
      }
    });
    box.querySelector('.bd').addEventListener('change', e => {
      const el = e.target;
      if (el.dataset.act == 'hard') { hard = el.checked; return draw(); }
      if (el.dataset.act == 'ahead') { ahead = el.checked; return draw(); }
      sync();
      if (el.dataset.k) { try { put(el.dataset.k, el); } catch (er) { say('That row has changed in another tab. Have another go.'); return draw(); } }
      else if (el.dataset.hols) set.extraHols = el.value.split(/[,\s]+/).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
      else if (el.dataset.stc) { set.stc = set.stc || {}; if (el.value === '') delete set.stc[el.dataset.stc]; else set.stc[el.dataset.stc] = { amt: +el.value }; }
      else if (el.dataset.gear) { set.gear = set.gear || {}; const o = set.gear[el.dataset.gear] || {}, keep = Object.assign({}, o.d ? { d: o.d } : {}, o.why ? { why: o.why } : {}); if (el.value === '') delete set.gear[el.dataset.gear]; else set.gear[el.dataset.gear] = Object.assign({ amt: +el.value }, keep); }
      else if (el.dataset.gearnone) { set.gear = set.gear || {}; if (el.checked) set.gear[el.dataset.gearnone] = { none: true }; else delete set.gear[el.dataset.gearnone]; }
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
