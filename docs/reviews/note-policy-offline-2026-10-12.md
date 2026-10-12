# 轻量笔记策略离线候选验收

本文为评审记录，不是 accepted 规范。上一线程基线 d15d09b、b89a371 已快进到本线程 main；未推送远端，也未操作用户主 checkout 的 main。新增本阶段策略改动尚未提交。

## 范围与结论

仅新增离线 `scripts/lib/note-policy-experiment.mjs`、三条 unit tests，并更新策略设计与 README。`baseline` 返回输入原文，`notes-v1` 显式追加新的 agent 策略；生产 TASK/system、runtime、CLI/SDK、公开工具/schema 不变。没有强制每步写入、宿主求解或 VISTA 资产/解法输入，没有开始 WP-10。

候选要求反证时撤回/收窄假设，区分干净/污染/未知起点；RESET 前修订 GUIDE 或在 retry_state 显式列陈旧结论；Level 切换重新观察状态和 palette；checkpoint gate 内仅用 save_compact_checkpoint。已修 recovery visual1024/native64 契约保持原样。

FT09 四组标注基于已有提交文档，不是原始 artifacts 重审。每组保留证据定位、四项 rubric、理由和 unknown；历史 double mapping 仍标为已修 harness 证据。报告没有语义改善分数，恢复请求/时间、重复失败试验、错误坐标、反证更新延迟、动作/输出成本均为未测。提示存在性测试不能证明模型执行策略正确。

## 实际验证

使用 Node22.23.1/npm10.9.8/uv0.8.12/Python3.12.9，从本地缓存离线安装锁定依赖。首次 npm run check 因新工作树缺少 dist 而在既有诊断脚本类型检查失败；npm run build 后重跑完整 npm run check 成功，再执行 npm run build、git diff --check 成功。

- TS 296（相较基线293新增3），Python33，contract TS4/Python4，integration85；跨 gate 数量重叠，不相加。
- TS statements90.64%、branches86.34%、functions95.46%、lines93.99%；Python lines93.98%、branches90.00%，未降低门槛。
- 按设计文档命令实际运行 offlineNotePolicyReport：零 provider 请求，semanticImprovementMeasured=false，四组来源与 unknown 保留。
- 未读取/复制/修改凭据，未调用真实 provider、下载 Game、外发反馈或修改 VISTA；未重复付费整局。

独立审阅因模型服务 temporarily overloaded 失败，未得到审阅报告，不能视为 approved。当前证据是主线程范围核对和完整离线门禁。真实收益仍需另行授权的冻结条件小范围 A/B；本阶段不能关闭 GUIDE 语义质量问题或宣称优于 VISTA。
