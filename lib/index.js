/**
 * @dsh-plugins/file-download — host half.
 *
 * One authenticated GET route turns a delivered file card into a real download:
 *
 *   GET /file-download/download?sessionId=…&seq=…&index=…
 *
 * The coordinates are the same ones the stock card already carries in its
 * `actionUrl` (the presented-open route): the Session id, the seq of the event
 * holding the `deliverables/presented` target, and the index of the file inside
 * that target. The route resolves the path from the recorded Session event, so
 * the browser never names a filesystem path of its own — the file is whatever
 * the Session actually declared, read through the workspace-files service that
 * confines it to that Session's workspace root.
 *
 * The response is the original bytes with `Content-Disposition: attachment`, so
 * a tap (or a plain `<a href>`) becomes a browser download on desktop and on a
 * phone without any JavaScript.
 */

const ROUTE_PREFIX = "/file-download";

/** Extensions worth naming explicitly; anything else streams as octet-stream. */
const MIME = {
	".pdf": "application/pdf",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
	".md": "text/markdown; charset=utf-8",
	".csv": "text/csv; charset=utf-8",
	".tsv": "text/tab-separated-values; charset=utf-8",
	".json": "application/json",
	".yaml": "application/yaml",
	".yml": "application/yaml",
	".xml": "application/xml",
	".html": "text/html; charset=utf-8",
	".zip": "application/zip",
	".gz": "application/gzip",
	".tar": "application/x-tar",
	".doc": "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xls": "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".ppt": "application/vnd.ms-powerpoint",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".odt": "application/vnd.oasis.opendocument.text",
	".ods": "application/vnd.oasis.opendocument.spreadsheet",
	".mp3": "audio/mpeg",
	".mp4": "video/mp4",
	".wav": "audio/wav",
	".webm": "video/webm",
};

const NUMERIC = /^\d+$/;

/** Parse one non-negative integer coordinate, or undefined. */
function coordinate(value) {
	return value !== null && NUMERIC.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
}

/** One header-safe ASCII rendition of a possibly-Cyrillic file name. */
function asciiFallback(name) {
	const cleaned = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_").trim();
	return cleaned === "" ? "download" : cleaned;
}

/** `Content-Disposition` naming the file for both ASCII-only and RFC 5987 clients. */
function disposition(name) {
	return `attachment; filename="${asciiFallback(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Plain-text refusal; the browser shows it instead of a broken download. */
function refuse(res, status, message) {
	res.writeHead(status, {
		"content-type": "text/plain; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(message);
}

/** The presented-file record a card was drawn for, or undefined. */
function presentedFileOf(target, index) {
	const data = target?.type === "deliverables/presented" ? target.data : undefined;
	if (data === null || typeof data !== "object" || !Array.isArray(data.files)) return undefined;
	const file = data.files[index];
	if (file === null || typeof file !== "object") return undefined;
	if (typeof file.path !== "string" || file.path === "") return undefined;
	return file;
}

/**
 * Wire the download route to the harness services.
 * @param ctx - Host context with the Session, workspace-file and Web server services.
 */
export function apply(ctx) {
	const route = ctx.webServer.register({
		kind: "prefix",
		path: ROUTE_PREFIX,
		handler: (req, res) => {
			void handle(ctx, req, res).catch((error) => {
				if (!res.headersSent && !res.writableEnded) refuse(res, 500, `download failed: ${error?.message ?? "unknown error"}`);
				else if (!res.writableEnded) res.end();
			});
		},
	});
	ctx.on("dispose", () => {
		route();
	});
}

/** Answer one download request from end to end. */
async function handle(ctx, req, res) {
	if (req.method !== "GET" && req.method !== "HEAD") return refuse(res, 405, "Use GET.");
	const url = new URL(req.url ?? "/", "http://dsh.invalid");
	if (url.pathname !== "/file-download/download") return refuse(res, 404, "Unknown route.");

	const query = url.searchParams;
	const sessionId = query.get("sessionId");
	const seq = coordinate(query.get("seq"));
	const index = coordinate(query.get("index"));
	if (!sessionId || seq === undefined || index === undefined) return refuse(res, 400, "Invalid file coordinates.");

	const signal = AbortSignal.timeout(30_000);
	let read;
	try {
		read = await ctx.sessionQuery.readEvent({
			sessionId,
			seq,
			before: 0,
			after: 0
		}, signal);
	} catch (error) {
		return refuse(res, 404, `Session result unavailable: ${error?.message ?? "unknown"}`);
	}
	const file = presentedFileOf(read?.target, index);
	if (file === undefined) return refuse(res, 404, "This file was not delivered by that turn.");

	const scope = {
		sessionId,
		workspaceRoot: read.session?.cwd ?? ctx.sandboxPolicy.workspaceRoot
	};
	let bytes;
	try {
		bytes = await ctx.workspaceFiles.readBytes(scope, file.path, {}, signal);
	} catch (error) {
		return refuse(res, 404, `File unavailable: ${error?.message ?? "unknown"}`);
	}

	const name = file.path.split(/[\\/]/).pop() || "download";
	const dot = name.lastIndexOf(".");
	const type = dot > 0 ? MIME[name.slice(dot).toLowerCase()] : undefined;
	const data = Buffer.from(bytes.data);
	res.writeHead(200, {
		"content-type": type ?? "application/octet-stream",
		"content-disposition": disposition(name),
		"content-length": String(data.byteLength),
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	if (req.method === "HEAD") {
		res.end();
		return;
	}
	res.end(data);
}

export const inject = ["webServer", "sessionQuery", "workspaceFiles", "sandboxPolicy"];
