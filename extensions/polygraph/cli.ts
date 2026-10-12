/**
 * The one place the extension runs the polygraph CLI itself: checking a session the user asks
 * to bind. Everything else goes through the MCP server, which runs the same CLI.
 */

import type { Binding } from "./binding.ts";

interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
}

type Exec = (command: string, args: string[], options?: { timeout?: number }) => Promise<ExecResult>;

// The MCP server resolves the CLI the same way: POLYGRAPH_CLI, a plain JS entry run through node.
function cliCommand(env: NodeJS.ProcessEnv): { command: string; prefix: string[] } {
	const cli = env.POLYGRAPH_CLI?.trim() || "polygraph";
	return /\.[cm]?js$/i.test(cli) ? { command: process.execPath, prefix: [cli] } : { command: cli, prefix: [] };
}

/** Reads a session with `session show` (read-only) and returns the binding for it, or throws the CLI's error. */
export async function lookUpSession(exec: Exec, sessionId: string, env: NodeJS.ProcessEnv = process.env): Promise<Binding> {
	// An id is passed as an option value, so it must not be readable as a flag.
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionId)) throw new Error(`Not a Polygraph session id: ${sessionId}`);

	const { command, prefix } = cliCommand(env);
	const result = await exec(command, [...prefix, "session", "show", "--session", sessionId, "--json"], { timeout: 30_000 });

	let shown: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(result.stdout);
		if (parsed && typeof parsed === "object") shown = parsed as Record<string, unknown>;
	} catch {
		// Not JSON: reported below with whatever the CLI printed.
	}

	if (result.code !== 0 || typeof shown.sessionId !== "string" || !shown.sessionId) {
		const error = shown.error && typeof shown.error === "object" ? (shown.error as { message?: unknown }).message : undefined;
		const detail = typeof error === "string" ? error : result.stderr.trim() || result.stdout.trim();
		throw new Error(detail || `polygraph session show exited with code ${result.code}`);
	}

	return {
		sessionId: shown.sessionId,
		...(typeof shown.polygraphSessionUrl === "string" && shown.polygraphSessionUrl ? { url: shown.polygraphSessionUrl } : {}),
	};
}
