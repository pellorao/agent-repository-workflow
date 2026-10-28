// Blind adjudication pools: the judge sees <root>/<name>/adj (the pool, its views and its own decisions file); the key,
// the prompt and the decision store stay beside it. Candidate order, group labels and ids follow qwen_strata's blind_pool.

import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {join, relative, sep} from 'node:path';

import {compareText, sha256} from '../common/json.mjs';
import {createRandom} from './random.mjs';
import {readShared} from './scenario.mjs';

export const SEED = 20261020;
const ANCHORS_PER_POOL = 12;
const ANCHOR_THRESHOLD = 0.9;
const FAMILIES = ['openai', 'anthropic', 'strata'];
const SPEC_READINESS = 'spec-readiness-reviewer';
const SUB_SCENARIO_VIEWS = {'artifact-promotion': 'view-ap', 'runtime-migration': 'view-rm'};
const DECISION = /^(?:matched|not-matched|unsupported|supported|problem-[1-9][0-9]*|false-positive:clean-[1-9][0-9]*)$/u;
const HEDGES = /可能|似乎|不确定|难以|无法确定|或许|勉强|边界|倾向|存疑|不太|未必|大概/u;
const FIELDS = ['kind', 'scenario', 'check', 'allowedDecisions', 'expectation', 'finding', 'result', 'evidence', 'requirementSource', 'problemOptions', 'cleanTargets'];
const FAIRNESS_NOTE = '调用方附加说明（不属于冻结 brief，用户 2026-10-20 决定加入）：候选的写法可能让你看得出它来自哪类模型或哪次运行。'
    + '不要据此推断来源，也不要因来源调整判断；请只按上文口径和 view 中的证据，对每个候选公平判定。';

export class PoolError extends Error {}

/** The view a scenario's reviewed state is staged under (a Spec Readiness sub-scenario has its own). */
export const viewOf = (/** @type {string} */ role, /** @type {string} */ scenarioName) => (role === SPEC_READINESS ? /** @type {Record<string, string>} */ (SUB_SCENARIO_VIEWS)[scenarioName] : 'view');
/** Every view entry of `adj/` a pool of the scenario needs. */
export const poolViews = (/** @type {string} */ role, /** @type {string} */ scenarioName) => (role === SPEC_READINESS ? Object.values(SUB_SCENARIO_VIEWS).sort(compareText)
    : scenarioName === 'commit-audit' ? ['view'] : ['view', 'change.diff']);

const text = (/** @type {unknown} */ value) => `${JSON.stringify(value, null, 1)}\n`;

// Python json.dumps(sort_keys=True, ensure_ascii=False), the fingerprint's byte form.
/** @type {(value: unknown) => string} */
const sortedDump = value => Array.isArray(value) ? `[${value.map(sortedDump).join(', ')}]`
    : value !== null && typeof value === 'object'
        ? `{${Object.keys(value).sort(compareText).map(key => `${JSON.stringify(key)}: ${sortedDump(/** @type {any} */ (value)[key])}`).join(', ')}}`
        : JSON.stringify(value);

/** The judge's view of a candidate: the brief's fields, nothing that names its run. */
export const poolItem = (/** @type {any} */ candidate) => {
    /** @type {Record<string, unknown>} */
    const item = {};
    for (const field of FIELDS) {
        if (field === 'scenario') {
            if (candidate.scenario !== undefined) item.scenario = candidate.scenario;
        } else if (field === 'requirementSource') {
            if (candidate.requirementSource !== undefined && candidate.requirementSource !== null) item.requirementSource = candidate.requirementSource;
        } else if ((field === 'problemOptions' || field === 'cleanTargets') && candidate.kind !== 'finding') {
            continue;
        } else item[field] = candidate[field] ?? null;
    }
    if (candidate.kind === 'finding') item.expectation = null;
    return item;
};

/** sha256 of a pool item without its pool id and group. */
export const itemFingerprint = (/** @type {any} */ item) => sha256(sortedDump(Object.fromEntries(Object.entries(item).filter(([field]) => field !== 'id' && field !== 'group'))));

export const candidateFingerprint = (/** @type {any} */ candidate) => itemFingerprint(poolItem(candidate));

/** A control (anchor or synthetic item) must be of an allowed kind, expect one of its own decisions and name a report family. */
const checkControl = (/** @type {any} */ control, /** @type {string[]} */ kinds) => {
    if (!kinds.includes(control.item.kind)) throw new PoolError(`${control.id}: control kind ${control.item.kind} is not allowed here.`);
    if (!control.item.allowedDecisions.includes(control.expected)) throw new PoolError(`${control.id}: the expected decision is not among allowedDecisions.`);
    if (!FAMILIES.includes(control.family)) throw new PoolError(`${control.id}: control without a report family.`);
};

/** At most `count` anchors, taken in turn from each report family, with at least one not-matched. */
const pickAnchors = (/** @type {any[]} */ anchors, /** @type {number} */ count, /** @type {ReturnType<typeof createRandom>} */ random) => {
    /** @type {Map<string, any[]>} */
    const byFamily = new Map();
    for (const anchor of [...anchors].sort((left, right) => compareText(left.id, right.id))) byFamily.set(anchor.family, [...byFamily.get(anchor.family) ?? [], anchor]);
    for (const items of byFamily.values()) random.shuffle(items);
    /** @type {any[]} */
    const picked = [];
    while (picked.length < count && [...byFamily.values()].some(items => items.length > 0)) {
        for (const family of [...byFamily.keys()].sort(compareText)) {
            const items = byFamily.get(family) ?? [];
            if (items.length > 0 && picked.length < count) picked.push(items.pop());
        }
    }
    const left = [...byFamily.values()].flat().filter(anchor => anchor.expected === 'not-matched');
    if (picked.length > 0 && left.length > 0 && !picked.some(anchor => anchor.expected === 'not-matched')) {
        picked[picked.length - 1] = left.find(anchor => anchor.family === picked[picked.length - 1].family) ?? left[0];
    }
    return picked;
};

/** Whole groups packed into pools of at most `limit` items, the largest groups first. */
const chunks = (/** @type {any[][]} */ groups, /** @type {number} */ limit) => {
    /** @type {any[][]} */
    const pools = [];
    for (const group of [...groups].sort((left, right) => right.length - left.length)) {
        if (group.length > limit) throw new PoolError(`One expectation group has ${group.length} items, more than a pool can take.`);
        let target = pools.find(items => items.length + group.length <= limit);
        if (target === undefined) pools.push(target = []);
        target.push(...group);
    }
    return pools;
};

/**
 * @param {{anchors: any, anchorsSha256: string | null, brief: string, candidates: any[], known?: Map<string, any>, limit: number, name: string, role: string, root: string, scenario: string, views: string[]}} input
 * @returns {Promise<{alreadyDecidedSkipped: number, pools: Array<{adj: string, controls: number, key: string, pool: string, real: number}>}>}
 */
export const buildPool = async ({anchors, anchorsSha256, brief, candidates, known = new Map(), limit, name, role, root, scenario, views}) => {
    const random = createRandom(SEED);
    const picked = anchors.anchors.length > ANCHORS_PER_POOL ? pickAnchors(anchors.anchors, ANCHORS_PER_POOL, random) : anchors.anchors;
    for (const anchor of picked) checkControl(anchor, ['association']);
    for (const synthetic of anchors.synthetic) checkControl(synthetic, ['association', 'finding']);
    const controls = [...picked.map((/** @type {any} */ anchor) => [anchor.item, {source: 'anchor', control: anchor.id, expected: anchor.expected, family: anchor.family,
        model: anchor.model ?? null, origin: anchor.origin ?? null}]),
    ...anchors.synthetic.map((/** @type {any} */ synthetic) => [synthetic.item, {source: 'synthetic', control: synthetic.id, type: synthetic.type,
        expected: synthetic.expected, family: synthetic.family, model: synthetic.model ?? null}])];
    if (!controls.some(([, meta]) => meta.expected === 'not-matched')) throw new PoolError('The scenario has no not-matched control for its pools.');
    const room = limit - controls.length;
    if (room <= 0) throw new PoolError('Controls alone fill a pool.');
    const origins = new Set(anchors.anchors.flatMap((/** @type {any} */ anchor) => (anchor.origin?.candidateId === undefined ? [] : [anchor.origin.candidateId])));
    const briefSha256 = sha256(brief);
    /** @type {Map<unknown, any[]>} */
    const groups = new Map();
    const seen = new Set();
    let skipped = 0;
    for (const candidate of candidates) {
        if (seen.has(candidate.candidateId)) throw new PoolError(`Candidate id ${candidate.candidateId} is repeated.`);
        seen.add(candidate.candidateId);
        if (role === SPEC_READINESS && !Object.hasOwn(SUB_SCENARIO_VIEWS, candidate.scenario)) throw new PoolError(`${candidate.candidateId}: no Spec Readiness sub-scenario.`);
        const item = poolItem(candidate);
        const fingerprint = itemFingerprint(item);
        const decided = known.get(candidate.candidateId);
        if (decided?.fingerprint === fingerprint && decided.brief_sha256 === briefSha256) {
            skipped += 1;
            continue;
        }
        if (origins.has(candidate.candidateId)) throw new PoolError(`${candidate.candidateId} is a registered anchor of the same instance; drop that anchor first.`);
        const groupKey = candidate.kind === 'association' ? item.expectation : `finding\0${candidate.candidateId}`;
        groups.set(groupKey, [...groups.get(groupKey) ?? [], [item, {source: 'instance', stableId: candidate.candidateId, kind: candidate.kind, fingerprint}]]);
    }
    const packed = groups.size === 0 ? [[]] : chunks([...groups.values()], room);
    /** @type {Array<{adj: string, controls: number, key: string, pool: string, real: number}>} */
    const written = [];
    for (const [index, real] of packed.entries()) {
        const poolName = packed.length === 1 ? name : `${name}-${index + 1}`;
        const items = [...real, ...controls];
        random.shuffle(items);
        const expectations = [...new Set(items.flatMap(([item]) => item.expectation === null ? [] : [item.expectation]))].sort(compareText);
        random.shuffle(expectations);
        let findings = 0;
        const labels = items.map(([item]) => item.expectation === null ? `F${String(++findings).padStart(2, '0')}` : `E${String(expectations.indexOf(item.expectation) + 1).padStart(2, '0')}`);
        const order = items.map((_, position) => position).sort((left, right) => compareText(labels[left], labels[right]) || left - right);
        const pool = [];
        const key = {};
        for (const [number, position] of order.entries()) {
            const id = `${poolName}-${String(number + 1).padStart(3, '0')}`;
            pool.push({id, group: labels[position], ...items[position][0]});
            /** @type {any} */ (key)[id] = items[position][1];
        }
        const directory = join(root, poolName);
        await mkdir(join(directory, 'adj'), {recursive: true});
        const poolPath = join(directory, 'adj', `pool-${poolName}.json`);
        const poolText = text(pool);
        await writeFile(poolPath, poolText);
        await writeFile(join(directory, 'key.json'), text({pool: poolName, scenario, role, briefText: brief, poolSha256: sha256(poolText), registrySha256: anchorsSha256, views, items: key}));
        written.push({adj: join(directory, 'adj'), controls: controls.length, key: join(directory, 'key.json'), pool: poolPath, real: real.length});
    }
    return {alreadyDecidedSkipped: skipped, pools: written};
};

export const readKey = async (/** @type {string} */ root, /** @type {string} */ name) => {
    const path = join(root, name, 'key.json');
    try { return {key: JSON.parse(await readFile(path, 'utf8')), path}; } catch (error) {
        if (/** @type {any} */ (error).code === 'ENOENT') throw new PoolError(`Pool key is missing: ${path}.`);
        throw error;
    }
};

/** `adj/` holds exactly the pool, its views and (later) its decisions; the view files match the binding when `pool view` wrote one. Returns the binding's SHA-256 or null. */
const checkAdj = async (/** @type {string} */ root, /** @type {string} */ name, /** @type {any} */ key) => {
    const adj = join(root, name, 'adj');
    if (sha256(await readFile(join(adj, `pool-${name}.json`))) !== key.poolSha256) throw new PoolError('The pool file differs from the one the key was written for.');
    const allowed = new Set([`pool-${name}.json`, `decisions-${name}.json`, ...key.views]);
    const present = await readdir(adj);
    const extra = present.filter(entry => !allowed.has(entry)).sort(compareText);
    if (extra.length > 0) throw new PoolError(`${adj} holds more than the pool and its views: ${extra.join(', ')}.`);
    const missing = key.views.filter((/** @type {string} */ view) => !present.includes(view));
    if (missing.length > 0) throw new PoolError(`${adj}: stage ${missing.join(', ')} (the views the brief names) first.`);
    const bindingBytes = await readFile(join(root, name, 'view-binding.json')).catch(error => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
    });
    if (bindingBytes === undefined) return null;
    const binding = JSON.parse(bindingBytes.toString('utf8'));
    const files = (await readdir(adj, {recursive: true, withFileTypes: true})).filter(entry => entry.isFile())
        .map(entry => relative(adj, join(entry.parentPath, entry.name)).split(sep).join('/')).filter(path => key.views.includes(path.split('/')[0])).sort(compareText);
    if (JSON.stringify(binding.views) !== JSON.stringify(key.views) || JSON.stringify(files) !== JSON.stringify(Object.keys(binding.files).sort(compareText))) {
        throw new PoolError('The files of the views differ from view-binding.json.');
    }
    for (const path of files) if (sha256(await readFile(join(adj, path))) !== binding.files[path]) throw new PoolError(`${path} differs from view-binding.json.`);
    return sha256(bindingBytes);
};

/** The judge's prompt: the brief with `<ADJ>` and `<名>` replaced, then the fairness note. */
export const poolPrompt = async (/** @type {{name: string, root: string}} */ {name, root}) => {
    const {key, path} = await readKey(root, name);
    for (const placeholder of ['<ADJ>', '<名>']) if (!key.briefText.includes(placeholder)) throw new PoolError(`The brief has no ${placeholder} to replace.`);
    const viewBindingSha256 = await checkAdj(root, name, key);
    const prompt = `${key.briefText.replaceAll('<ADJ>', 'adj').replaceAll('<名>', name).replace(/\n+$/u, '')}\n\n${FAIRNESS_NOTE}\n`;
    const promptPath = join(root, name, 'prompt.md');
    await writeFile(promptPath, prompt);
    await writeFile(path, text({...key, briefSha256: sha256(key.briefText), promptSha256: sha256(prompt), viewBindingSha256}));
    return {briefSha256: sha256(key.briefText), prompt: promptPath, promptSha256: sha256(prompt)};
};

const readStore = async (/** @type {string} */ path) => JSON.parse(await readFile(path, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '{"decisions": {}, "history": []}';
    throw error;
}));

/** The set of (file, line) points an item's evidence names. */
const evidencePoints = (/** @type {any} */ item) => {
    /** @type {Set<string>} */
    const points = new Set();
    const range = (/** @type {string} */ file, /** @type {number} */ from, /** @type {number} */ to) => { for (let line = from; line <= to; line += 1) points.add(`${file}\0${line}`); };
    for (const evidence of Array.isArray(item.evidence) ? item.evidence : []) {
        if (evidence === null || typeof evidence !== 'object' || !('filePath' in evidence)) continue;
        if ('line' in evidence) points.add(`${evidence.filePath}\0${evidence.line}`);
        else if ('lineStart' in evidence) range(evidence.filePath, evidence.lineStart, evidence.lineEnd || evidence.lineStart);
        else if (Array.isArray(evidence.lines)) {
            for (const part of evidence.lines) {
                if (Number.isInteger(part)) points.add(`${evidence.filePath}\0${part}`);
                else if (Array.isArray(part) && part.length === 2) range(evidence.filePath, part[0], part[1]);
            }
        }
    }
    return points;
};

/** Agreement with the expected decision per `field` value of the control rows. */
const agreement = (/** @type {any[]} */ rows, /** @type {string} */ field) => {
    /** @type {Record<string, {agree: number, misses: any[], n: number, rate?: number}>} */
    const out = {};
    for (const row of rows) {
        const entry = out[String(row[field])] ??= {agree: 0, misses: [], n: 0};
        entry.n += 1;
        if (row.decision === row.expected) entry.agree += 1;
        else entry.misses.push({control: row.control, decision: row.decision, expected: row.expected, id: row.id});
    }
    for (const entry of Object.values(out)) entry.rate = entry.agree / entry.n;
    return out;
};

/** Main's review lists: every supported decision, and the unsupported ones that are hedged, named hardest, or share evidence with an item decided otherwise. */
const reviewLists = (/** @type {any[]} */ real, /** @type {Map<string, any>} */ pool, /** @type {Map<string, any>} */ decided, /** @type {Set<string>} */ hard) => {
    /** @type {any[]} */
    const supported = [];
    /** @type {any[]} */
    const disputedUnsupported = [];
    for (const row of real) {
        const {decision, reason} = decided.get(row.id);
        const entry = {decision, finding: pool.get(row.id).finding, id: row.id, reason, stableId: row.stableId};
        if (decision === 'supported') supported.push(entry);
        if (decision !== 'unsupported') continue;
        const why = [];
        if (hard.has(row.id)) why.push('among the hardest the adjudicator named');
        if (HEDGES.test(reason)) why.push('hedged reason');
        const points = evidencePoints(pool.get(row.id));
        const others = real.filter(other => other.id !== row.id && decided.get(other.id).decision !== 'unsupported'
            && [...evidencePoints(pool.get(other.id))].some(point => points.has(point))).map(other => other.id);
        if (others.length > 0) why.push(`evidence shared with items decided otherwise: ${JSON.stringify(others.slice(0, 8))}`);
        if (why.length > 0) disputedUnsupported.push({...entry, why});
    }
    return {disputedUnsupported, supported};
};

/**
 * Checks the judge's decisions against the pool's controls; a pool that passes has its decisions written into the store.
 * The verdict and Main's review lists are written to split-<name>.json either way.
 *
 * @param {{decisions: any, hard?: string[], name: string, root: string}} input
 */
export const splitPool = async ({decisions: reply, hard = [], name, root}) => {
    const {key} = await readKey(root, name);
    if (key.briefSha256 === undefined) throw new PoolError('Run pool prompt before pool split.');
    const brief = await readShared(key.scenario, 'brief.md');
    if (brief === undefined) throw new PoolError(`The brief of ${key.scenario} is missing.`);
    if (key.briefSha256 !== sha256(brief)) throw new PoolError('The pool prompt was not made from the current brief; run pool prompt again.');
    const pool = new Map((JSON.parse(await readFile(join(root, name, 'adj', `pool-${name}.json`), 'utf8'))).map((/** @type {any} */ item) => [item.id, item]));
    if (sha256(await readFile(join(root, name, 'adj', `pool-${name}.json`), 'utf8')) !== key.poolSha256) throw new PoolError('The pool file differs from the one the key was written for.');
    /** @type {Map<string, any>} */
    const decided = new Map();
    for (const item of Array.isArray(reply?.decisions) ? reply.decisions : []) {
        if (decided.has(item?.id)) throw new PoolError(`${item.id} is decided twice.`);
        decided.set(item?.id, item);
    }
    if (decided.size !== pool.size || [...decided.keys()].some(id => !pool.has(id))) throw new PoolError('Decision ids differ from the pool.');
    for (const [id, item] of decided) {
        if (!pool.get(id).allowedDecisions.includes(item.decision) || String(item.reason ?? '').trim() === '') throw new PoolError(`${id}: decision ${item.decision} is not allowed or has no reason.`);
    }
    const rows = Object.entries(key.items).map(([id, meta]) => ({id, ...(/** @type {any} */ (meta)), decision: decided.get(id).decision}));
    const anchors = rows.filter(row => row.source === 'anchor');
    const synthetic = rows.filter(row => row.source === 'synthetic');
    const agree = (/** @type {any[]} */ list) => list.filter(row => row.decision === row.expected).length;
    const anchorRate = anchors.length === 0 ? null : agree(anchors) / anchors.length;
    const syntheticAllRight = agree(synthetic) === synthetic.length;
    const passed = anchorRate !== null && anchorRate >= ANCHOR_THRESHOLD && syntheticAllRight && synthetic.length > 0;
    /** @type {Record<string, number>} */
    const decisionCounts = {};
    for (const {decision} of decided.values()) decisionCounts[decision] = (decisionCounts[decision] ?? 0) + 1;
    const real = rows.filter(row => row.source === 'instance');
    const review = reviewLists(real, pool, decided, new Set(hard));
    const verdict = {anchorAgreementByFamily: agreement(anchors, 'family'), anchorAgreementByModel: agreement(anchors, 'model'), anchorRate, anchors: anchors.length, decisionCounts, passed,
        review: {disputedUnsupported: review.disputedUnsupported.length, supported: review.supported.length}, synthetic: synthetic.length,
        syntheticAllRight, syntheticByFamily: agreement(synthetic, 'family'), written: 0};
    if (passed) {
        const storePath = join(root, name, 'decisions.json');
        const store = await readStore(storePath);
        for (const row of real) {
            const item = decided.get(row.id);
            const entry = {decision: item.decision, reason: item.reason, source: `pool ${name}:${row.id}`, kind: row.kind, fingerprint: row.fingerprint,
                brief_sha256: key.briefSha256, allowedDecisions: pool.get(row.id).allowedDecisions};
            const old = store.decisions[row.stableId];
            if (old !== undefined && sortedDump({...old, allowedDecisions: 0}) !== sortedDump({...entry, allowedDecisions: 0})) store.history.push({stable_id: row.stableId, replaced: old, by: entry.source});
            store.decisions[row.stableId] = entry;
            verdict.written += 1;
        }
        await writeFile(storePath, text(store));
    }
    await writeFile(join(root, name, `split-${name}.json`), text({verdict, review}));
    return verdict;
};

/** A reviewed decision replaces a stored one (history kept); it must be one the candidate allows. */
export const overridePool = async (/** @type {{by?: string, decision: string, id: string, name: string, reason: string, root: string}} */ {by = 'Main review', decision, id, name, reason, root}) => {
    const storePath = join(root, name, 'decisions.json');
    const store = await readStore(storePath);
    const old = store.decisions[id];
    if (old === undefined) throw new PoolError(`${id} has no adjudicated decision to override.`);
    if (String(reason).trim() === '') throw new PoolError('An override needs a reason.');
    if (!DECISION.test(decision) || (old.kind === 'association') !== (decision === 'matched' || decision === 'not-matched')) throw new PoolError(`${decision} is not a decision of a ${old.kind} candidate.`);
    if (!Array.isArray(old.allowedDecisions) || !old.allowedDecisions.includes(decision)) throw new PoolError(`${decision} is not in allowedDecisions ${JSON.stringify(old.allowedDecisions)}.`);
    const entry = {...old, decision, reason, source: `override (${by})`};
    store.history.push({stable_id: id, replaced: old, by: entry.source});
    store.decisions[id] = entry;
    await writeFile(storePath, text(store));
    return entry;
};

/** Registers a decided association candidate as a new anchor in the scenario's anchors file (the one fixture the suite writes). */
export const addAnchor = async (/** @type {{anchorsPath: string, candidate: any, confirmedBy: string, expected: string, family: string, id?: string, model: string}} */ {anchorsPath, candidate, confirmedBy, expected, family, id, model}) => {
    if (candidate.kind !== 'association') throw new PoolError('Anchors are association decisions; a finding-kind control is synthetic.');
    if (expected !== 'matched' && expected !== 'not-matched') throw new PoolError('An anchor decision is matched or not-matched.');
    if (!FAMILIES.includes(family)) throw new PoolError(`family is one of ${FAMILIES.join(', ')}.`);
    if (String(model ?? '').trim() === '' || String(confirmedBy ?? '').trim() === '') throw new PoolError('An anchor needs its source model and who confirmed it.');
    const registry = JSON.parse(await readFile(anchorsPath, 'utf8'));
    const anchorId = id ?? `a${String(registry.anchors.length + 1).padStart(2, '0')}`;
    if (registry.anchors.some((/** @type {any} */ anchor) => anchor.id === anchorId)) throw new PoolError(`${anchorId} is already registered.`);
    const {cleanTargets, problemOptions, ...item} = poolItem(candidate);
    const anchor = {id: anchorId, family, model, expected, confirmed_by: confirmedBy, origin: candidate.candidateId === undefined ? null : {candidateId: candidate.candidateId},
        item: {...item, allowedDecisions: ['matched', 'not-matched']}};
    registry.anchors.push(anchor);
    await writeFile(anchorsPath, text(registry));
    return anchor;
};
