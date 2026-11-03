<!-- arw:managed:start -->
# Subagent 模型配置

## Initial repository configuration

缺少仓库配置时, 所属运行环境的 Main Agent 调查当前可用的主流模型及其支持的推理强度, 拟定智力到模型, 努力到所选模型推理强度的映射. 提交方案前可以询问用户偏好. 该调查由创建非预定义 subagent 前的配置检查触发, 由所属运行环境的 Main Agent 完成.

向用户提交具体模型及其低, 中, 高努力档位的推理强度. 用户批准后, 将这些配置写入 `./subagent-allocation.md` 的 repository owned 区域, 然后继续创建原定的 subagent. 审批前不使用候选映射.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
None.
<!-- arw:repository-owned:end -->
