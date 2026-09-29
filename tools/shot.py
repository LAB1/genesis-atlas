"""Screenshot one scene step with headless Edge/Chrome (one process, memory-light).

usage: python tools/shot.py <scene-id> <step(1-based)> [out.png]
Default output: tools/shots/<id>-<step>.png
"""
import os
import shutil
import subprocess
import sys

from smoke import BROWSERS, ROOT


def main():
    sid = sys.argv[1]
    step = sys.argv[2] if len(sys.argv) > 2 else '1'
    out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(ROOT, 'tools', 'shots', '%s-%s.png' % (sid, step))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    exe = next((b for b in BROWSERS if os.path.exists(b)), None)
    url = 'file:///' + os.path.join(ROOT, 'index.html').replace('\\', '/') + '?smoke&shot=%s:%s' % (sid, step)
    prof = os.path.join(os.environ.get('TEMP', ROOT), 'atlas-shot-%d' % os.getpid())
    cmd = [exe, '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', '--mute-audio', '--hide-scrollbars',
           '--user-data-dir=' + prof, '--allow-file-access-from-files', '--virtual-time-budget=25000',
           '--window-size=1600,1000', '--screenshot=' + os.path.abspath(out), url]
    try:
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
    finally:
        shutil.rmtree(prof, ignore_errors=True)
    print(out if os.path.exists(out) else 'screenshot failed')


if __name__ == '__main__':
    main()
