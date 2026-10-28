# 发布参考

以下步骤都在 VM 验证全部通过之后进行. 每个外部写入前, 都先向维护者说明准确的项目, `origin`, 分支, 版本和 commit, 并取得授权. 回滚同一版本 tag 与 Release 的授权见 Skill 开头. `<tmp>` 见 Skill 第 3 节.

## Push and tag

1. 确认 `git rev-parse HEAD` 等于 VM `PASS` 行中的 commit, 且工作树干净. 如果候选之后又有改动, 回到 Skill 第 2 节.
2. `git push origin <branch>`, 然后用 `git ls-remote origin refs/heads/<branch>` 确认远端分支指向该 commit. 推送前确认 `git remote get-url origin` 等于 `release-validation.json` 中的规范 HTTPS 地址, 不一致时停止.
3. `git tag <version> <commit>`, 然后 `git push origin refs/tags/<version>`. tag 名就是 `MAJOR.MINOR.PATCH`, 不加 `v` 前缀. 推送后用 `git ls-remote --tags origin <version>` 确认 tag 指向该 commit. 规范远端第一次看到的 tag 就必须指向正式 commit, 已推送的 tag 绝不原地移动, 只能按回滚步骤整体删除后重建.

## Publish the GitHub announcement

先写公告文件. 公告的 title 和正文都使用中文:

- 比较范围是上一个正式 Release tag 到本次 tag. 只写安装者, 使用者或维护者能在本次 tag 上观察到的变化. 中间提交引入后又被撤销或替换的内容不写, 发布验证流程等内部细节也不写.
- 标题后先用一段简介概括本版本的主题和收益. 然后只列出实际有内容的分类: 新功能, 问题修复, 文档, 日常维护. 每个条目先用普通语言说明结果, 再链接对应的提交.
- 必须包含安装章节, 依次说明: 支持的 Node.js 版本和系统自带 `tar`; 下载本版本的 `scripts/install-arw.mjs`, 用 Node.js 运行; 重新打开终端并运行 `arw --version` 验证; 新仓库用 `arw workflow init` 初始化, 已受管仓库用 `arw workflow update` 更新. 不提供克隆源码仓库的安装方式.
- 最后是 `Changelog`: 包含上一个 tag 到本次 tag 的比较链接, 以及仍然有效的逐项提交链接. 首次发布没有上一个 tag, 此时省略比较链接.

把准确的 title 和完整的公告文件交给维护者审核. 批准后不再修改; 任何修改都要重新审核.

确认 `gh auth status` 通过后, 先运行只读查看:

```text
gh release view <version> --repo <project> --json tagName,name,body,isDraft,isPrerelease,targetCommitish,url
```

- Release 已存在: 如果 tag, title 和正文都与批准的内容一致, 并且不是 draft 或 prerelease, 且 `gh release view <version> --repo <project> --json assets` 含 `arw.tar.gz`, 视为已完成. 任一字段冲突时停止, 不做更新或删除.
- Release 不存在: 运行 `gh release create <version> --repo <project> --verify-tag --title <title> --notes-file <approved-file>`. 不加 `--target`, 不自动生成公告. 先运行 `node scripts/pack-release.mjs <tmp>/arw.tar.gz`, 创建时把该文件作为资产附在命令末尾. 创建后再运行一次 `view` 核对, 并确认资产名为 `arw.tar.gz`. 创建超时或结果不明确时, 也只运行 `view`, 不盲目重复创建.

tag 指向的 commit 以 `git ls-remote` 的结果为准, 不以 `targetCommitish` 为准.

## Verify the public Bootstrap

Release 创建并核对后, 在临时目录中用公开 HTTPS 地址验证用户实际使用的安装方式:

```text
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/<version>/scripts/install-arw.mjs -o <tmp>/install-arw.mjs
HOME=<tmp>/home node <tmp>/install-arw.mjs --version <version> --non-interactive --register-path false
<tmp>/home/.agent-repository-workflow/arw --version
```

最后一条命令必须输出 `<version>`. 验证完成后删除 `<tmp>`.

## Rollback after the tag

压缩包生成, Release 的创建, 核对或公开 Bootstrap 验证失败发生在 tag 推送之后. 回滚边界和公告后的处理见 [release spec](../../../../docs/specs/agent-repository-workflow-release/spec.md#failure-recovery-and-authorization), 本 Skill 运行期间一律视为尚未公告.

1. 运行 `gh release view <version> --repo <project> --json tagName,url,assets`, 把准确状态记入发布准备 issue 的 `## Comments`. 输出 Release 不存在是有效的 "无 Release" 状态 (压缩包生成或创建前失败); 认证, 网络等其他读取失败时停止.
2. 只删除本次运行创建的对象: `git ls-remote --tags origin <version>` 指向本次验证 commit, 且 Release (若存在) 由本次运行的 `gh release create` 创建. 不满足时 (包括 Release 已存在而停止的情形) 停止, 不删除.
3. Release 存在时运行 `gh release delete <version> --repo <project> --yes --cleanup-tag`, 否则运行 `git push origin :refs/tags/<version>`. 然后 `git tag -d <version>`.
4. 核对 `gh release view` 报告不存在, `git ls-remote --tags origin <version>` 与 `git tag -l <version>` 都为空. 不动已推送的分支. 第 1 步的真实读取失败, 或任一删除, 核对失败时停止并报告准确状态, 不继续重建.
5. 修复根因. 修复产生新 commit 时回到 Skill 第 2 节, 新候选重新验证 (含 VM); 候选不变 (`gh`, 网络, 临时目录, 压缩包环境问题) 时不重跑 VM, 回到 `Push and tag` 第 3 步重建 tag 并继续.
6. 同一版本连续回滚 2 次仍失败时停止, 报告并列入待决定.
