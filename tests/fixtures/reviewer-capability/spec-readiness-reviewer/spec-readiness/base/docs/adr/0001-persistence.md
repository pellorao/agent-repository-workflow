# 持久化顺序决定

## Decision

Tracked promotion 使用 baseline-first 顺序, tracked state 是最后 commit point. Readiness Module 决定顺序, Promotion Module 执行 temporary baseline 和 tracked commit, Recovery Module 执行 commit failure 后的 rollback. 新的 tracked promotion boundary 必须评估 commit order 和 recovery ownership. 本既有决定不定义本次新增的 recovery-result 字段和失败生命周期.
