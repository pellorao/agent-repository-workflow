import {normalizeLineEndingBytes} from '../common/text-policy.mjs';

/** Repository Workflow 读取文件字节时的换行规则: 归一化为 LF; `.toml` (Codex 配置等) 含用户字节, 原样返回. @param {string} path @param {Buffer} bytes */
export const readManagedBytes = (path, bytes) => path.endsWith('.toml') ? bytes : normalizeLineEndingBytes(bytes);
