import {BENCHMARK_REVIEWERS} from './benchmark-contract.mjs';
import {projectRuntimeMeasurement,tokenKeys} from './statistics.mjs';
import {aggregateReviewerPhaseGroups,reviewerMeasurementRates} from '../reviewer-runtime/reviewer-measurement.mjs';
import {escapeHtml as html} from '../common/html.mjs';
import {mean} from '../common/math.mjs';

/** @typedef {import('./statistics.mjs').Repetition} Repetition */
/** @typedef {import('./statistics.mjs').Observation} Observation */
/** @typedef {import('./statistics.mjs').Statistics} Statistics */
/** @typedef {import('./statistics.mjs').RoleStatistics} RoleStatistics */
/** @typedef {import('./statistics.mjs').TokenUsage} TokenUsage */

const fixed = (/** @type {number|null|undefined} */ value, digits = 3) => value == null ? '-' : value.toFixed(digits);
const diagnosticReasons = new Map([['report-format-correction','报告格式修正'],['commit-audit-fallback','Commit Audit 后备评分'],
    ['qwen-revision-timeout-prior-report','Qwen 修订超时, 按修订前报告诊断评分'],
    ['commit-audit-requirement-split','Commit Audit 要求拆分, 逐要求诊断评分'],
    ['spec-readiness-heading-evidence','Spec Readiness 证据没有有效正文行, 逐 finding 诊断评分'],
    ['spec-readiness-invalid-evidence','Spec Readiness 单项证据无效, 其他判断继续诊断评分'],
    ['spec-readiness-requirement-continuation','Spec Readiness 在 Requirements 问题后继续检查, 诊断评分'],
    ['deepseek-timeout','DeepSeek 超时'],['deepseek-no-final-report','DeepSeek 没有最终报告'],
    ['deepseek-revision-timeout-prior-report','DeepSeek 修订超时, 按修订前报告诊断评分'],
    ['qwen-timeout','Qwen 超时'],['qwen-no-final-report','Qwen 没有最终报告'],['reviewer-incomplete','Reviewer 未完成审查']]);
const tooltipCell = (/** @type {string} */ content, /** @type {string} */ description) =>
    `<td class="has-tooltip" tabindex="0" aria-label="${html(description)}" data-tooltip="${html(description)}">${content}</td>`;
const repeatCell = (/** @type {Repetition} */ repeat) => {
    const details = [];
    if (repeat.scoreSource === 'diagnostic') details.push('诊断来源',`原因: ${diagnosticReasons.get(repeat.diagnosticReason ?? '') ?? repeat.diagnosticReason}`);
    if (repeat.mainAgentCorrectedScoringCopy) details.push('Main Agent 修正了评分用独立副本');
    return details.length ? tooltipCell(`${fixed(repeat.score)} <sup>*</sup>`,details.join('\n')) : `<td>${fixed(repeat.score)}</td>`;
};
/** @param {Observation[]} observations @param {'input'|'output'} direction */
const speedCell = (observations,direction) => {
    const totals = observations.map(item => item.runtime.modelPhases?.totalRequests);
    const total = totals.every(value => value != null) ? totals.reduce((sum,value) => sum + /** @type {number} */ (value),0) : null;
    const groups=aggregateReviewerPhaseGroups(observations.flatMap(item=>item.runtime.modelPhases?.[direction]??[]));
    const phase = reviewerMeasurementRates({modelPhases:{totalRequests:total,input:direction === 'input' ? groups : [],
        output:direction === 'output' ? groups : []}}).model[direction];
    return tooltipCell(fixed(phase.tokensPerSecond,1) + (phase.estimated ? ' *' : ''),
        `来源: ${[...new Set(phase.sources.map(group => group.source))].join(', ') || '未知'}\n覆盖请求: ${phase.measuredRequests}/${total ?? '未知'}\n${phase.basis ?? ''}`);
};
/** @param {Statistics[]} configurations */
export const renderTablesHtml = configurations => {
    if (!Array.isArray(configurations) || !configurations.length) throw new TypeError('At least one configuration is required.');
    const ordered = [...configurations].sort((a,b) => a.configuration.model.localeCompare(b.configuration.model,'en')
        || a.configuration.reasoningEffort.localeCompare(b.configuration.reasoningEffort,'en'));
    const headings = ['模型','推理强度','重复 1','重复 2','重复 3','平均 F2','平均墙钟 (分钟)',
        '平均输入 token','平均缓存输入 token','平均输出 token','平均工作耗时 (分钟)',
        '任务平均输入 token/s','任务平均输出 token/s','模型输入 token/s','模型输出 token/s','完成实例','执行错误'];
    const sections = BENCHMARK_REVIEWERS.flatMap(reviewerId => {
        const entries = ordered.filter(entry => entry.roles.some(role => role.reviewerId === reviewerId));
        if (!entries.length) return [];
        const rows = entries.map(entry => {
            const role = /** @type {RoleStatistics} */ (entry.roles.find(item => item.reviewerId === reviewerId));
            if (role.repetitions.length !== 3) throw new TypeError('Configuration role statistics are incomplete.');
            for (const observation of entry.observations) projectRuntimeMeasurement(observation.runtime);
            const observations = entry.observations.filter(item => item.reviewerId === reviewerId
                && (reviewerId !== 'spec-readiness-reviewer' || item.scenarioId === 'artifact-promotion'));
            const timed=observations.filter(item=>item.runtime.durationMs!==null);
            const durations = timed.map(item => /** @type {number} */(item.runtime.durationMs));
            const usages = observations.flatMap(item => item.runtime.tokenUsage === null ? [] : [item.runtime.tokenUsage]);
            const work = timed.flatMap(item => item.runtime.workDuration?.durationMs == null ? [] : [item.runtime.workDuration]);
            const averaged = (/** @type {'input'|'output'} */ direction) => {
                const paired = timed.filter(item => item.runtime.tokenUsage !== null && (item.runtime.workDuration?.durationMs ?? 0) > 0);
                const numerator = paired.reduce((sum,item) => sum + /** @type {TokenUsage} */ (item.runtime.tokenUsage)[direction],0);
                const denominator = paired.reduce((sum,item) => sum + /** @type {number} */ (item.runtime.workDuration?.durationMs),0);
                return tooltipCell(fixed(denominator > 0 ? numerator / (denominator / 1000) : null,1)
                    + (paired.some(item => item.runtime.workDuration?.estimated) ? ' *' : ''),
                    `配对实例: ${paired.length}/${observations.length}\n${[...new Set(paired.flatMap(item => item.runtime.workDuration?.basis ? [item.runtime.workDuration.basis] : []))].join('\n')}`);
            };
            const errors = role.repetitions.flatMap(repeat => repeat.deliveryErrors.map(error => `重复 ${repeat.repetition}: ${error}`));
            return `<tr><th>${html(entry.configuration.model)}</th><td>${html(entry.configuration.reasoningEffort)}</td>`
                + role.repetitions.map(repeatCell).join('')
                + `<td>${fixed(role.repetitions.every(item => item.score !== null) ? mean(role.repetitions.map(item => /** @type {number} */ (item.score))) : null)}</td>`
                + `<td>${fixed(durations.length ? /** @type {number} */ (mean(durations)) / 60000 : null,1)}</td>`
                + tokenKeys.map(key => `<td>${usages.length ? Math.round(/** @type {number} */ (mean(usages.map(usage => usage[key])))).toLocaleString('en-US') : '-'}</td>`).join('')
                + tooltipCell(fixed(work.length ? /** @type {number} */ (mean(work.map(item => /** @type {number} */ (item?.durationMs)))) / 60000 : null,1)
                    + (work.some(item => item?.estimated) ? ' *' : ''),work.map(item => item?.basis ?? '直接观察').join('\n'))
                + averaged('input') + averaged('output') + speedCell(observations,'input') + speedCell(observations,'output')
                + `<td>${role.repetitions.reduce((sum,item) => sum + item.completedInstances,0)}/${role.repetitions.reduce((sum,item) => sum + item.expectedInstances,0)}</td>`
                + tooltipCell(errors.length ? '?' : '',errors.join('\n')) + '</tr>';
        }).join('\n');
        return [`<section><h2>${html(reviewerId)}</h2><table><thead><tr>${headings.map(value => `<th>${html(value)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></section>`];
    }).join('\n');
    return '<!doctype html>\n<html lang="zh"><head><meta charset="utf-8"><title>Reviewer 模型能力测量</title>'
        + '<style>body{font:16px system-ui,sans-serif;margin:2rem}section{overflow-x:auto}table{border-collapse:collapse}th,td{border:1px solid #bbb;padding:.4rem} '
        + '.has-tooltip{position:relative}.has-tooltip:hover::after,.has-tooltip:focus::after{content:attr(data-tooltip);position:absolute;z-index:1;background:#202936;color:white;white-space:pre-wrap;min-width:16rem;padding:.5rem}</style></head><body>'
        + '<h1>Reviewer 模型能力测量</h1><p>分数来自单一 Reviewer Capability 评分. 旧诊断性质只表示历史来源. * 表示评分来源说明或估算. 未观察指标显示 -. Spec Readiness 的耗时和 token 只取 artifact-promotion 场景. 两类速度均使用匹配计量样本, 不把未知值记为 0.</p>'
        + sections + '</body></html>\n';
};
