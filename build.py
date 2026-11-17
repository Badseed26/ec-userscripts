#!/usr/bin/env python3
"""Builds the installable userscripts from src/.

Each <name>.user.js at the top of the repo (the file Tampermonkey installs and updates from) is the script in src/<name>.js
with a small live updater in front of it. The updater checks the repo's latest commit every 2 minutes (free when nothing's
changed), keeps the newest src/<name>.js it finds, and runs that on the next page load, so a push is live in a couple of
minutes instead of whenever Tampermonkey gets round to it. The built in copy runs when there's nothing newer, when the new
code needs a permission this install hasn't got (Tampermonkey's own update brings that in), or when the browser won't run it.

Run after every change in src/:  python3 build.py
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = 'Badseed26/ec-userscripts'
ADD_GRANT = ['GM_xmlhttpRequest', 'GM_getValue', 'GM_setValue']
ADD_CONNECT = ['api.github.com', 'raw.githubusercontent.com']
NEED = re.compile(r'^// @(grant|connect|match|exclude|include|run-at|sandbox)\s+.+$', re.M)

LOADER = r'''
// Built from src/%(name)s.js by build.py. Change src/%(name)s.js, not this file.
(function () {
  // Live updates (23/10): Tampermonkey only checks for a new version every few hours. This checks the repo's latest commit every
  // 2 min (free when nothing's changed) and keeps the newest code here, so a push runs on the next page load. If the new code needs
  // a permission this install hasn't got, or this browser won't run it, the built in copy below runs like before.
  const __ecName = %(jname)s, __ecVer = %(jver)s, __ecHave = new Set(%(jhave)s);
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
    GM_xmlhttpRequest({ method: 'GET', url: 'https://raw.githubusercontent.com/%(repo)s/main/src/' + __ecName + '.js?t=' + Date.now(), timeout: 30000, headers: { 'Cache-Control': 'no-cache' }, onload: q => {
      try { if (q.status != 200) return; const v = __ecMeta(q.responseText || '').v; if (v) __ecTake(q.responseText, 'raw:' + v); } catch (e) {} } });
  }
  function __ecCheck() {
    try {
      if (Date.now() - GM_getValue('ecLiveAt', 0) < 2 * 60e3) return; GM_setValue('ecLiveAt', Date.now());
      const et = GM_getValue('ecLiveEtag', ''), hd = { Accept: 'application/vnd.github+json' }; if (et) hd['If-None-Match'] = et;
      GM_xmlhttpRequest({ method: 'GET', url: 'https://api.github.com/repos/%(repo)s/commits/main', headers: hd, timeout: 20000, onerror: __ecRaw, ontimeout: __ecRaw, onload: r => {
        try {
          if (r.status == 304) return; // nothing new, and it doesn't count against GitHub's limit
          if (r.status != 200) { __ecSay('GitHub said ' + r.status + ', checking the file directly'); return __ecRaw(); }
          const sha = (JSON.parse(r.responseText) || {}).sha, tag = (((r.responseHeaders || '').match(/^etag:\s*(.+)$/mi) || [])[1] || '').trim();
          if (!sha) return; if (sha == GM_getValue('ecLiveSha', '')) { if (tag) GM_setValue('ecLiveEtag', tag); return; }
          GM_xmlhttpRequest({ method: 'GET', url: 'https://raw.githubusercontent.com/%(repo)s/' + sha + '/src/' + __ecName + '.js', timeout: 30000, onload: q => {
            try { if (q.status == 200) __ecTake(q.responseText || '', sha, tag); } catch (e) {} } });
        } catch (e) {} } });
    } catch (e) {}
  }
  if (window.top === window.self) { __ecCheck(); setInterval(__ecCheck, 2 * 60e3 + 5000); }
  if (__ecLive()) return;
  // ---------- the built in copy (src/%(name)s.js at %(ver)s) ----------
%(body)s
})();
'''

def build(name, src):
    m = re.match(r'(\s*// ==UserScript==\n.*?// ==/UserScript==\n)(.*)\Z', src, re.S)
    if not m: sys.exit('no header in src/%s.js' % name)
    head, body = m.group(1), m.group(2)
    ver = re.search(r'^// @version\s+(\S+)', head, re.M).group(1)
    lines = head.rstrip('\n').split('\n')
    end = lines.pop()  # // ==/UserScript==
    have = {re.sub(r'\s+', ' ', l).strip() for l in lines}
    def add(kind, val):
        key = '// @%s %s' % (kind, val)
        if key in have or (kind == 'connect' and '// @connect *' in have): return
        # straight after the last line of the same kind, else before updateURL
        idx = max([i for i, l in enumerate(lines) if l.startswith('// @%s ' % kind)] or [-1])
        if idx < 0: idx = next(i for i, l in enumerate(lines) if l.startswith('// @run-at') or l.startswith('// @updateURL')) - 1
        lines.insert(idx + 1, '// @%-12s %s' % (kind, val)); have.add(key)
    for g in ADD_GRANT: add('grant', g)
    for c in ADD_CONNECT: add('connect', c)
    head = '\n'.join(lines + [end]) + '\n'
    need = sorted({re.sub(r'\s+', ' ', x.group(0)).strip() for x in NEED.finditer(head)})
    return head + LOADER % dict(name=name, jname=json.dumps(name), ver=ver, jver=json.dumps(ver), jhave=json.dumps(need), repo=REPO, body=body.rstrip('\n'))

if __name__ == '__main__':
    OLD = 'wre'  # the old prefix, for the one off copies below
    for f in sorted(os.listdir(os.path.join(ROOT, 'src'))):
        if not f.endswith('.js'): continue
        name = f[:-3]
        with open(os.path.join(ROOT, 'src', f), encoding='utf-8') as fh: src = fh.read()
        with open(os.path.join(ROOT, name + '.user.js'), 'w', encoding='utf-8', newline='\n') as fh: fh.write(build(name, src))
        print('built', name + '.user.js')
        # One off (18/11/2026): copies under the old file names, so copies already installed from those links update
        # to the new script. Take this out, and delete the copies, once every device shows the new names.
        if name.startswith('ec-'):
            with open(os.path.join(ROOT, OLD + name[2:] + '.user.js'), 'w', encoding='utf-8', newline='\n') as fh: fh.write(build(name, src))
    import shutil
    shutil.copyfile(os.path.join(ROOT, 'ec-clipboard-brain.ahk'), os.path.join(ROOT, OLD + '-clipboard-brain.ahk'))
