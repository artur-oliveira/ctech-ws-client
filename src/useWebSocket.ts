'use client'

import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {
  nextBackoffDelay,
  isPongMessage,
  MAX_RECONNECT_ATTEMPTS,
  CLIENT_PING_INTERVAL_MS,
  CLIENT_PONG_TIMEOUT_MS,
} from './heartbeat.js'

export type WSStatus = 'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error'

export interface UseWebSocketOptions {
  url: string | null
  onMessage: (data: unknown) => void
  enabled?: boolean
  /** JWT sent as the first frame after the upgrade (M3) so it never appears in the URL. */
  authToken?: string
  /**
   * Subscribes to access-token changes (e.g. a silent OAuth refresh). Each app
   * passes its own client.ts's token pub/sub. On a genuinely new token, the
   * hook closes the current socket and reconnects immediately with no backoff
   * delay — a refresh is a healthy, deliberate event, not a failure.
   */
  subscribeToken?: (cb: (token: string) => void) => () => void
}

export function useWebSocket({
  url,
  onMessage,
  enabled = true,
  authToken,
  subscribeToken,
}: UseWebSocketOptions): {status: WSStatus} {
  const [status, setStatus] = useState<WSStatus>('disconnected')
  const attemptsRef = useRef(0)
  const onMessageRef = useRef(onMessage)
  const authTokenRef = useRef(authToken)
  const reconnectNowRef = useRef<(() => void) | null>(null)

  useLayoutEffect(() => {
    onMessageRef.current = onMessage
  })

  useLayoutEffect(() => {
    authTokenRef.current = authToken
  })

  useEffect(() => {
    if (!subscribeToken) return
    return subscribeToken((token) => {
      authTokenRef.current = token
      reconnectNowRef.current?.()
    })
  }, [subscribeToken])

  useEffect(() => {
    if (!url || !enabled) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let pingTimer: ReturnType<typeof setInterval> | null = null
    let pongTimer: ReturnType<typeof setTimeout> | null = null
    let ws: WebSocket | null = null

    function clearHeartbeat() {
      if (pingTimer) clearInterval(pingTimer)
      if (pongTimer) clearTimeout(pongTimer)
      pingTimer = null
      pongTimer = null
    }

    function startHeartbeat(sock: WebSocket) {
      pingTimer = setInterval(() => {
        if (sock.readyState !== WebSocket.OPEN) return
        sock.send(JSON.stringify({type: 'ping'}))
        pongTimer = setTimeout(() => sock.close(), CLIENT_PONG_TIMEOUT_MS)
      }, CLIENT_PING_INTERVAL_MS)
    }

    function connect() {
      if (cancelled) return

      setStatus(attemptsRef.current === 0 ? 'connecting' : 'reconnecting')
      const sock = new WebSocket(url!)
      ws = sock

      sock.onopen = () => {
        if (ws !== sock) return
        attemptsRef.current = 0
        setStatus('connected')
        if (authTokenRef.current) {
          try {
            sock.send(JSON.stringify({token: authTokenRef.current}))
          } catch {
            // ignore — server closes the socket if auth is missing
          }
        }
        startHeartbeat(sock)
      }

      sock.onmessage = (evt) => {
        if (ws !== sock) return
        try {
          const data = JSON.parse(evt.data as string)
          if (isPongMessage(data)) {
            if (pongTimer) clearTimeout(pongTimer)
            return
          }
          onMessageRef.current(data)
        } catch {
          // malformed frame — ignore
        }
      }

      sock.onerror = () => {
        if (ws === sock) setStatus('error')
      }

      sock.onclose = () => {
        // A newer connection (e.g. token-refresh reconnect) already replaced
        // this one — this is a stale close event, ignore it.
        if (ws !== sock) return
        clearHeartbeat()
        ws = null
        if (cancelled) return
        setStatus('disconnected')

        attemptsRef.current++
        if (attemptsRef.current > MAX_RECONNECT_ATTEMPTS) return

        timer = setTimeout(connect, nextBackoffDelay(attemptsRef.current))
      }
    }

    reconnectNowRef.current = () => {
      attemptsRef.current = 0
      if (timer) clearTimeout(timer)
      const stale = ws
      ws = null // makes the stale socket's onclose guard (ws !== sock) a no-op
      stale?.close()
      connect()
    }

    connect()

    return () => {
      cancelled = true
      reconnectNowRef.current = null
      if (timer) clearTimeout(timer)
      clearHeartbeat()
      ws?.close(1000)
      ws = null
    }
  }, [url, enabled])

  return {status}
}
