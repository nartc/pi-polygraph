/**
 * Polygraph for Pi
 *
 * Registers the Polygraph MCP server, asks before any Polygraph call that changes something,
 * and remembers which Polygraph session this Pi session ships to.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BINDING_ENTRY, type Binding, bindingPrompt, bindingRecord, restoreBinding, shortSessionId } from "./binding.ts";
import { lookUpSession } from "./cli.ts";
import {
	coveredBySessionGrant,
	describeCall,
	polygraphTool,
	READ_ONLY_TOOLS,
	SERVER_NAME,
	SHIPPING_TOOLS,
	sessionIdOf,
	startedSessionId,
} from "./tools.ts";

const ONCE = "Yes, once";
const FOR_SESSION = "Yes, and stop asking about pushes and pull request edits for this Polygraph session";
const NO = "No";

export default function (pi: ExtensionAPI) {
	// A server named "polygraph" in mcp.json takes precedence over this registration.
	pi.registerMcpServer(SERVER_NAME, {
		command: "npx",
		args: ["-y", "@polygraph/mcp@latest"],
		description: "Polygraph sessions: push branches, open and update pull requests, read CI status and logs",
	});

	let binding: Binding | undefined;
	// Polygraph sessions the user said to stop asking about. Never saved: a restart asks again.
	const granted = new Set<string>();

	function showStatus(ctx: ExtensionContext) {
		ctx.ui.setStatus("polygraph", binding ? `polygraph ${shortSessionId(binding.sessionId)}` : undefined);
	}

	function restore(ctx: ExtensionContext) {
		binding = restoreBinding(ctx.sessionManager.getBranch(), ctx.sessionManager.getSessionId());
		granted.clear();
		showStatus(ctx);
	}

	function bind(ctx: ExtensionContext, next: Binding | undefined) {
		binding = next;
		pi.appendEntry(BINDING_ENTRY, bindingRecord(ctx.sessionManager.getSessionId(), next));
		showStatus(ctx);
	}

	pi.on("session_start", (_event, ctx) => restore(ctx));
	pi.on("session_tree", (_event, ctx) => restore(ctx));

	// The system prompt is rebuilt every run, so this is what carries the session id across compaction.
	pi.on("before_agent_start", (event) => {
		if (binding) event.systemPromptOptions.sections.polygraph_session = bindingPrompt(binding);
		else delete event.systemPromptOptions.sections.polygraph_session;
	});

	pi.on("tool_call", async (event, ctx) => {
		const tool = polygraphTool(event.toolName);
		if (!tool || READ_ONLY_TOOLS.has(tool)) return undefined;

		const input = event.input as Record<string, unknown>;
		const sessionId = sessionIdOf(input.sessionId);
		const grantable = sessionId !== undefined && coveredBySessionGrant(tool, input);
		if (grantable && granted.has(sessionId)) return undefined;

		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `Polygraph ${tool} needs the user's confirmation and this Pi session has no interactive UI. Tell the user; do not publish another way.`,
			};
		}

		const question = [`Polygraph: ${describeCall(tool, input)}`];
		if (sessionId) question.push(`Session: ${sessionId}`);
		if (sessionId && binding && sessionId !== binding.sessionId) {
			question.push(`This Pi session is bound to a different session: ${binding.sessionId}`);
		}

		const choice = await ctx.ui.select(question.join("\n"), grantable ? [ONCE, FOR_SESSION, NO] : [ONCE, NO], {
			signal: ctx.signal,
		});
		if (choice === FOR_SESSION && grantable) granted.add(sessionId);
		if (choice === ONCE || choice === FOR_SESSION) return undefined;

		return {
			block: true,
			reason: `The user declined Polygraph ${tool}. Do not retry it or publish another way (git push, the polygraph CLI) unless the user asks.`,
		};
	});

	pi.on("tool_result", (event, ctx) => {
		const tool = polygraphTool(event.toolName);
		if (!tool || event.isError) return;

		let sessionId: string | undefined;
		if (tool === "start_session") {
			sessionId = startedSessionId(event.content.map((part) => (part.type === "text" ? part.text : "")).join("\n"));
		} else if (!binding && SHIPPING_TOOLS.has(tool)) {
			sessionId = sessionIdOf(event.input.sessionId);
		}
		if (sessionId && sessionId !== binding?.sessionId) bind(ctx, { sessionId });
	});

	pi.registerCommand("polygraph", {
		description: "Polygraph session for this Pi session: status | bind <session id or URL> | unbind",
		getArgumentCompletions: (prefix) => {
			const verbs = ["status", "bind", "unbind"].filter((verb) => verb.startsWith(prefix.trim()));
			return verbs.length ? verbs.map((verb) => ({ value: verb, label: verb })) : null;
		},
		handler: async (args, ctx) => {
			const [verb = "status", ref] = args.trim().split(/\s+/).filter(Boolean);

			if (verb === "status") {
				if (!binding) {
					ctx.ui.notify(
						"Not bound to a Polygraph session. A binding is made when this session starts one or first ships to one, or with /polygraph bind <session id or URL>.",
						"info",
					);
					return;
				}
				const lines = [`Bound to Polygraph session ${binding.sessionId}`];
				if (binding.url) lines.push(binding.url);
				if (granted.has(binding.sessionId)) lines.push("Pushes and pull request edits for it run without asking until Pi restarts.");
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			if (verb === "unbind") {
				if (binding) granted.delete(binding.sessionId);
				bind(ctx, undefined);
				ctx.ui.notify("Unbound. The Polygraph session itself is untouched.", "info");
				return;
			}

			const sessionId = verb === "bind" ? sessionIdOf(ref) : undefined;
			if (!sessionId) {
				ctx.ui.notify("Usage: /polygraph [status | bind <session id or URL> | unbind]", "warning");
				return;
			}
			try {
				const found = await lookUpSession(pi.exec.bind(pi), sessionId);
				bind(ctx, found);
				ctx.ui.notify(`Bound to Polygraph session ${found.sessionId}`, "info");
			} catch (error) {
				ctx.ui.notify(`Not bound: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
