import {withDroppedWarnings} from '../common/process-warnings.mjs';

/** @typedef {import('node:sqlite').DatabaseSync} DatabaseSync */

// Node 24.0 加载 `node:sqlite` 时会打印 SQLite 的 ExperimentalWarning, 只在加载期间丢弃这一条.
export const {DatabaseSync} = await withDroppedWarnings((warning, type) => type === 'ExperimentalWarning' && warning.includes('SQLite'), () => import('node:sqlite'));
