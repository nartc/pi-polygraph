import assert from "node:assert/strict";
import { test } from "node:test";
import { BINDING_ENTRY, bindingPrompt, bindingRecord, restoreBinding, shortSessionId } from "../extensions/polygraph/binding.ts";

const entry = (data: unknown) => ({ type: "custom", customType: BINDING_ENTRY, data });
const message = { type: "message" };

test("the newest record on the branch is the binding", () => {
	const branch = [
		entry(bindingRecord("pi-1", { sessionId: "old" })),
		message,
		entry(bindingRecord("pi-1", { sessionId: "new", url: "https://app.example/s/new" })),
		message,
	];
	assert.deepEqual(restoreBinding(branch, "pi-1"), { sessionId: "new", url: "https://app.example/s/new" });
});

test("no record means not bound", () => {
	assert.equal(restoreBinding([message, { type: "custom", customType: "something-else", data: { sessionId: "x" } }], "pi-1"), undefined);
});

test("an unbind is remembered", () => {
	const branch = [entry(bindingRecord("pi-1", { sessionId: "old" })), entry(bindingRecord("pi-1", undefined))];
	assert.equal(restoreBinding(branch, "pi-1"), undefined);
});

test("a fork or clone does not inherit the binding its entries were copied with", () => {
	const branch = [entry(bindingRecord("pi-1", { sessionId: "s-1" }))];
	assert.equal(restoreBinding(branch, "pi-2"), undefined);
});

test("a newest record that can't be read never falls back to an older one", () => {
	const good = entry(bindingRecord("pi-1", { sessionId: "old" }));
	for (const bad of [
		undefined,
		"text",
		{ version: 2, owner: "pi-1", binding: { sessionId: "future" } },
		{ version: 1, owner: "pi-1", binding: { sessionId: "" } },
		{ version: 1, owner: "pi-1", binding: { sessionId: 7 } },
		{ version: 1, owner: "pi-1" },
	]) {
		assert.equal(restoreBinding([good, entry(bad)], "pi-1"), undefined);
	}
});

test("the prompt carries the id, and the page when known", () => {
	assert.match(bindingPrompt({ sessionId: "s-1" }), /bound to Polygraph session s-1\./);
	assert.doesNotMatch(bindingPrompt({ sessionId: "s-1" }), /Session page/);
	assert.match(bindingPrompt({ sessionId: "s-1", url: "https://app.example/s/s-1" }), /Session page: https:\/\/app\.example\/s\/s-1/);
});

test("long ids are shortened for the footer, keeping the hash at the end", () => {
	assert.equal(shortSessionId("short-id"), "short-id");
	assert.equal(shortSessionId("W07--ACME-1234--add-user-preferences-across-web-and-api-0a1b2c3d"), "W07--ACME-1234--add-…0a1b2c3d");
});
