# AGENTS.md — ctech-ws-client (npm `@aoctech/ws-client`)

**Reuse me, don't fork.** This is the one resilient WebSocket React hook for CTech SPAs (dfe, wallet).
If your app needs a realtime socket, import this — the server side of the fix (native WS
ping/pong control frames) lives in each app's own `ws.go`, but the client heartbeat/backoff/
reconnect-on-token-change logic belongs here, once.

## Import

```ts
import { useWebSocket } from "@aoctech/ws-client";
```

Repo dir is `ctech-ws-client`; npm name is `@aoctech/ws-client`. Peer dep `react >= 18`.

## Public API (anchored to file:line in `src/`)

- `useWebSocket(options)` — `src/useWebSocket.ts:45`.
  - `UseWebSocketOptions` `:14`: `url` (null disables), `onMessage`, `enabled?`, `authToken?`
    (sent as first frame), `subscribeToken?` (token-change notifier → immediate reconnect),
    `onOpen?` (fired after open + auth frame).
  - `UseWebSocketResult` `:35`: `status: WSStatus` `:12`, `attempt` (reconnect count, capped),
    `send(value): boolean` `:174` (no-op/returns false when not open), `reconnect()` `:164` (immediate,
    no backoff).
  - First-frame JWT auth: on open, if `authToken` is set, sends `{"token": <jwt>}` `:118-124`.
  - Heartbeat: app-level `{"type":"ping"}` every 20s, arms a 10s pong timeout, closes on miss
    `:98-104`. (Browser can't send native WS ping; `README.md` explains the two-direction split.)
- Heartbeat helpers/constants — `src/heartbeat.ts`: `nextBackoffDelay` `:12` (exponential, cap 30s),
  `isPongMessage` `:16`, `BASE_DELAY_MS` `:1`, `MAX_DELAY_MS` `:2`, `MAX_RECONNECT_ATTEMPTS` `:3`,
  `CLIENT_PING_INTERVAL_MS` `:9`, `CLIENT_PONG_TIMEOUT_MS` `:10`.
- Re-exports: `src/index.ts:1-2`.

## Caveats

- The hook itself has **no in-repo test** (needs a DOM/RTL harness); behavior is tested in consuming
  apps (`ctech-dfe/ui/.../useRealtimeUpdates.test.tsx`). Don't add a test harness here unless you
  also add react-test-renderer.
- MIT licensed. Publish via npm OIDC trusted publishing on GitHub Release.
