import { type ChildProcess, spawn } from "node:child_process";

interface ToolResult {
	content: { type: string; text?: string }[];
	isError?: boolean;
}

/** The few MCP requests the tests need, over stdio. */
export class McpClient {
	private readonly child: ChildProcess;
	private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
	private nextId = 0;
	private buffer = "";

	constructor(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) {
		this.child = spawn(command, args, { ...options, stdio: ["pipe", "pipe", "ignore"] });
		this.child.stdout!.on("data", (chunk: Buffer) => {
			this.buffer += chunk.toString();
			for (let end = this.buffer.indexOf("\n"); end !== -1; end = this.buffer.indexOf("\n")) {
				const line = this.buffer.slice(0, end).trim();
				this.buffer = this.buffer.slice(end + 1);
				if (line) this.receive(line);
			}
		});
		this.child.on("exit", () => {
			for (const { reject } of this.pending.values()) reject(new Error("the MCP server exited"));
			this.pending.clear();
		});
	}

	private receive(line: string) {
		const message = JSON.parse(line);
		const waiting = this.pending.get(message.id);
		if (!waiting) return;
		this.pending.delete(message.id);
		if (message.error) waiting.reject(new Error(message.error.message));
		else waiting.resolve(message.result);
	}

	private request(method: string, params: unknown): Promise<any> {
		const id = ++this.nextId;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
		});
	}

	async initialize() {
		await this.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "pi", version: "0.0.0" } });
		this.child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
	}

	async toolNames(): Promise<string[]> {
		const { tools } = await this.request("tools/list", {});
		return tools.map((tool: { name: string }) => tool.name);
	}

	/** Calls a tool and returns its text and whether the server marked it an error. */
	async call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
		const result: ToolResult = await this.request("tools/call", { name, arguments: args });
		return { text: result.content.map((part) => part.text ?? "").join("\n"), isError: result.isError === true };
	}

	close() {
		this.child.kill();
	}
}
