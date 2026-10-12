# 长文本与首幅图片位置：受控实验结果

## 实验

用户授权两组各8真实请求，产物run-artifacts/long-position-cache-20261010T031620Z。固定opencode-go/deepseek-flash/max、1024syntheticimageA/B、同一139239字符普通合成长文本、system/options、每组独立session且组内固定。retry0/maxOutput256，所有16请求成功；不使用Game/privatecode/transcript。长历史不是reasoning字段；服务端fullInput实际29498–30164，>=20000实验门槛。

唯一basecontent差异：long-before=image_url→text；long-after=text→image_url。固定extension从同一组base出发。所有oldPrefixEqual/configStable=true、4个repeatEqual=true；实际payload只读observed，HMACkey不保存，无正文/images/auth/header输出。

| 请求 | 图片在文本前：full/hit | 文本在图片前：full/hit |
| --- | --- | --- |
| base | 29499 / 0% | 29498 / 0% |
| base repeat | 29499 / 99.80% | 29498 / 99.80% |
| text extension | 29512 / 99.76% | 29511 / 99.76% |
| text repeat | 29512 / 99.76% | 29511 / 99.76% |
| same image extension | 30164 / 0% | 30163 / 95.06% |
| same image repeat | 30164 / 99.72% | 30163 / 99.72% |
| new image extension | 30164 / 0% | 30163 / 95.48% |
| new image repeat | 30164 / 99.72% | 30163 / 99.72% |

image-first追加图片两次cacheRead=0；text-first分别cacheRead28672和28800，长文本prefix被复用。与此前~7k text-first追加大图仅cache6144也一致。同图/新图cache行为相同；不是单纯图片内容相似性影响。完整请求repeat高hit，说明此模型/endpoint确实能缓存完整视觉request。

## 可支持的解释

本次最清晰变量是首幅图之前的文本长度。新增图片可让图片之前的文本继续复用，但图片之后的长文本未复用，即便原HTTPmessageprefix相同、第一幅图本身未改变。支持视觉预处理/输入表示随全局图像变化而影响server可复用prefix这一机制类解释。

不证明OpenCode/DeepSeek具体tokenization、routing、imagepositions算法，也不能从单样本排除全部服务端因素。但相比“随机TTL导致全部低hit”，本次配对结果提供了明确位置依赖证据。

与真实Game对应：第一次currentvisual很早进入context（约2k system/tools共享prefix之后），之后长tool/推理历史位于首图之后；新增Gameframe时只命中约2048tokens、无新增图时可高hit，与控制现象一致。这是解释关联，不是Game层因果干预实验，不宣称已优化Gamecache。

## 不应采取的伪修复

- 不将所有图片从历史中移到末尾、重排旧message或重复塞入长正文来制造cache；改变模型观察顺序并再次破坏append-only。
- 不删除thinking/图像、伪装Codex身份或改privatecache字段。
- 不把全payloadbyteprefix相等当server可复用tokenprefix相等。

## 建议方向

停止继续整局试跑或扩大合成请求规模。先整理无敏感复现给服务方（本报告公开synthetic布局/usage即可；发送需用户明确确认），请求说明为什么新增图改变首图后cache，以及官方推荐的兼容请求方式。必要时单独验证另一公开API/model ID作为明确新实验，不能悄悄换模型破坏VISTA对照。

pi-arc保留容量checkpoint作为正确性保护；若要利用位置现象改善成本，只能评审合法的固定GUIDE/恢复摘要置于首图前、减少携带的历史，而不是改写已发送history。这会改变agent策略，需独立评估效果/信息损失。

## 验证

合并长stages后主线程npm run check/build/git diff --check通过（Node22.23.1/npm10.9.8/Python3.12.9，TS219/Python29/contract各4/integration76）。真实请求16、零重试、总output370，未超过4096上限；费用非硬美元cap。没有源码提交。
