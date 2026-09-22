import { readFile } from "node:fs/promises";
import { reportFailure } from "./lib/run-command.mjs";

const requiredChecks = [
	"quality / dependencies",
	"quality / format-lint",
	"quality / types-boundaries",
	"test / typescript",
	"test / python",
	"test / contract",
	"test / integration-offline",
	"quality / specification",
];
/** @type {Record<string, string>} */
const approvedActions = {
	"actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
	"actions/setup-node": "820762786026740c76f36085b0efc47a31fe5020",
	"actions/setup-python": "a309ff8b426b58ec0e2a45f0f869d46889d02405",
	"astral-sh/setup-uv": "08807647e7069bb48b6ef5acd8ec9567f424441b",
};

/** @param {unknown} condition @param {string} message */
function assert(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {string} value */
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
	const workflow = await readFile(".github/workflows/ci.yml", "utf8");
	assert(/^permissions:\n {2}contents: read$/m.test(workflow), "CI must use contents: read permissions");
	assert(!workflow.includes("${{ secrets."), "required CI must not read repository or environment secrets");
	assert(!/^\s*continue-on-error:/m.test(workflow), "required CI must not continue on error");

	for (const check of requiredChecks) {
		const matches = workflow.match(new RegExp(`^\\s+name: ${escapeRegExp(check)}$`, "gm")) ?? [];
		assert(matches.length === 1, `required check must appear exactly once: ${check}`);
	}

	const uses = [...workflow.matchAll(/^\s+- uses: ([^@\s]+)@([^\s#]+)/gm)];
	assert(uses.length > 0, "CI must contain SHA-pinned actions");
	for (const match of uses) {
		const action = match[1];
		const revision = match[2];
		if (action === undefined || revision === undefined) throw new Error("invalid action reference");
		const approvedRevision = approvedActions[action];
		assert(approvedRevision !== undefined, `unreviewed GitHub Action: ${action}`);
		assert(approvedRevision === revision, `${action} must use its approved full commit SHA`);
		assert(/^[0-9a-f]{40}$/.test(revision), `${action} is not pinned to a full commit SHA`);
	}

	const checkoutCount = uses.filter((match) => match[1] === "actions/checkout").length;
	const credentialGuards = workflow.match(/^\s+persist-credentials: false$/gm) ?? [];
	const driftChecks = workflow.match(/^\s+- run: git diff --exit-code$/gm) ?? [];
	assert(checkoutCount === requiredChecks.length, "every required job must check out the repository");
	assert(credentialGuards.length === checkoutCount, "every checkout must disable persisted credentials");
	assert(driftChecks.length === requiredChecks.length, "every required job must reject tracked worktree drift");
	assert(
		(workflow.match(/^\s+- run: npm ci --ignore-scripts --no-audit --no-fund$/gm) ?? []).length === 8,
		"every job must use frozen npm install",
	);
	assert(
		(workflow.match(/^\s+- run: uv sync --locked --all-groups --python 3\.12\.9$/gm) ?? []).length === 6,
		"every Python job must use frozen uv sync",
	);
	process.stdout.write("CI policy: OK (8 required checks, all actions SHA-pinned)\n");
}

main().catch(reportFailure);
