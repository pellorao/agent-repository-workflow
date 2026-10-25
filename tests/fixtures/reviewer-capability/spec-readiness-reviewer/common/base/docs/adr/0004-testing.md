# Public lifecycle 测试决定

## Decision

Runtime behavior 必须通过 public lifecycle Interface 测试. 测试不能把 private helper、内部调用顺序或 Adapter implementation detail 当作产品合同.
