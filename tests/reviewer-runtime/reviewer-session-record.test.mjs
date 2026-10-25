import assert from 'node:assert/strict';
import {relative} from 'node:path';
import test from 'node:test';
import {createReviewerRuntime} from '../../lib/reviewer-runtime/reviewer-runtime.mjs';
import {readReviewerSessionRecord} from '../../lib/reviewer-runtime/reviewer-session-record.mjs';
import {createReviewerRuntimeFixture,reviewerHandoff} from '../helpers/reviewer-runtime-adapter.mjs';

test('saved Reviewer records reject malformed optional measurements without changing bytes and retain legacy reads',async () => {
    const fixture = createReviewerRuntimeFixture();
    const runtime = createReviewerRuntime({nativeSessions:fixture.native.nativeSessions,filesystem:fixture.filesystem,
        clock:fixture.clock,recoveryBoundary:fixture.recoveryBoundary});
    try {
        const accepted = await runtime.execute({operation:'spawn_agent',input:reviewerHandoff});
        assert.equal(accepted.status,'succeeded');
        if (accepted.status !== 'succeeded') assert.fail('Expected an accepted Reviewer task.');
        const observed = await runtime.inspect({runId:accepted.result.runId});
        assert.equal(observed.status,'succeeded');
        if (observed.status !== 'succeeded') assert.fail('Expected a saved Reviewer binding.');
        const recoveryPath = observed.result.recoveryPath;
        assert.equal(typeof recoveryPath,'string');
        if (typeof recoveryPath !== 'string') assert.fail('Expected a bound recovery path.');
        const opened = await fixture.filesystem.open({root:reviewerHandoff.cwd});
        if (opened.status !== 'succeeded') assert.fail('Expected the prepared repository filesystem.');
        const filesystem = opened.scopedFilesystem;
        const path = relative(reviewerHandoff.cwd,recoveryPath).split('\\').join('/');
        const original = await filesystem.read({path});
        if (original.status !== 'succeeded') assert.fail('Expected the actual saved record bytes.');
        const saved = JSON.parse(original.bytes.toString('utf8'));
        assert.deepEqual(await readReviewerSessionRecord(filesystem,recoveryPath,path),saved);
        assert.ok(saved.measurement.work);
        assert.ok(saved.measurement.phases);

        const withoutBasis = JSON.parse(original.bytes.toString('utf8'));
        delete withoutBasis.measurement.work.basis;
        const invalidResponse = JSON.parse(original.bytes.toString('utf8'));
        invalidResponse.measurement.phases.responses = {broken:null};
        for (const invalid of [withoutBasis,invalidResponse]) {
            const bytes = Buffer.from(`${JSON.stringify(invalid)}\n`);
            assert.equal((await filesystem.write({path,bytes,mode:'replace'})).status,'succeeded');
            await assert.rejects(readReviewerSessionRecord(filesystem,recoveryPath,path),{code:'recovery-invalid'});
            const unchanged = await filesystem.read({path});
            if (unchanged.status !== 'succeeded') assert.fail('Expected the rejected record to remain readable.');
            assert.deepEqual(unchanged.bytes,bytes);
        }

        const legacy = JSON.parse(original.bytes.toString('utf8'));
        delete legacy.measurement.work;
        delete legacy.measurement.phases;
        const bytes = Buffer.from(`${JSON.stringify(legacy)}\n`);
        assert.equal((await filesystem.write({path,bytes,mode:'replace'})).status,'succeeded');
        assert.deepEqual(await readReviewerSessionRecord(filesystem,recoveryPath,path),legacy);
        const unchanged = await filesystem.read({path});
        if (unchanged.status !== 'succeeded') assert.fail('Expected the legacy record bytes.');
        assert.deepEqual(unchanged.bytes,bytes);
    } finally {
        await runtime.close();
    }
});
