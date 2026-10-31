# 加深

如何在已知依赖的前提下, 安全地加深一组浅 Module. 以 `./SKILL.md` 中的词汇为前提: **module**, **interface**, **seam**, **adapter**.

## Dependency categories

评估加深候选时, 先对其依赖分类. 类别决定加深后的 Module 怎样跨其 Seam 测试.

### 1. In-process

纯计算, 内存状态, 没有 I/O. 总是可以加深: 合并这些 Module, 直接通过新的 Interface 测试. 不需要 Adapter.

### 2. Local-substitutable

有本地测试替身的依赖 (Postgres 用 PGLite, 或内存文件系统). 替身存在时可以加深. 加深后的 Module 在测试套件中以运行中的替身测试. Seam 是内部的, Module 的外部 Interface 处没有端口.

### 3. Remote but owned (Ports & Adapters)

你自己的服务, 跨越网络边界 (微服务, 内部 API). 在 Seam 处定义一个 **端口** (port, 即 Interface). 深 Module 拥有逻辑, 传输层作为 **Adapter** 注入. 测试使用内存 Adapter, 生产使用 HTTP/gRPC/队列 Adapter.

建议的表述形式: _"在 Seam 处定义一个端口, 为生产实现 HTTP Adapter, 为测试实现内存 Adapter, 使逻辑即便部署在网络两端, 也位于同一个深 Module 中."_

### 4. True external (Mock)

你无法控制的第三方服务 (Stripe, Twilio 等). 加深后的 Module 把外部依赖作为注入的端口接收, 测试提供 mock Adapter.

## Seam discipline

- **一个 Adapter 意味着假想的 Seam, 两个 Adapter 才是真正的 Seam.** 除非至少有两个 Adapter 站得住 (通常是生产加测试), 否则不要引入端口. 只有一个 Adapter 的 Seam 只是多余的间接层.
- **内部 Seam 与外部 Seam** (定义见 `./SKILL.md`). 不要仅因为测试用到内部 Seam, 就通过 Interface 把它暴露出去.

## Testing strategy: replace, don't layer

- 加深后的 Module 的 Interface 处有了测试后, 浅 Module 上原有的单元测试就成了浪费, 应删除.
- 在加深后的 Module 的 Interface 处编写新测试. **Interface 就是测试面.**
- 测试断言通过 Interface 可观察到的结果, 不断言内部状态.
- 测试应当经得起内部重构: 它们描述行为, 不描述实现. 如果实现变了测试就得跟着改, 说明它测到了 Interface 之外.
