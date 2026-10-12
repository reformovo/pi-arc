# 分阶段合成视觉缓存实验结果

## 执行

用户授权large→tool→reasoning，2026-10-09，产物run-artifacts/staged-vision-cache-20261009T104229Z。三组各8请求全部成功、retry0/maxOutput256/max、不同synthetic session但组内固定、仅公开合成文字/PNG/工具call/思考，没有Game或私有源码。所有oldPrefixEqual/configStable和repeatEqual成立。真实调用24次，累计output933（上限6144）。

| 阶段 | base repeat | text append | 同图append | 同图repeat | 新图append | 新图repeat | 全组weighted hit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| large1024 | 98.86% | 98.70% | 71.75% | 98.66% | 71.75% | 98.66% | 89.19% |
| tool1024 | 99.96% | 99.40% | 71.07% | 99.20% | 71.07% | 99.20% | 80.16% |
| reasoning | 99.96% | 99.40% | 99.20% | 99.20% | 99.20% | 99.20% | 99.43% |

weighted hit包含各组base首次请求，其冷暖不同，不作为跨组因果比较；比较extension/repeat对更加合理。Large/tool的新图与同图结果一致；1024图追加有约28%新prefill，但不是Game约98%新prefill。publicadapter将tool结果图片hoist为syntheticuser，所以tool阶段同时引入assistant/tool/user结构，未声明schema或执行工具。

各组累计fullInput65870/66426/66426、output199/395/339、duration sum33.604/27.420/37.364秒。

## 长thinking实验的重要限制

后验mockwire核对：tool base reasoning_content长度0，reasoning base实际序列化长度70200字符，其他roles=system/assistant/tool/user、图片1一致。真实reasoning组每一对应请求fullInput与tool组完全相同（base7939、text7984、图append8645），并出现跨独立session的已暖cache。

因此客户端确实传递了synthetic reasoning字段，但本次服务端usage没有显示预期的长历史token增加。可能涉及服务端历史reasoning处理或usage口径，但不证明具体算法。不能把此组当“新增17k真实tokens”或据其高hit排除真实长context问题。character/4估算不是tokenizer；当前常量长度与实际序列化长度按mock实测报告，不沿用旧68400口述数字。

## 修正与剩余范围

- 大图尺寸本身、工具图像布局本身，至少在短synthetic历史中不足以复现Game低cache。
- 同图/新图在两组内都无差异，不支持盲改图像内容或privatecachekey。
- 更可能有尚未覆盖的条件：第一幅图之前的可缓存前缀长度、长真实text/tool/思考表示、多轮图像位置/数量或服务端处理。只列候选，不声称根因已找到。
- 下一步若继续，需要用明确可计入usage的长普通文本建立长历史，以及比较图像在固定文本前/后的位置；小请求数配对、一次一个变量。不再直接复跑Game，不删除真实thinking去伪造收益、不伪装Codex身份。

## 工程检查

主线程合并后Node22.23.1/npm10.9.8/Python3.12.9运行npm run check/build/git diff --check通过：TS214/Python29/双端contract各4/integration76。PNG CRC/1024dims、wire角色/identity、思考字段/隐私/limit都由离线tests覆盖。运行策略未修改，未提交代码。
