import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeSession } from "./helpers/fake-pi.ts";

const ONCE = "Yes, once";
const FOR_SESSION = "Yes, and stop asking about pushes and pull request edits for this Polygraph session";
const NO = "No";

const push = { sessionId: "s-1", repo: "acme/web", branch: "feat/x", description: "none" };

test("registers the Polygraph MCP server", () => {
	const pi = new FakeSession();
	assert.deepEqual(pi.servers.get("polygraph").command, "npx");
	assert.deepEqual(pi.servers.get("polygraph").args, ["-y", "@polygraph/mcp@latest"]);
});

test("read-only tools and other servers' tools run without asking", async () => {
	const pi = new FakeSession();
	for (const tool of ["mcp__polygraph__whoami", "mcp__polygraph__show_session", "mcp__polygraph__get_ci_logs", "mcp__linear__save_issue", "bash"]) {
		assert.equal(await pi.call(tool, { sessionId: "s-1" }), undefined);
	}
	assert.equal(pi.questions.length, 0);
});

test("a push asks, and runs only on a yes", async () => {
	const pi = new FakeSession();

	pi.answers = [NO];
	const declined = await pi.call("mcp__polygraph__push_branch", push);
	assert.equal(declined.block, true);
	assert.match(declined.reason, /declined Polygraph push_branch/);

	// Escape dismisses the dialog with no choice.
	pi.answers = [undefined];
	assert.equal((await pi.call("mcp__polygraph__push_branch", push)).block, true);

	pi.answers = [ONCE];
	assert.equal(await pi.call("mcp__polygraph__push_branch", push), undefined);

	assert.equal(pi.questions.length, 3);
	assert.equal(pi.questions[0].title, "Polygraph: Push branch feat/x of acme/web\nSession: s-1");
	assert.deepEqual(pi.questions[0].options, [ONCE, FOR_SESSION, NO]);
});

test("without a UI every publishing call is refused, unasked", async () => {
	const pi = new FakeSession();
	pi.hasUI = false;
	pi.answers = [ONCE];
	const refused = await pi.call("mcp__polygraph__create_pr", { sessionId: "s-1", prs: [], description: "d" });
	assert.equal(refused.block, true);
	assert.match(refused.reason, /no interactive UI/);
	assert.equal(pi.questions.length, 0);
});

test("yes once asks again the next time", async () => {
	const pi = new FakeSession();
	pi.answers = [ONCE, ONCE];
	await pi.call("mcp__polygraph__push_branch", push);
	await pi.call("mcp__polygraph__push_branch", push);
	assert.equal(pi.questions.length, 2);
});

test("yes for the session covers later pushes and pull request edits for that session only", async () => {
	const pi = new FakeSession();
	pi.answers = [FOR_SESSION];
	assert.equal(await pi.call("mcp__polygraph__push_branch", push), undefined);

	assert.equal(await pi.call("mcp__polygraph__push_branch", push), undefined);
	assert.equal(await pi.call("mcp__polygraph__create_pr", { sessionId: "s-1", prs: [], description: "d" }), undefined);
	assert.equal(await pi.call("mcp__polygraph__update_pr", { sessionId: "https://app.example/s/s-1", prUrl: "u" }), undefined);
	assert.equal(await pi.call("mcp__polygraph__associate_pr", { sessionId: "s-1", prUrl: "u", description: "d" }), undefined);
	assert.equal(pi.questions.length, 1);

	// Another session, a force-push, marking ready and everything else still ask.
	assert.equal((await pi.call("mcp__polygraph__push_branch", { ...push, sessionId: "s-2" })).block, true);
	assert.equal((await pi.call("mcp__polygraph__push_branch", { ...push, force: true })).block, true);
	assert.equal((await pi.call("mcp__polygraph__mark_pr_ready", { sessionId: "s-1", prUrls: ["u"] })).block, true);
	assert.equal((await pi.call("mcp__polygraph__archive_session", { sessionId: "s-1" })).block, true);
	assert.equal(pi.questions.length, 5);
	assert.deepEqual(pi.questions[2].options, [ONCE, NO], "a force-push is never offered a session-wide yes");
	assert.match(pi.questions[2].title, /FORCE-push/);
	assert.deepEqual(pi.questions[3].options, [ONCE, NO]);
});

test("a session grant does not outlive the runtime or a move in the session tree", async () => {
	const pi = new FakeSession();
	pi.answers = [FOR_SESSION];
	await pi.call("mcp__polygraph__push_branch", push);

	await pi.emit("session_tree", { newLeafId: "a", oldLeafId: "b" });
	assert.equal((await pi.call("mcp__polygraph__push_branch", push)).block, true);

	pi.answers = [FOR_SESSION];
	await pi.call("mcp__polygraph__push_branch", push);
	pi.load();
	await pi.start();
	assert.equal((await pi.call("mcp__polygraph__push_branch", push)).block, true);
});

test("a tool the extension has never heard of asks", async () => {
	const pi = new FakeSession();
	const blocked = await pi.call("mcp__polygraph__delete_everything", { sessionId: "s-1", scope: "all" });
	assert.equal(blocked.block, true);
	assert.equal(pi.questions[0].title, 'Polygraph: Run delete_everything with:\n  scope: "all"\nSession: s-1');
	assert.deepEqual(pi.questions[0].options, [ONCE, NO]);
});

test("starting a session binds this Pi session to it", async () => {
	const pi = new FakeSession();
	await pi.start();
	assert.equal(await pi.promptSection(), undefined);

	await pi.result("mcp__polygraph__start_session", { title: "t", selectedRepoIds: ["r"] }, "Session initialized successfully.\nSession ID: s-new\n");

	assert.match((await pi.promptSection()) ?? "", /bound to Polygraph session s-new\./);
	assert.equal(pi.statuses.get("polygraph"), "polygraph s-new");
	assert.deepEqual(pi.branch.at(-1)?.data, { version: 1, owner: "pi-session-1", binding: { sessionId: "s-new" } });
});

test("a failed call binds nothing", async () => {
	const pi = new FakeSession();
	await pi.result("mcp__polygraph__start_session", {}, "Session ID: s-new", true);
	await pi.result("mcp__polygraph__push_branch", push, "Remote branch has diverged", true);
	assert.equal(await pi.promptSection(), undefined);
	assert.equal(pi.branch.length, 0);
});

test("the first successful shipping call binds an unbound session; reading never does", async () => {
	const pi = new FakeSession();
	await pi.result("mcp__polygraph__show_session", { sessionId: "s-other" }, "{}");
	assert.equal(await pi.promptSection(), undefined);

	await pi.result("mcp__polygraph__push_branch", push, "Successfully pushed");
	assert.match((await pi.promptSection()) ?? "", /session s-1\./);

	// Shipping somewhere else later does not move the binding; starting a session does.
	await pi.result("mcp__polygraph__create_pr", { sessionId: "s-2", prs: [] }, "ok");
	assert.match((await pi.promptSection()) ?? "", /session s-1\./);
	await pi.result("mcp__polygraph__start_session", {}, "Session s-3 (/tmp/root)\nRepositories:\n  - acme/web: ready");
	assert.match((await pi.promptSection()) ?? "", /session s-3\./);
});

test("the confirmation says when a call targets a session other than the bound one", async () => {
	const pi = new FakeSession();
	await pi.result("mcp__polygraph__push_branch", push, "Successfully pushed");
	await pi.call("mcp__polygraph__push_branch", { ...push, sessionId: "s-2" });
	assert.equal(pi.questions[0].title, "Polygraph: Push branch feat/x of acme/web\nSession: s-2\nThis Pi session is bound to a different session: s-1");
});

test("the binding is there again after a restart, and gone from the prompt once unbound", async () => {
	const pi = new FakeSession();
	await pi.result("mcp__polygraph__push_branch", push, "Successfully pushed");

	pi.load();
	assert.equal(await pi.promptSection(), undefined, "nothing is assumed before the session's entries are read");
	await pi.start();
	assert.match((await pi.promptSection()) ?? "", /session s-1\./);
	assert.equal(pi.statuses.get("polygraph"), "polygraph s-1");

	await pi.command("unbind");
	const sections = { polygraph_session: "stale" };
	await pi.emit("before_agent_start", { systemPromptOptions: { sections } });
	assert.deepEqual(sections, {});
	assert.equal(pi.statuses.get("polygraph"), undefined);

	pi.load();
	await pi.start();
	assert.equal(await pi.promptSection(), undefined);
});

test("a fork starts unbound", async () => {
	const pi = new FakeSession();
	await pi.result("mcp__polygraph__push_branch", push, "Successfully pushed");
	pi.sessionId = "pi-session-2";
	pi.load();
	await pi.start();
	assert.equal(await pi.promptSection(), undefined);
});

test("/polygraph bind checks the session with the CLI before binding", async () => {
	const pi = new FakeSession();
	const runs: string[][] = [];
	pi.exec = async (command, args) => {
		runs.push([command, ...args]);
		const id = args[args.indexOf("--session") + 1];
		if (id === "missing") {
			return { stdout: JSON.stringify({ success: false, error: { message: "Session not found: missing" } }), stderr: "", code: 1, killed: false };
		}
		return { stdout: JSON.stringify({ sessionId: id, polygraphSessionUrl: `https://app.example/s/${id}` }), stderr: "", code: 0, killed: false };
	};

	await pi.command("bind missing");
	assert.equal(await pi.promptSection(), undefined);
	assert.deepEqual(pi.notices.at(-1), { message: "Not bound: Session not found: missing", type: "error" });

	await pi.command("bind https://app.example/orgs/org-1/sessions/s-9");
	assert.deepEqual(runs.at(-1)?.slice(-5), ["session", "show", "--session", "s-9", "--json"]);
	assert.match((await pi.promptSection()) ?? "", /session s-9\.\nSession page: https:\/\/app\.example\/s\/s-9/);

	await pi.command("bind --reset");
	assert.equal(runs.length, 2, "something that reads as a flag never reaches the CLI");
	assert.match((await pi.promptSection()) ?? "", /session s-9\./);

	await pi.command("");
	assert.match(pi.notices.at(-1)?.message ?? "", /^Bound to Polygraph session s-9\nhttps:\/\/app\.example\/s\/s-9$/);

	await pi.command("bind");
	assert.match(pi.notices.at(-1)?.message ?? "", /^Usage:/);
});
