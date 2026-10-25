# Source Checkout 发布和恢复

## Publish the release

发布准备 issue 完成和唯一正式发布 commit 创建后, 后续外部发布操作直接由本文件授权, 不为分支推送, tag, 正式远程 `post-tag` 或 GitHub 发布另建 issue.

Main Agent 先机械确认正式 commit 与本地发布验证候选之间只有发布验证规则允许的 issue 完成记录和 Commit Audit 正式记录差异, 当前连续操作仍保留完整候选身份, 且 Source Checkout 工作树干净. 任一其他差异或连续性丢失都会使本地发布验证失效.

在当前用户对准确项目, `origin`, 分支, 版本和本次尝试的外部写入授权下, Main Agent 把正式候选分支推送到 `release-validation.json` 配置的规范 `origin`, 再确认远程分支指向准确正式 commit, 且本地与远程都不存在当前版本 tag. 该首次远程推送不复用本地 Git URL 映射.

Main Agent 随后从规范 `origin` 把准确正式 commit 取得到本次发布已经准备的绝对 `.bundle-input/candidate` 裸仓库, 并把 `refs/heads/arw-validation` 更新为该 commit. 该步骤只替换候选输入, 不重新构建已经准备的目标 bundle. 在创建版本 tag 前, Main Agent 检查该裸仓库中的 `refs/tags/<version>`. 引用不存在时继续; 引用精确指向刚完成本地发布验证的隔离候选 commit 时, 使用该旧值作为删除条件删除引用, 并确认它不存在; 引用指向其他 commit 或无法读取时停止并取得用户指示. 完成这项检查并验证候选引用后, Main Agent 创建并推送精确且没有前缀的版本 tag. 规范远程第一次看到该 tag 时, 它必须已经指向正式 commit; 不得先推送临时位置再移动 tag.

标签推送后, 传入上述候选裸 Repository, 并运行一次 `node scripts/verify-post-tag-bootstrap.mjs --version <version> --candidate-repository <absolute-path>`. 不得使用 Source Checkout 或另建未绑定的 Repository. 该命令不使用本地 Git URL 映射, 从 `release-validation.json` 中的 HTTPS 远程获取精确 tag, 验证它剥离后的 commit 与 `arw-validation` 相同, 再只通过 `git show` 读取 `scripts/install-arw.mjs`. 它报告完整且已经注册的实际事件顺序. Main Agent 把实际远程, 路径, 哈希, tag, commit, Installer 路径和参数与正式候选比较, 创建 Registry 要求的 `post-tag` 归档, 再运行 `node scripts/release-conformance.mjs --evidence-directory <absolute-temporary-directory> --phase post-tag`. 成功结果必须返回 `tagAllowed: false`. 它不重新运行 VM, 源码测试或读取 `pre-tag` 归档.

正式远程 `post-tag` 通过后记录发布验证通过, 再继续 GitHub 发布阶段; 此时尚未完成整个版本发布.

## Publish the GitHub announcement

只有 `post-tag` Release Conformance 通过后, 才生成仓库外公告. 公告的 title 和正文使用中文. 公告以最近的前一个正式 Release tag 和已验证的准确候选 tag 为相邻比较端点, 结合两个端点的实际状态与该 Git 范围内的历史, 只说明候选端点仍然存在且安装者, 使用者或维护者可以观察的变化. 只在中间提交出现, 随后被撤销, 更名或替换而无法从候选端点观察的状态不进入公告. 公告也不描述发布验证流程和其他对版本使用者没有价值的内部细节.

公告在标题后以简洁简介概括当前版本的实际主题和可观察收益, 不重复后续条目的完整说明. 随后只使用实际有内容的中文分类章节: 新功能, 问题修复, 文档和日常维护. 每个条目先用普通语言说明可观察结果, 再链接形成该结果的准确提交, 不把原始提交标题机械复制为公告文字.

每份公告都必须包含安装章节. 该章节只说明候选版本实际支持的 Node.js 前提, 下载该准确版本的 `scripts/install-arw.mjs`, 使用 Node.js 执行该文件, 重新打开终端, 验证安装结果, 以及使用 `arw workflow init` 初始化新目标仓库或使用 `arw workflow update` 更新已受管目标仓库. 下载地址在准确 tag 存在后形成并绑定该版本. 不提供克隆 Source Checkout 的替代安装流程, 也不要求用户为 Bootstrap 安装修改本机 Git 换行符配置.

分类与安装内容之后的 `Changelog` 提供从前一个正式 tag 到候选 tag 的完整比较链接和逐项提交链接, 并只列出在最终候选中仍然有效的已发布工作.

Main Agent 先机械检查比较端点, 候选状态, 章节, 链接和排除内容, 再向用户展示准确 title 和完整公告文件. 用户审核这一份最终候选; 批准后不得修改 title 或文件字节, 任何变化都需要重新审核完整 title 和文件.

写入前确认 `gh` 可用且已通过目标 GitHub 的认证预检, 本地与规范远端的准确版本 tag 都指向已验证候选, 并核对准确项目, title 和公告文件. 先运行只读查看:

```text
gh release view <version> --repo <project> --json tagName,name,body,isDraft,isPrerelease,targetCommitish,url
```

每次判断成功时都从规范 Git 远端解析准确 tag 及其剥离后的提交, 与本地已验证候选比较, 不把 GitHub 的分支名或 `targetCommitish` 作为提交证明. 对象必须不是 draft 或 prerelease. 既有 Release 的 tag, 经 Git 核对的 commit, title 和正文全部匹配时, 把它作为幂等成功. 任一字段冲突时停止, 不更新, 替换或删除. 只有对象不存在时才运行:

```text
gh release create <version> --repo <project> --verify-tag --title <title> --notes-file <approved-file>
```

不得提供 `--target`, 自动生成公告或任何发布资产. `--verify-tag` 阻止工具隐式创建缺失 tag. 只有既有对象为正式已发布 Release, 且 Git 解析的 tag commit 与候选相同时才能匹配成功; `targetCommitish` 不是 tag commit 的证明. 创建成功后仍运行相同的只读查看并比较全部 4 个字段. 创建超时, 连接中断或结果不明确时也只进行只读查看, 不盲目重复创建. 只有远端对象完全匹配时才报告版本发布完成.

## Recover a failed tag

如果 HTTPS Bootstrap 检查或 `post-tag` 一致性检查失败, 首先读取本地和远程标签, 并证明两者仍然指向候选提交. 在一个不中断的恢复步骤中, 只删除该精确的本地和远程标签, 并验证两者都不存在. 不得创建失败归档或另一个一致性检查阶段. 如果无法证明标签身份, 停止并取得用户指示. 修复返回默认发布验证流程, 记录问题和方法, 在全部可执行路径结束后形成新的暂存候选, 并重新运行完整本地矩阵与本地 tag 前后验证. 不得移动已经推送的标签.

GitHub 托管发布对象的创建或核验失败发生在 tag 后验证已经通过之后. 此时保留本地和远端 tag, 不使用本节的 tag 删除恢复. 记录准确远端 Release 状态并停止; 任何后续创建, 更新或删除都需要新的用户决定.
