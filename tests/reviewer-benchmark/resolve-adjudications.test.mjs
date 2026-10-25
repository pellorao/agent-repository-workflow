import assert from 'node:assert/strict';
import test from 'node:test';

import {resolveAdjudications} from '../../lib/reviewer-benchmark/resolve-adjudications.mjs';

const decision = (/** @type {string} */ candidateId, /** @type {string} */ value, reason = value) =>
    ({candidateId, decision: value, reason});

test('combines agreement and requires an explicit decision for each disputed candidate', () => {
    const request = {candidates: [{candidateId: 'a'}, {candidateId: 'b'}]};
    const sets = [
        {decisions: [decision('a', 'matched'), decision('b', 'not-matched')]},
        {decisions: [decision('a', 'matched'), decision('b', 'matched')]},
    ];
    assert.throws(() => resolveAdjudications(request, sets, []), /lacks Main Agent resolution/u);
    const result = resolveAdjudications(request, sets,
        [decision('b', 'matched', 'Verified against the original finding.')]);
    assert.equal(result.disagreements, 1);
    assert.deepEqual(result.decisions,
        [decision('a', 'matched'), decision('b', 'matched', 'Verified against the original finding.')]);
    const corrected = resolveAdjudications(request, sets,
        [decision('a', 'not-matched', 'Original finding differs from the frozen case.'),
            decision('b', 'matched')]);
    assert.equal(corrected.unanimousCorrections, 1);
    assert.equal(corrected.decisions[0]?.decision, 'not-matched');
    assert.throws(() => resolveAdjudications(request,
        [{decisions: [decision('a', 'matched'), decision('a', 'matched')]}, ...sets.slice(1)],
        [decision('b', 'matched')]), /duplicate candidates/u);
});
