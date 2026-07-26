'use client'

import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
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
   * Invite/share code bundled into the same first frame as `authToken`
   * (`{"token": ..., "share_code": ...}`), for servers that gate private-room
   * access at the WS upgrade in addition to the JWT. Omitted from the frame
   * when unset.
   */
  shareCode?: string
  /**
   * Subscribes to access-token changes (e.g. a silent OAuth refresh). Each app
   * passes its own client.ts's token pub/sub. On a genuinely new token, the
   * hook closes the current socket and reconnects immediately with no backoff
   * delay — a refresh is a healthy, deliberate event, not a failure.
   */
  subscribeToken?: (cb: (token: string) => void) => () => void
  /**
   * Fired once after the socket opens and the auth token frame is sent. Apps
   * that need a follow-up frame (e.g. a post-auth ping that makes the server
   * run a reconnect/rebind command) put it here instead of racing the open.
   */
  onOpen?: () => void
  /** If set, configures ws.binaryType. Default is undefined (standard string messages). */
  binaryType?: 'arraybuffer' | 'blob'
  /** Optional custom encoder for outgoing messages. Defaults to JSON.stringify. */
  encode?: (value: any) => string | ArrayBuffer | Blob
  /** Optional custom decoder for incoming messages. Defaults to JSON.parse. */
  decode?: (data: any) => any
}

export interface UseWebSocketResult {
  status: WSStatus
  /** Number of reconnect attempts since the last successful open (capped at MAX_RECONNECT_ATTEMPTS). */
  attempt: number
  /** Sends a frame if the socket is open; returns false if not connected. */
  send: (value: any) => boolean
  /** Forces an immediate reconnect with no backoff (same path as a token refresh). */
  reconnect: () => void
}

export function useWebSocket({
  url,
  onMessage,
  enabled = true,
  authToken,
  shareCode,
  subscribeToken,
  onOpen,
  binaryType,
  encode,
  decode,
}: UseWebSocketOptions): UseWebSocketResult {
  const [status, setStatus] = useState<WSStatus>('disconnected')
  const [attempt, setAttempt] = useState(0)
  const onMessageRef = useRef(onMessage)
  const onOpenRef = useRef(onOpen)
  const authTokenRef = useRef(authToken)
  const shareCodeRef = useRef(shareCode)
  const attemptsRef = useRef(0)
  const reconnectNowRef = useRef<(() => void) | null>(null)
  const sendRef = useRef<(value: any) => boolean>(() => false)

  const encodeRef = useRef(encode || ((val: any) => JSON.stringify(val)))
  const decodeRef = useRef(decode || ((data: any) => JSON.parse(data as string)))
  const binaryTypeRef = useRef(binaryType)

  useLayoutEffect(() => {
    onMessageRef.current = onMessage
  })

  useLayoutEffect(() => {
    onOpenRef.current = onOpen
  })

  useLayoutEffect(() => {
    authTokenRef.current = authToken
  })

  useLayoutEffect(() => {
    shareCodeRef.current = shareCode
  })

  useLayoutEffect(() => {
    encodeRef.current = encode || ((val: any) => JSON.stringify(val))
  })

  useLayoutEffect(() => {
    decodeRef.current = decode || ((data: any) => JSON.parse(data as string))
  })

  useLayoutEffect(() => {
    binaryTypeRef.current = binaryType
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
        try {
          sock.send(encodeRef.current({type: 'ping'}))
        } catch {
          // ignore
        }
        pongTimer = setTimeout(() => sock.close(), CLIENT_PONG_TIMEOUT_MS)
      }, CLIENT_PING_INTERVAL_MS)
    }

    function connect() {
      if (cancelled) return

      setStatus(attemptsRef.current === 0 ? 'connecting' : 'reconnecting')
      const sock = new WebSocket(url!)
      ws = sock

      if (binaryTypeRef.current) {
        sock.binaryType = binaryTypeRef.current
      }

      sock.onopen = () => {
        if (ws !== sock) return
        attemptsRef.current = 0
        setAttempt(0)
        setStatus('connected')
        if (authTokenRef.current) {
          try {
            const frame: Record<string, any> = {token: authTokenRef.current}
            if (shareCodeRef.current) frame.share_code = shareCodeRef.current
            sock.send(encodeRef.current(frame))
          } catch {
            // ignore — server closes the socket if auth is missing
          }
        }
        startHeartbeat(sock)
        onOpenRef.current?.()
      }

      sock.onmessage = (evt) => {
        if (ws !== sock) return
        try {
          const data = decodeRef.current(evt.data)
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
        setAttempt(attemptsRef.current)
        if (attemptsRef.current > MAX_RECONNECT_ATTEMPTS) return

        timer = setTimeout(connect, nextBackoffDelay(attemptsRef.current))
      }
    }

    reconnectNowRef.current = () => {
      attemptsRef.current = 0
      setAttempt(0)
      if (timer) clearTimeout(timer)
      const stale = ws
      ws = null // makes the stale socket's onclose guard (ws !== sock) a no-op
      stale?.close()
      connect()
    }

    sendRef.current = (value: any) => {
      if (ws?.readyState !== WebSocket.OPEN) return false
      try {
        ws.send(encodeRef.current(value))
        return true
      } catch {
        return false
      }
    }

    connect()

    return () => {
      cancelled = true
      reconnectNowRef.current = null
      sendRef.current = () => false
      if (timer) clearTimeout(timer)
      clearHeartbeat()
      ws?.close(1000)
      ws = null
    }
  }, [url, enabled])

  const send = useCallback((value: any) => sendRef.current(value), [])
  const reconnect = useCallback(() => reconnectNowRef.current?.(), [])

  return {status, attempt, send, reconnect}
}
