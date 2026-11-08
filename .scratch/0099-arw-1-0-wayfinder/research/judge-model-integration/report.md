# Jev 类模型接入方式的事实核对

## Scope and method

本报告为 [定义 Engine 调用 Jev 类模型的接入方式](../../issues/16-define-judge-model-integration.md) 收集决定所需的事实: 托管 Jev 与本地候选的服务接口, 错误与重试, 凭据; ARW 用户级后台管理进程现有的 Strata 提供方接入方式. 网页事实于 11-09 读取一手页面; ARW 事实读取当前 HEAD (`9cfd2b3`) 的源码与 spec. 没有注册账号, 没有发送请求, 没有下载或运行模型. 模型能力, 价格, 延迟与数据政策见 [Jev 类判别模型调研报告](../jev-class-models/report.md), 本报告不重复.

## Hosted Jev wire protocol

来源: https://docs.typesafe.ai/introduction/quickstart.md , https://docs.typesafe.ai/api/errors.md (11-09 读取).

- 请求: `POST https://api.typesafe.ai/v1/systemone`, 头 `Authorization: Bearer <API_KEY>` 与 `Content-Type: application/json`. 请求体含 `model` (如 `jev-latest`), `state` (文本或对象, 文档称也可含图片), `questions` (以调用方自定的题目 ID 为键; 每题含 `type` 为 `choice`, `score`, `noul` 或 `box`, `instructions`, 以及 choice 与 score 必需的 `criteria`).
- 响应: `model` 为实际运行的版本 (示例请求 `jev-latest`, 响应 `jev-1.13.0`), `answers` 以题目 ID 为键 (choice 含 `choice`, `confidence`, `probabilities`; noul 只含 0 到 1 的 `noul`), `usage` 含 `input_tokens` 与 `output_tokens`. 因此每次调用都能记录实际模型版本, 别名漂移可以从记录中看出.
- 凭据: 文档建议把密钥放在环境变量 `TYPESAFE_API_KEY`, Python SDK 自动读取它. 官方 SDK 有 Python (`typesafe-sdk`) 与 JavaScript/TypeScript (`@typesafe-ai/sdk`).
- 错误: 400 (请求规则不符; `max_tokens_exceeded` 表示超出模型上下文), 401 (密钥缺失或无效), 413 (请求体超过 32 MiB), 415 (压缩编码不支持), 422 (字段校验失败, 响应指出字段), 429 (超出速率限制), 529 (服务暂时过载). 对 429 文档写 "Back off and retry after a short delay", 对 529 写 "Retry after a short delay", 总体建议指数退避; 未给速率限制数值, 未提 `Retry-After` 头, 未记载请求超时.

## Local candidate servers

- Laya (https://github.com/NandhaKishorM/laya , 11-09 读取前 10 万字符): `laya-serve` 自述在 "the same `POST /v1/systemone` wire protocol as TypeSafe's hosted Jev API" 上提供服务, 另有 `POST /v1/systemone/batch` (一组题目对最多 64 个 `states`). 默认绑定 `0.0.0.0:8000` (`LAYA_HOST`, `LAYA_PORT` 可改), `LAYA_API_KEY` 设置后要求 Bearer 认证, 未设置即不认证. 切换检查点的重载中位数 CPU 7.4 s, T4 10.3 s, `LAYA_PRELOAD=1` 可在启动时预载. `min_confidence` 时返回 `abstention` 与 `abstention_threshold`; `route` 与保形预测字段只在 Python API 中记载, HTTP 响应是否返回未记载.
- NeoHorse-Jev-4B (https://huggingface.co/TokenRhythm/NeoHorse-Jev-4B , 11-09 读取): `neohorse-decision serve --model-dir ... --port 8080`, 默认绑定 `127.0.0.1`, 端点 `/v1/systemone`, 卡片称 "System One-style", 未声明与 TypeSafe 客户端兼容; 请求示例含 `model`, `state`, `questions` (示例为 `noul`). 需要支持 BF16 的 CUDA 显卡, 权重约 9.08 GB; 对外访问时建议用 `NEOHORSE_API_KEY` 开启 Bearer 认证并加 TLS 网关.
- 推断: 两个本地候选都用同一路径和大体相同的请求形状, 但兼容程度只有 Laya 自称, 每个候选是否返回同样的响应字段 (尤其 `probabilities` 与 `model`) 需要在 [本地 Jev 类候选的可行性小实验](../../issues/15-task-local-candidate-feasibility.md) 中用一组固定题目逐个核对.

## Current ARW provider integration

来源: `lib/background-agent/model-catalog.mjs`, `lib/background-agent/strata-driver.mjs`, `lib/background-agent/strata-models.mjs`, `lib/background-agent/manager.mjs`, `docs/specs/agent-repository-workflow-installation/spec.md` (HEAD `9cfd2b3`).

- 提供方配置在 ARW 用户级配置 `config.json` 的 `backgroundAgent.providers`, 每项只接受 `driver` (唯一取值 `strata`), `installationDirectory`, `maxInstances`, `contextWindow`; 旧的 `models.custom.json.providers` 只在安装时一次性迁移.
- Strata 驱动只实现 Strata 安装的控制协议: 读取安装目录的 `config/frontend.json` 得到控制地址, 经 `/lease/acquire`, `/model/status`, `/model/start`, `/model/stop`, `/lease/release` 取得独占 lease 并加载模型, 然后把 `<controller>/strata/v1` 作为 Responses 端点交给 Codex App Server 会话. 管理进程负责准入, lease 持久化, 模型切换与释放时机, 进程异常退出后的 lease 在下次启动时释放.
- 提供方因此是 "给 Agent 会话提供模型" 的概念: 它的产物是一个 Agent 会话可用的推理端点, 以 `maxInstances` 计容量, 以 lease 控制 GPU 独占. 它不提供无状态的单次判断调用.
- 生成目录与私有运行状态写在 `<ARW 安装目录>/background-agent-state/`.

## Gaps

- 托管 Jev 的速率限制数值与超时未记载, 只能实测.
- 本地候选 HTTP 响应的字段完整性, 启动耗时, 显存占用未记载 (NeoHorse) 或只部分记载 (Laya).
- 本地判断模型与 Strata 模型同机运行时怎样分配显卡, 两边都没有现成机制; Strata 的 lease 只管 Strata 自己加载的模型.
