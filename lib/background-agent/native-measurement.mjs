import {uptime} from 'node:os';

/** @typedef {{threadId:string,responseId:string,turnId?:string|null,recordSequence?:number,startedAt?:number|null,completedAt?:number|null,inputTokens?:number|null,cachedInputTokens?:number|null,outputTokens?:number|null,firstGeneratedAt?:number|null,lastGeneratedAt?:number|null,firstChunkTokens?:number|null,source?:'client-request'|'existing-events',basis?:string}} NativeResponseMeasurement */
/** @typedef {{startedAt:number,finishedAt:number|null,estimated?:boolean,basis?:string}} NativeNonWorkInterval */
/** @typedef {{responses?:NativeResponseMeasurement[],requestsComplete?:boolean,nonWork?:NativeNonWorkInterval[],workState?:{state:'working'|'paused'|'unavailable',at:number,estimated?:boolean,basis?:string},workCoverage?:{complete:boolean,basis?:string},unknownReasons?:string[]}} NativeMeasurementFacts */
/** @typedef {{at:number,lowerSleepOffsetMs:number,upperSleepOffsetMs:number}} NativeWorkClockSample */

/** @param {NativeResponseMeasurement|undefined} previous @param {NativeResponseMeasurement} observation @returns {NativeResponseMeasurement} */
export function mergeNativeResponseMeasurement(previous, observation) {
    if (!previous) return {...observation};
    if (previous.threadId !== observation.threadId || previous.responseId !== observation.responseId) throw new TypeError('Native response measurement identity changed.');
    const merged = {...previous, ...observation};
    if (observation.turnId == null && previous.turnId != null) merged.turnId = previous.turnId;
    const first = [previous.firstGeneratedAt, observation.firstGeneratedAt].filter(value => typeof value === 'number');
    const last = [previous.lastGeneratedAt, observation.lastGeneratedAt].filter(value => typeof value === 'number');
    if (first.length) merged.firstGeneratedAt = Math.min(.../** @type {number[]} */(first));
    if (last.length) merged.lastGeneratedAt = Math.max(.../** @type {number[]} */(last));
    return merged;
}

/**
 * Linux 的启动时钟包含内核挂起, 活动时钟排除挂起. 以两次活动时钟包住读取, 不把读取延迟当睡眠.
 * 其他平台的 Node 时钟没有这一差异, 不据墙钟跳变或事件循环延迟推断休眠.
 * @returns {NativeWorkClockSample|null}
 */
export function readNativeWorkClock() {
    if (process.platform !== 'linux') return null;
    try {
        const before = Number(process.hrtime.bigint()) / 1_000_000;
        const boot = uptime() * 1000;
        const after = Number(process.hrtime.bigint()) / 1_000_000;
        const precision=Number.isInteger(boot/1000)?1000:10;
        return {at:Date.now(),lowerSleepOffsetMs:boot-after,upperSleepOffsetMs:boot-before+precision};
    } catch {return null;}
}

/**
 * 时钟差只给出采样窗口内的累计挂起量, 恢复端位置是估算. /proc/uptime 的百分之一秒精度不累积为休眠.
 * @param {NativeWorkClockSample|null} previous @param {NativeWorkClockSample|null} current
 * @returns {NativeNonWorkInterval|null}
 */
export function estimateNativeSleepInterval(previous, current) {
    if (!previous || !current || current.at <= previous.at) return null;
    if (current.lowerSleepOffsetMs <= previous.upperSleepOffsetMs) return null;
    const estimate=(current.lowerSleepOffsetMs+current.upperSleepOffsetMs-previous.lowerSleepOffsetMs-previous.upperSleepOffsetMs)/2;
    const duration = Math.min(current.at-previous.at, Math.round(estimate));
    return {startedAt:current.at-duration,finishedAt:current.at,estimated:true,
        basis:'Kernel suspension is estimated from the difference between Linux boot and active clocks. Boundaries fall between samples and are positioned at the resume observation. Coverage of WSL host or other VM suspension is not established.'};
}
