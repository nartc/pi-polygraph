/**
 * What the extension knows about the Polygraph MCP server's tools.
 *
 * The server declares no MCP annotations, so which calls run without asking is decided here.
 */

export const SERVER_NAME = "polygraph";

// Pi names MCP tools mcp__<server>__<tool>, with "-" in the server name turned into "_".
const TOOL_NAME = /^mcp__polygraph(?:_mcp)?__(.+)$/;

/** The server's own tool name (`push_branch`) for a Pi tool name, or undefined for any other tool. */
export function polygraphTool(toolName: string): string | undefined {
	return TOOL_NAME.exec(toolName)?.[1];
}

/** Tools that only read from Polygraph or fetch into local files. Every other tool asks first, new ones included. */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
	"whoami",
	"list_accounts",
	"list_repos",
	"list_sessions",
	"search_sessions",
	"show_session",
	"session_intro",
	"get_session_logs",
	"list_artifacts",
	"show_agent",
	"get_ci_logs",
	"git_fetch",
]);

const SESSION_GRANT_TOOLS = new Set(["push_branch", "create_pr", "update_pr", "associate_pr"]);

/** Whether one "yes for this session" answer may cover this call: draft-stage shipping, never a force-push. */
export function coveredBySessionGrant(tool: string, input: Record<string, unknown>): boolean {
	return SESSION_GRANT_TOOLS.has(tool) && input.force !== true;
}

/** Calls whose success shows which Polygraph session this conversation ships to. */
export const SHIPPING_TOOLS: ReadonlySet<string> = new Set([...SESSION_GRANT_TOOLS, "mark_pr_ready"]);

/**
 * The session id for a `sessionId` argument, which may also be an app URL
 * (`/s/<id>` or `/orgs/<org>/sessions/<id>`), as the server accepts.
 */
export function sessionIdOf(ref: unknown): string | undefined {
	if (typeof ref !== "string") return undefined;
	const value = ref.trim();
	if (!value) return undefined;
	if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) return value;
	try {
		const parts = new URL(value).pathname.split("/").filter(Boolean);
		const id =
			parts.length === 2 && parts[0] === "s"
				? parts[1]
				: parts.length === 4 && parts[0] === "orgs" && parts[2] === "sessions"
					? parts[3]
					: undefined;
		return id ? decodeURIComponent(id).trim() || undefined : undefined;
	} catch {
		return undefined;
	}
}

/** The session id in a successful `start_session` result, which is prose, in either form the server writes. */
export function startedSessionId(resultText: string): string | undefined {
	const labelled = /^Session ID:\s*(\S+)\s*$/m.exec(resultText);
	if (labelled) return labelled[1];
	return /^Session (?!started\b|initialized\b)(\S+)/m.exec(resultText)?.[1];
}

// Long free text the confirmation never shows: it would bury the facts the answer depends on.
const PROSE_ARGUMENTS = new Set(["description", "body", "content", "instruction", "context", "sharedInstruction"]);

function text(value: unknown): string {
	return typeof value === "string" && value.trim() ? value.trim() : "?";
}

function list(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function collectionChange(name: string, value: unknown): string | undefined {
	const change = record(value);
	if (typeof change.mode !== "string") return undefined;
	const values = list(change.values).map(String);
	if (change.mode === "set") return values.length ? `set ${name} to ${values.join(", ")}` : `clear all ${name}`;
	return `${change.mode} ${name} ${values.join(", ")}`;
}

/** One or more lines saying what a call would do, for the confirmation dialog. */
export function describeCall(tool: string, input: Record<string, unknown>): string {
	switch (tool) {
		case "push_branch":
			return `${input.force === true ? "FORCE-push" : "Push"} branch ${text(input.branch)} of ${text(input.repo)}`;
		case "create_pr": {
			const prs = list(input.prs).map((entry) => {
				const pr = record(entry);
				const into = typeof pr.baseBranch === "string" ? ` into ${pr.baseBranch}` : "";
				const target = typeof pr.targetRepository === "string" ? ` (fork PR to ${pr.targetRepository})` : "";
				return `  ${text(pr.owner)}/${text(pr.repo)}: "${text(pr.title)}" from ${text(pr.branch)}${into}${target}`;
			});
			return [`Open ${prs.length} draft pull request${prs.length === 1 ? "" : "s"}:`, ...prs].join("\n");
		}
		case "update_pr": {
			const changes = [
				typeof input.title === "string" ? `title to "${input.title}"` : undefined,
				typeof input.body === "string" ? (input.body ? "body" : "clear the body") : undefined,
				collectionChange("labels", input.labels),
				collectionChange("assignees", input.assignees),
			].filter((change) => change !== undefined);
			return `Update ${text(input.prUrl)}: ${changes.join("; ") || "no changes named"}`;
		}
		case "mark_pr_ready":
			return ["Mark ready for review:", ...list(input.prUrls).map((url) => `  ${String(url)}`)].join("\n");
		case "associate_pr":
			return typeof input.prUrl === "string"
				? `Associate ${input.prUrl} with the session`
				: `Associate the pull request for branch ${text(input.branch)} of ${text(input.repo)} with the session`;
		default: {
			const shown = Object.entries(input)
				.filter(([name]) => name !== "sessionId" && !PROSE_ARGUMENTS.has(name))
				.map(([name, value]) => {
					const json = JSON.stringify(value) ?? "undefined";
					return `  ${name}: ${json.length > 80 ? `${json.slice(0, 77)}...` : json}`;
				});
			return [`Run ${tool}${shown.length ? " with:" : ""}`, ...shown].join("\n");
		}
	}
}
