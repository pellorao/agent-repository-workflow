/**
 * 运行 `run` 期间丢弃 `shouldDrop(警告文本, 警告类型)` 为真的 process 警告, 其他警告原样转发; 结束后还原 `process.emitWarning`.
 * @template T
 * @param {(warning: string, type: string | undefined) => boolean} shouldDrop @param {() => Promise<T>} run
 */
export const withDroppedWarnings = async (shouldDrop, run) => {
    const emitWarning = process.emitWarning;
    process.emitWarning = /** @type {typeof process.emitWarning} */ ((warning, ...options) => {
        const [first] = options;
        if (!shouldDrop(String(warning), typeof first === 'string' ? first : /** @type {{type?: string} | undefined} */ (first)?.type)) Reflect.apply(emitWarning, process, [warning, ...options]);
    });
    try { return await run(); } finally { process.emitWarning = emitWarning; }
};
