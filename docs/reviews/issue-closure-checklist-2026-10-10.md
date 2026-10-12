# 已知问题关闭与验证清单

## 口径

实现修复、离线回归、真实workflow与未验证项分开。门禁通过和某局WIN都不能关闭所有问题。记录截至最新恢复坐标修复，不宣称全部关闭。

| 项目 | 实现 | 验证 | 当前关闭口径 |
| --- | --- | --- | --- |
| SDKstdout污染JSONL | 已修 | 子进程noise回归+真实Game | 已关闭当前入口缺陷 |
| 非法Action错误归storage_failure | 已修 | faux纠正并WIN+真实工具记录 | 已关闭分类缺陷 |
| Actionbudget被多轮loop绕过 | 已修 | 同operationbudget1/末预算WIN/恢复门禁 | 离线关闭，真实预算12正确停止 |
| 取消后admit新Action | 已修 | startup/model/provider/receipt竞态 | 离线关闭，真实取消workflow未全面验收 |
| audit依赖模型配置 | 已修 | compiledCLIprocess+真实归档audit | 已关闭 |
| thinking unsupported静默clamp | 已修 | capabilitymap包含off | 离线关闭 |
| RESET错误依赖SDKavailableActions | 已修双端 | actualSDK158重放+RESETdedupe、FT09真实RESET后WIN | 已关闭 |
| rollingimage破坏prefix | 已移除 | exactwire/mock、两次真实imagecheckpoint+prefixdiag | 已关闭客户端改写，非所有cachemiss |
| Go视觉cache首图后退化 | 未改upstream | syntheticdirect对照/#51993同型 | Go暂停/官方规避，不叫修复 |
| 记录持久性缺fsync | 已加file/parentflush | ordered/failuretests | 当前publish改进，掉电硬件/祖先目录未实测 |
| 恢复intent/receipt/commitjoin不足 | 已严格验证 | 缺失/冲突failclosed、realstore边界fixture | 离线关闭 |
| 恢复native64/visual1024歧义 | 已投影/显式label | map/parser/不改archive+官方单次synthetic模型408120→native25,7命中 | 此受控契约样本通过；不等于所有Game恢复语义验收 |
| 同anchor无进展toolloop无界 | 已加16/stage守卫 | schema拒绝/只读无限48+重启pendingeffect | 离线关闭；真实FT09max11未升级终止 |
| check:spec误扫描runtime | 已排除root输出 | malformedruntimevsmaintaineddoc回归/fullgate | 已关闭 |
| request成本缺细粒度指标 | providerusage+prefixHMAC已加 | mockHTTP+真实Game25prefix+direct | 已改善；transport重放不是serialization次数 |
| GUIDE错误假设/陈旧/冲突 | 未改模板 | FT09notes真实分析 | 尚未关闭，先harness修复不改taskprompt |
| token容量checkpoint生产验证 | 已实现928k/968k | faux容量/race/boundary | 尚未真实触发；image/RESET不能代替 |
| walltime/token费用预算 | 未新增 | 实际FT09长推理/恢复证据 | 未解决产品策略，次数预算不等time上限 |
| 跨平台/磁盘满/掉电/长任务矩阵 | 未全部完成 | requiredofflinechecks+Mac单Gameworkflow | 未关闭，WP-10未自动开始 |
| 依赖安全告警 | 未专项核实/升级 | npm安装告警 | 未关闭，不能擅自lock升级 |
| 泄露密钥撤销/轮换 | 用户操作 | 未读取账户 | 未确认关闭 |
| 固定revision/seed/多样本公平评测 | 未充分冻结 | Gameid/digest、provider、单次usage | 未关闭，不声称稳定优于VISTA |

## 最近完整门禁

主线程在最后新增playparser回归后完整运行：Node22.23.1/npm10.9.8/Python3.12.9，npm run check/build/git diff --check通过；TS267/Python33/contract各4/integration85。计数跨gate重叠不相加。随后独立子任务新增离线plan脚本/2tests，主线程修正其命名/metadata，不把intent称为完成证据，再重跑完整组合gate：TS269/Python33/contract各4/integration85，npm run check/build/git diff --check全部通过。随后最小coordinateprobe合并后主线程完整check/build/diff通过：TS293/Python33/contract各4/integration85。此为当前最终门禁，不引用子任务Node24结果。

## 定向真实恢复验证的未完成事项

最初混合fauxsetup/officialidentity设计未获验收，随后改为独立driver-replayprovenance正式controller诊断。2026-10-12已执行：179已完成source动作校验/新环境逐FrameObservation重放/GAME_OVER/RESET成功，真实官方模型一次响应output1024全部reasoning、零工具/动作，未完成坐标理解验收。首次诊断runtime误写floatcost已修并新增回归，全门禁TS281/Python33/integration85通过，未自动加预算重跑。详见targeted-reset-result-2026-10-12.md。

可选后续应设计明确分离setupprovenance与模型驱动结果的诊断，或采用更窄的官方模型读取修复后envelope检查坐标理解；不能伪造新的正常terminal、绕过sidecarauthority或把candidateplan当已验证回放。此前actualSDK无模型重放与真实FT09RESET已是有效证据，但不能证明修复后agent永不误读。

后续最小synthetic坐标契约官方单次请求已生成408120→native25,7并命中；具体“没有真实模型坐标toolcall证据”缺口关闭，见minimal-coordinate-contract-result-2026-10-12.md。此前Game多次inconclusive仍保留；单独诊断scope/onlyplay不是正常Game或提示词优化。没有源码提交。
