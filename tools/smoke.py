"""Runtime smoke test in ONE headless browser process (memory-light).

usage: python tools/smoke.py [scene-id ...]      (default: all scenes)
Builds every step instantly, then replays every step animated at 60x speed,
and reports JS errors / timeouts per scene.
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


def main():
    exe = next((b for b in BROWSERS if os.path.exists(b)), None)
    if not exe:
        print('no Edge/Chrome found')
        sys.exit(2)
    ids = [a for a in sys.argv[1:] if a != '--nav']
    q = '?smoke&nav' if '--nav' in sys.argv else '?smoke' + ('=' + ','.join(ids) if ids else '')
    url = 'file:///' + os.path.join(ROOT, 'index.html').replace('\\', '/') + q
    prof = os.path.join(os.environ.get('TEMP', ROOT), 'atlas-smoke-%d' % os.getpid())
    cmd = [exe, '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', '--mute-audio',
           '--user-data-dir=' + prof, '--allow-file-access-from-files', '--virtual-time-budget=600000',
           '--window-size=1600,900', '--dump-dom', url]
    try:
        out = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300).stdout.decode('utf-8', 'replace')
    except subprocess.TimeoutExpired:
        print('browser timed out')
        sys.exit(3)
    finally:
        shutil.rmtree(prof, ignore_errors=True)
    m = re.search(r'SMOKE-BEGIN(.*?)SMOKE-END', out, re.S)
    if not m:
        print('no smoke output (page failed to boot?)')
        print(out[-2000:])
        sys.exit(4)
    txt = m.group(1).replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&').replace('&quot;', '"')
    report = json.loads(txt)
    bad = 0
    for r in report:
        if r['status'] == 'ok':
            print('ok     %-16s steps=%-2s elements=%s' % (r['id'], r.get('steps'), r.get('elementsAnimated')))
        elif r['status'] == 'placeholder':
            print('--     %-16s (placeholder, file missing or not registered)' % r['id'])
        else:
            bad += 1
            print('ERROR  %-16s' % r['id'])
            for e in r['errors'][:8]:
                print('         ' + e[:400])
    print('SMOKE OK' if not bad else 'SMOKE: %d scene(s) with errors' % bad)
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
