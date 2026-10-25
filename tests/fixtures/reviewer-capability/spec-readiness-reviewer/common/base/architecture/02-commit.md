# Commit evidence

## Commit Point

Readiness Module 决定 baseline-first 顺序. Promotion Module 先检查 preconditions, 写 temporary baseline, 再将 tracked state 作为最后 commit point. Commit failure 后由 Recovery Module 执行 rollback, Promotion 原样传播恢复结果. Baseline 不成为 authoritative result. 本架构记录职责和顺序, 不定义本次新增 recovery-result 的公开字段及失败生命周期.
