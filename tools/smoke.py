"""Runtime tests in ONE headless browser process (memory-light).

usage:
  python tools/smoke.py [scene-id ...]        build + animated replay + beat-gate + seek-consistency checks
  python tools/smoke.py --nav                 navigation: zoom in/out, backward jumps, tour, map, references
  python tools/smoke.py --layout [id ...]     layout audit at the end of every beat  [--viewport 1366x768] [--json out.json]
  python tools/smoke.py --clicks [id ...]     click harness: clicks every interactive SVG element in the end state of every
                                              step (no console / window errors allowed, scene must survive) and every
                                              .hotspot (Engine.go / zoomInto must be called with the right target)
  python tools/smoke.py --a11y                keyboard / accessibility checks (names, focus ring, Escape stack, drawer, aria state)
  python tools/smoke.py --chrome              shell layout audit at --viewport (top bar clipping / overlap, panels, page scroll)
  python tools/smoke.py --cards               stress test of the left panel (narration box + newest card) for every beat
  python tools/smoke.py --posters [id ...]    score every step of a chamber with the poster picker (diagnostic)
  (--viewport also works for the other modes; the title block and rails are laid out for that window size)
"""
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRAME = (34, 97)     # window frame lost by --dump-dom (see run_browser)
BROWSERS = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
]


def pop_opt(args, name, takes_value=False):
    if name not in args:
        return None
    i = args.index(name)
    val = args[i + 1] if takes_value else True
    del args[i:i + (2 if takes_value else 1)]
    return val


def run_browser(query, timeout=600, viewport='1600x900'):
    exe = next((b for b in BROWSERS if os.path.exists(b)), None)
    if not exe:
        print('no Edge/Chrome found')
        sys.exit(2)
    url = 'file:///' + os.path.join(ROOT, 'index.html').replace('\\', '/') + query
    prof = os.path.join(os.environ.get('TEMP', ROOT), 'atlas-smoke-%d' % os.getpid())
    # --dump-dom opens a real (headless) window whose CLIENT area is smaller than --window-size by the window frame
    # (measured: 34 x 97 px); --screenshot (shot.py) has no such loss. Add it back so that --viewport WxH means an
    # inner window of W x H, i.e. the same picture shot.py --size W x H shows.
    vw, vh = [int(v) for v in viewport.split('x')]
    cmd = [exe, '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', '--mute-audio',
           '--user-data-dir=' + prof, '--allow-file-access-from-files', '--virtual-time-budget=900000',
           '--window-size=%d,%d' % (vw + FRAME[0], vh + FRAME[1]), '--dump-dom', url]
    try:
        out = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout).stdout.decode('utf-8', 'replace')
    except subprocess.TimeoutExpired:
        print('browser timed out')
        sys.exit(3)
    finally:
        shutil.rmtree(prof, ignore_errors=True)
    m = re.search(r'SMOKE-BEGIN(.*?)SMOKE-END', out, re.S)
    if not m:
        print('no smoke output (page failed to boot?)')
        print(out[-1500:])
        sys.exit(4)
    txt = m.group(1).replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"').replace('&amp;', '&')
    return json.loads(txt)


def main():
    args = sys.argv[1:]
    nav = pop_opt(args, '--nav')
    layout = pop_opt(args, '--layout')
    clicks = pop_opt(args, '--clicks')
    chrome = pop_opt(args, '--chrome')
    a11y = pop_opt(args, '--a11y')
    cards = pop_opt(args, '--cards')
    posters = pop_opt(args, '--posters')
    theme = pop_opt(args, '--theme', True)
    out_json = pop_opt(args, '--json', True)
    viewport = pop_opt(args, '--viewport', True) or '1600x900'
    ids = args
    q = '?smoke'
    if nav:
        q += '&nav'
    elif chrome:
        q += '&chrome'
    elif a11y:
        q += '&a11y'
    elif cards:
        q += '&cards'
    elif posters:
        q += '&posters' + ('=' + ','.join(ids) if ids else '')
    elif clicks:
        q += '&clicks' + ('=' + ','.join(ids) if ids else '')
    elif layout:
        q += '&layout' + ('=' + ','.join(ids) if ids else '')
    elif ids:
        q += '=' + ','.join(ids)
    if theme:
        q += '&theme=' + theme
    report = run_browser(q, viewport=viewport)

    if a11y:
        rec = report[0]
        for e in rec.get('errors', []):
            print('ERROR  ' + e[:300])
        print('A11Y OK' if not rec.get('errors') else 'A11Y: %d problem(s)' % len(rec['errors']))
        sys.exit(1 if rec.get('errors') else 0)

    if chrome or cards or posters:
        rec = report[0]
        for e in rec.get('errors', []):
            print('ERROR  ' + e[:300])
        if out_json:
            with open(out_json, 'w') as f:
                json.dump(rec, f, indent=1)
        if chrome:
            print('window %s' % (rec.get('win'),))
            for tag, inf in sorted(rec.get('info', {}).items()):
                print('  %-10s %s' % (tag, json.dumps(inf)))
            seen = set()
            for it in rec.get('issues', []):
                key = json.dumps(it, sort_keys=True)
                if key in seen:
                    continue
                seen.add(key)
                print('  ISSUE  ' + key[:300])
            print('CHROME: %d issue(s)' % len(rec.get('issues', [])))
            sys.exit(1 if rec.get('issues') or rec.get('errors') else 0)
        print(json.dumps(rec.get('summary', rec), indent=1)[:6000])
        sys.exit(1 if rec.get('errors') else 0)

    if clicks:
        bad = 0
        tot_scenes = tot_inter = tot_hot = scenes_with = 0
        for r in report:
            if r['status'] == 'placeholder':
                print('--     %-16s (placeholder)' % r['id'])
                continue
            tot_scenes += 1
            tot_inter += r.get('interactions', 0)
            tot_hot += r.get('hotspots', 0)
            if r.get('interactions', 0):
                scenes_with += 1
            flag = 'ok    ' if r['status'] == 'ok' else 'FAIL  '
            print('%s %-16s steps=%-2s clickable=%-4s clicks=%-4s hotspots=%-2s' % (flag, r['id'], r.get('steps'), r.get('clickable', 0), r.get('interactions', 0), r.get('hotspots', 0)))
            for n in r.get('notes', []):
                print('         NOTE ' + n[:300])
            if r['status'] != 'ok':
                bad += 1
                for e in r.get('errors', [])[:12]:
                    print('         ' + e[:400])
        print('CLICKS: %d scene(s), %d with interactions, %d interactions, %d hotspots; %d scene(s) with failures' % (tot_scenes, scenes_with, tot_inter, tot_hot, bad))
        print('CLICKS OK' if not bad else 'CLICKS FAILED')
        sys.exit(1 if bad else 0)

    if layout:
        rec = report[0]
        issues = rec.get('issues', [])
        if out_json:
            with open(out_json, 'w') as f:
                json.dump(issues, f, indent=1)
        for e in rec.get('errors', []):
            print('ERROR  ' + e[:300])
        by = {}
        for it in issues:
            by.setdefault((it['scene'], it['step']), []).append(it)
        kinds = {}
        for it in issues:
            kinds[it['type']] = kinds.get(it['type'], 0) + 1
        for (sid, step), lst in sorted(by.items()):
            seen = set()
            print('%s step %d "%s"' % (sid, step, lst[0].get('title', '')))
            for it in lst:
                key = (it['type'], it.get('a'), it.get('b'))
                if key in seen:
                    continue
                seen.add(key)
                detail = {k: v for k, v in it.items() if k not in ('type', 'scene', 'step', 'beat', 'title')}
                print('   beat %d  %-14s %s' % (it['beat'], it['type'], json.dumps(detail, ensure_ascii=False)[:200]))
        print('LAYOUT: %d issue(s) %s' % (len(issues), json.dumps(kinds)))
        sys.exit(1 if issues or rec.get('errors') else 0)

    bad = 0
    for r in report:
        if r['status'] == 'ok':
            print('ok     %-16s steps=%-2s beats=%-3s gated=%-2s elements=%s' % (r['id'], r.get('steps'), r.get('beats', '-'), r.get('gated', '-'), r.get('elementsAnimated')))
        elif r['status'] == 'placeholder':
            print('--     %-16s (placeholder, file missing or not registered)' % r['id'])
        else:
            bad += 1
            print('ERROR  %-16s' % r['id'])
            for e in r['errors'][:10]:
                print('         ' + e[:400])
    print('SMOKE OK' if not bad else 'SMOKE: %d scene(s) with errors' % bad)
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
