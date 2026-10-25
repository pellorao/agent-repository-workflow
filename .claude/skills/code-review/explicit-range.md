# 显式 Git 范围

用户提供了任一边界时, 要求提供两个边界. 不推断缺失的边界.

- 将起点解析为不可变 Git 提交身份.
- 终点可以解析为 Git 提交, 或明确选择的暂存索引.
- 提交终点只解析一次身份, 保留三点比较语义, 使用 `git merge-base <start-commit> <end-commit>` 计算实际起点. 比较该实际起点与已解析终点提交, 并从这些对象读取完整上下文.
- 暂存索引终点先解析 `HEAD`, 使用 `git merge-base <start-commit> <head-commit>` 计算实际起点, 再由 Main Agent 使用 `git write-tree` 固定一次索引. 使用 `git diff <actual-start> <captured-tree> --name-only -z` 取得路径, 使用 `git diff <actual-start> <captured-tree> -- <included-paths>` 比较, 并使用 `git show <captured-tree>:<path>` 读取完整上下文.

完整绑定的审查版本与路径过滤遵循技能主文件. 本轮 Reviewer 不解析正在移动的引用, 不读取实时索引或工作树.
