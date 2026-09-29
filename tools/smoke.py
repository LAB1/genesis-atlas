"""Runtime tests in ONE headless browser process (memory-light).

usage:
  python tools/smoke.py [scene-id ...]        build + animated replay + beat-gate + seek-consistency checks
  python tools/smoke.py --nav                 navigation: zoom in/out, backward jumps, tour, map, references
  python tools/smoke.py --layout [id ...]     layout audit at the end of every beat  [--theme light] [--json out.json]
"""
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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


def run_browser(query, timeout=600):
    exe = next((b for b in BROWSERS if os.path.exists(b)), None)
    if not exe:
        print('no Edge/Chrome found')
        sys.exit(2)
    url = 'file:///' + os.path.join(ROOT, 'index.html').replace('\\', '/') + query
    prof = os.path.join(os.environ.get('TEMP', ROOT), 'atlas-smoke-%d' % os.getpid())
    cmd = [exe, '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', '--mute-audio',
           '--user-data-dir=' + prof, '--allow-file-access-from-files', '--virtual-time-budget=900000',
           '--window-size=1600,900', '--dump-dom', url]
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
    theme = pop_opt(args, '--theme', True)
    out_json = pop_opt(args, '--json', True)
    ids = args
    q = '?smoke'
    if nav:
        q += '&nav'
    elif layout:
        q += '&layout' + ('=' + ','.join(ids) if ids else '')
    elif ids:
        q += '=' + ','.join(ids)
    if theme:
        q += '&theme=' + theme
    report = run_browser(q)

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
