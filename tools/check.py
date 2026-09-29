"""Static checks for Genesis Atlas (no browser / node needed).

usage: python tools/check.py [scene-file ...]     (default: all js files)

Checks
  1. JS syntax (esprima, ES2017 subset: no class fields, no ?. or ??)
  2. scene files: Atlas.register({id}) id exists in catalog and matches file name
  3. every step has title / say / run; narration length sanity
  4. ctx.<member> usages exist on SceneCtx (catches hallucinated API)
  5. ctx.hotspot(el, 'id') targets exist in catalog
"""
import io
import os
import re
import sys

try:
    import esprima
except ImportError:
    print('esprima missing: python -m pip install --user esprima')
    sys.exit(2)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(ROOT, 'js')


def read(p):
    with io.open(p, encoding='utf-8-sig') as f:
        return f.read()


def catalog():
    src = read(os.path.join(JS, 'core', 'catalog.js'))
    ids = re.findall(r"\{ id: '([\w-]+)', parent: [^,]+, level: \d, file: '([\w.-]+)'", src)
    return dict(ids)


def ctx_api():
    src = read(os.path.join(JS, 'core', 'ctx.js'))
    names = set(re.findall(r'^\s*P\.(\w+) = ', src, re.M))
    names |= {'state', 'W', 'H', 'C', 'Ease', 'instant', 'speed', 'dead', 'layer', 'engine', 'scene', 'rng'}
    return {n for n in names if not n.startswith('_')}


def walk(node, fn):
    if isinstance(node, dict):
        fn(node)
        for v in node.values():
            walk(v, fn)
    elif isinstance(node, list):
        for v in node:
            walk(v, fn)


def check_file(path, cat, api, errors, warns):
    rel = os.path.relpath(path, ROOT)
    src = read(path)
    try:
        tree = esprima.parseScript(src, {'loc': True}).toDict()
    except Exception as e:  # esprima.Error
        errors.append('%s: SYNTAX %s' % (rel, e))
        return
    if not rel.replace('\\', '/').startswith('js/scenes/'):
        return

    reg = []

    def visit(n):
        t = n.get('type')
        if t == 'CallExpression':
            cal = n.get('callee') or {}
            if cal.get('type') == 'MemberExpression' and not cal.get('computed'):
                obj, prop = cal.get('object') or {}, (cal.get('property') or {}).get('name')
                if obj.get('type') == 'Identifier' and obj.get('name') == 'Atlas' and prop == 'register':
                    reg.append(n)
                if obj.get('type') == 'Identifier' and obj.get('name') == 'ctx' and prop == 'hotspot':
                    args = n.get('arguments') or []
                    if len(args) >= 2 and args[1].get('type') == 'Literal':
                        if args[1].get('value') not in cat:
                            errors.append('%s:%s hotspot target %r not in catalog' % (rel, n['loc']['start']['line'], args[1].get('value')))
        if t == 'MemberExpression' and not n.get('computed'):
            obj = n.get('object') or {}
            if obj.get('type') == 'Identifier' and obj.get('name') == 'ctx':
                name = (n.get('property') or {}).get('name')
                if name and name not in api:
                    errors.append('%s:%s unknown ctx API: ctx.%s' % (rel, n['loc']['start']['line'], name))
        if t == 'MemberExpression' and not n.get('computed'):
            obj = n.get('object') or {}
            if obj.get('type') == 'Identifier' and obj.get('name') == 'Math' and (n.get('property') or {}).get('name') == 'random':
                warns.append('%s:%s Math.random() -> prefer ctx.rng(seed) so rebuilds are identical' % (rel, n['loc']['start']['line']))

    walk(tree, visit)
    if len(reg) != 1:
        errors.append('%s: expected exactly one Atlas.register call, found %d' % (rel, len(reg)))
        return
    args = reg[0].get('arguments') or []
    if not args or args[0].get('type') != 'ObjectExpression':
        errors.append('%s: Atlas.register argument must be an object literal' % rel)
        return
    props = {}
    for p in args[0]['properties']:
        k = p['key'].get('name') or p['key'].get('value')
        props[k] = p['value']
    sid = props.get('id', {}).get('value')
    if sid not in cat:
        errors.append('%s: id %r not in catalog' % (rel, sid))
    elif cat[sid] != os.path.basename(path):
        errors.append('%s: id %r belongs in file %s' % (rel, sid, cat[sid]))
    steps = props.get('steps')
    if not steps or steps.get('type') != 'ArrayExpression':
        errors.append('%s: steps must be an array literal' % rel)
        return
    if len(steps['elements']) < 4:
        warns.append('%s: only %d steps (aim for 5-9)' % (rel, len(steps['elements'])))
    for i, st in enumerate(steps['elements']):
        if st.get('type') != 'ObjectExpression':
            continue
        keys = {}
        for p in st['properties']:
            keys[p['key'].get('name') or p['key'].get('value')] = p['value']
        for need in ('title', 'say', 'run', 'deep'):
            if need not in keys:
                errors.append('%s: step %d missing %s' % (rel, i + 1, need))
        say = keys.get('say')
        if say is not None and say.get('type') == 'Literal':
            words = len(str(say.get('value')).split())
            if words < 25:
                warns.append('%s: step %d narration short (%d words)' % (rel, i + 1, words))
            if words > 140:
                warns.append('%s: step %d narration long (%d words)' % (rel, i + 1, words))
            if re.search(r'[一-鿿]', str(say.get('value'))):
                errors.append('%s: step %d narration must be English' % (rel, i + 1))


def main():
    cat = catalog()
    api = ctx_api()
    files = sys.argv[1:]
    if not files:
        for d, _, fs in os.walk(JS):
            files += [os.path.join(d, f) for f in fs if f.endswith('.js')]
    errors, warns = [], []
    for f in sorted(files):
        check_file(os.path.abspath(f), cat, api, errors, warns)
    scenes = os.path.join(JS, 'scenes')
    have = set(os.listdir(scenes)) if os.path.isdir(scenes) else set()
    missing = [f for f in cat.values() if f not in have]
    for w in warns:
        print('WARN  ' + w)
    for e in errors:
        print('ERROR ' + e)
    if not sys.argv[1:]:
        print('scene files present: %d / %d%s' % (len(cat) - len(missing), len(cat), ('  missing: ' + ', '.join(missing)) if missing else ''))
    print('OK' if not errors else '%d error(s)' % len(errors))
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
