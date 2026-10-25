# Reviewer 与 Engine 分离决定

## Decision

Reviewer 只负责开放语义判断. Engine 负责封闭 grammar, path, identity, digest, canonical generation 和 persistence validation. Engine 不启动或监控 Reviewer.
