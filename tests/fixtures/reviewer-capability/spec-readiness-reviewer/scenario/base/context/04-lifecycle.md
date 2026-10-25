# 生命周期上下文

## Lifecycle

Generated artifact 在 promotion 前是 temporary non-authoritative state. 在所有 promotion 路径中, temporary baseline 只可作为 recovery input 或 evidence, 永远不是 authoritative result. Commit 前, existing tracked state 是唯一 current authoritative result. Successful tracked commit 后, new tracked state 取代 existing tracked state 成为唯一 current authoritative result. Tracked commit failure 或 rollback failure 后, existing tracked state 继续是唯一 current authoritative result.
