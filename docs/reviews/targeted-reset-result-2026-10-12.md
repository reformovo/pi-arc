# 定向 RESET / 恢复坐标复测结果

## 真实执行范围与结果

用户授权小范围定向验证；run-artifacts/ft09-targeted-reset-20261012T030616Z，validationMode=diagnostic/benchmark=false，officialdeepseek/deepseek-flash/max。

- sourceDigest8a069edbb989330409f8b6c42d80c0a532888f4af57adfe985b0e9b81b5b26d9，179个旧FT09动作通过hashchain及intent/completeReceipt/Turnjoin验证。
- 新环境driver-replay-1..179逐动作Observation/Frame内容一致，达到GAME_OVER；无旧session/notes/modeloutput复制。
- controllerdriver-reset成功，Turn180/Attempt2/NOT_FINISHED/进度4/6，setupOrigin单独记录，不称官方模型成绩。
- 修复后的恢复envelope+当前视觉交给真实官方模型1次，imageCount1。
- 响应reportedoutput1024/reasoning1024，input18859/cacheRead2176/full21035。没有toolcalls或modelAction被执行。
- 诊断没有提高输出limit1024、没有第二次请求/重试；正式terminal=model_failure/lastTurn180，auditok=true/findings=[]。

## 本次判定

setup/真实RESET/恢复材料生成及archive审计通过，**真实模型坐标理解未完成验证**。1024输出全部用于reasoning，无法用无动作结果证明模型正确或错误使用坐标。也不能用audit通过冒充诊断目标通过或通关。

## 诊断脚本发现与修复

首次执行modelresponded记录试图写入浮点catalogcost；canonicalJSON只允许safeinteger，写入异常导致diagnosticReason泛化为model_request_or_tool_failed。原run runtime只有model.requested；report保留usage及output1024，未修改旧archive/terminal补记录。不能声称原runtime已确认stopReason长度，原记录不足；长度耗尽推断由reportedusage支持。

已修复standalonehelper只保存整数tokenusage、不把floatcost写入runtime；新增回归realworldfloatcost+stopReasonlength，验证保留model_length诊断、零动作、audit正确。此为诊断脚本缺陷，不是生产controller异常。修复后未再发真实请求。

主线程修复后完整npm run check/build/git diff --check通过（Node22.23.1/npm10.9.8/Python3.12.9；TS281/Python33/contract各4/integration85）。之前子任务一次CLIfixture超时如实保留，最终主线程无自动隐藏retry门禁通过。

## 尚待选择

用户随后授权继续：本次只1个请求，保持max、output8192、单请求300秒、总诊断output请求预算仍<=8192（程序校验不能8*8192），零retry。新增参数只在standalone诊断driver，不修改正常CLI/provider策略。真实模型输入/原生映射对照仅记录合法成功ACTION6的数值，不导出参数正文。

第二真实诊断run-artifacts/ft09-targeted-reset-one-20261012T031843Z：source179重放/逐FrameObservation/GAME_OVER/RESET均通过，official一次响应stopReason=length、output8192/reasoning8192、input171/cacheRead20864/full21035；模型仍没有工具或动作。

随后第1关定向source复测run-artifacts/ft09-level1-targeted-one8192-20261012T123400Z：固定(39,39)点击32次达到GAME_OVER且0/6，RESET后官方一次响应output2394/reasoning2138、input232/cacheRead7936/full8168，执行1次inspect、0次play，diagnosticReason=model_request_budget_exhausted，auditok=true/findings=[]。模型观察到了恢复图像/材料但没有实际坐标Action；坐标理解仍未验证，不再提高预算。diagnosticReason=model_length、lastTurn180、auditok=true，无findings。没有第二次调用、提高输出或降低thinking。此单样本仍未证明坐标理解正确/错误，不叫通关或恢复能力通过。

代码回归与最终组合门禁：单请求8192/300秒配置、超总预算beforeI/O拒绝、合法模型坐标与native记录对照、floatcost不落canonicalruntime通过；Node22.23.1/npm10.9.8/Python3.12.9 npm run check/build/diff全通过（TS283/Python33/contract各4/integration85）。

## 第1关用户批准后的定向验证

起初固定native(0,0)是空白区，192commit后仍NOT_FINISHED，执行超时停止，partialsource完整保留，不作为GAME_OVER证据，没有provider调用。改为publicinitialFrame可见普通tile(39,39)，固定32点击到GAME_OVER且0/6、setupsourceauditok，source run-artifacts/ft09-level1-source-20261012T122400Z。只提供固定点击，不给解法；providerdiagnostic-driver/setup_only。

第1次CLI定向误用默认1024（入口未传大输出参数），official1响应output/reasoning1024，model_length/零动作，auditok；run-artifacts/ft09-level1-targeted-20261012T122400Z。此为本轮额外已执行请求，如实记录，不称approved8192测试。修复CLI参数转发后执行批准的maxRequests1/output8192/300s：run-artifacts/ft09-level1-targeted-one8192-20261012T123400Z，32replay+RESET成功，official1responseoutput2394/reasoning2138/input232/cache7936/full8168，完整toolUse执行一次inspect，0play/action。diagnosticReason=model_request_budget_exhausted/terminalmodel_no_progress，auditok无findings。

结论：更简单场景下模型已完成观察恢复图像/材料，但一次请求不足以覆盖下一步点击，坐标行为仍未验证；没有再加request或降低max，不把readOnly成功误称coordinateChecks通过。随后获批准执行2请求总output预算8192（每次4096），但第一请求再次reasoning耗尽并stopReason=model_length，requests=1/actions=0/toolCalls=0；未发送第二请求，auditok=true。不会继续无上限提高max。

最新主线程组合npm run check/build/git diff --check通过（TS287/Python33/contract各4/integration85）。关闭清单继续保留真实理解未验证，本文保留每次failed/inconclusive真实实验，不抹除诊断入口失误或partialsource。
