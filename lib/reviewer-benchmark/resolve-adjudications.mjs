/** @typedef {{candidateId:string,decision:string,reason:string}} Decision */
/** @param {string} message @returns {never} */
function fail(message) {throw new Error(message);}
const validDecision = (/** @type {Decision} */ value) => value && typeof value.candidateId === 'string'
    && ['matched', 'not-matched'].includes(value.decision)
    && typeof value.reason === 'string' && value.reason.trim().length > 0;

/** Reuse two agreed judgments unless Main Agent corrects them; resolve every dispute explicitly. */
export const resolveAdjudications = (/** @type {{candidates:{candidateId:string}[]}} */ request, /** @type {{decisions:Decision[]}[]} */ decisionSets, /** @type {Decision[]} */ resolutions) => {
    if (!Array.isArray(request?.candidates) || decisionSets?.length !== 2
        || !Array.isArray(resolutions)) fail('A request, two decisions, and resolutions are required.');
    const ids = request.candidates.map(item => item.candidateId);
    if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
        fail('Candidate IDs are invalid or duplicated.');
    }
    const candidates = new Set(ids);
    const sets = decisionSets.map((set, index) => {
        if (!Array.isArray(set?.decisions) || set.decisions.length !== ids.length
            || set.decisions.some(item => !validDecision(item) || !candidates.has(item.candidateId))) {
            fail(`Decision set ${index + 1} does not cover the request.`);
        }
        const values = new Map(set.decisions.map(item => [item.candidateId, item]));
        if (values.size !== ids.length) fail(`Decision set ${index + 1} has duplicate candidates.`);
        return values;
    });
    /** @type {Map<string,Decision>} */
    const overrides = new Map();
    for (const item of resolutions) {
        if (!validDecision(item) || !candidates.has(item.candidateId)
            || overrides.has(item.candidateId)) fail('Resolution is invalid or duplicated.');
        overrides.set(item.candidateId, item);
    }
    let disagreements = 0;
    let unanimousCorrections = 0;
    const decisions = ids.map(candidateId => {
        const values = sets.map(set => /** @type {Decision} */ (set.get(candidateId)));
        const agreed = values.every(item => item.decision === values[0].decision);
        const override = overrides.get(candidateId);
        if (agreed) {
            if (override) {
                if (override.decision === values[0].decision) {
                    fail(`Agreed candidate resolution does not correct its decision: ${candidateId}.`);
                }
                unanimousCorrections++;
            }
            return override ?? values[0];
        }
        disagreements++;
        if (!override) fail(`Disputed candidate lacks Main Agent resolution: ${candidateId}.`);
        return override;
    });
    if (overrides.size !== disagreements + unanimousCorrections) {
        fail('Resolutions do not match all disputes and corrections.');
    }
    return {decisions:decisions.map(({candidateId,decision,reason}) => ({candidateId,decision,reason})),
        disagreements, unanimousCorrections};
};
