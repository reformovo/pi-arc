/** Offline-only agent strategy. Not imported by the production host or public SDK. */
export const NOTE_POLICY_ADDENDUM = `
New agent strategy: notes-v1 (experimental; not verbatim VISTA alignment).
Keep compact author notes at rule contradiction, Level transition, and before RESET or checkpoint; do not write after every play merely to satisfy this policy.
Separate observed facts (Turn/Frame evidence and Level/palette scope), hypotheses (support and uncertainty), and refutations (the trial and what it actually ruled out). Shared-cell consistency is not proof of a full rule or of WIN. A candidate plan is not a verified solution.
In GUIDE retain scoped mechanisms, unresolved differences, and explicit withdrawals of contradicted claims. In WORKING retain current Level/Attempt/Turn, observed state versus inferred parity, and the next smallest distinguishing trial: starting state, action(s), predicted observation, and failure criterion.
For a failed trial retain an evidence anchor, starting state, actions, actual observation, and whether the state was clean, contaminated, or unknown. A failed label alone is insufficient. An uncontrolled failure does not prove a rule false; narrow the claim or propose a clean distinguishing trial. Do not repeat a ruled-out trial unless changed conditions are explicit.
Before RESET, reconcile GUIDE with retry_state. Update GUIDE before play RESET when possible; otherwise explicitly identify stale GUIDE claims and their counterevidence in retry_state. Distinguish the pre-RESET state from the expected new Attempt; do not assert the reset state until the committed result is observed. Notes cannot override Environment observations.
At a Level transition retain scoped GUIDE, but do not carry old WORKING state, coordinates, or palette assumptions as facts about the new Level. Reobserve before applying them.
When checkpoint has been requested, use only save_compact_checkpoint: provide a complete revised GUIDE or null only if it remains consistent, and current working_memory. Do not issue separate note writes while the checkpoint gate is active. Checkpoint changes context, not the game state.
All tool coordinates remain visual1024 (0..1023); do not divide them by 16. Use supplied recovery Level/Attempt labels and canonical_replay_equivalent coordinates without replaying committed actions.
Keep evidence references rather than long thinking, pixel grids, or copied history. If evidence is missing say unknown and read the smallest relevant history/visual evidence. The host does not derive or certify game rules.
`.trim();

/**
 * Explicit selection for offline callers only; baseline is returned byte-for-byte.
 * @param {string} baseline
 * @param {"baseline" | "notes-v1"} strategy
 */
export function selectNotePolicyPrompt(baseline, strategy) {
	if (strategy === "baseline") return baseline;
	if (strategy === "notes-v1") return `${baseline}\n\n${NOTE_POLICY_ADDENDUM}`;
	throw new Error("Unknown offline note strategy");
}

/**
 * Manual annotations of existing FT09 review evidence, not an automatic semantic scorer.
 * unknown means the review excerpt cannot establish the criterion either way.
 * @type {ReadonlyArray<{id: string, anchor: string, evidence: string, judgments: readonly ("pass" | "fail" | "unknown")[], reason: string}>}
 */
export const FT09_NOTE_REVIEW = [
	{
		id: "v18-v19",
		anchor: "Turn5 GUIDE v18 / WORKING v19",
		evidence: "docs/reviews/ft09-working-quality-2026-10-10.md#已有用处",
		judgments: ["fail", "pass", "pass", "unknown"],
		reason:
			"L2 not yet WIN despite confirmed heading; remaining steps and expectations explicit; recovery agreement not established here.",
	},
	{
		id: "v161-v162",
		anchor: "Turn52 notes; Turn70 unsuccessful candidate",
		evidence: "docs/reviews/ft09-working-quality-2026-10-10.md#q1未成立的假设升级成已确认规则",
		judgments: ["fail", "fail", "pass", "unknown"],
		reason:
			"EXACT overclaims consistency; state later stale and mini state not covered; candidate and failure fallback explicit; no recovery in this pair.",
	},
	{
		id: "reset-v161",
		anchor: "Turn180 RESET retry_state / GUIDE v161",
		evidence: "docs/reviews/ft09-working-quality-2026-10-10.md#q2reset恢复完整但guide语义陈旧与working冲突",
		judgments: ["fail", "fail", "fail", "fail"],
		reason:
			"Stale GUIDE conflicts with retry_state; failed labels omit starting states, actions and observations; next distinguishing trial not established.",
	},
	{
		id: "v549-v550",
		anchor: "After Turn180; Turn181/182 double mapping; Turn214 L5 completion",
		evidence: "docs/reviews/ft09-working-quality-2026-10-10.md#q3确定的坐标单位错误造成两次无效action",
		judgments: ["fail", "unknown", "unknown", "fail"],
		reason:
			"Candidate called solution before further trials; coordinate contradiction is historical harness evidence already repaired, not a new policy defect; excerpt cannot establish all state/prediction criteria.",
	},
];

export const NOTE_REVIEW_CRITERIA = [
	"facts_hypotheses_refutations",
	"current_state_trial_start",
	"next_action_failure_criterion",
	"recovery_coordinates_note_agreement",
];

/** Deterministic rendering of manual annotations; never reads artifacts or credentials. */
export function offlineNotePolicyReport() {
	return {
		kind: "offline_manual_review",
		provenance: "committed review excerpts, not original artifact re-audit",
		providerRequests: 0,
		semanticImprovementMeasured: false,
		criteria: NOTE_REVIEW_CRITERIA,
		annotations: FT09_NOTE_REVIEW,
		unmeasured: [
			"recovery_requests_and_elapsed_time",
			"repeated_failed_trials",
			"invalid_coordinates",
			"refutation_update_latency",
			"actions_output_tokens_and_cost",
		],
	};
}
