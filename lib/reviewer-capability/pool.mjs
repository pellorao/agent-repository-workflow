// Blind adjudication pools: the judge sees <root>/<name>/adj (the pool, its views and its own decisions file); the key,
// the prompt and the decision store stay beside it. Candidate order, group labels and ids follow qwen_strata's blind_pool.

import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {compareText, sha256} from '../common/json.mjs';
import {createRandom} from './random.mjs';

export const SEED = 20261020;
const ANCHORS_PER_POOL = 12;
const ANCHOR_THRESHOLD = 0.9;
const FIELDS = ['kind', 'scenario', 'check', 'allowedDecisions', 'expectation', 'finding', 'result', 'evidence', 'requirementSource', 'problemOptions', 'cleanTargets'];
const FAIRNESS_NOTE = '调用方附加说明（不属于冻结 brief，用户 2026-10-20 决定加入）：候选的写法可能让你看得出它来自哪类模型或哪次运行。'
    + '不要据此推断来源，也不要因来源调整判断；请只按上文口径和 view 中的证据，对每个候选公平判定。';

export class PoolError extends Error {}

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

export const candidateFingerprint = (/** @type {any} */ candidate) => {
    return sha256(sortedDump(poolItem(candidate)));
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

/**
 * @param {{anchors: any, brief: string, candidates: any[], limit: number, name: string, root: string, scenario: string}} input
 * @returns {Promise<{adj: string, controls: number, key: string, pool: string, real: number}>}
 */
export const buildPool = async ({anchors, brief, candidates, limit, name, root, scenario}) => {
    const random = createRandom(SEED);
    const picked = anchors.anchors.length > ANCHORS_PER_POOL ? pickAnchors(anchors.anchors, ANCHORS_PER_POOL, random) : anchors.anchors;
    const controls = [...picked.map((/** @type {any} */ anchor) => [anchor.item, {source: 'anchor', control: anchor.id, expected: anchor.expected, family: anchor.family,
        model: anchor.model ?? null, origin: anchor.origin ?? null}]),
    ...anchors.synthetic.map((/** @type {any} */ synthetic) => [synthetic.item, {source: 'synthetic', control: synthetic.id, type: synthetic.type,
        expected: synthetic.expected, family: synthetic.family, model: synthetic.model ?? null}])];
    if (!controls.some(([, meta]) => meta.expected === 'not-matched')) throw new PoolError('The scenario has no not-matched control for its pools.');
    /** @type {Map<unknown, any[]>} */
    const groups = new Map();
    for (const candidate of candidates) {
        const item = poolItem(candidate);
        const groupKey = candidate.kind === 'association' ? item.expectation : `finding\0${candidate.candidateId}`;
        groups.set(groupKey, [...groups.get(groupKey) ?? [], [item, {source: 'instance', stableId: candidate.candidateId, kind: candidate.kind, fingerprint: candidateFingerprint(candidate)}]]);
    }
    const room = limit - controls.length;
    const real = [...groups.values()].sort((left, right) => right.length - left.length).flat();
    if (real.length > room) throw new PoolError(`${real.length} candidates and ${controls.length} controls exceed the pool limit ${limit}.`);
    const items = [...real, ...controls];
    random.shuffle(items);
    const expectations = [...new Set(items.flatMap(([item]) => item.expectation === null ? [] : [item.expectation]))].sort(compareText);
    random.shuffle(expectations);
    let findings = 0;
    const labels = items.map(([item]) => item.expectation === null ? `F${String(++findings).padStart(2, '0')}` : `E${String(expectations.indexOf(item.expectation) + 1).padStart(2, '0')}`);
    const order = items.map((_, index) => index).sort((left, right) => compareText(labels[left], labels[right]) || left - right);
    const pool = [];
    const key = {};
    for (const [index, position] of order.entries()) {
        const id = `${name}-${String(index + 1).padStart(3, '0')}`;
        pool.push({id, group: labels[position], ...items[position][0]});
        /** @type {any} */ (key)[id] = items[position][1];
    }
    const directory = join(root, name);
    await mkdir(join(directory, 'adj'), {recursive: true});
    const poolPath = join(directory, 'adj', `pool-${name}.json`);
    const poolText = text(pool);
    await writeFile(poolPath, poolText);
    await writeFile(join(directory, 'key.json'), text({pool: name, scenario, briefText: brief, poolSha256: sha256(poolText), items: key}));
    return {adj: join(directory, 'adj'), controls: controls.length, key: join(directory, 'key.json'), pool: poolPath, real: real.length};
};

const readKey = async (/** @type {string} */ root, /** @type {string} */ name) => {
    const path = join(root, name, 'key.json');
    try { return {key: JSON.parse(await readFile(path, 'utf8')), path}; } catch (error) {
        if (/** @type {any} */ (error).code === 'ENOENT') throw new PoolError(`Pool key is missing: ${path}.`);
        throw error;
    }
};

/** The judge's prompt: the brief with `<ADJ>` and `<名>` replaced, then the fairness note. */
export const poolPrompt = async (/** @type {{name: string, root: string}} */ {name, root}) => {
    const {key, path} = await readKey(root, name);
    for (const placeholder of ['<ADJ>', '<名>']) if (!key.briefText.includes(placeholder)) throw new PoolError(`The brief has no ${placeholder} to replace.`);
    const prompt = `${key.briefText.replaceAll('<ADJ>', 'adj').replaceAll('<名>', name).replace(/\n+$/u, '')}\n\n${FAIRNESS_NOTE}\n`;
    const promptPath = join(root, name, 'prompt.md');
    await writeFile(promptPath, prompt);
    await writeFile(path, text({...key, briefSha256: sha256(key.briefText), promptSha256: sha256(prompt)}));
    return {briefSha256: sha256(key.briefText), prompt: promptPath, promptSha256: sha256(prompt)};
};

const readStore = async (/** @type {string} */ path) => JSON.parse(await readFile(path, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '{"decisions": {}, "history": []}';
    throw error;
}));

/**
 * Checks the judge's decisions against the pool's controls; a pool that passes has its decisions written into the store.
 *
 * @param {{decisions: any, name: string, root: string}} input
 */
export const splitPool = async ({decisions: reply, name, root}) => {
    const {key} = await readKey(root, name);
    if (key.briefSha256 === undefined) throw new PoolError('Run pool prompt before pool split.');
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
    /** @type {[string, any][]} */
    const rows = Object.entries(key.items);
    const anchors = rows.filter(([, meta]) => meta.source === 'anchor');
    const synthetic = rows.filter(([, meta]) => meta.source === 'synthetic');
    const agree = (/** @type {[string, any][]} */ list) => list.filter(([id, meta]) => decided.get(id).decision === meta.expected).length;
    const anchorRate = anchors.length === 0 ? null : agree(anchors) / anchors.length;
    const syntheticAllRight = agree(synthetic) === synthetic.length;
    const passed = anchorRate !== null && anchorRate >= ANCHOR_THRESHOLD && syntheticAllRight && synthetic.length > 0;
    /** @type {Record<string, number>} */
    const decisionCounts = {};
    for (const {decision} of decided.values()) decisionCounts[decision] = (decisionCounts[decision] ?? 0) + 1;
    const verdict = {anchorRate, anchors: anchors.length, decisionCounts, passed, synthetic: synthetic.length, syntheticAllRight, written: 0};
    if (!passed) return verdict;
    const storePath = join(root, name, 'decisions.json');
    const store = await readStore(storePath);
    for (const [id, meta] of rows.filter(([, row]) => row.source === 'instance')) {
        const item = decided.get(id);
        const entry = {decision: item.decision, reason: item.reason, source: `pool ${name}:${id}`, kind: meta.kind, fingerprint: meta.fingerprint,
            brief_sha256: key.briefSha256, allowedDecisions: pool.get(id).allowedDecisions};
        const old = store.decisions[meta.stableId];
        if (old !== undefined && sortedDump({...old, allowedDecisions: 0}) !== sortedDump({...entry, allowedDecisions: 0})) store.history.push({stable_id: meta.stableId, replaced: old, by: entry.source});
        store.decisions[meta.stableId] = entry;
        verdict.written += 1;
    }
    await writeFile(storePath, text(store));
    return verdict;
};

/** A reviewed decision replaces a stored one (history kept); it must be one the candidate allows. */
export const overridePool = async (/** @type {{decision: string, id: string, name: string, reason: string, root: string}} */ {decision, id, name, reason, root}) => {
    const storePath = join(root, name, 'decisions.json');
    const store = await readStore(storePath);
    const old = store.decisions[id];
    if (old === undefined) throw new PoolError(`${id} has no adjudicated decision to override.`);
    if (String(reason).trim() === '') throw new PoolError('An override needs a reason.');
    if (!old.allowedDecisions.includes(decision)) throw new PoolError(`${decision} is not in allowedDecisions ${JSON.stringify(old.allowedDecisions)}.`);
    const entry = {...old, decision, reason, source: 'override (Main review)'};
    store.history.push({stable_id: id, replaced: old, by: entry.source});
    store.decisions[id] = entry;
    await writeFile(storePath, text(store));
    return entry;
};
