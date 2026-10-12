# 少量合成视觉请求的缓存验证

用户在12 Action诊断后批准继续受控验证。目的：固定历史与配置，区分新增纯文字/相同图/不同图以及相同请求重复的cache行为；不执行Game Action、不发送仓库源码或历史Game transcript，不改pi-arc运行策略。

## 预算与方法

最多8个真实公开Models请求；deepseek-flash/opencode-go/max，固定synthetic session/system/history/options；每个输出最多256 tokens（总最多2048，包含reasoning），HTTPretry=0，单请求120s/global约12min，失败或没有可用usage立即停止。不把输出上限当美元费用保证。

序列：base(imageA)→相同base；base+纯文字→相同重复；base+相同imageA→相同重复；base+不同imageB→相同重复。各extension都从完全同一base出发，不把前一次模型生成加入历史，避免变量污染。基线与两个image仅使用公开合成内容；不存在第三方私有代码上传。

固定请求使用公开onPayload只读observer（返回undefined），仅保存计数/长度/稳定HMAC元数据以及usage、耗时、stopReason；不落盘正文、图片、密钥、header或错误原文。默认脚本必须offline/mock，live要求明确--live，required checks禁止真实请求。

## 解释边界

首次请求和重复请求分开；extension与base比较而不是错误地要求分叉sequence全部append-only。同图/不同图若都首请求低hit且repeat高hit，更像图像输入导致cache布局变化；不证明服务端具体算法。所有bodyprefix稳定但repeat仍miss，则需要服务端cache诊断。任何结论仅此样本、此时间和当前alias，不承诺VISTA99.82%复现。

## 执行状态

脚本/离线mock测试实施中，尚未执行真实8请求。check:spec扫描运行产物的问题并行修复，不修改任何已归档GUIDE。
