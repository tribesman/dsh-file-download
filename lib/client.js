/**
 * @dsh-plugins/file-download — browser half.
 *
 * Hand-written lazy-CJS bundle in the DSH client-module factory form: running
 * the script only REGISTERS the factory; everything below runs at
 * materialization. Only the shell-seeded baseline (`react`) is required.
 *
 * The button mounts into the stock `deliverables.file.actions` seat, which the
 * deliverable card renders inside `.nyYjTG_actions` (pointer-events on, while
 * the rest of the card body is pointer-events none and covered by the preview
 * overlay). The card hands the seat its authenticated `actionUrl` — the
 * presented-open route carrying `sessionId`, `seq` and `index` — and this
 * plugin only rewrites it onto its own download route, so the browser never
 * names a path.
 *
 * Because the response is an attachment, no JavaScript touches the payload:
 * the anchor is a plain navigation that becomes a browser download, which also
 * works on a phone where there is no way to run a command.
 */
window.__ModuleLoader__.load({
	id: "@dsh-plugins/file-download",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");

		/** Locale namespace owned by this plugin. */
		const NS = "file-download";
		/** Host route registered by this package's server half. */
		const DOWNLOAD_PATH = "/file-download/download";
		/** Stock route whose query the card already carries. */
		const PRESENT_OPEN_PATH = "/api/present.open";
		/** Untranslated fallback: the card is readable in any locale. */
		const FALLBACK_LABEL = "Скачать";

		//#region styles
		const CSS_ID = "dsh-plugin-file-download";
		const CSS =
			"a.dsh-file-download{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 10px;" +
			"box-sizing:border-box;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1,#e0e0e0);" +
			"background:var(--dsw-static-neutral-00,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);" +
			"font:inherit;font-size:12px;font-weight:500;line-height:1;text-decoration:none;white-space:nowrap;" +
			"cursor:pointer;transition:background-color .12s;flex:none}" +
			"a.dsh-file-download:hover{background:var(--dsw-static-neutral-100,#f2f2f2)}" +
			"a.dsh-file-download:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#3b82f6);outline-offset:1px}" +
			"a.dsh-file-download>svg{flex:none;width:14px;height:14px;display:block}" +
			"body[data-ds-dark-theme] a.dsh-file-download{background:var(--dsw-static-neutral-800,#2a2a2a);" +
			"border-color:var(--dsw-alias-border-l1,#3a3a3a);color:var(--dsw-alias-label-primary,#f5f5f5)}" +
			"body[data-ds-dark-theme] a.dsh-file-download:hover{background:var(--dsw-static-neutral-700,#333)}" +
			"@container (max-width:420px){a.dsh-file-download{width:28px;padding:0}a.dsh-file-download>span{display:none}}";

		/** Inject the stylesheet once per document, tagged so the shell can drop it. */
		function installStyles() {
			try {
				if (typeof document === "undefined") return;
				if (document.head.querySelector(`style[data-plugin-css="${CSS_ID}"]`) !== null) return;
				const style = document.createElement("style");
				style.dataset.pluginCss = CSS_ID;
				style.textContent = CSS;
				document.head.appendChild(style);
			} catch {
				/* A missing stylesheet never blocks the download itself. */
			}
		}
		//#endregion

		//#region download link
		/**
		 * Rebuild the download URL from the coordinates the card already carries.
		 *
		 * The stock card hands the seat `${PRESENT_OPEN_ROUTE}?sessionId=…&seq=…&index=…`,
		 * a *relative* URL; resolving it against the page would land under a shell
		 * subpath, so only the three query coordinates are read and the path is
		 * rebuilt as an absolute one. Coordinates are the contract of that route.
		 *
		 * @param actionUrl - authenticated route the card passed to its actions seat.
		 * @returns the download URL, or null when the card carried no coordinates.
		 */
		function downloadUrl(actionUrl) {
			if (typeof actionUrl !== "string" || actionUrl === "") return null;
			let url;
			try {
				url = new URL(actionUrl, typeof location === "undefined" ? "http://dsh.invalid/" : location.origin);
			} catch {
				return null;
			}
			const sessionId = url.searchParams.get("sessionId");
			const seq = url.searchParams.get("seq");
			const index = url.searchParams.get("index");
			if (!sessionId || !seq || !index) return null;
			const params = new URLSearchParams({
				sessionId,
				seq,
				index
			});
			return `${DOWNLOAD_PATH}?${params.toString()}`;
		}

		/** Tray-and-arrow download glyph, drawn here so the bundle stays dependency-free. */
		function DownloadIcon() {
			return react.createElement("svg", {
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.6,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				focusable: "false"
			}, react.createElement("path", { d: "M8 2v7.5" }), react.createElement("path", { d: "M4.8 6.6 8 9.8l3.2-3.2" }), react.createElement("path", { d: "M2.8 11.6v1.4a.8.8 0 0 0 .8.8h8.8a.8.8 0 0 0 .8-.8v-1.4" }));
		}

		/**
		 * The seat's translator, degraded to the fallback label if the locale
		 * namespace did not bind (a missing string must not hide the button).
		 * @param t - translator handed down by the slot.
		 * @returns the visible label.
		 */
		function labelOf(t) {
			if (typeof t !== "function") return FALLBACK_LABEL;
			try {
				const value = t("label");
				return typeof value === "string" && value !== "" && value !== "label" ? value : FALLBACK_LABEL;
			} catch {
				return FALLBACK_LABEL;
			}
		}

		/**
		 * One compact Download control for a delivered file.
		 * @param props - the actions seat props handed down by the deliverable card.
		 * @returns the anchor, or null when the card's coordinates are unusable.
		 */
		function DownloadAction(props) {
			try {
				const href = downloadUrl(props?.actionUrl);
				if (href === null) return null;
				installStyles();
				const label = labelOf(props?.t);
				return react.createElement("a", {
					className: "dsh-file-download",
					href,
					title: label,
					"aria-label": label,
					"data-dsh-file-download": "true"
				}, react.createElement(DownloadIcon, null), react.createElement("span", null, label));
			} catch {
				/* A card must never break because a download link could not be built. */
				return null;
			}
		}
		//#endregion

		const inject = ["slots", "locale"];

		/**
		 * Mount the action into the delivered-file card seat.
		 * @param ctx - client context with the slot registry and the locale service.
		 */
		function apply(ctx) {
			const locale = ctx.locale;
			if (locale !== undefined && locale !== null) {
				try {
					locale.register(NS, {
						en: { label: "Download" },
						zh: { label: "下载" },
						ru: { label: "Скачать" }
					});
				} catch {
					/* Translation is cosmetic; the fallback label stays. */
				}
			}
			ctx.slots.inject("deliverables.file.actions", () => ctx.slots.register({
				name: "deliverables.file.actions",
				id: "file-download",
				order: 50,
				locale: NS
			}, DownloadAction));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
