export const BASE_DELAY_MS = 1_000
export const MAX_DELAY_MS = 30_000
export const MAX_RECONNECT_ATTEMPTS = 10

// Client-side app-level heartbeat cadence. The server answers native WS ping
// frames transparently at the browser layer (WHATWG gives JS no way to send
// those itself), so the client's own liveness check has to be a JSON
// heartbeat the server replies to explicitly.
export const CLIENT_PING_INTERVAL_MS = 20_000
export const CLIENT_PONG_TIMEOUT_MS = 10_000

export function nextBackoffDelay(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS)
}

export function isPongMessage(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as {type?: unknown}).type === 'pong'
}
