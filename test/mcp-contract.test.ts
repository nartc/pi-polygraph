/**
 * Runs the real @polygraph/mcp server against a fake polygraph CLI, to hold the extension to
 * what the server actually does: its tool names, the session ids in its results, and the CLI
 * commands the publishing tools turn into. Nothing here reaches Polygraph: the server only
 * ever works through the CLI, and the CLI is the fake.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { READ_ONLY_TOOLS, startedSessionId } from "../extensions/polygraph/tools.ts";
import { McpClient } from "./helpers/mcp-client.ts";

// Tools known to change something. They ask because they are not read-only; the list exists so a
// new tool upstream fails this test until someone decides which kind it is.
const KNOWN_CONFIRMED_TOOLS = [
	"push_branch",
	"create_pr",
	"update_pr",
	"associate_pr",
	"mark_pr_ready",
	"start_session",
	"resume_session",
	"update_session",
	"archive_session",
	"add_repo",
	"link_reference",
	"pack_and_copy",
	"upload_artifact",
	"delete_artifact",
	"spawn_agent",
	"stop_agent",
	"allow_agent",
	"deny_agent",
	"login",
	"logout",
	"select_account",
];

const server = createRequire(import.meta.url).resolve("@polygraph/mcp");
const fakeCli = fileURLToPath(new URL("./fixtures/fake-polygraph.mjs", import.meta.url));

let scratch: string;
let log: string;
let mcp: McpClient;

/** What the fake CLI was asked to run since the last look, without the server's own `doctor` checks. */
function cliCalls(): { argv: string[]; spec?: unknown }[] {
	const calls = readFileSync(log, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line))
		.filter((call) => call.argv[0] !== "doctor");
	writeFileSync(log, "");
	return calls;
}

before(async () => {
	scratch = mkdtempSync(join(tmpdir(), "pi-polygraph-"));
	log = join(scratch, "cli.log");
	writeFileSync(log, "");
	// An empty HOME as well: no credentials on this machine are within reach of the server.
	mcp = new McpClient(process.execPath, [server], {
		cwd: scratch,
		env: { PATH: process.env.PATH, HOME: scratch, POLYGRAPH_CLI: fakeCli, FAKE_POLYGRAPH_LOG: log },
	});
	await mcp.initialize();
});

after(() => {
	mcp?.close();
	rmSync(scratch, { recursive: true, force: true });
});

test("every tool the server offers is known as read-only or as one that asks", async () => {
	const offered = await mcp.toolNames();
	const unknown = offered.filter((tool) => !READ_ONLY_TOOLS.has(tool) && !KNOWN_CONFIRMED_TOOLS.includes(tool));
	assert.deepEqual(unknown, [], "new tools: they already ask, decide whether any is read-only");

	const gone = [...READ_ONLY_TOOLS, ...KNOWN_CONFIRMED_TOOLS].filter((tool) => !offered.includes(tool));
	assert.deepEqual(gone, [], "tools the extension names that the server no longer has");
});

test("the session id is read out of both forms of a real start_session result", async () => {
	const summary = await mcp.call("start_session", { title: "plain", selectedRepoIds: ["repo-1"] });
	assert.equal(summary.isError, false);
	assert.equal(startedSessionId(summary.text), "fake-started-0a1b2c3d");

	const listing = await mcp.call("start_session", { title: "with repositories", selectedRepoIds: ["repo-1"] });
	assert.equal(startedSessionId(listing.text), "fake-started-0a1b2c3d");
	cliCalls();
});

test("push_branch pushes through the CLI, and a refusal comes back as an error", async () => {
	cliCalls();
	const pushed = await mcp.call("push_branch", { sessionId: "https://app.example/s/s-1", repo: "acme/web", branch: "feat/x", description: "none" });
	assert.equal(pushed.isError, false);
	assert.deepEqual(cliCalls().map((call) => call.argv), [["git", "push-branch", "acme/web", "feat/x", "--session", "s-1", "--description", "none", "--json"]]);

	const diverged = await mcp.call("push_branch", { sessionId: "s-1", repo: "acme/web", branch: "diverged", description: "none" });
	assert.equal(diverged.isError, true);
	assert.match(diverged.text, /diverged/);
});

test("create_pr hands the CLI a spec file with the pull requests", async () => {
	cliCalls();
	const created = await mcp.call("create_pr", {
		sessionId: "s-1",
		description: "## Goal\nship x",
		prs: [{ owner: "acme", repo: "web", title: "feat(web): add x", body: "the body", branch: "feat/x", baseBranch: "main" }],
	});
	assert.equal(created.isError, false);

	const [call] = cliCalls();
	assert.deepEqual(call.argv.slice(0, 3), ["git", "create-pr", "--spec-file"]);
	assert.deepEqual(call.argv.slice(4), ["--session", "s-1", "--description", "## Goal\nship x", "--json"]);
	assert.deepEqual(call.spec, { prs: [{ owner: "acme", repo: "web", title: "feat(web): add x", body: "the body", headBranch: "feat/x", baseBranch: "main" }] });
});

test("update_pr, mark_pr_ready and get_ci_logs map to their CLI commands", async () => {
	cliCalls();
	await mcp.call("update_pr", { sessionId: "s-1", prUrl: "https://github.com/acme/web/pull/1", title: "feat(web): add y", assignees: { mode: "add", values: ["nartc"] } });
	await mcp.call("mark_pr_ready", { sessionId: "s-1", prUrls: ["https://github.com/acme/web/pull/1"] });
	const logs = await mcp.call("get_ci_logs", { sessionId: "s-1", repoId: "repo-1", jobId: 42 });

	assert.deepEqual(cliCalls().map((call) => call.argv), [
		["git", "update-pr", "--session", "s-1", "--pr-url", "https://github.com/acme/web/pull/1", "--title=feat(web): add y", "--add-assignee=nartc", "--json"],
		["git", "mark-pr-ready", "--pr-url", "https://github.com/acme/web/pull/1", "--session", "s-1", "--json"],
		["git", "ci-logs", "s-1", "--repo", "repo-1", "--job", "42", "--json"],
	]);
	assert.match(logs.text, /fake-ci\.log/);
});
