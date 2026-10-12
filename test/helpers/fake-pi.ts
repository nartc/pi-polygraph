import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import polygraph from "../../extensions/polygraph/index.ts";

type Handler = (event: any, ctx: ExtensionContext) => unknown;

interface Command {
	handler: (args: string, ctx: any) => Promise<void>;
}

/** A Pi session with the extension loaded: just enough of the extension API to drive it. */
export class FakeSession {
	readonly branch: { type: string; customType?: string; data?: unknown }[] = [];
	readonly servers = new Map<string, any>();
	readonly commands = new Map<string, Command>();
	readonly statuses = new Map<string, string | undefined>();
	readonly notices: { message: string; type?: string }[] = [];
	/** Every confirmation shown, in order. */
	readonly questions: { title: string; options: string[] }[] = [];
	/** Answers for the confirmations still to come; with none left, the dialog is dismissed. */
	answers: (string | undefined)[] = [];
	hasUI = true;
	sessionId = "pi-session-1";
	exec: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number; killed: boolean }> =
		async () => ({ stdout: "", stderr: "exec was not expected", code: 1, killed: false });

	private readonly handlers = new Map<string, Handler[]>();

	constructor() {
		this.load();
	}

	/** Runs the extension factory again, as a reload or a restart does. Entries on the branch stay. */
	load() {
		this.handlers.clear();
		const pi = {
			on: (event: string, handler: Handler) => {
				this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
			},
			registerMcpServer: (name: string, config: unknown) => this.servers.set(name, config),
			registerCommand: (name: string, command: Command) => this.commands.set(name, command),
			appendEntry: (customType: string, data?: unknown) => this.branch.push({ type: "custom", customType, data }),
			exec: (command: string, args: string[]) => this.exec(command, args),
		};
		polygraph(pi as unknown as ExtensionAPI);
	}

	get ctx(): ExtensionContext {
		return {
			hasUI: this.hasUI,
			signal: undefined,
			ui: {
				select: async (title: string, options: string[]) => {
					this.questions.push({ title, options });
					return this.answers.shift();
				},
				notify: (message: string, type?: string) => this.notices.push({ message, type }),
				setStatus: (key: string, text: string | undefined) => this.statuses.set(key, text),
			},
			sessionManager: { getBranch: () => this.branch, getSessionId: () => this.sessionId },
		} as unknown as ExtensionContext;
	}

	/** Fires an event and returns the first result a handler gave, as Pi does for a blocked tool call. */
	async emit(event: string, payload: Record<string, unknown> = {}): Promise<any> {
		let result: unknown;
		for (const handler of this.handlers.get(event) ?? []) {
			result ??= await handler({ type: event, ...payload }, this.ctx);
		}
		return result;
	}

	start() {
		return this.emit("session_start", { reason: "startup" });
	}

	/** A tool call as the model (or a codemode script) makes it. Resolves to the block result, or undefined. */
	call(tool: string, input: Record<string, unknown> = {}) {
		return this.emit("tool_call", { toolName: tool, toolCallId: "call-1", input });
	}

	result(tool: string, input: Record<string, unknown>, text: string, isError = false) {
		return this.emit("tool_result", { toolName: tool, toolCallId: "call-1", input, content: [{ type: "text", text }], isError });
	}

	/** The `polygraph_session` section the model would see on its next run, if any. */
	async promptSection(): Promise<string | undefined> {
		const sections: Record<string, string> = {};
		await this.emit("before_agent_start", { prompt: "", systemPrompt: "", systemPromptOptions: { sections } });
		return sections.polygraph_session;
	}

	command(args: string) {
		return this.commands.get("polygraph")!.handler(args, this.ctx);
	}
}
