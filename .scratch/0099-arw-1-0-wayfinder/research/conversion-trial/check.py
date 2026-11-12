"""v1-convtry: 22 的第 1 层 (静态校验) 与第 2 层 (源映射完整与哈希) 的试做, 外加一次变异普查.
graph 存为 graph/<子流程>.jsonl: 第一行是子流程头 (flow, desc, entry, returns), 其后每行一个节点; graph/_shared.jsonl 放参数与 work.
用法: python3 -I check.py [--fill] [-v]   (--fill 把当前段落哈希写进 source-map.jsonl; -v 列出未被拦住的变异)
只读 ARW 源码仓库的 distribution/ 与本目录的 JSONL, 不写其他文件."""
import copy, glob, hashlib, json, os, re, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ARW = os.path.abspath(os.path.join(HERE, '../../../..'))
ROOT = 'commit'
REVIEWER_ROLES = {'requirements-reviewer', 'code-standards-reviewer', 'spec-readiness-reviewer'}
ANCHORED_CLASSES = {'F', 'Fj', 'C', 'S', 'K3'}  # 必须有节点锚定的段落类别
UNANCHORABLE = {'D', 'O', 'N'}  # 节点不得锚定的段落类别
rows = lambda path: [json.loads(ln) for ln in open(path, encoding='utf-8') if ln.strip()]


def load():
    flows = {}
    for path in sorted(glob.glob(os.path.join(HERE, 'graph', '*.jsonl'))):
        if os.path.basename(path).startswith('_'): continue
        head, *nodes = rows(path)
        flows[head['flow']] = {'head': head, 'nodes': nodes, 'file': os.path.basename(path)}
    shared = rows(os.path.join(HERE, 'graph', '_shared.jsonl'))
    prims = rows(os.path.join(HERE, 'primitives.jsonl'))
    return {
        'flows': flows,
        'params': {r['name']: r for r in shared if r['kind'] == 'param'},
        'works': {r['name']: r for r in shared if r['kind'] == 'work'},
        'prims': {r['primitive']: r for r in prims if 'primitive' in r},
        'external': {r['flow']: r for r in prims if r.get('kind') == 'external-flow'},
    }


def results_of(n, G):
    t = n['type']
    if t == 'program': return G['prims'][n['primitive']]['results'] if n['primitive'] in G['prims'] else []
    if t in ('judgment', 'waitUser'): return n['options']
    if t == 'parallel': return ['joined']
    if t == 'call':
        if n['call'] in G['flows']: return list(G['flows'][n['call']]['head']['returns'])
        return G['external'].get(n['call'], {}).get('returns', [])
    if t == 'agent':
        b = list(n['output']['branch'])
        if 'ask-user' in b and 'ask-user' not in n.get('next', {}):  # Engine 代办的问用户: 答复后回到本节点, 只有 "停止" 要连边
            b[b.index('ask-user')] = 'ask-user:stop'
        return b
    return []


def contains(G, flow, pred, seen=None):
    """子流程 (含它调用的子流程) 里是否有满足 pred 的节点."""
    seen = seen or set()
    if flow in seen or flow not in G['flows']: return False
    seen.add(flow)
    return any(pred(n) or (n['type'] == 'call' and contains(G, n['call'], pred, seen)) for n in G['flows'][flow]['nodes'])


KINDS = {
    'barrier-freeze': lambda n: n['type'] == 'program' and n.get('barrier') and n['primitive'] != 'git.commit',
    'formalGate': lambda n: bool(n.get('formalGate')),
}


def flow_errors(G, name):
    f = G['flows'][name]
    head, errs, nodes = f['head'], [], {}
    E = lambda msg: errs.append(f'{name}: {msg}')
    if not head.get('desc'): E('flow without desc')
    for n in f['nodes']:
        if n['id'] in nodes: E(f"duplicate node {n['id']}")
        nodes[n['id']] = n
        if not n.get('desc'): E(f"{n['id']}: node without desc")
    branch_nodes = {b for n in f['nodes'] if n['type'] == 'parallel' for b in n['branches']}
    succ, returned = {}, set()
    for n in nodes.values():
        nid, t, nx = n['id'], n['type'], n.get('next', {})
        if t == 'program':
            p = G['prims'].get(n['primitive'])
            if not p: E(f'{nid}: unknown primitive'); continue
            if p.get('barrier') and not n.get('barrier'): E(f'{nid}: primitive is a barrier but node drops it')
        if t == 'call':
            if n['call'] in G['external']:
                if set(n.get('args', {})) != set(G['external'][n['call']]['params']): E(f'{nid}: args do not match params of {n["call"]}')
            elif n['call'] not in G['flows']: E(f"{nid}: calls unknown flow {n['call']}"); continue
        for a in re.findall(r'\$param\.([\w.]+)', json.dumps(n)):
            if a not in G['params']: E(f'{nid}: unknown param {a}')
        if t == 'agent' and n['work'] not in G['works']: E(f'{nid}: unknown work'); continue
        if nid in branch_nodes:
            if nx: E(f'{nid}: parallel branch must not have next')
            continue
        rs = results_of(n, G)
        for r in rs:
            if r not in nx: E(f'{nid}: result {r} has no next')
        for r, dst in nx.items():
            if r not in rs: E(f'{nid}: next for undeclared result {r}')
            if dst.startswith('return:'):
                if dst[7:] not in head['returns']: E(f'{nid}: returns undeclared {dst}')
                returned.add(dst[7:])
            elif dst not in nodes: E(f'{nid}: next to unknown node {dst}')
            elif dst in branch_nodes: E(f'{nid}: next into a parallel branch {dst}')
            succ.setdefault(nid, set()).add(dst)
        if t == 'judgment' and n.get('oneWay') and n.get('conservative') not in n['options']: E(f'{nid}: one-way without conservative option')
        if t == 'agent':
            if n.get('formalGate'):
                if G['works'][n['work']].get('role') not in REVIEWER_ROLES: E(f'{nid}: formal gate not from a Reviewer role')
                if n['write']['scope'] != 'report-only': E(f'{nid}: formal gate may write')
                if 'incomplete' not in rs: E(f'{nid}: Reviewer without incomplete')
            elif 'ask-user' not in n['output']['branch']: E(f'{nid}: agent schema lacks ask-user')
        if t == 'parallel':
            for b in n['branches']:
                if b not in nodes: E(f'{nid}: unknown parallel branch {b}')
    for r in head['returns']:
        if r not in returned: E(f'declared return {r} is never returned')

    def reach(start, banned=frozenset(), skip=None):
        seen, stack = set(), [start]
        while stack:
            x = stack.pop()
            if x in seen or x in banned or x.startswith('return:'): continue
            seen.add(x)
            stack.extend(d for r, d in nodes[x].get('next', {}).items() if (x, r) != skip)
        return seen
    if head['entry'] not in nodes: return errs + [f'{name}: unknown entry']
    live = reach(head['entry'])
    for n in nodes.values():
        if n['id'] in branch_nodes: continue
        if n['id'] not in live: E(f"{n['id']}: unreachable from entry")
        elif not any(d.startswith('return:') for x in reach(n['id']) for d in nodes[x].get('next', {}).values()): E(f"{n['id']}: cannot reach a return")
    for n in nodes.values():
        for k in n.get('requiresBefore', []):
            if k.startswith('edge:'):  # 试验中的加强版: 每条路径至少经过一次指定结果的边
                src, res = k[5:].split('/')
                if n['id'] in reach(head['entry'], skip=(src, res)): E(f"{n['id']}: some path from entry reaches it without {k}")
                continue
            pred = KINDS[k]  # 22 原版: 节点存在性; 跨层时调用了含该类节点的子流程即算
            banned = frozenset(x for x, m in nodes.items() if pred(m) or (m['type'] == 'call' and contains(G, m['call'], pred)))
            if n['id'] in reach(head['entry'], banned): E(f"{n['id']}: some path from entry reaches it without {k}")
    return errs


def layers(G):
    """从顶层起按调用深度分层; 返回 {flow: 深度} 与调用环错误."""
    depth, errs = {}, []
    def walk(flow, d, stack):
        if flow in stack: errs.append(f'call cycle: {" -> ".join(stack + [flow])}'); return
        if flow not in G['flows']: return
        depth[flow] = min(depth.get(flow, d), d)
        for n in G['flows'][flow]['nodes']:
            if n['type'] == 'call': walk(n['call'], d + 1, stack + [flow])
    walk(ROOT, 1, [])
    errs += [f'{f}: flow file not reachable from {ROOT}' for f in G['flows'] if f not in depth]
    return depth, errs


def static_errors(G):
    _, errs = layers(G)
    for name in G['flows']: errs += flow_errors(G, name)
    return errs


def source_map(G, fill):
    path = os.path.join(HERE, 'source-map.jsonl')
    smap = rows(path)
    head, paras = smap[0], {r['para']: r for r in smap if 'para' in r}
    anchors = {}
    for name, f in G['flows'].items():
        for n in f['nodes']:
            for key in n.get('src', []): anchors.setdefault(key, []).append(f"{name}/{n['id']}")
    errs, seen = [], set()
    for f in head['scope']:
        for i, p in enumerate(paragraphs(open(os.path.join(ARW, head['base'], f), encoding='utf-8').read()), 1):
            key, h = f'{f}#{i}', hashlib.sha256(p.encode()).hexdigest()[:12]
            seen.add(key)
            e = paras.get(key)
            if e is None: errs.append(f'{key}: paragraph has no class'); continue
            if fill: e['hash'] = h
            elif e.get('hash') != h: errs.append(f'{key}: stale (hash {e.get("hash")} != {h})')
    for key, e in paras.items():
        if key not in seen: errs.append(f'{key}: mapped paragraph no longer exists')
        if e['class'] in ANCHORED_CLASSES and key not in anchors: errs.append(f"{key}: class {e['class']} but no node anchors it")
    for key, ns in anchors.items():
        if key not in paras: errs.append(f'{ns}: anchor {key} not in map')
        elif paras[key]['class'] in UNANCHORABLE: errs.append(f"{ns}: anchors {key} of class {paras[key]['class']}")
    if fill: open(path, 'w', encoding='utf-8').write(''.join(json.dumps(r, ensure_ascii=False, separators=(', ', ': ')) + '\n' for r in smap))
    return errs, paras, anchors


def paragraphs(text):
    """空行, 标题, 受管区域标记分段; 每个列表项各为一段; 表格整体一段."""
    out, cur, lines = [], [], text.split('\n')
    start = lines.index('---', 1) + 1 if lines and lines[0] == '---' else 0
    def flush():
        if cur: out.append('\n'.join(cur))
        cur.clear()
    for ln in lines[start:]:
        if ln.startswith('<!-- arw:') or ln.startswith('#') or not ln.strip():
            flush(); continue
        if re.match(r'^(\d+\.|-|\|) ', ln) and cur and not cur[0].startswith('|'): flush()
        cur.append(ln)
    flush()
    return out


def strip_edge_requirements(G):
    G = copy.deepcopy(G)
    for f in G['flows'].values():
        for n in f['nodes']:
            if 'requiresBefore' in n: n['requiresBefore'] = [k for k in n['requiresBefore'] if not k.startswith('edge:')]
    return G


def mutations(G):
    """每个节点交换两条 next 的目标; 只有出现基线之外的新错误才算被静态校验拦住."""
    caught = survived = deletions = 0
    names, base = [], set(static_errors(G))
    for name, f in G['flows'].items():
        for i, n in enumerate(f['nodes']):
            items = list(n.get('next', {}).items())
            deletions += len(items)
            for a in range(len(items)):
                for b in range(a + 1, len(items)):
                    if items[a][1] == items[b][1]: continue
                    g = copy.deepcopy(G)
                    nx = g['flows'][name]['nodes'][i]['next']
                    nx[items[a][0]], nx[items[b][0]] = items[b][1], items[a][1]
                    if set(static_errors(g)) - base: caught += 1
                    else: survived += 1; names.append(f"{name}/{n['id']}: {items[a][0]}<->{items[b][0]}")
    return caught, survived, deletions, names


if __name__ == '__main__':
    G = load()
    se = static_errors(G)
    me, paras, anchors = source_map(G, '--fill' in sys.argv)
    depth, _ = layers(G)
    allnodes = [(name, n) for name, f in G['flows'].items() for n in f['nodes']]
    print('flows', len(G['flows']), 'nodes', len(allnodes), dict(Counter(n['type'] for _, n in allnodes)), 'next entries', sum(len(n.get('next', {})) for _, n in allnodes))
    callers = Counter(n['call'] for _, n in allnodes if n['type'] == 'call')
    for d in sorted(set(depth.values())):
        fl = sorted(f for f in depth if depth[f] == d)
        print(f'layer {d}: {len(fl)} flows, {sum(len(G["flows"][f]["nodes"]) for f in fl)} nodes:', ', '.join(f'{f} ({len(G["flows"][f]["nodes"])}, called {callers[f]}x)' for f in fl))
    print('max depth', max(depth.values()), '(external flows not counted:', sorted(G['external']), ')')
    agents = [n for _, n in allnodes if n['type'] == 'agent']
    print('agent nodes', len(agents), 'formal gate', sum(1 for n in agents if n.get('formalGate')), 'works', len(G['works']))
    print('nodes without source anchor', [f'{f}/{n["id"]}' for f, n in allnodes if not n.get('src')])
    print('classes', dict(Counter(e['class'] for e in paras.values())))
    print('static errors', len(se)); [print('  ', e) for e in se]
    print('source-map errors', len(me)); [print('  ', e) for e in me]
    c, s, d, _ = mutations(strip_edge_requirements(G))
    print(f'mutations, node-presence barriers only (22): swap caught {c}, survived {s}; next deletions {d} all caught')
    c, s, d, names = mutations(G)
    print(f'mutations, plus edge requirements: swap caught {c}, survived {s}')
    if '-v' in sys.argv: [print('  survived', x) for x in names]
