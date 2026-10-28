#!/usr/bin/env node
// 把安装载荷打成发布压缩包: node scripts/pack-release.mjs <输出.tar.gz>
// 内容 = install.mjs 及其模块导入闭包, package.json, release-manifest.json 及其登记的全部文件, 不含测试和维护脚本.

import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname, join, posix, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {loadInstallationPayload, SUPPORTED_PLATFORMS} from '../lib/installation/installation-payload.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const [output] = process.argv.slice(2);
if (output === undefined) {
    process.stderr.write('Usage: node scripts/pack-release.mjs <output.tar.gz>\n');
    process.exit(2);
}

// 三个平台的载荷验证路径并集 (清单, 配置种子, 启动器, 运行时文件和完整 Workflow Distribution).
const files = new Set(['install.mjs', 'package.json']);
for (const platform of SUPPORTED_PLATFORMS) {
    const payload = await loadInstallationPayload({platform, sourceDirectory: ROOT});
    if (payload.status !== 'succeeded') throw new Error(payload.diagnostics.map(entry => entry.message).join(' '));
    for (const path of payload.verificationPaths) files.add(path);
}
const pending = ['install.mjs'];
for (const file of pending) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    for (const [, specifier] of [...source.matchAll(/\b(?:from\s+|import\s*\(\s*)['"](\.[^'"]+)['"]/gu), ...source.matchAll(/\bimport\s+['"](\.[^'"]+)['"]/gu)]) {
        const imported = posix.join(posix.dirname(file), specifier);
        files.add(imported);
        if (!pending.includes(imported)) pending.push(imported);
    }
}

const result = spawnSync('tar', ['-czf', resolve(output), '-C', ROOT, '-T', '-'], {input: [...files].sort().join('\n'), stdio: ['pipe', 'inherit', 'inherit']});
process.exitCode = result.status ?? 1;
