import {isAbsolute, resolve} from 'node:path';
import {resolveAbsolutePathWithinScope} from '../common/filesystem.mjs';

/** @typedef {import('../background-agent/codex-app-server.mjs').NativeSnapshot} NativeSnapshot */
/** @typedef {import('../background-agent/codex-app-server.mjs').NativeMember} NativeMember */
/** @typedef {{cwd: string, writePaths: string[], reportPath: string, contextFloors: Record<string, number>, rootThreadId: string, beforeTurn?: boolean}} GroupRequirements */

const accessPriority = {deny: 3, write: 2, read: 1};

/** @param {string} path @param {string[]} scopes */
export const isWithinReviewerPaths = (path, scopes) => scopes.some(scope =>
    resolveAbsolutePathWithinScope({path, scope}).status === 'succeeded');

/** @param {NativeMember[]} members @returns {Record<string, number>} */
export const reviewerContextFloors = members => Object.fromEntries(members.map(member => [
    member.threadId,
    Math.max(-1, ...member.contexts.map(context => context.recordSequence)),
]));

/** @param {NativeSnapshot} snapshot @param {GroupRequirements} requirements */
export const inspectReviewerGroup = (snapshot, requirements) => {
    const {rootThreadId, contextFloors, cwd, writePaths, reportPath, beforeTurn = false} = requirements;
    /** @type {string[]} */
    const violations = [];
    const unknownReasons = [...snapshot.unknownReasons];
    const root = snapshot.members.find(member => member.threadId === rootThreadId);
    if (snapshot.rootThreadId !== rootThreadId || !root) {
        unknownReasons.push('The original root Thread.id could not be confirmed.');
    }
    if (!snapshot.factsComplete && unknownReasons.length === 0) {
        unknownReasons.push('Reviewer thread discovery or native records are incomplete.');
    }
    if (new Set(snapshot.members.map(member => member.threadId)).size !== snapshot.members.length) {
        unknownReasons.push('Native Reviewer threads contain duplicate Thread.id values.');
    }
    for (const member of snapshot.members) {
        const contexts = member.contexts.filter(context => context.recordSequence > (contextFloors[member.threadId] ?? -1));
        if (member.threadId !== rootThreadId) {
            if (member.state === 'active' || !Object.hasOwn(contextFloors, member.threadId) || contexts.length > 0) {
                violations.push(`An additional Agent thread ${member.threadId} was created, resumed or participated in this review.`);
            }
            continue;
        }
        if (!member.sessionPath && !(beforeTurn && member.turnId === null)) unknownReasons.push('The native record for the Reviewer thread is unknown.');
        if (contexts.length === 0 && !(beforeTurn && member.state !== 'active')) unknownReasons.push('No current native Reviewer turn context is available.');
        for (const context of contexts) {
            unknownReasons.push(...context.unknownReasons.map(reason => `${member.threadId}: ${reason}`));
            if (context.cwd === null || context.permissionsRules === null) {
                unknownReasons.push(`The native working directory or permissions are unknown for ${member.threadId}.`);
            } else {
                if (resolve(context.cwd) !== resolve(cwd)) violations.push(`Reviewer thread ${member.threadId} uses a different working directory.`);
                if (context.permissionsRules.some(rule => rule.path !== ':minimal' && !isAbsolute(rule.path))) {
                    unknownReasons.push(`The native permission paths cannot be interpreted for ${member.threadId}.`);
                }
                const rules = context.permissionsRules.filter(rule => rule.path !== ':minimal' && isAbsolute(rule.path))
                    .map(rule => ({path: resolve(rule.path), access: rule.access}));
                const accessFor = (/** @type {string} */ path) => rules.filter(rule => isWithinReviewerPaths(path, [rule.path]))
                    .sort((left, right) => right.path.length - left.path.length || accessPriority[right.access] - accessPriority[left.access])[0]?.access;
                const repositoryPaths = new Set([cwd, reportPath, ...rules.map(rule => rule.path).filter(path => isWithinReviewerPaths(path, [cwd]))]);
                for (const path of repositoryPaths) {
                    const access = accessFor(path);
                    if (access === undefined) {
                        unknownReasons.push(`Repository read permission could not be confirmed for ${member.threadId}.`);
                    } else if (access === 'deny') {
                        violations.push(`Reviewer thread ${member.threadId} cannot read the complete working repository.`);
                    }
                    if (access === 'write' && !isWithinReviewerPaths(path, writePaths)) {
                        violations.push(`Reviewer thread ${member.threadId} has write permission outside the authorized temporary paths.`);
                    }
                }
                if (accessFor(reportPath) !== 'write') {
                    violations.push(`Reviewer thread ${member.threadId} does not have write permission for the bound report.`);
                }
            }
        }
    }
    return {
        root,
        violations: [...new Set(violations)],
        unknownReasons: [...new Set(unknownReasons)],
        active: root?.state === 'active',
    };
};
