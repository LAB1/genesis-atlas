"""Static checks for Genesis Atlas (no browser / node needed).

usage: python tools/check.py [scene-file ...]     (default: all js files)

Checks
  1. JS syntax (esprima, ES2017 subset: no class fields, no ?. or ??)
  2. scene files: Atlas.register({id}) id exists in catalog and matches file name
  3. every step has title + run and either beats[] (say/card/deep per beat, ctx.beat(k) gates) or legacy say+deep
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
        tag = '%s: step %d' % (rel, i + 1)
        for need in ('title', 'run'):
            if need not in keys:
                errors.append('%s missing %s' % (tag, need))
        if 'beats' in keys:
            check_beats(rel, i + 1, keys, errors, warns)
        else:
            warns.append('%s has no beats[] (legacy say+deep step; author beats so it plays point by point)' % tag)
            for need in ('say', 'deep'):
                if need not in keys:
                    errors.append('%s missing %s' % (tag, need))
            say = literal_text(keys.get('say'))
            if say is not None:
                w = len(say.split())
                if w < 25:
                    warns.append('%s narration short (%d words)' % (tag, w))
                if w > 140:
                    warns.append('%s narration long (%d words)' % (tag, w))
                if re.search(r'[\u4e00-\u9fff]', say):
                    errors.append('%s narration must be English' % tag)


CARD_TAGS = {'KEY IDEA', 'HOW IT WORKS', 'NUMBERS', 'WHY IT MATTERS', 'TRADE-OFF', 'PITFALL', 'STATE OF THE ART', 'TRY IT', 'NOTE'}


def literal_text(node):
    """String value of a literal or a '+' chain of literals; None if not statically known."""
    if node is None:
        return None
    if node.get('type') == 'Literal' and isinstance(node.get('value'), str):
        return node['value']
    if node.get('type') == 'BinaryExpression' and node.get('operator') == '+':
        a, b = literal_text(node.get('left')), literal_text(node.get('right'))
        return a + b if a is not None and b is not None else None
    if node.get('type') == 'TemplateLiteral' and not node.get('expressions'):
        return ''.join(q['value']['cooked'] for q in node['quasis'])
    return None


def obj_props(node):
    d = {}
    for p in node.get('properties', []):
        d[p['key'].get('name') or p['key'].get('value')] = p['value']
    return d


def check_beats(rel, n, keys, errors, warns):
    tag = '%s: step %d' % (rel, n)
    arr = keys['beats']
    if arr.get('type') != 'ArrayExpression':
        errors.append('%s beats must be an array literal' % tag)
        return
    beats = arr['elements']
    nb = len(beats)
    if nb < 2:
        errors.append('%s needs at least 2 beats (has %d)' % (tag, nb))
    if nb > 7:
        errors.append('%s has %d beats; keep steps to 2-7 beats' % (tag, nb))
    total = 0
    for b, node in enumerate(beats):
        bt = '%s beat %d' % (tag, b + 1)
        if node.get('type') != 'ObjectExpression':
            errors.append('%s must be an object literal' % bt)
            continue
        bp = obj_props(node)
        say = literal_text(bp.get('say'))
        if say is None:
            errors.append('%s missing a string literal say' % bt)
        else:
            w = len(say.split())
            total += w
            if w < 8:
                warns.append('%s narration very short (%d words)' % (bt, w))
            if w > 75:
                warns.append('%s narration long (%d words); split the beat' % (bt, w))
            if re.search(r'[\u4e00-\u9fff]', say):
                errors.append('%s narration must be English' % bt)
            if re.search(r'[\u2192\u00d7\u2248\u00b2\u221a\u2264\u2265\u2192]', say):
                warns.append('%s narration contains symbols (-> x ~ etc.); spell them out for text to speech' % bt)
        if 'deep' not in bp:
            warns.append('%s has no deep chunk' % bt)
        if 'card' not in bp:
            warns.append('%s has no callout card' % bt)
        else:
            cp = obj_props(bp['card']) if bp['card'].get('type') == 'ObjectExpression' else {}
            tg = literal_text(cp.get('tag'))
            if tg is not None and tg not in CARD_TAGS:
                errors.append('%s card tag %r not one of %s' % (bt, tg, sorted(CARD_TAGS)))
            if 'title' not in cp:
                warns.append('%s card has no title' % bt)
            if 'body' not in cp and 'stat' not in cp:
                errors.append('%s card needs body or stat' % bt)
            body = literal_text(cp.get('body'))
            if body is not None and len(re.sub(r'<[^>]+>', '', body).split()) > 42:
                warns.append('%s card body long (>42 words); cards are punchy, put detail in deep' % bt)
    if total and (total < 45 or total > 320):
        warns.append('%s total narration %d words (aim for 60-260)' % (tag, total))
    # gates: run() must call ctx.beat(k) for every k in 1..nb-1
    run = keys.get('run')
    found = set()

    def visit(nd):
        if nd.get('type') == 'CallExpression':
            cal = nd.get('callee') or {}
            if cal.get('type') == 'MemberExpression' and not cal.get('computed'):
                o = cal.get('object') or {}
                if o.get('type') == 'Identifier' and o.get('name') == 'ctx' and (cal.get('property') or {}).get('name') == 'beat':
                    a = nd.get('arguments') or []
                    if a and a[0].get('type') == 'Literal' and isinstance(a[0].get('value'), (int, float)):
                        found.add(int(a[0]['value']))
                    else:
                        errors.append('%s ctx.beat() argument must be an integer literal' % tag)
    if run is not None:
        walk(run, visit)
    want = set(range(1, nb))
    if nb >= 2 and found != want:
        errors.append('%s run() must call ctx.beat(k) exactly for k in %s; found %s' % (tag, sorted(want), sorted(found)))

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
