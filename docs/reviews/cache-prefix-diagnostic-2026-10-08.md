# Offline cache-prefix diagnostic — 2026-10-08

## Result

**Rolling image replacement demonstrably destroys an otherwise stable request prefix after the 64-image budget is crossed.** It is not the sole explanation for every historic cache miss. Thinking is retained, not silently removed, in the actual public-provider serialization tested here.

No runtime, prompt, model-selection or checkpoint-threshold changes were made. This diagnostic adds only a script and this report. No real provider requests, credentials, `.env` reads, raw transcript exports, payload exports or image exports were used.

## Reproduce

```sh
npm exec --yes --package=node@22.23.1 --package=npm@10.9.8 -- npm ci --ignore-scripts --no-audit --no-fund
npm exec --yes --package=node@22.23.1 --package=npm@10.9.8 -- npm run build
npm exec --yes --package=node@22.23.1 --package=npm@10.9.8 -- node scripts/diagnose-cache.mjs /absolute/path/to/pi-session
```

The input used was the successful historic `cd82-20261008T051213Z/pi-session` under `/Users/kaikai/projects/memo/pi-arc/.delta/worktrees/fsfkg5f4b0tx/pi-arc/run-artifacts/`. The script recursively locates exactly one JSONL file or accepts a file directly. JSONL lines are **objects or arrays of entries**, not one message per line. It recursively flattens batches, selects `kind: entry, type: message`, and validates a linear parent chain. This artifact contains 346 actual messages: one user, 172 assistant and 173 tool results; there are no nonmessage context/compaction entries.

For each persisted assistant response, replay history immediately preceding that response twice: unchanged and through the actual `boundVisualContext(history, 64)`. The public `Models.completeSimple` entry point normalizes history and the real `opencodeGoProvider` serializes HTTP. Only documented public package exports are imported. Requests use a synthetic key/session ID, an `.invalid` endpoint, an explicit mocked fetch, zero retries, and a throwing global fetch fallback. Auth-context lookups return absent without reading environment/files. **344 mocked fetches, zero network fetches.** Mock response usage is not evidence; cache figures below come from historic assistant messages.

Historic system prompt/tool declarations are not present in session messages. The replay therefore uses a constant diagnostic system sentinel and current public tool definitions, plus the same public DeepSeek baseline metadata/alias arrangement used by the CLI. It reconstructs actual history conversion and request wire shape, not every byte of the original requests. The alias's real backend behavior is not validated offline.

主线程已在锁定 Node 22.23.1 下复跑：172 response histories/344 mocked fetches；unbounded mutations=0、bound64 mutations=91、首次溢出request72，thinking994110 bytes保留，结果与原诊断一致。`.mts` 当前不在Biome/required typecheck范围，不能称其通过代码门禁；这是单独执行的离线诊断工具。

## Concrete measurements

Request numbers are 1-based assistant response ordinals. Changed-message indexes are 0-based **serialized wire message** indexes, including the diagnostic system message and any provider-generated image messages. Bytes are UTF-8 JSON messages joined by newline (array closing punctuation excluded). All compared older messages are identical in the unbounded replay; added responses/results append at the end.

| Request | Images before request | Historic full input | Historic cache read | Cache fraction | Unbounded common bytes | Bound64 common bytes | First changed wire message |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 64 | 56 | 249,001 | 248,576 | 99.83% | 1,124,952 | 1,124,952 | none |
| 65 | 57 | 252,599 | 251,648 | 99.62% | 1,135,803 | 1,135,803 | none |
| 71 | 61 | 272,199 | 271,616 | 99.79% | 1,227,463 | 1,227,463 | none |
| 72 | 65 | 276,716 | 2,432 | 0.88% | 1,241,076 | 1,433 | 3, tool/content |
| 73 | 66 | 280,498 | 3,584 | 1.28% | 1,274,606 | 6,122 | 6, tool/content |
| 100 | 92 | 364,927 | 97,152 | 26.62% | 1,758,607 | 330,789 | 56, tool/content |
| 101 | 93 | 365,190 | 106,880 | 29.27% | 1,768,942 | 365,853 | 62, tool/content |
| 150 | 137 | 413,057 | 252,288 | 61.08% | 2,296,591 | 808,335 | 154, tool/content |
| 172 | 158 | 443,985 | 327,296 | 73.72% | 2,570,522 | 1,021,293 | 204, tool/content |

- **Unbounded:** zero old-message mutations in 171 consecutive comparisons.
- **Bound64:** 91 old-message mutations, starting at request 72. This is the first request above 64 images, not assistant request number 65: requests do not correspond one-to-one with images.
- At request 72, retained images are 64. A previously transmitted image now becomes an omission text block in an old tool result; provider serialization changes that old tool message and image expansion. This is a real content mutation, not a timestamp/usage-field comparison artifact.
- At request 72, byte/4 prefix proxy falls from 310,269 to 358.25. Excluding inline image data gives 189,230.25 versus 358.5. These are deliberately labelled **proxies, not model-token counts**. Base64 bytes cannot be equated to vision tokens; JSON punctuation and tokenizer differences also prevent exact conversion.
- After overflow, requests **78, 86, 90, 98, 106, 110, 114, 131, 141 and 151** add no new image. Their bounded prefixes have no old-message mutation, and historic cache fractions are all **99.77–99.85%**. The same cap is present; it simply does not advance on those requests. This within-run contrast strongly supports rolling replacement as the cause of the recurring post-cap misses.
- As the replacement boundary moves forward, a larger already-omitted prefix stabilizes. Increasing cached token counts later in the run are compatible with this mechanism; they do not imply that the full history remains cacheable.

Full input is `usage.input + usage.cacheRead + usage.cacheWrite`, not uncached `usage.input` alone. Historic cacheWrite is zero in the reported rows. Request 64 has only 425 uncached input tokens but **249,001 total input tokens**. Cache does not eliminate logical context occupancy.

## Thinking and actual wire shape

Every request's sum of source assistant thinking UTF-8 bytes equals the sum of serialized assistant `reasoning_content` bytes. At the last request both equal **994,110 bytes**. All historic thinking signatures are `reasoning_content`. Historical assistant reasoning survives both projection and provider normalization; it contributes substantial growing input and cacheable prefix, but is not a source of older-prefix mutation in this replay.

The provider-generated request body has `model`, `messages`, `stream`, `stream_options`, `max_tokens`, `tools`, `thinking`, and `reasoning_effort`. With historic configured thinking level, actual wire has `thinking: {type: enabled}` and `reasoning_effort: max`. Synthetic session ID is transmitted in **`x-opencode-session`**, not the JSON body. **No `prompt_cache_key`** is serialized. This is observable behavior, not proof of faulty caching: the historic run repeatedly achieved high cache fractions without that body field. Header names only are emitted; authorization/session values and request URL are never printed.

## What remains unproven

There are serious **pre-cap** misses despite fully append-only replay:

| Request | Images | Full input | Cache read |
| --- | ---: | ---: | ---: |
| 42 | 39 | 186,203 | 2,304 |
| 48 | 43 | 208,618 | 2,304 |
| 52 | 47 | 212,603 | 2,304 |
| 56 | 49 | 226,935 | 0 |

At request 56, common normalized prefix is 1,000,670 bytes with no old-message mutation; its image count is unchanged from the preceding request. Rolling image replacement cannot explain these misses. Backend cache eviction/TTL, routing or affinity behavior, prefix-block granularity, backend preprocessing of reasoning/images, and unpersisted system/tool/request-option differences remain **hypotheses**. We have not captured the original wire, contacted the real endpoint, or measured elapsed cache TTL/worker assignment. The diagnostic must not present these possibilities as established causes.

Persisted responses also do not reveal failed attempts/retries before the successful response. This report compares consecutive successful persisted assistant requests inferred from message history, not a complete historic HTTP-attempt trace.

## Direction for a cache fix

Prefer a cache-stable image-budget rule rather than retuning the prompt, model or checkpoint threshold. The demonstrated failure is replacing already-sent images inside the oldest still-active history whenever a new image arrives. An eventual implementation should preserve previously transmitted prefixes within a segment and change image retention only at an explicit context boundary, or use a deliberate image-admission/refresh policy that does not continuously rewrite old history. These alternatives carry product tradeoffs (visual recency, inspect admission, boundary cost); neither is implemented by this diagnostic. Simply removing the image limit is not viable evidence-based remediation: the limit exists because the endpoint rejects more than 64 images.

Validate any chosen rule with the same offline wire-prefix experiment and a separately authorized fixed-game real baseline. Cache hit rates and full input must be reported separately. Backend-only misses before the cap require additional sanitized request metrics or provider-side evidence, not speculative payload/header edits.

## Checks actually run

- `npm ci --ignore-scripts`: succeeded with locked dependencies; engine warning because execution used Node 24.11.0 / npm 11.18.0 rather than pinned Node 22.23.1 / npm 10.9.8. No dependency manifest edits.
- Exact script command above, against the historic absolute directory: succeeded; 172 responses and 344 mocked serializations. Re-run after final auth-isolation/byte-proxy changes also succeeded.
- `biome check scripts/diagnose-cache.mts`: no files processed because repository config excludes `.mts`; **not a passing lint check**.
- No full project tests, real-provider run or pinned-Node22 execution were performed for these two diagnostic-only files.
