// Template-style finding marks: findings of one instance whose normalized text is the same or nearly the same. A flag only; it
// never changes a score. The text similarity reproduces Python's difflib.SequenceMatcher(None, a, b).ratio() (with autojunk),
// the measure qwen_strata's template_findings uses.

const TEMPLATE_ROWS = 3;
const TEMPLATE_RATIO = 0.9;

export const normalizedFinding = (/** @type {unknown} */ text) => String(text).toLowerCase().replace(/`[^`]*`/gu, '`x`')
    .replace(/[\p{L}\p{N}_./-]+:\d+(?:[-,]\d+)*/gu, 'loc').replace(/\p{Nd}+/gu, '0').replace(/[\p{White_Space}\x1c-\x1f]+/gu, ' ').trim();

/** The longest block a[i..i+k) == b[j..j+k) inside the ranges, earliest in a then in b (difflib.find_longest_match without junk). */
const longestMatch = (/** @type {string[]} */ a, /** @type {string[]} */ b, /** @type {Map<string, number[]>} */ b2j, /** @type {number[]} */ [alo, ahi, blo, bhi]) => {
    let [besti, bestj, bestsize] = [alo, blo, 0];
    /** @type {Map<number, number>} */
    let j2len = new Map();
    for (let i = alo; i < ahi; i += 1) {
        /** @type {Map<number, number>} */
        const newj2len = new Map();
        for (const j of b2j.get(a[i]) ?? []) {
            if (j < blo) continue;
            if (j >= bhi) break;
            const k = (j2len.get(j - 1) ?? 0) + 1;
            newj2len.set(j, k);
            if (k > bestsize) [besti, bestj, bestsize] = [i - k + 1, j - k + 1, k];
        }
        j2len = newj2len;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) [besti, bestj, bestsize] = [besti - 1, bestj - 1, bestsize + 1];
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize += 1;
    return [besti, bestj, bestsize];
};

export const sequenceMatcherRatio = (/** @type {string} */ left, /** @type {string} */ right) => {
    const a = Array.from(left);
    const b = Array.from(right);
    /** @type {Map<string, number[]>} */
    const b2j = new Map();
    for (const [index, element] of b.entries()) b2j.set(element, [...b2j.get(element) ?? [], index]);
    // autojunk: with 200 or more elements, those occurring more than n / 100 + 1 times are not match anchors.
    if (b.length >= 200) for (const [element, indices] of b2j) if (indices.length > Math.floor(b.length / 100) + 1) b2j.delete(element);
    let matched = 0;
    const queue = [[0, a.length, 0, b.length]];
    for (let range = queue.pop(); range !== undefined; range = queue.pop()) {
        const [i, j, k] = longestMatch(a, b, b2j, range);
        if (k === 0) continue;
        matched += k;
        if (range[0] < i && range[2] < j) queue.push([range[0], i, range[2], j]);
        if (i + k < range[1] && j + k < range[3]) queue.push([i + k, range[1], j + k, range[3]]);
    }
    return a.length + b.length === 0 ? 1 : 2 * matched / (a.length + b.length);
};

/**
 * @param {any[]} candidates every candidate seen while scoring one report set
 * @param {Map<string, {decision: string, source: string}>} decisions the applied decisions by candidateId
 */
export const templateFindings = (candidates, decisions) => {
    /** @type {Map<string, Map<string, string>>} */
    const byInstance = new Map();
    const keyOf = (/** @type {any} */ candidate) => JSON.stringify([candidate.check ?? candidate.problemScope, candidate.findingIndex]);
    for (const candidate of candidates) {
        if (candidate.finding === undefined || candidate.finding === null) continue;
        const keys = byInstance.get(candidate.instanceId) ?? new Map();
        // The first text of a key stands for it.
        if (!keys.has(keyOf(candidate))) keys.set(keyOf(candidate), candidate.finding);
        byInstance.set(candidate.instanceId, keys);
    }
    const found = [];
    for (const instanceId of [...byInstance.keys()].sort()) {
        /** @type {Array<{norm: string, text: string, keys: string[]}>} */
        const groups = [];
        for (const [key, text] of /** @type {Map<string, string>} */ (byInstance.get(instanceId))) {
            const norm = normalizedFinding(text);
            const group = groups.find(item => item.norm === norm || sequenceMatcherRatio(item.norm, norm) >= TEMPLATE_RATIO);
            if (group === undefined) groups.push({keys: [key], norm, text});
            else group.keys.push(key);
        }
        for (const group of groups.filter(item => item.keys.length >= TEMPLATE_ROWS)) {
            const credited = candidates.flatMap(candidate => {
                const decision = decisions.get(candidate.candidateId);
                return candidate.instanceId === instanceId && group.keys.includes(keyOf(candidate)) && decision !== undefined
                    && (decision.decision === 'matched' || decision.decision.startsWith('problem-'))
                    ? [{candidateId: candidate.candidateId, decision: decision.decision, source: decision.source}] : [];
            });
            found.push({credited, findings: group.keys.length, instanceId, text: group.text});
        }
    }
    return found;
};
