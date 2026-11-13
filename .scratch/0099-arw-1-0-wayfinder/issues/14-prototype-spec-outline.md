# 整理 ARW 1.0 规范的结构与验收场景

Type: prototype
Blocked by: issue:0099:06, issue:0099:07, issue:0099:08, issue:0099:09, issue:0099:10, issue:0099:11, issue:0099:13, issue:0099:16, issue:0099:19, issue:0099:20, issue:0099:22

##### Question

主要边界明确后, 用一份可审阅的大纲和关键正常与失败场景检验完整规范的组织方式: 规范能否独立说明行为, 理由, 状态变化, 可观察结果与验收方式, 并作为随后编写正文的依据?

## Comments

11-14 (任务 v1-d26ans, 承接 v1-d24ans 的遗留): D24 后判断模型可选, 首版不配, 本地判断模型的部署与选模型 (18, 以及 20 的 When a qualified local model exists 节) 推迟到有合格模型时, 不再是大纲的前提; 大纲只需 20 定下的首版一个端点的配置. 所以 Blocked by 去掉 18, 加上 20 (只为首版一个端点). 22 与 23 的 Interfaces 列出了大纲要有的章节与验收场景; 新建的 [设计给人看的 graph 查看界面](24-design-graph-viewer.md) 不作为本 issue 的阻断项, 大纲给它留一章, 内容按 24 的结论填写.
