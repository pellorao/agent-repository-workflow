// Cell statistics of repeated scored instances: mean, sample SD, SE, t 95% interval, and the numerics behind the interval
// (Student t quantile by bisection over the regularized incomplete beta function, as qwen_strata's benchmark_summary does).

/** The scored instances taken into one cell's main statistic: the first MAIN_N given. */
export const MAIN_N = 5;

const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

/** ln Gamma(x) for x >= 0.5 (Lanczos, g = 7). */
const lgamma = (/** @type {number} */ x) => {
    const z = x - 1;
    let sum = LANCZOS[0];
    for (let index = 1; index < LANCZOS.length; index += 1) sum += LANCZOS[index] / (z + index);
    const t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
};

const TINY = 1e-300;
const nonZero = (/** @type {number} */ value) => (Math.abs(value) > TINY ? value : TINY);

/** Continued fraction of the incomplete beta function (Lentz). */
const betacf = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ x) => {
    const qab = a + b;
    const qap = a + 1;
    const qam = a - 1;
    let c = 1;
    let d = 1 / nonZero(1 - qab * x / qap);
    let h = d;
    for (let m = 1; m < 300; m += 1) {
        const m2 = 2 * m;
        for (const aa of [m * (b - m) * x / ((qam + m2) * (a + m2)), -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))]) {
            d = 1 / nonZero(1 + aa * d);
            c = nonZero(1 + aa / c);
            h *= d * c;
        }
        if (Math.abs(d * c - 1) < 1e-15) break;
    }
    return h;
};

const betainc = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const front = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? front * betacf(a, b, x) / a : 1 - front * betacf(b, a, 1 - x) / b;
};

export const tTwoSidedP = (/** @type {number} */ t, /** @type {number} */ df) => betainc(df / 2, 0.5, df / (df + t * t));

/** The upper quantile q with P(T <= q) = p (p > 0.5). */
export const tQuantile = (/** @type {number} */ p, /** @type {number} */ df) => {
    let low = 0;
    let high = 1e3;
    for (let step = 0; step < 200; step += 1) {
        const middle = (low + high) / 2;
        if (1 - tTwoSidedP(middle, df) / 2 < p) low = middle;
        else high = middle;
    }
    return (low + high) / 2;
};

const mean = (/** @type {number[]} */ values) => values.reduce((total, value) => total + value, 0) / values.length;

/**
 * One cell's statistics over the final scores of its main instances.
 * @param {Array<{final: number, f: number, rawScore: number, rRepairable: number, scoreR83: number}>} rows at least one
 */
export const cellStatistics = rows => {
    const scores = rows.map(row => row.final);
    const n = scores.length;
    const average = mean(scores);
    const sd = n < 2 ? null : Math.sqrt(scores.reduce((total, value) => total + (value - average) ** 2, 0) / (n - 1));
    const se = sd === null ? null : sd / Math.sqrt(n);
    const half = se === null ? null : tQuantile(0.975, n - 1) * se;
    const ordered = [...scores].sort((left, right) => left - right);
    const middle = Math.floor(n / 2);
    return {ci95: half === null ? null : [average - half, average + half], formatPenaltyMean: mean(rows.map(row => row.f)), mean: average,
        meanR83: mean(rows.map(row => row.scoreR83)), median: n % 2 === 1 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2,
        min: ordered[0], nNegative: scores.filter(value => value < 0).length, rawScoreMean: mean(rows.map(row => row.rawScore)),
        repairsTotal: rows.reduce((total, row) => total + row.rRepairable, 0), sd, se};
};

const fixed = (/** @type {number | null} */ value) => (value === null ? '未知' : value.toFixed(3));

/** The cell table and the per-instance table, flush left. */
export const summaryMarkdown = (/** @type {any[]} */ cells, /** @type {any[]} */ instances) => [
    '| 格 | n | 平均 ± SD | SE | 95% 区间 | 负分数 | 最小 | 中位数 | r8.3 均值 | rawScore 均值 | f 均值 | 修复 |', '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...cells.map(cell => `| ${cell.cell} | ${cell.n} | ${fixed(cell.mean)} ± ${fixed(cell.sd)} | ${fixed(cell.se)} | ${cell.ci95 === null ? '未知' : `${fixed(cell.ci95[0])} 到 ${fixed(cell.ci95[1])}`} | ${cell.nNegative} | ${fixed(cell.min)} | ${fixed(cell.median)} | ${fixed(cell.meanR83)} | ${fixed(cell.rawScoreMean)} | ${fixed(cell.formatPenaltyMean)} | ${cell.repairsTotal} |`),
    '', '| 格 | 实例 | 主统计 | final | r8.3 分数 | rawScore | f | 修复 | 暂停 | 模型失败 |', '|---|---|---|---|---|---|---|---|---|---|',
    ...instances.map(row => `| ${row.cell} | ${row.id} | ${row.main ? '是' : ''} | ${fixed(row.final)} | ${fixed(row.scoreR83)} | ${fixed(row.rawScore)} | ${fixed(row.f)} | ${row.rRepairable} | ${row.paused ? '是' : ''} | ${row.modelFailure ?? ''} |`),
].join('\n');
