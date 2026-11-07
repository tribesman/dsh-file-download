import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

/**
 * Execute the lazy-CJS bundle the way the shell does: the script only
 * registers a factory, materialization happens on first import.
 */
function load() {
	let registration;
	const styles = [];
	const react = { createElement: (type, props, ...children) => ({ type, props, children }) };
	const document = {
		head: {
			querySelector: (selector) => styles.find((style) => selector.includes(style.dataset.pluginCss)) ?? null
		},
		createElement: (tag) => {
			const element = { tag, dataset: {}, textContent: "" };
			return element;
		}
	};
	const sandbox = {
		window: { __ModuleLoader__: { load: (value) => { registration = value; } } },
		document,
		location: { origin: "http://127.0.0.1:3079" },
		URL,
		URLSearchParams,
		console
	};
	vm.createContext(sandbox);
	vm.runInContext(SOURCE, sandbox);
	assert.ok(registration, "the bundle registers a factory");
	const exports = registration.factory((specifier) => {
		if (specifier === "react") return react;
		throw new Error(`unexpected require: ${specifier}`);
	});
	// Capture the stylesheet as the real DOM would hold it.
	document.head.appendChild = (style) => styles.push(style);
	return { registration, exports, styles, react };
}

/** Mount the bundle and return the component registered into the card seat. */
function seat() {
	const loaded = load();
	const registrations = [];
	const ctx = {
		slots: {
			inject: (name, run) => run(),
			register: (definition, component) => registrations.push({ definition, component })
		},
		locale: { register: () => {} }
	};
	loaded.exports.apply(ctx);
	assert.equal(registrations.length, 1);
	return { ...registrations[0], ...loaded };
}

test("registers exactly one action into the delivered-file card seat", () => {
	const { definition, component, exports } = seat();
	assert.equal(definition.name, "deliverables.file.actions");
	assert.equal(definition.id, "file-download");
	assert.equal(typeof component, "function");
	// The bundle runs in its own VM realm: copy the array before asserting.
	assert.deepEqual([...exports.inject], ["slots", "locale"]);
});

test("builds an absolute download link from the card's relative route", () => {
	const { component } = seat();
	const element = component({ actionUrl: "api/present.open?sessionId=abc&seq=180&index=0" });
	assert.equal(element.type, "a");
	assert.equal(element.props.href, "/file-download/download?sessionId=abc&seq=180&index=0");
	assert.equal(element.props["data-dsh-file-download"], "true");
	assert.equal(element.props["aria-label"], "Скачать");
});

test("keeps only the three coordinates the host route needs", () => {
	const { component } = seat();
	const element = component({ actionUrl: "/api/present.open?sessionId=abc&seq=7&index=2&action=open&application=x" });
	assert.equal(element.props.href, "/file-download/download?sessionId=abc&seq=7&index=2");
});

test("accepts an absolute action URL", () => {
	const { component } = seat();
	const element = component({ actionUrl: "https://host.example/api/present.open?sessionId=abc&seq=1&index=0" });
	assert.equal(element.props.href, "/file-download/download?sessionId=abc&seq=1&index=0");
});

test("renders nothing when the card carries no coordinates", () => {
	const { component } = seat();
	assert.equal(component({}), null);
	assert.equal(component({ actionUrl: "" }), null);
	assert.equal(component({ actionUrl: "/api/present.open?seq=1&index=0" }), null);
	assert.equal(component({ actionUrl: "not a url" }), null);
});

test("never throws into the card, even on a hostile props object", () => {
	const { component } = seat();
	const hostile = { get actionUrl() { throw new Error("boom"); } };
	assert.equal(component(hostile), null);
	assert.equal(component(null), null);
});

test("injects its stylesheet once", () => {
	const { component, styles } = seat();
	component({ actionUrl: "/api/present.open?sessionId=a&seq=1&index=0" });
	component({ actionUrl: "/api/present.open?sessionId=b&seq=2&index=0" });
	assert.equal(styles.length, 1);
	assert.equal(styles[0].dataset.pluginCss, "dsh-plugin-file-download");
	assert.match(styles[0].textContent, /a\.dsh-file-download/);
});

test("falls back to a readable label when the locale does not answer", () => {
	const { component } = seat();
	const label = (t) => component({ actionUrl: "/api/present.open?sessionId=a&seq=1&index=0", t }).props["aria-label"];
	assert.equal(label(() => "Download"), "Download");
	assert.equal(label(() => "label"), "Скачать");
	assert.equal(label(() => ""), "Скачать");
	assert.equal(label(() => { throw new Error("no namespace"); }), "Скачать");
});
