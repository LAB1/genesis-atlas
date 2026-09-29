"""Screenshot one beat of one step with headless Edge/Chrome (one process, memory-light).

usage: python tools/shot.py <scene-id> <step(1-based)> [beat(1-based)] [--theme dark|light] [--size 1920x1080] [--out file.png]
The image shows the state at the END of that beat (its callout card and deep-dive blocks included).
Default output: tools/shots/<id>-<step>[-b<beat>][-light].png     (theme default: dark, size 1600x1000)
"""
import os
import shutil
import subprocess
import sys

from smoke import BROWSERS, ROOT, pop_opt


def main():
    args = sys.argv[1:]
    theme = pop_opt(args, '--theme', True) or 'dark'
    size = pop_opt(args, '--size', True) or '1600x1000'
    out = pop_opt(args, '--out', True)
    opn = pop_opt(args, '--open', True)      # progress | home | zoom
    pending = pop_opt(args, '--pending')     # show the "press Play" state of a freshly opened topic
    sid = args[0]
    step = args[1] if len(args) > 1 else '1'
    beat = args[2] if len(args) > 2 else None
    spec = '%s:%s' % (sid, step) + (':' + beat if beat else '')
    if not out:
        name = '%s-%s%s%s.png' % (sid, step, ('-b' + beat) if beat else '', '-light' if theme == 'light' else '')
        out = os.path.join(ROOT, 'tools', 'shots', name)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    exe = next((b for b in BROWSERS if os.path.exists(b)), None)
    url = 'file:///' + os.path.join(ROOT, 'index.html').replace('\\', '/') + '?smoke&shot=%s&theme=%s' % (spec, theme) + ('&pending' if pending else '') + ('&open=' + opn if opn else '')
    prof = os.path.join(os.environ.get('TEMP', ROOT), 'atlas-shot-%d' % os.getpid())
    cmd = [exe, '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', '--mute-audio', '--hide-scrollbars',
           '--user-data-dir=' + prof, '--allow-file-access-from-files', '--virtual-time-budget=30000',
           '--window-size=' + size.replace('x', ','), '--screenshot=' + os.path.abspath(out), url]
    try:
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=150)
    finally:
        shutil.rmtree(prof, ignore_errors=True)
    print(out if os.path.exists(out) else 'screenshot failed')


if __name__ == '__main__':
    main()
