import assert from 'node:assert/strict';
import {mkdir, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {precheckSpecReadiness} from '../../lib/spec-readiness/precheck.mjs';

const subjectOf = (/** @type {string} */ build, /** @type {string} */ criteria) => `## What to build\n\n${build}\n\n## Acceptance criteria\n\n${criteria}\n`;

test('precheck warns about out-of-range references, missing paths and criteria without observation, and skips new files', async t => {
    const root = await createTemporaryDirectory(t, 'precheck-');
    await mkdir(join(root, 'lib'));
    await symlink(join(root, 'lib'), join(root, 'linked'));
    await writeFile(join(root, 'lib', 'present.mjs'), 'one\ntwo\n');
    await writeFile(join(root, 'lib', 'bare.mjs'), 'one\ntwo');
    const subject = subjectOf(
        '见 `lib/present.mjs:9` 与 lib/present.mjs:2 与 lib/bare.mjs:2.\n改 `lib/gone.mjs`.\n新增 `lib/fresh.mjs`.\n读 `elsewhere/none.md`. 经链接 `linked/gone.mjs`. 文件作父级 `lib/present.mjs/gone.md`.',
        '- [ ] 行为正确.\n- [ ] 命令 `pnpm test` 通过.\n- [ ] 观察: 输出含 ok.',
    );
    const warnings = await precheckSpecReadiness({repositoryRoot: root, subject: {content: subject, filePath: 'issue.md'}, texts: [{filePath: 'spec', content: 'spec 引用 lib/present.mjs:3'}]});
    assert.deepEqual(warnings, [
        'warning: issue.md: lib/present.mjs:9 超出该文件的行数.',
        'warning: issue.md: lib/gone.mjs 不存在.',
        'warning: issue.md: lib/present.mjs/gone.md 不存在.',
        'warning: spec: lib/present.mjs:3 超出该文件的行数.',
        'warning: issue.md: 验收项没有观察方式: - [ ] 行为正确.',
    ]);
});

test('precheck warns about criteria conditioned on post-commit facts or other reviews', async t => {
    const root = await createTemporaryDirectory(t, 'precheck-');
    const criteria = '- [ ] 观察: Commit Audit 通过.\n- [ ] 观察: 提交号已记录.\n- [ ] 观察: Spec Readiness 通过.\n- [ ] 观察: 审核结果为通过.\n- [ ] 观察: 审核全部通过.\n- [ ] 观察: Spec Readiness 已通过.\n- [ ] 观察: 输出含 ok.\n- [ ] 观察: Reviewer 角色文档检查通过.\n- [ ] 观察: 审核脚本输出通过.';
    assert.deepEqual(await precheckSpecReadiness({repositoryRoot: root, subject: {content: subjectOf('做事.', criteria), filePath: 'issue.md'}, texts: []}), [
        'warning: issue.md: 验收项以提交后的事实或其他审核的结果为条件, 应移入预期验证: - [ ] 观察: Commit Audit 通过.',
        'warning: issue.md: 验收项以提交后的事实或其他审核的结果为条件, 应移入预期验证: - [ ] 观察: 提交号已记录.',
        'warning: issue.md: 验收项以提交后的事实或其他审核的结果为条件, 应移入预期验证: - [ ] 观察: Spec Readiness 通过.',
        'warning: issue.md: 验收项以提交后的事实或其他审核的结果为条件, 应移入预期验证: - [ ] 观察: 审核结果为通过.',
        'warning: issue.md: 验收项以提交后的事实或其他审核的结果为条件, 应移入预期验证: - [ ] 观察: 审核全部通过.',
        'warning: issue.md: 验收项以提交后的事实或其他审核的结果为条件, 应移入预期验证: - [ ] 观察: Spec Readiness 已通过.',
    ]);
});

test('precheck stays silent for a clean subject', async t => {
    const root = await createTemporaryDirectory(t, 'precheck-');
    assert.deepEqual(await precheckSpecReadiness({repositoryRoot: root, subject: {content: subjectOf('做事.', '- [ ] 观察: 通过.'), filePath: 'issue.md'}, texts: []}), []);
});
