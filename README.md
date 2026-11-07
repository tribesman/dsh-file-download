# @dsh-plugins/file-download

A **Download** button on every delivered-file card in the [DSH](https://github.com/deepseek-ai/deepseek-harness)
web surface, streaming the original bytes — PDF, image, archive, whatever was
delivered — through an authenticated Host route.

## Why

The stock card offers *Preview in sidebar* and *Open on the Host desktop*.
Neither reaches a phone: there is no command line, and the preview iframe is
sandboxed without `allow-downloads`. The bytes already live on the Host, but
there was no way to pull them into the browser. This plugin adds that missing
verb.

## How it works

**Host half** — one GET route:

```
GET /file-download/download?sessionId=…&seq=…&index=…
```

Those coordinates are the ones the card already carries in its `actionUrl` (the
same triple `/api/present.open` takes). The route resolves the declared path
from the recorded `deliverables/presented` event through `sessionQuery`, then
reads the bytes through `workspaceFiles`, which confines them to that Session's
workspace root. **The browser never names a filesystem path**, so the route
cannot be pointed at an arbitrary file.

The response is the original bytes with

```
content-disposition: attachment; filename="…"; filename*=UTF-8''…
```

so a plain navigation becomes a browser download — no JavaScript touches the
payload, which is what makes it work on a phone.

**Browser half** — registers one compact action into the stock
`deliverables.file.actions` seat, which the deliverable card renders inside its
pointer-events-enabled actions container. It reads `sessionId`, `seq` and
`index` out of the card's relative `actionUrl` and rebuilds an absolute link on
the download route.

The seat is decoration only: a card whose coordinates do not parse renders
without the button, and a throw inside the component is swallowed, so the stock
card can never break because of this plugin.

## Install

The package declares `dsh.client` and **no** bundle patch, so it is not a
profile bundle: it needs its own Loader row in the profile's patch layer
(`$DSH_HOME/profiles/web/cordis.patch.yml`).

```yaml
- insert:
    - id: file-download
      name: '@dsh-plugins/file-download'
```

Then add the package to the profile, in one of three ways:

```bash
# 1. straight from the git remote (installs into the profile's node_modules)
dsh plugin --profile web add "git+https://github.com/tribesman/dsh-file-download.git"

# 2. from npm, once published
dsh plugin --profile web add @dsh-plugins/file-download

# 3. from a checkout, for development (symlink, no copy)
ln -s /path/to/dsh-file-download \
  "$DSH_HOME/profiles/web/node_modules/@dsh-plugins/file-download"
```

Restart the harness once so the new Loader row is composed (`dsh web`). On a
live instance an *inserted* row mounts without a restart, but a *removed* row
keeps its host half running until the next start — plan uninstalls accordingly.

Check it works: the card of any delivered file grows a **Скачать / Download**
button, and

```bash
curl -sI "http://127.0.0.1:3079/file-download/download?sessionId=…&seq=…&index=0"
```

answers `200` with `content-disposition: attachment`.

## Security notes

- The route is registered on the raw web server rather than the
  `connection.fetch` fence, so it does not require the shell's session cookie.
  On a loopback-only harness that keeps downloads working with a stale cookie;
  it also means any local process can read files a Session **declared**, by
  guessing coordinates. Cross-origin pages cannot read the response (no CORS
  headers), and no request can name a path outside the Session workspace.
- Only files an actual `present` call delivered are reachable — not arbitrary
  workspace paths.

## Development

```bash
npm test        # node --test: 20 cases over the host handler and the bundle
npm run check   # syntax gate on both halves
```

The tests drive the host handler through stub `sessionQuery`/`workspaceFiles`
services and execute the browser bundle in a VM with a stub React and DOM, so
they need neither a harness nor a browser.

## Files

| Path | Role |
| --- | --- |
| `lib/index.js` | Host half: the download route |
| `lib/client.js` | Browser half: lazy-CJS bundle, the card action |
| `test/host.test.mjs` | Route behaviour: statuses, headers, filename encoding |
| `test/client.test.mjs` | Seat contract, link building, failure tolerance |

## License

MIT.
