import assert from "node:assert/strict";
import { test } from "node:test";
import { coveredBySessionGrant, describeCall, polygraphTool, sessionIdOf, startedSessionId } from "../extensions/polygraph/tools.ts";

test("polygraphTool recognises the server's tools under either server name", () => {
	assert.equal(polygraphTool("mcp__polygraph__push_branch"), "push_branch");
	assert.equal(polygraphTool("mcp__polygraph_mcp__create_pr"), "create_pr");
	assert.equal(polygraphTool("mcp__linear__save_issue"), undefined);
	assert.equal(polygraphTool("mcp__polygraphy__push_branch"), undefined);
	assert.equal(polygraphTool("bash"), undefined);
});

test("sessionIdOf accepts an id or an app URL", () => {
	assert.equal(sessionIdOf("  W07--fix-login-0a1b2c3d "), "W07--fix-login-0a1b2c3d");
	assert.equal(sessionIdOf("https://app.example/s/W07--fix-login-0a1b2c3d"), "W07--fix-login-0a1b2c3d");
	assert.equal(sessionIdOf("https://app.example/orgs/org-1/sessions/W07--fix%2Dlogin"), "W07--fix-login");
	assert.equal(sessionIdOf("https://github.com/acme/web/pull/7"), undefined);
	assert.equal(sessionIdOf(""), undefined);
	assert.equal(sessionIdOf(undefined), undefined);
	assert.equal(sessionIdOf(42), undefined);
});

test("startedSessionId reads both forms of a start_session result", () => {
	assert.equal(startedSessionId("Session initialized successfully.\nSession ID: abc-123\n\nCloned repositories:\n- acme/web"), "abc-123");
	assert.equal(startedSessionId("Session abc-123 (/tmp/root)\nRepositories:\n  - acme/web (in-place): ready"), "abc-123");
	assert.equal(startedSessionId("Session abc-123\nRepositories:\n  - acme/web: ready"), "abc-123");
	assert.equal(startedSessionId("Session started\nRepositories:\n  - acme/web: ready"), undefined);
	assert.equal(startedSessionId("Polygraph session start failed: not authenticated"), undefined);
});

test("a session grant covers draft-stage shipping and never a force-push", () => {
	assert.equal(coveredBySessionGrant("push_branch", { branch: "feat/x" }), true);
	assert.equal(coveredBySessionGrant("push_branch", { branch: "feat/x", force: true }), false);
	assert.equal(coveredBySessionGrant("create_pr", {}), true);
	assert.equal(coveredBySessionGrant("update_pr", {}), true);
	assert.equal(coveredBySessionGrant("associate_pr", {}), true);
	assert.equal(coveredBySessionGrant("mark_pr_ready", {}), false);
	assert.equal(coveredBySessionGrant("archive_session", {}), false);
	assert.equal(coveredBySessionGrant("start_session", {}), false);
});

test("describeCall names what would be published and leaves long prose out", () => {
	assert.equal(describeCall("push_branch", { repo: "acme/web", branch: "feat/x", description: "## Goal\nlong" }), "Push branch feat/x of acme/web");
	assert.equal(describeCall("push_branch", { repo: "acme/web", branch: "feat/x", force: true }), "FORCE-push branch feat/x of acme/web");

	const created = describeCall("create_pr", {
		description: "## Goal\nlong",
		prs: [
			{ owner: "acme", repo: "web", title: "feat(web): add x", body: "SECRET BODY", branch: "feat/x", baseBranch: "main" },
			{ owner: "me", repo: "api-fork", title: "feat(api): add x", body: "b", branch: "feat/x", targetRepository: "acme/api" },
		],
	});
	assert.equal(
		created,
		[
			"Open 2 draft pull requests:",
			'  acme/web: "feat(web): add x" from feat/x into main',
			'  me/api-fork: "feat(api): add x" from feat/x (fork PR to acme/api)',
		].join("\n"),
	);

	assert.equal(
		describeCall("update_pr", {
			prUrl: "https://github.com/acme/web/pull/1",
			title: "feat(web): add y",
			body: "new body text",
			labels: { mode: "set", values: [] },
			assignees: { mode: "add", values: ["nartc"] },
		}),
		'Update https://github.com/acme/web/pull/1: title to "feat(web): add y"; body; clear all labels; add assignees nartc',
	);
	assert.equal(describeCall("update_pr", { prUrl: "https://github.com/acme/web/pull/1", body: "" }), "Update https://github.com/acme/web/pull/1: clear the body");

	assert.equal(
		describeCall("mark_pr_ready", { prUrls: ["https://github.com/acme/web/pull/1", "https://github.com/acme/api/pull/2"] }),
		"Mark ready for review:\n  https://github.com/acme/web/pull/1\n  https://github.com/acme/api/pull/2",
	);
	assert.equal(describeCall("associate_pr", { branch: "feat/x", repo: "acme/web", description: "long" }), "Associate the pull request for branch feat/x of acme/web with the session");

	assert.equal(
		describeCall("upload_artifact", { sessionId: "s-1", name: "plan", kind: "plan", content: "SECRET CONTENT" }),
		'Run upload_artifact with:\n  name: "plan"\n  kind: "plan"',
	);
	assert.equal(describeCall("logout", {}), "Run logout");
});
