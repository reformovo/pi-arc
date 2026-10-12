# Offline branch-aware cache diagnostic — 2026-10-09

## Result

**Reconstructed serialized prefixes are append-only within all three roots, yet the first segment has only 14.343% aggregate cache reads before image eviction occurs.** This run does not reproduce the old post-cap prefix mutation. Low cache reads remain unexplained by persisted-history mutation or thinking removal.

Only `scripts/diagnose-cache.mts` and this report were changed. No runtime strategy edits, Game actions, live provider HTTP, `.env`/secret reads, transcript/image/error exports, or commits were performed.

## Input and method

Input run directory:

```text
/Users/kaikai/projects/memo/pi-arc/.delta/worktrees/fsfkg5f4b0tx/pi-arc/run-artifacts/cd82-image-checkpoint-20261009T072046Z
```

The nested array batches contain **299 message entries: 145 assistant, 149 toolResult, 5 user, and three roots with parentId=null**. Each assistant's PRE-request history is reconstructed by walking parentId, excluding that assistant response. Stored messages are never sliced into a global history. Consecutive request comparisons occur only within the same root segment.

Public `Models.completeSimple` and the real `opencodeGoProvider` serializer use synthetic auth/session, an `.invalid` endpoint, explicit mocked fetch, zero retries, absent auth-context lookups, and a throwing global fetch fallback. Raw and bound64 histories produce **290 mocked fetches, zero real HTTP calls**. Historic session usage supplies cache counts, not mock response usage.

**This is partial reconstruction, not exact original requests.** A fixed diagnostic system prompt and current tool schemas replace unpersisted historic system/tools. Original runtime transforms/options, failed attempts absent from persisted responses, tokenizer behavior, and provider cache state are not reconstructed. Timestamp/usage matching does not prove original payload identity. Common UTF-8 serialized-message bytes and bytes/4 proxies are not model tokens, especially for base64 images.

## Per-segment results

Full input is input + cacheRead + cacheWrite. Aggregate cache fraction is total cacheRead / total full input, not an average of request percentages.

| Segment | Global requests | Count | Full input | Uncached input | Cache read | Cache write | Cache fraction | Max images |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1–64 | 64 | 7,070,623 | 6,056,479 | 1,014,144 | 0 | 14.343% | 64 |
| 2 | 65–131 | 67 | 9,112,994 | 6,664,994 | 2,448,000 | 0 | 26.863% | 64 |
| 3 | 132–145 | 14 | 479,531 | 419,883 | 59,648 | 0 | 12.439% | 13 |

Across **142 within-segment comparisons**, both raw and bound64 histories have **zero old-prefix mutations**. First changed serialized message is null throughout. All older serialized messages, including image data and reasoning, remain identical. Nonappend ancestor paths within a root: zero. No persisted successful request exceeds 64 images, so rolling replacement does not activate.

Source history remains byte-identical before and after projection and both serializations, covering thinking and image data without exporting either. Source thinking bytes equal serialized reasoning_content bytes on every request; the last request of each segment retains **451,933 / 396,591 / 85,098 bytes**, respectively.

The script outputs per-request numeric usage, cache, image/thinking counts, segment ordinal, timestamps, old-prefix comparison, first changed message/changed keys, and runtime correlation. It exports no message text, arguments, images, credentials, or raw errors.

### Low cache before the cap

| Request | Images | Full input | Cache read | Common serialized prefix bytes | First changed old message |
| --- | ---: | ---: | ---: | ---: | --- |
| 10 | 12 | 37,475 | 2,304 | 181,068 | none |
| 30 | 28 | 106,674 | 2,048 | 529,131 | none |
| 54 | 54 | 191,091 | 2,048 | 917,486 | none |
| 60 | 60 | 196,829 | 2,048 | 1,018,532 | none |
| 64 | 64 | 200,659 | 2,048 | 1,059,419 | none |

Request 1 is cold, but substantial misses continue well before reaching the image cap. Rolling image omission and removed thinking cannot explain these reconstructed prefixes.

## Checkpoint boundaries and timing

Only two storage transitions are nonappend: fresh user roots at zero-based message-entry indexes **134 and 270**. Segment 2 starts at **07:51:25.558Z**, after checkpoint.fresh at **07:51:25.465Z**; segment 3 starts at **08:23:04.479Z**, after checkpoint.fresh at **08:23:04.348Z**. Runtime image_capacity / checkpoint.attempt / checkpoint.fresh boundaries occur at turns 47 and 91. Successful checkpoint-attempt responses are requests **64 and 131**, still in the old segments with 64 images. Requests **65 and 132** restart with one image and no historic thinking. These are explicit root resets, not within-segment old-message rewrites.

All **145 runtime model.responded records with usage uniquely match 145 assistant responses** on input/output/cacheRead/cacheWrite/totalTokens. Runtime image counts match reconstructed history for every response. Runtime responses precede corresponding entry persistence by **10–41 ms**. Request-start timestamps are matched separately using runtime requestId, rather than treating entry timestamps as starts. This supports usage/segment alignment, not exact historic payload equivalence.

The mock wire includes thinking enabled, reasoning_effort=max, user-agent, and **x-opencode-session**. Session identity appears in headers, not the body. The known valid session header and client identity are not missing-cache-key explanations. Absence of JSON prompt_cache_key is observable but does not establish a defect; no speculative protocol/header change is justified.

## Supported next step

The first segment's **14.343%** remains unexplained, as do low aggregate reads in the other stable reconstructed segments. Stability is established for reconstructed serialized messages, not every original request byte or provider-internal representation.

The next discriminating evidence is safe **exact-request prefix metadata at the serialization boundary**, in a separately authorized future run: prefix lengths/equality, immutable image/thinking indicators, stable system/tool/options fingerprints, segment IDs, request start/end timestamps, and full usage. Include checkpoint/retry attempts, not just successful persisted responses, without exporting payloads or secrets. This separates unpersisted client changes from misses despite identical original prefixes. If original prefixes are confirmed stable, provider-side cache observability is needed; this study does not identify a backend cause. No instrumentation or live experiment was implemented here.

## Checks actually run

Locked executable version: `npm exec --yes --package=node@22.23.1 -- node --version` → **v22.23.1**.

The following exact diagnostic was executed twice with output redirected to separate scratch JSON files:

```sh
npm exec --yes --package=node@22.23.1 -- node --experimental-strip-types scripts/diagnose-cache.mts /Users/kaikai/projects/memo/pi-arc/.delta/worktrees/fsfkg5f4b0tx/pi-arc/run-artifacts/cd82-image-checkpoint-20261009T072046Z/pi-session /Users/kaikai/projects/memo/pi-arc/.delta/worktrees/fsfkg5f4b0tx/pi-arc/run-artifacts/cd82-image-checkpoint-20261009T072046Z/runtime.jsonl
```

`diff -u` of both outputs succeeded with no differences. The old linear cd82-20261008T051213Z session was also replayed under the exact locked interpreter: **172 responses / 344 mocked fetches, raw mutations 0, bound64 mutations 91, first overflow request 72, retained thinking 994,110 bytes**, preserving the established old results.

`git diff --check -- scripts/diagnose-cache.mts` could not complete: system Git opened an Xcode license prompt and timed out. No license was accepted; this is not a passing Git check. The `.mts` file is excluded from repository lint/type-check coverage; execution is a standalone diagnostic, **not a full-gate pass**. No full project gates or live-provider tests were run.
