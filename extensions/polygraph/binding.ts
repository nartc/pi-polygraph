/**
 * The link between one Pi session and the Polygraph session it ships to.
 *
 * It is kept in Pi custom entries, so it follows the active branch of the session tree and is
 * there again after compaction, reload and resume. Nothing here talks to Polygraph.
 */

export const BINDING_ENTRY = "polygraph-binding";

export interface Binding {
	sessionId: string;
	/** The session's page in the Polygraph app, when known. */
	url?: string;
}

interface BindingRecord {
	version: 1;
	/** The Pi session that wrote the record. A fork or clone copies entries but is a different session. */
	owner: string;
	/** Null records an unbind. */
	binding: Binding | null;
}

interface EntryLike {
	type: string;
	customType?: string;
	data?: unknown;
}

export function bindingRecord(owner: string, binding: Binding | undefined): BindingRecord {
	return { version: 1, owner, binding: binding ?? null };
}

function readRecord(data: unknown, owner: string): Binding | undefined {
	if (!data || typeof data !== "object") return undefined;
	const record = data as Partial<BindingRecord>;
	if (record.version !== 1 || record.owner !== owner) return undefined;
	const binding = record.binding;
	if (!binding || typeof binding !== "object") return undefined;
	if (typeof binding.sessionId !== "string" || !binding.sessionId.trim()) return undefined;
	return { sessionId: binding.sessionId, ...(typeof binding.url === "string" && binding.url ? { url: binding.url } : {}) };
}

/**
 * The binding for the active branch. The newest record on the branch decides, whatever it says:
 * an unbind, another session's record or one this code can't read all mean "not bound", never
 * "fall back to an older record".
 */
export function restoreBinding(branch: readonly EntryLike[], owner: string): Binding | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type === "custom" && entry.customType === BINDING_ENTRY) return readRecord(entry.data, owner);
	}
	return undefined;
}

/** What the model is told each turn while a binding exists. */
export function bindingPrompt(binding: Binding): string {
	return [
		`This Pi session is bound to Polygraph session ${binding.sessionId}.`,
		binding.url ? `Session page: ${binding.url}` : undefined,
		"Pass that id as sessionId to the Polygraph tools (mcp__polygraph__*).",
		"Load the polygraph-ship skill before pushing a branch or opening, updating or readying a pull request.",
	]
		.filter((line) => line !== undefined)
		.join("\n");
}

/** A session id short enough for the footer. Ids end in a hash, so the tail is kept. */
export function shortSessionId(sessionId: string): string {
	return sessionId.length <= 32 ? sessionId : `${sessionId.slice(0, 20)}…${sessionId.slice(-8)}`;
}
