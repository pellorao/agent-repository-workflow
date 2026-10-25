# Result Summary 设计

## Scope

本文档为 `promote(inputPath)` 的 successful result 新增 caller-visible `summary` field.

## Requirements

### Summary Result

`promote(inputPath)` 成功时必须在现有 structured result 中返回 string `summary`. Validated artifact identity 产生 non-empty string `artifactId`, successful tracked commit 产生 non-empty string `trackedStateId`, `summary` 的值是 `${artifactId} promoted to ${trackedStateId}`. 该字段由现有 result owner 在 commit 成功后生成, 不改变 persistence, security, recovery 或 authority boundary.

## Design Rationale

选择把 summary 放入现有 result, 而不是新增查询 operation, 因为 caller 需要在同一次响应中展示结果. 单独查询被拒绝, 因为它会引入状态一致性问题. 接受的成本是现有 result consumer 必须处理一个新字段.

## Module Design

Not required: The existing result owner serializes `summary` together with the other successful result fields, so the change does not add another runtime Module.

## ADR Evaluation

新增 `summary` 是 additive, reversible public result extension. 它保留现有 field meanings, failure contract, lifecycle, authority, persistence, security 和 recovery boundaries. 已接受的 consumer migration cost 不形成新的 durable compatibility decision, 因此不需要新 ADR.
