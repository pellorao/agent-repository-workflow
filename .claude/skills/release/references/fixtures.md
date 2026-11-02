# Fixture 参考

维护者在 VM 配置 JSON 的 `fixturesDirectory` 目录中保存两个 Git 跟踪的 fixture 压缩包, 不在仓库内:

- `agent-assisted.tgz`: 由上一发布版 ARW 管理的仓库.
- `plain.tgz`: 从未初始化 ARW 的仓库.

## Validate the candidate

只把压缩包解压到全新的临时目录 (`<tmp>` 下), 在解压结果中验证, 不修改压缩包. 安装候选使用 Skill 第 3 节的压缩包和临时 `HOME`, 不改动维护者自己的安装. agent-assisted 不在这里验证, 由 guest 检查覆盖.

- plain: 运行 `arw workflow init --non-interactive --platform codex --platform claude-code --domain-layout single-context --code-map-root --code-map-include --code-map-exclude`, 再运行 `arw workflow verify`.

任一命令失败按 Skill 第 3 节判断候选缺陷或环境问题.

## Update after a successful release

只在发布成功 (Release 创建且公开 Bootstrap 验证通过) 后更新 `agent-assisted.tgz`, 且只更新它:

1. 解压到全新临时目录, 用公开 Bootstrap 在临时 `HOME` 安装刚发布的版本 `<ver>`.
2. 在解压出的仓库中运行 `arw workflow update --non-interactive` 和 `arw workflow verify`.
3. 提交, 提交信息为 `fixture: arw workflow update to <ver>`, 并建 tag `arw-<ver>`.
4. 重新打包, 覆盖 `agent-assisted.tgz`, 压缩包顶层必须是 `agent-assisted/` 仓库目录. 删除临时目录.
