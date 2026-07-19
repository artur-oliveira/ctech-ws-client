# @aoctech/ws-client

[![CI](https://github.com/artur-oliveira/ctech-ws-client/actions/workflows/ci.yml/badge.svg)](https://github.com/artur-oliveira/ctech-ws-client/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@aoctech/ws-client)](https://www.npmjs.com/package/@aoctech/ws-client)

Resilient WebSocket React hook shared across CTech apps: app-level heartbeat, backoff reconnect,
and immediate reconnect on a token refresh.

> Repo name is `ctech-ws-client` on GitHub; published to npm as `@aoctech/ws-client`.
> Searching by either name should land here.

## Why this exists

`ctech-dfe` and `ctech-wallet` each carried their own byte-identical copy of the same
`useWebSocket` hook. Neither side verified its own ping/pong: the server sent an app-level JSON
ping every 30s and never checked for a reply, and the client replied but the server never noticed
if it didn't — so a half-open connection (a server restart, a dropped TCP reset somewhere in the
proxy chain) left the UI stuck showing "connected" indefinitely. A silent background token refresh
also never reconnected the socket, so it could keep sending a now-stale JWT until the connection
happened to drop for some other reason.

This package is the single implementation. The server side of the fix (native WS ping/pong control
frames) lives in each app's own `ws.go` — a browser can't send those itself (see below) — but the
client-side heartbeat, backoff, and reconnect-on-token-change logic is here, once.

## Install

```bash
npm install @aoctech/ws-client
```

## Usage

```tsx
import { useWebSocket } from "@aoctech/ws-client";
import { subscribeAccessToken } from "@/lib/api/client";

const { status } = useWebSocket({
  url: wsUrl, // null disables the connection
  onMessage: (data) => { /* handle a parsed JSON message */ },
  enabled: !!wsUrl,
  authToken: token,
  // Reconnects immediately (no backoff) when a new token comes in — e.g. a
  // silent OAuth refresh. Optional; omit if the app has no such notifier.
  subscribeToken: subscribeAccessToken,
});

// status: 'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error'
```

## How the heartbeat works

A browser's WebSocket API gives JavaScript no way to send a native ping control frame — only the
browser itself answers a server-sent one, transparently, per RFC 6455. So the two directions use
different mechanisms:

- **Server → client:** the server sends a native WS ping periodically and enforces a read deadline
  via `SetPongHandler`. The browser answers it automatically; this hook has no code for it at all.
- **Client → server:** every `CLIENT_PING_INTERVAL_MS` (20s) the hook sends an app-level
  `{"type":"ping"}` text frame and arms a `CLIENT_PONG_TIMEOUT_MS` (10s) timer. If the server's own
  `{"type":"pong"}` reply doesn't arrive in time, the hook closes the socket — the existing
  backoff-reconnect path takes it from there. The server must reply to this explicitly; it's not
  automatic like the native direction.

## API

- `useWebSocket(options): { status, attempt, send, reconnect }` — see Usage above.
- `status: WSStatus` — `disconnected` | `connecting` | `reconnecting` | `connected` | `error`.
- `attempt: number` — reconnect attempts since the last successful open (capped at
  `MAX_RECONNECT_ATTEMPTS`). Reset to `0` on open.
- `send(value: object): boolean` — sends a JSON-encoded frame if the socket is open; returns
  `false` (and is a no-op) when not connected. Use it for app frames like `act`, `chat`, `ready`.
- `reconnect(): void` — forces an immediate reconnect with no backoff, the same path a token
  refresh takes. Wire a "Reconnect now" button to it.
- `onOpen?: () => void` — option fired once after the socket opens and the auth token frame is
  sent. Put a post-auth follow-up frame here (e.g. a ping that makes the server run a reconnect
  command) instead of racing the open event.
- `type WSStatus = 'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error'`
- `nextBackoffDelay(attempt)`, `isPongMessage(data)` — the pure helpers behind the hook, exported
  standalone for testing.
- `BASE_DELAY_MS`, `MAX_DELAY_MS`, `MAX_RECONNECT_ATTEMPTS`, `CLIENT_PING_INTERVAL_MS`,
  `CLIENT_PONG_TIMEOUT_MS` — the tuning constants above.

## Development

```bash
npm run build   # tsc -> dist/
npm test        # build + node's built-in test runner
```

The hook itself has no test in this repo (rendering a hook needs either a DOM/RTL harness this repo
has no other use for, or `react-test-renderer`, which React 19 deprecates). Its behavior is tested
in the consuming apps instead, using their existing Vitest+RTL setups — see
`ctech-dfe/ui/src/__tests__/lib/useRealtimeUpdates.test.tsx`.

## Releasing

`publish.yml` only fires on a published GitHub Release — a push to `main` alone never publishes
(it only runs `ci.yml`, which tests). Publishing uses npm's OIDC trusted publishing, so there's no
`NPM_TOKEN` secret to manage; provenance is generated automatically.

```bash
# 1. Bump "version" in package.json, then commit and push as usual
git commit -am "chore: release vX.Y.Z"
git push

# 2. Tag it and push the tag
git tag vX.Y.Z
git push --tags

# 3. Cut the release — this is what actually triggers the publish workflow
gh release create vX.Y.Z --generate-notes
```

## License

MIT
