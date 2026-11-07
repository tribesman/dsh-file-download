import assert from "node:assert/strict";
import test from "node:test";

import { apply, inject } from "../lib/index.js";

/** Capture the route the plugin registers, with stub harness services. */
function mount(files = [{ path: "meal-plan-nedelya.pdf" }]) {
	let route;
	const ctx = {
		webServer: {
			register: (definition) => {
				route = definition;
				return () => {
					route = null;
				};
			}
		},
		sessionQuery: {
			readEvent: async ({ sessionId, seq }) => {
				if (sessionId === "missing") throw new Error(`session "${sessionId}" not found`);
				return {
					session: { cwd: "/workspace/project" },
					target: seq === 7 ? { type: "deliverables/presented", data: { files } } : { type: "request/header", data: {} }
				};
			}
		},
		workspaceFiles: {
			readBytes: async (scope, path) => {
				if (path === "gone.pdf") {
					const error = new Error("not found");
					error.code = "ENOENT";
					throw error;
				}
				assert.equal(scope.workspaceRoot, "/workspace/project");
				return { data: new Uint8Array([0x25, 0x50, 0x44, 0x46]) };
			}
		},
		sandboxPolicy: { workspaceRoot: "/workspace" },
		on: () => {}
	};
	apply(ctx);
	assert.ok(route, "the plugin registers a web route");
	return {
		route,
		call(url, method = "GET") {
			return new Promise((resolve) => {
				const res = {
					headersSent: false,
					writableEnded: false,
					status: 0,
					headers: {},
					body: null,
					writeHead(status, headers) {
						this.status = status;
						this.headers = headers;
						this.headersSent = true;
					},
					end(body) {
						this.body = body;
						this.writableEnded = true;
						resolve(this);
					}
				};
				route.handler({ method, url }, res);
			});
		}
	};
}

test("registers a prefix route and the services it needs", () => {
	assert.deepEqual(inject, ["webServer", "sessionQuery", "workspaceFiles", "sandboxPolicy"]);
	const { route } = mount();
	assert.equal(route.kind, "prefix");
	assert.equal(route.path, "/file-download");
});

test("serves the delivered file as an attachment", async () => {
	const { call } = mount();
	const res = await call("/file-download/download?sessionId=s1&seq=7&index=0");
	assert.equal(res.status, 200);
	assert.equal(res.headers["content-type"], "application/pdf");
	assert.equal(res.headers["content-disposition"], `attachment; filename="meal-plan-nedelya.pdf"; filename*=UTF-8''meal-plan-nedelya.pdf`);
	assert.equal(res.headers["cache-control"], "no-store");
	assert.equal(res.headers["x-content-type-options"], "nosniff");
	assert.equal(res.headers["content-length"], "4");
	assert.deepEqual([...res.body], [0x25, 0x50, 0x44, 0x46]);
});

test("names a non-ASCII file for both header flavours", async () => {
	const { call } = mount([{ path: "отчёт за ноябрь.pdf" }]);
	const res = await call("/file-download/download?sessionId=s1&seq=7&index=0");
	assert.equal(res.status, 200);
	const disposition = res.headers["content-disposition"];
	assert.match(disposition, /filename="[^"]*\.pdf"/);
	assert.ok(disposition.includes(encodeURIComponent("отчёт за ноябрь.pdf")), disposition);
	assert.ok(!/[^\x20-\x7e]/.test(disposition.split("filename*=UTF-8''")[0]), "the ASCII fallback stays pure ASCII");
});

test("answers HEAD without a body", async () => {
	const { call } = mount();
	const res = await call("/file-download/download?sessionId=s1&seq=7&index=0", "HEAD");
	assert.equal(res.status, 200);
	assert.equal(res.headers["content-length"], "4");
	assert.equal(res.body, undefined);
});

test("rejects a method it does not serve", async () => {
	const { call } = mount();
	const res = await call("/file-download/download?sessionId=s1&seq=7&index=0", "POST");
	assert.equal(res.status, 405);
});

test("rejects malformed coordinates", async () => {
	const { call } = mount();
	for (const url of [
		"/file-download/download",
		"/file-download/download?sessionId=s1&seq=x&index=0",
		"/file-download/download?sessionId=s1&seq=7",
		"/file-download/download?sessionId=s1&seq=-1&index=0"
	]) {
		const res = await call(url);
		assert.equal(res.status, 400, url);
	}
});

test("answers 404 for an unknown route under its prefix", async () => {
	const { call } = mount();
	const res = await call("/file-download/nope");
	assert.equal(res.status, 404);
});

test("answers 404 when the turn delivered no such index", async () => {
	const { call } = mount();
	const res = await call("/file-download/download?sessionId=s1&seq=7&index=5");
	assert.equal(res.status, 404);
	assert.match(String(res.body), /not delivered/);
});

test("answers 404 for an event that is not a delivery", async () => {
	const { call } = mount();
	const res = await call("/file-download/download?sessionId=s1&seq=1&index=0");
	assert.equal(res.status, 404);
});

test("answers 404 for an unknown session", async () => {
	const { call } = mount();
	const res = await call("/file-download/download?sessionId=missing&seq=7&index=0");
	assert.equal(res.status, 404);
	assert.match(String(res.body), /unavailable/);
});

test("answers 404 when the file disappeared from the workspace", async () => {
	const { call } = mount([{ path: "gone.pdf" }]);
	const res = await call("/file-download/download?sessionId=s1&seq=7&index=0");
	assert.equal(res.status, 404);
	assert.match(String(res.body), /unavailable/);
});

test("ignores file records without a usable path", async () => {
	const { call } = mount([{ path: "" }, { description: "no path" }]);
	for (const index of [0, 1, 2]) {
		const res = await call(`/file-download/download?sessionId=s1&seq=7&index=${index}`);
		assert.equal(res.status, 404, `index ${index}`);
	}
});
