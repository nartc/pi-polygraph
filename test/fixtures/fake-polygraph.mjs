#!/usr/bin/env node
// Stands in for the polygraph CLI in tests. It records what it was asked to do and answers
// with canned JSON. It never talks to Polygraph.
import { appendFileSync, readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const flag = (name) => {
	const at = argv.indexOf(name);
	return at === -1 ? undefined : argv[at + 1];
};
const command = argv.filter((arg) => !arg.startsWith("-")).slice(0, 2).join(" ");

const call = { argv, cwd: process.cwd() };
const specFile = flag("--spec-file");
if (specFile) call.spec = JSON.parse(readFileSync(specFile, "utf8"));
if (process.env.FAKE_POLYGRAPH_LOG) appendFileSync(process.env.FAKE_POLYGRAPH_LOG, `${JSON.stringify(call)}\n`);

const fail = (message) => {
	process.stdout.write(`${JSON.stringify({ type: "result", success: false, error: { type: "api", message } })}\n`);
	process.exit(1);
};

const session = flag("--session");
if (session === "missing-session") fail(`Session not found: ${session}`);

let out;
switch (command) {
	case "session list":
	case "repo list":
		out = [];
		break;
	case "session show":
		out = {
			sessionId: session,
			title: "Fake session",
			polygraphSessionUrl: `https://polygraph.example/orgs/org-1/sessions/${session}`,
			repositories: [{ id: "repo-1", fullName: "acme/web" }],
			pullRequests: [],
		};
		break;
	case "session start":
		out =
			flag("--title") === "with repositories"
				? {
						success: true,
						sessionId: "fake-started-0a1b2c3d",
						sessionRoot: "/tmp/fake-root",
						repositories: [{ repoFullName: "acme/web", status: "ready", strategy: "in-place" }],
					}
				: {
						success: true,
						sessionId: "fake-started-0a1b2c3d",
						clonesSummary: "Session initialized successfully.\nSession ID: fake-started-0a1b2c3d\n\nCloned repositories:\n- acme/web: /tmp/fake-root/web",
					};
		break;
	case "git push-branch":
		if (argv[3] === "diverged") fail("Remote branch has diverged");
		out = { success: true, branch: argv[3] };
		break;
	case "git create-pr":
		out = { success: true, results: [{ success: true, url: "https://github.com/acme/web/pull/1" }] };
		break;
	case "git ci-logs":
		out = { success: true, jobId: Number(flag("--job")), logFile: "/tmp/fake-ci.log", sizeBytes: 12 };
		break;
	default:
		out = { success: true };
}
process.stdout.write(`${JSON.stringify(out)}\n`);
