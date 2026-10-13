# History action 接入与离线调用链验收

状态：用户要求按推荐顺序继续后的最小结果投影。非 accepted 规范修订；不改工具输入、CLI/SDK、TASK/system、工具description、schema version/生成schema，不执行真实Game。

## 精确结果变化与规范边界

`history.events[]` 保留原有 turn/actionId/Observation/digest/Level/Attempt字段，**新增只读action字段**：

```json
{
  "turn": 53,
  "actionId": "committed-action-id",
  "action": {
    "name": "ACTION6",
    "data": { "x": 408, "y": 120 },
    "coordinateSpace": "visual_1024",
    "coordinateRepresentation": "canonical_replay_equivalent"
  }
}
```

此为选定字段的示例，原有Observation等字段省略展示，不是实际Game新产物。Turn0的action为null；RESET和ACTION1–5/7为`{name,data:{}}`，不携带retry_state或内部字段。ACTION6使用native*16+8中心，不冒充原模型输入值。只增模型可见结果，不改输入schema或顶层pi-arc.tool-result.v1；accepted §10.4要求Environment action records，§10.5要求模型视觉坐标。现有result为开放的JSON logical result，本变更不修改schema文件，但不是“输出逐字不变”。

兼容性说明：这里只能说新增action的shape兼容；之前P3还改变了查询行为。events无范围取最新limit条，有任一显式范围从范围起点分页；attempts先聚合整个匹配范围，再返回最后limit组（包括显式范围），actualStart/End是返回组覆盖的Turn边界，truncated按未返回元素判断。相同输入可能得到不同记录，不能称behavior不变。

## 单一生产投影规则

新增application层纯函数`committedActionProjection`，history与recovery共同使用，避免两个proof-join/坐标规则漂移。按actionId/Turn一次构建intent/receipt/commit索引，再校验commit引用的唯一前序intent和complete receipt；核对顺序、instance、baseTurn/baseObservation、Action、Turn、Observation；要求base字段有效且前序commit摘要对应，Turn=baseTurn+1。只允许已提交Action，pending intent不会出现在events，且不修改ledger或调用Environment。

非坐标Action返回字段白名单；ACTION6要求native整数0..63，才投影为visual1024并添加representation标签。不从笔记推导规则、不从Pi transcript反推动作，不暴露retry_state。证明缺失/冲突时整次events查询拒绝，既有ToolResult分类为storage_failure，不返回部分动作数组；不新增错误枚举。

recovery沿用同一纯函数，因此原来的坐标与proofjoin测试仍直接覆盖生产规则。此投影不是独立完整密码学审计：receipt内容与receiptDigest、Observation内容与observationDigest的哈希验证依赖已有controller入库验证及artifact审计；投影只复核记录关联，不宣称它可以认证任意恶意重写且重新hash的ledger。索引避免为完整Level每个动作重复扫描全部ledger，但每次仍读取/校验整个ledger并分配索引；输出有界不等于计算和I/O有界。

## 离线验收

- history实参通过真实ModelToolExecutor，检查最新默认/显式范围、ACTION6(25,7)→visual(408,120)、Turn0 null、RESET剥离作者字段、pending排除、证据缺失/冲突整次拒绝、只读无Action。
- SDK/faux provider实收消息：RESET后的fresh user包含Attempt摘要、原文retry笔记和1张Visual；下一个history结果包含Turn0/null、ACTION1、RESET最小参数；无retry_state泄漏。不是只在bridge上断言生成文本。
- history/recovery共同proofjoin仍有边界坐标、native数据非法、missing/different evidence、Level/Attempt/reset/checkpoint回归。

长记录synthetic只读projection（本机单次，无磁盘I/O）：复审修复后重测2000动作/6001 records约13.968ms，4000动作/12001 records约17.537ms；两次恢复正文1374 UTF-8 bytes、1个Attempt摘要。它不衡量模型token/费用，也不包含ArtifactStore读取/hash耗时。另有2001 Turn/6001 record history回归验证最新128条及只读无Action；不设置脆弱耗时阈值。

独立review报告发现base字段可缺失及实际消息断言偏宽，本轮已加入base类型/前序锚点/唯一性校验和缺失、共享错误base、duplicate intent回归，并精确解析notes位置和history动作白名单；receipt hash信任边界按上述说明收窄。最新snapshot独立静态复审给出approve-with-limits：在所述controller入库/ledger信任边界下无阻塞问题；并建议补duplicate receipt/base commit、missing base digest和invalid base type的独立负例，本轮已补。审阅者没有运行测试，其结论不替代完整gate或用户发布授权。完整gate首轮诊断fixture还断言旧数组含canonical动作标签而失败，已同步为RESET summary和坐标directive，定向103例通过。复审建议的duplicate base commit负例初版查询了追加的Turn0而未查询Turn1，已固定显式Turn1范围，最终完整gate322例通过；不放宽生产检查。

构建后的实际ModelToolExecutor已只读投影FT09 Turn180–183：RESET最小字段、native(2,0)→visual(40,8)、native(33,7)→visual(536,120)，都标canonical_replay_equivalent；旧ledger前后bytes一致，未重建Environment或重放Action。这是历史投影验收，不认证原模型输入坐标或修复后模型效果。

最终Node22.23.1/npm10.9.8/uv0.8.12/Python3.12.9完整 `npm run check`、`npm run build`、`git diff --check` 通过：TS322/Python33/contract双端各4/integration85（计数重叠）；TS statements90.63%/branches86.55%/functions95.69%/lines93.96%，Python lines93.98%/branches90.00%。TASK/system资产、MODEL_TOOL_DEFINITIONS、schema/生成schema/依赖lockfiles相对b89a371无diff。

初次独立复审读取的是旧隔离snapshot，不能验证修复；从最新树重新发起的独立review已完成，静态approve-with-limits，范围为record-association与安全投影，不含真实模型效果或独立密码学audit。

source provenance、VISTA版本差异、saved_at差异仍由P4单独收尾，不静默扩展manifest。整体逐结构/逐行为对齐和语义收益仍未证明。未读取凭据/修改.env、未调用provider/下载Game、未修改VISTA或历史artifact、未提交/推送。
