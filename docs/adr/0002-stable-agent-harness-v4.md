---
status: accepted
accepted: 2026-09-22
---

# 采用稳定 AgentHarness v4，不采用 Pico3

`pi-arc` 以 Pi 0.86 根导出的稳定 `AgentHarness` v4 作为 runtime 基线，因为它已经提供 durable session、intent/effect/settlement、`replay: "safe" | "never"` 和公开 lane surface；Pico3 仍从 experimental 路径导出，且相关 `micro` 适配器不在已发布公共 surface 中。这个选择牺牲 Pico3 更轻量的新模型，换取公开兼容边界和已能验证的失败语义；Pico3 只有在转为稳定 API 并完成同一 conformance matrix 后才能重新评估。
