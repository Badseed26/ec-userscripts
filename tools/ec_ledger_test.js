#!/usr/bin/env node
// Checks the maths in src/ec-ledger.js with made up numbers. Run: node tools/ec_ledger_test.js
// Only the part between ENGINE START and ENGINE END is run, so nothing here touches a page or anyone's real figures.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ec-ledger.js'), 'utf8');
const m = src.match(/\/\/ ===== ENGINE START[^\n]*\n([\s\S]*?)\/\/ ===== ENGINE END/);
if (!m) { console.error('no ENGINE block in src/ec-ledger.js'); process.exit(1); }
const E = new Function(m[1] + '\nreturn ENGINE;')();

let pass = 0, fail = 0;
const near = (a, b) => Math.abs(a - b) < 0.011;
function ok(name, got, want) {
  const good = typeof want == 'number' ? near(got, want) : JSON.stringify(got) === JSON.stringify(want);
  if (good) pass++; else { fail++; console.log('FAIL ' + name + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want)); }
}
const hols = new Set(E.HOLS);
const T = (who, day, from, to, jn) => ({ who, s: day + 'T' + from + ':00', e: day + 'T' + to + ':00', jn });

// ---- dates ----
ok('1 July 2026 is a Wednesday', E.dow('2026-07-01'), 3);
ok('weekend rolls to Monday', E.nextBiz('2026-08-01'), '2026-08-03');
ok('weekend rolls back to Friday', E.prevBiz('2026-10-31'), '2026-10-30');
ok('end of February', E.eom('2027-02'), '2027-02-28');
ok('month after December', E.addMonth('2026-12', 2), '2027-02');
ok('financial year start, November', E.fyStart('2026-11-20'), '2026-07-01');
ok('financial year start, March', E.fyStart('2027-03-02'), '2026-07-01');

// ---- tax held from a week's pay (the ATO's scale 2 formula) ----
ok('under the threshold', E.withhold(361), 0);
ok('1,500 a week', E.withhold(1500), Math.round(0.32 * 1500.99 - 181.7319));
ok('2,000.80 a week drops the cents', E.withhold(2000.8), Math.round(0.32 * 2000.99 - 181.7319));
ok('3,000 a week', E.withhold(3000), Math.round(0.39 * 3000.99 - 363.4627));

// ---- one hourly person's week (Wed 4 Nov to Tue 10 Nov 2026, no public holidays) ----
const P = { name: 'Alex Test', type: 'hourly', rate: 50 };
const wk = (lines) => E.payWeek(P, '2026-11-04', E.hoursByDay(lines)['Alex Test'], hols, 12);
let w = wk([]);
ok('nothing logged: paid the 38', w.ord, 38); ok('nothing logged: gross', w.gross, 1900); ok('nothing logged: super', w.sup, 228); ok('nothing logged: top up', w.top, 38);
w = wk(['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10'].map(d => T('Alex Test', d, '07:00', '15:00')));
ok('5 x 8 hours: 40 plain hours', w.ord, 40); ok('5 x 8 hours: no overtime', w.ot, 0); ok('5 x 8 hours: gross', w.gross, 2000); ok('5 x 8 hours: no top up', w.top, 0);
w = wk([T('Alex Test', '2026-11-04', '06:00', '17:00')]); // 11 hours on one weekday: 8 plain, 2 at 1.5, 1 at 2
ok('11 hour day: overtime', w.ot, 5); ok('11 hour day: plain hours with the top up', w.ord, 38); ok('11 hour day: gross', w.gross, 50 * 43);
w = wk([T('Alex Test', '2026-11-07', '08:00', '09:00')]); // 1 hour on a Saturday is paid as 4: 2 at 1.5, 2 at 2
ok('short Saturday: 4 hour minimum', w.ot, 7); ok('short Saturday: gross', w.gross, 50 * 45);
w = wk([T('Alex Test', '2026-11-08', '08:00', '14:00')]); // 6 hours on a Sunday at double
ok('Sunday: double time', w.ot, 12);
w = wk([T('Alex Test', '2026-11-04', '07:00', '08:30', '9001'), T('Alex Test', '2026-11-04', '08:30', '15:00', '9001')]); // travel then site, same day
ok('the guarantee for a full week', w.guar, 38); ok('travel counts as worked time', w.logged, 8); ok('travel sits inside the 38', w.ord, 38);
ok('super is on plain time only', wk([T('Alex Test', '2026-11-04', '06:00', '17:00')]).sup, 50 * 38 * 0.12);
// public holiday week: Mon 5 Oct 2026 (week Wed 30 Sep to Tue 6 Oct)
const ph = (lines) => E.payWeek(P, '2026-09-30', E.hoursByDay(lines)['Alex Test'], hols, 12);
ok('public holiday off: still 38', ph([]).ord, 38);
w = ph([T('Alex Test', '2026-10-05', '07:00', '13:00')]); // 6 hours worked on the holiday at 2.5
ok('public holiday worked: 2.5 times', w.ot, 15); ok('public holiday worked: the day still counts to the 38', w.ord, 38 - 7.6);
// someone who starts part way through the week only gets those days
w = E.payWeek({ name: 'Alex Test', type: 'hourly', rate: 50, from: '2026-11-09' }, '2026-11-04', {}, hols, 12);
ok('started Monday: 2 days guaranteed', w.ord, 15.2);
// salary
w = E.payWeek({ name: 'Sam Test', type: 'salary', weekly: 1300 }, '2026-11-04', {}, hols, 12);
ok('salary: flat week', w.gross, 1300); ok('salary: super', w.sup, 156); ok('salary: net', w.net, 1300 - E.withhold(1300));

// ---- a small replay ----
const data = {
  from: '2026-04-01',
  invoices: [
    { n: 'INV1', d: '2026-07-06', st: 'Approved', ex: 1000, inc: 1100, cl: 'Big Builder Pty Ltd', jn: '9001', tn: 'PO 123 - 1 Test St solar replacement' },
    { n: 'INV2', d: '2026-07-10', st: 'Approved', ex: 2000, inc: 2200, cl: 'Mrs Smith', jn: '9002', tn: '2 Test Rd switchboard' },
    { n: 'INV3', d: '2026-07-10', st: 'Void', ex: 500, inc: 550, cl: 'Mrs Smith', jn: '9003', tn: 'void one' },
    { n: 'INV0', d: '2026-06-24', st: 'Approved', ex: 300, inc: 330, cl: 'Mrs Smith', jn: '9000', tn: 'June job' },
    { n: 'INVM', d: '2026-05-11', st: 'Approved', ex: 5000, inc: 5500, cl: 'Mrs Smith', jn: '8900', tn: 'May solar install' }, // before the start: read for the GST, not a solar job to chase
    { n: 'INVJ', d: '2026-07-02', st: 'Approved', ex: 4000, inc: 4400, cl: 'Mrs Smith', jn: '8950', tn: 'solar job done in June, invoiced in July' },
    { n: 'INV4', d: '2026-07-15', st: 'IN_PROGRESS', ex: 700, inc: 770, cl: 'Mrs Smith', jn: '9004', tn: 'still being written' },
    { n: 'INV5', d: '2026-05-01', st: 'IN_PROGRESS', ex: 900, inc: 990, cl: 'Mrs Smith', jn: '9005', tn: 'old draft from before the start' },
  ],
  pos: [
    { no: '4401', d: '2026-07-08', sup: 'Hardware Store', ex: 100, jn: '9002' },
    { no: '4402', d: '2026-07-08', sup: 'TradeZone Gold Coast', ex: 900, jn: '9001' }, // read off the supplier's own account instead
  ],
  sup: [
    { sup: 'Tradezone', d: '2026-07-03', inc: 990 }, { sup: 'Tradezone', d: '2026-07-20', inc: 110 },
    { sup: 'CNW', d: '2026-06-15', inc: 220 }, // June order, paid end of July
  ],
  times: [T('Alex Test', '2026-07-02', '07:00', '15:00', '9001'), T('Lee Other', '2026-07-02', '07:00', '11:00', '9001'), T('Lee Other', '2026-06-10', '07:00', '11:00', '8950')],
  stc: { '9001': { amt: -1500 } },
};
const set = { start: '2026-07-01', terms: 14, clientTerms: [{ match: 'big builder', days: 30 }], people: [{ name: 'Alex Test', type: 'hourly', rate: 50 }], estimates: [{ name: 'Fuel', kind: 'fuel', veh: 1, km: 500, l100: 10, price: 2, gst: true }, { name: 'Phones', kind: 'fixed', amt: 110, per: 'month', gst: true }, { name: 'Insurance', kind: 'fixed', amt: 1200, per: 'year', gst: false }, { name: 'Workers comp', kind: 'pct', pct: 2, gst: false }] };
const R = E.run(data, set, '2026-11-20');
const find = (kind, f) => R.tx.filter(t => t.kind == kind && (!f || f(t)));
ok('builder on 30 days lands Wed 5 Aug', find('inv', t => /INV1/.test(t.label))[0].d, '2026-08-05');
ok('everyone else on 14 days lands Fri 24 Jul', find('inv', t => /INV2/.test(t.label))[0].d, '2026-07-24');
ok('invoice lands inc GST', find('inv', t => /INV2/.test(t.label))[0].amt, 2200);
ok('void invoice left out', find('inv', t => /INV3/.test(t.label)).length, 0);
ok('draft invoice left out', find('inv', t => /INV4/.test(t.label)).length, 0);
ok('draft invoices are counted up for the note', [R.drafts.n, R.drafts.inc, R.drafts.list.map(d => d.n)], [1, 770, ['INV4']]);
ok('June invoice landing in July counts', find('inv', t => /INV0/.test(t.label))[0].d, '2026-07-08');
ok('STC money 2 days after the last day on the job', find('stc')[0].d, '2026-07-04');
ok('STC amount off the AroFlo line', find('stc')[0].amt, 1500);
ok('Tradezone July orders paid Mon 31 Aug', find('sup', t => /Tradezone/.test(t.label))[0].d, '2026-08-31');
ok('Tradezone July orders added up', find('sup', t => /Tradezone/.test(t.label))[0].amt, -1100);
ok('CNW June orders paid Fri 31 Jul', find('sup', t => /CNW/.test(t.label))[0].d, '2026-07-31');
ok('other supplier PO paid on the day with GST', find('po')[0].amt, -110);
ok('supplier account POs not doubled up', find('po').length, 1);
ok('first payday is Wed 1 July', find('wage')[0].d, '2026-07-01');
ok('paydays are all Wednesdays', find('wage').every(t => E.dow(t.d) == 3), true);
ok('super goes the same day as the pay', find('super')[0].d, '2026-07-01');
const julyPays = R.wageWeeks.filter(x => x.pay.slice(0, 7) == '2026-07');
ok('5 paydays in July 2026', julyPays.length, 5);
ok('July held tax paid Fri 21 Aug', find('payg', t => /July/.test(t.label))[0].d, '2026-08-21');
ok('July held tax adds up', find('payg', t => /July/.test(t.label))[0].amt, -julyPays.reduce((a, x) => a + x.tax, 0));
ok('September held tax goes with the BAS, Wed 28 Oct', find('payg', t => /September/.test(t.label))[0].d, '2026-10-28');
ok('June held tax lands Tue 28 Jul', find('payg', t => /June/.test(t.label))[0].d, '2026-07-28');
ok('fuel every Friday', R.tx.filter(t => t.label == 'Fuel').every(t => E.dow(t.d) == 5), true);
ok('fuel amount', R.tx.filter(t => t.label == 'Fuel')[0].amt, -100);
ok('yearly bill spread by month', R.tx.filter(t => t.label == 'Insurance')[0].amt, -100);
ok('monthly bill on the 15th', R.tx.filter(t => t.label == 'Phones')[0].d, '2026-07-15');
ok('workers comp is a share of the month\'s gross pay', R.tx.filter(t => t.label == 'Workers comp' && t.d == '2026-07-31')[0].amt, -E.r2(julyPays.reduce((a, x) => a + x.gross, 0) * 0.02));
// GST for July to September, paid 28 Oct: 100 (INV1) + 200 (INV2) + 30 (INV0) + 400 (INVJ) in, less CNW 20, Tradezone 100, hardware 10
ok('GST on the hard data, July to September', find('gst', t => t.tag == 'data' && t.d == '2026-10-28')[0].amt, -(730 - 20 - 100 - 10));
ok('GST for April to June lands Tue 28 Jul', R.tx.some(t => t.kind == 'gst' && t.d == '2026-07-28'), true);
ok('nothing before the start date', R.tx.every(t => t.d >= '2026-07-01'), true);
ok('nothing past 6 weeks ahead', R.tx.every(t => t.d <= '2027-01-01'), true);
ok('lines after today are marked as projection', R.tx.filter(t => t.proj).every(t => t.d > '2026-11-20') && R.tx.some(t => t.proj), true);
ok('other people\'s hours are listed, not paid, from the start date', R.others, { 'Lee Other': 4 });
ok('only solar jobs from the start date on are listed', R.solar.map(s => s.jn), ['9001']);
ok('solar job found with its STC line', R.solar[0].how, 'line');
ok('ATO bills after the window are added up', R.atoLater > 0, true);
// a solar job with no STC line is flagged at 0 until a figure is typed in, then remembered
const R2 = E.run(Object.assign({}, data, { stc: {} }), set, '2026-11-20');
ok('no STC line: flagged', R2.solar[0].how, 'need'); ok('no STC line: no money counted', R2.tx.filter(t => t.kind == 'stc').length, 0);
const R3 = E.run(Object.assign({}, data, { stc: {} }), Object.assign({}, set, { stc: { '9001': { amt: 1800 } } }), '2026-11-20');
ok('typed in STC figure used', R3.tx.filter(t => t.kind == 'stc')[0].amt, 1800); ok('typed in STC figure tagged as a setting', R3.tx.filter(t => t.kind == 'stc')[0].tag, 'set');
ok('marked no STCs', E.run(Object.assign({}, data, { stc: {} }), Object.assign({}, set, { stc: { '9001': { none: true } } }), '2026-11-20').solar[0].how, 'none');

// ---- only what moves inside the period is counted, and money for earlier work is marked ----
ok('old draft from before the start is not in the draft count', [R.drafts.n, R.drafts.inc], [1, 770]);
ok('June invoice paid in July is marked before start', find('inv', t => /INV0/.test(t.label))[0].pre, true);
ok('July invoice is not marked', find('inv', t => /INV2/.test(t.label))[0].pre, false);
ok('June supplier account is marked before start', find('sup', t => /CNW/.test(t.label))[0].pre, true);
ok('July supplier account is not marked', find('sup', t => /Tradezone/.test(t.label))[0].pre, false);
ok('the 1 July pay is for a week before the start', find('wage')[0].pre, true);
ok('the 8 July pay is not', find('wage')[1].pre, false);
ok('June held tax is marked before start', find('payg', t => /June/.test(t.label))[0].pre, true);
ok('GST for April to June is marked before start', R.tx.filter(t => t.kind == 'gst' && t.d == '2026-07-28').every(t => t.pre), true);
ok('GST for July to September is not', R.tx.filter(t => t.kind == 'gst' && t.d == '2026-10-28').some(t => t.pre), false);
ok('estimates are never marked before start', R.tx.filter(t => t.kind == 'est').some(t => t.pre), false);
// in: the June invoice (330) plus the GST back on April to June's estimates
ok('the before start money in is added up', E.tally(R).preIn, E.r2(R.tx.filter(t => t.pre && t.amt > 0).reduce((s, t) => s + t.amt, 0)));
ok('the June invoice is in it', E.tally(R).preIn >= 330 && E.tally(R).preOut > 0, true);
ok('before start money is part of the in and out, not on top', E.tally(R).preIn <= E.tally(R).in && E.tally(R).preOut <= E.tally(R).out, true);
ok('invoices paid inside the period are counted for the note', R.counts.inv, R.tx.filter(t => t.kind == 'inv' && !t.proj).length);
ok('timesheet lines counted are from the start on', R.counts.times, 2);
// a period with an end date: 1 July to 30 September, run on 20 November
const late = Object.assign({}, data, { invoices: data.invoices.concat([{ n: 'INV9', d: '2026-10-10', st: 'Approved', ex: 9000, inc: 9900, cl: 'Mrs Smith', jn: '9009', tn: 'October solar job' }]), times: data.times.concat([T('Lee Other', '2026-10-12', '07:00', '15:00', '9009')]) });
const setE = Object.assign({}, set, { end: '2026-09-30' });
const RE = E.run(late, setE, '2026-11-20'), RE0 = E.run(data, setE, '2026-11-20');
ok('end date: nothing after it', RE.tx.every(t => t.d <= '2026-09-30'), true);
ok('end date: nothing before the start', RE.tx.every(t => t.d >= '2026-07-01'), true);
ok('end date: no projection', RE.tx.some(t => t.proj), false);
ok('end date: the as at day is the end date', [RE.today, RE.ended], ['2026-09-30', true]);
ok('end date: an invoice after it is not in', RE.tx.some(t => /INV9/.test(t.label)), false);
ok('end date: money after it adds nothing to the ATO bills', RE.atoLater, RE0.atoLater);
ok('end date: the quarter\'s GST is still to come', RE.tx.some(t => t.kind == 'gst' && t.d == '2026-10-28'), false);
ok('end date: pays stop at it', RE.wageWeeks.every(w => w.pay <= '2026-09-30'), true);
ok('end date: hours after it are not listed', RE.others, { 'Lee Other': 4 });
ok('end date: solar jobs after it are not listed', RE.solar.map(s => s.jn), ['9001']);
ok('end date: the balance is the lines added up', E.tally(RE).now, E.r2(RE.tx.reduce((a, t) => a + t.amt, 0)));
ok('an end date after today is ignored', E.run(data, Object.assign({}, set, { end: '2027-06-30' }), '2026-11-20').ended, false);

// ---- looking back a year: the older tax table, 2025 public holidays ----
ok('pays before 1 July 2026 use the older table', E.withhold(1500, '2026-06-24'), Math.round(0.32 * 1500.99 - 176.5769));
ok('pays from 1 July 2026 use the newer one', E.withhold(1500, '2026-07-01'), Math.round(0.32 * 1500.99 - 181.7319));
ok('older table, under its threshold', E.withhold(360, '2025-08-06'), 0);
ok('older table, 1,000 a week', E.withhold(1000, '2025-08-06'), Math.round(0.3227 * 1000.99 - 180.0385));
ok('no pay day given means the current table', E.withhold(1500), E.withhold(1500, '2026-11-18'));
ok('King\'s Birthday 2025 is in', hols.has('2025-10-06'), true);
ok('Labour Day 2025 is in', hols.has('2025-05-05'), true);

// ---- purchase orders: account suppliers, months an account page doesn't cover, and orders with no price ----
const pd = {
  from: '2025-03-01', invoices: [{ n: 'I1', d: '2025-09-10', st: 'Approved', ex: 1000, inc: 1100, cl: 'Builder', jn: '8100', tn: 'Solar install' }], times: [], stc: {},
  sup: [{ sup: 'Tradezone', d: '2025-10-03', inc: 1100, ref: 'a' }, { sup: 'Tradezone', d: '2025-11-05', inc: 2200, ref: 'b' }],
  pos: [
    { no: '1', d: '2025-08-05', sup: 'HAYMANS ELECTRICAL', jn: '8001', ex: 100, st: 'PROCESSED' },
    { no: '2', d: '2025-08-20', sup: 'Haymans Electrical', jn: '8002', ex: 200, st: 'PROCESSED' },
    { no: '3', d: '2025-08-12', sup: 'TRADEZONE', jn: '', ex: 300, st: 'PROCESSED' },   // before the account page's first order: stands in
    { no: '4', d: '2025-10-15', sup: 'TRADEZONE', jn: '', ex: 400, st: 'PROCESSED' },   // the account page has that month: left out
    { no: '5', d: '2025-09-02', sup: 'CNW', jn: '', ex: 500, st: 'PROCESSED' },         // no CNW account page at all: stands in
    { no: '6', d: '2025-09-09', sup: 'BUNNINGS', jn: '', ex: 50, st: 'PROCESSED' },     // paid on the day
    { no: '7', d: '2025-09-15', sup: 'RAYSTECH', jn: '8100', ex: 0, st: 'IN_PROGRESS', li: '10x panels' },
    { no: '8', d: '2025-09-16', sup: 'RAYSTECH', jn: '', ex: 0, st: 'IN_PROGRESS', li: '' },
    { no: '9', d: '2025-09-17', sup: 'RAYSTECH', jn: '8200', ex: 0, st: 'IN_PROGRESS', li: '1x inverter' },
    { no: '10', d: '2025-10-20', sup: 'TRADEZONE', jn: '', ex: 0, st: 'IN_PROGRESS' },  // unpriced, but the account page covers it
    { no: '11', d: '2025-09-18', sup: 'RAYSTECH', jn: '', ex: 0, st: 'CANCELLED' },
    { no: '12', d: '2025-06-18', sup: 'RAYSTECH', jn: '', ex: 0, st: 'IN_PROGRESS' },   // before the start
  ],
};
const ps = { start: '2025-07-01', people: [], estimates: [] };
const P0 = E.run(Object.assign({}, pd, { pos: pd.pos.concat([{ no: '13', d: '2025-09-10', sup: 'POLYAIRE', jn: '', ex: 1000, st: 'PROCESSED' }]) }), ps, '2025-12-10'), lab = (R, re) => R.tx.filter(t => re.test(t.label));
ok('account supplier: a month\'s orders are one payment', lab(P0, /haymans/i).map(t => [t.d, t.amt, t.kind]), [['2025-09-30', -330, 'sup']]);
ok('own supplier before its account page starts: purchase orders stand in', lab(P0, /TRADEZONE account, August/).map(t => [t.d, t.amt]), [['2025-09-30', -330]]);
ok('own supplier inside its account page: purchase order left out', P0.tx.some(t => t.amt == -440), false);
ok('own supplier with no account page read: purchase orders stand in', lab(P0, /CNW account, September/).map(t => [t.d, t.amt]), [['2025-10-31', -550]]);
ok('account page orders still counted', lab(P0, /Tradezone account, October/).map(t => t.amt), [-1100]);
ok('everyone else is paid on the day', lab(P0, /BUNNINGS/).map(t => [t.d, t.amt, t.kind]), [['2025-09-09', -55, 'po']]);
ok('Polyaire is paid on the day unless it is put on the account list', lab(P0, /POLYAIRE/).map(t => [t.d, t.amt, t.kind]), [['2025-09-10', -1100, 'po']]);
ok('orders with no price are listed, newest first', P0.gear.map(g => [g.key, g.how]), [['po9', 'need'], ['po8', 'need'], ['po7', 'need']]);
ok('nothing is counted for them till a figure is set', P0.tx.some(t => t.kind == 'gear'), false);
ok('the lines on the order ride along', P0.gear.find(g => g.key == 'po7').li, '10x panels');
const P1 = E.run(pd, Object.assign({}, ps, { gear: { po7: { amt: 1000, why: 'ten panels' }, po8: { none: true } } }), '2025-12-10');
ok('a figure on an order: paid on its day with GST', P1.tx.filter(t => t.kind == 'gear').map(t => [t.d, t.amt, t.tag, t.sub]), [['2025-09-15', -1100, 'set', 'ten panels']]);
ok('figure set and nothing to pay are sorted, one still waiting', P1.gear.map(g => [g.key, g.how]), [['po9', 'need'], ['po8', 'none'], ['po7', 'set']]);
const gq = R => R.tx.filter(t => t.kind == 'gst' && t.d == '2025-10-28').reduce((a, t) => a + t.amt, 0);
ok('the GST on it comes back with the BAS', E.r2(gq(P1) - gq(P0)), 100);
const P2 = E.run(pd, Object.assign({}, ps, { gear: { 8100: { amt: 2000 }, 8300: { amt: 500, d: '2025-11-03', why: 'off the pallet' }, 8400: { amt: 900 } } }), '2025-12-10');
ok('a figure for the job covers its orders', P2.gear.map(g => [g.key, g.how, g.d]).filter(g => g[1] != 'need'), [['8300', 'set', '2025-11-03'], ['8100', 'set', '2025-09-15']]);
ok('job figures: counted once each, on the order\'s day or the day given', P2.tx.filter(t => t.kind == 'gear').map(t => [t.d, t.amt]), [['2025-09-15', -2200], ['2025-11-03', -550]]);
ok('a job figure with no order, job or date has nowhere to land', P2.gear.some(g => g.key == '8400'), false);
ok('unpriced gear is not hard data', E.tally(P1, t => t.tag == 'data').rows.some(t => t.kind == 'gear'), false);
ok('balance still adds up with gear in', E.tally(P1).end, E.r2(P1.tx.reduce((a, t) => a + t.amt, 0)));

// ---- casuals, and the number AroFlo's calendar wants for a person ----
const cz = { name: 'Cas', type: 'casual', rate: 40 }, hz = { name: 'Cas', type: 'hourly', rate: 40 };
const cw = E.payWeek(cz, '2026-08-05', { '2026-08-05': 6, '2026-08-06': 10 }, hols, 12), hw = E.payWeek(hz, '2026-08-05', { '2026-08-05': 6, '2026-08-06': 10 }, hols, 12);
ok('casual: paid the hours logged, overtime after 8', cw.gross, 40 * (6 + 8) + 40 * 2 * 1.5);
ok('casual: no top up to the guarantee', cw.top, 0);
ok('hourly: same hours are topped up to 38', hw.gross, 40 * 38 + 40 * 2 * 1.5);
ok('casual: a week with nothing logged pays nothing', E.payWeek(cz, '2026-08-05', {}, hols, 12).gross, 0);
ok('casual: a public holiday off isn\'t paid', E.payWeek(cz, '2026-09-30', { '2026-10-01': 8 }, hols, 12).gross, 320);
ok('casual: super on the plain hours', cw.sup, E.r2(40 * 14 * 0.12));
ok('user number off a coded id', E.userNo('EFS00000010'), '4');
ok('user number, longer id', E.userNo('EFS000010R0'), String((32768 + 24 * 32) / 8));
ok('user number: not a whole number means none', E.userNo('EFS00000011'), '');
ok('user number: odd characters mean none', E.userNo('EFS0000I0L0'), '');
ok('user number: nothing in, nothing out', E.userNo(''), '');

// ---- the balance ----
const A = E.tally(R), Dn = E.tally(R, t => t.tag == 'data');
ok('balance is the lines added up', A.end, E.r2(R.tx.reduce((a, t) => a + t.amt, 0)));
ok('today\'s balance leaves out the projection', A.now, E.r2(R.tx.filter(t => !t.proj).reduce((a, t) => a + t.amt, 0)));
ok('hard data only drops pays and estimates', Dn.rows.every(t => t.tag == 'data'), true);
ok('in less out is the balance', E.r2(A.in - A.out), A.now);
ok('lowest point is never above the finish', A.low.bal <= A.now, true);
ok('weeks start on a Monday', A.weeks.every(x => E.dow(x.ws) == 1), true);
ok('opening balance carries through', E.tally(E.run(data, Object.assign({}, set, { open: 5000 }), '2026-11-20')).end, E.r2(A.end + 5000));

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
