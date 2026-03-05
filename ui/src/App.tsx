import { useState, useEffect, useRef } from 'react'

// ─── Types ───────────────────────────────────────────────────────────

export interface WorldState {
  replica_id: string
  lag_ms: number
  game: { x: number; y: number; score: string; half: number; clock: number }
  book: {
    bids: [number, number][]
    asks: [number, number][]
  }
}

interface ChartPoint {
  ts: number
  mid: number
  lag: number
}

// ─── Constants ───────────────────────────────────────────────────────

const MAX_HISTORY = 50

// ─── Helpers ─────────────────────────────────────────────────────────

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ─── WebSocket Hook ──────────────────────────────────────────────────

function useReplicaSocket(url: string) {
  const [state, setState] = useState<WorldState | null>(null)
  const [connected, setConnected] = useState(false)
  const [chartData, setChartData] = useState<ChartPoint[]>([])
  const historyRef = useRef<ChartPoint[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const backoffRef = useRef(1000)

  useEffect(() => {
    historyRef.current = []
    setChartData([])
    setState(null)
    backoffRef.current = 1000

    function connect() {
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        backoffRef.current = 1000
      }

      ws.onmessage = (event) => {
        const data: WorldState = JSON.parse(event.data)
        setState(data)

        const mid =
          data.book.bids.length > 0 && data.book.asks.length > 0
            ? (data.book.bids[0][0] + data.book.asks[0][0]) / 2
            : 0
        historyRef.current = [
          ...historyRef.current.slice(-(MAX_HISTORY - 1)),
          { ts: data.game.clock, mid, lag: data.lag_ms },
        ]
        setChartData([...historyRef.current])
      }

      ws.onclose = () => {
        setConnected(false)
        const delay = backoffRef.current
        backoffRef.current = Math.min(backoffRef.current * 2, 10000)
        setTimeout(connect, delay)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [url])

  return { state, connected, chartData }
}

// ─── Sub-Components ──────────────────────────────────────────────────

export function Scoreboard({ state }: { state: WorldState }) {
  return (
    <div className="flex items-center justify-center gap-6">
      <span className="text-4xl font-bold font-mono tracking-wider">
        {state.game.score}
      </span>
      <div className="flex flex-col items-center text-muted-foreground text-sm">
        <span>{state.game.half === 1 ? '1st Half' : '2nd Half'}</span>
        <span className="font-mono text-foreground text-lg">
          {formatClock(state.game.clock)}
        </span>
      </div>
    </div>
  )
}

export function Pitch({ state }: { state: WorldState }) {
  return (
    <svg viewBox="0 0 100 50" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      {/* Field */}
      <rect x="0" y="0" width="100" height="50" fill="#1a6b3c" rx="2" />
      {/* Center line */}
      <line x1="50" y1="0" x2="50" y2="50" stroke="rgba(255,255,255,0.3)" strokeWidth="0.3" />
      {/* Center circle */}
      <circle cx="50" cy="25" r="8" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.3" />
      <circle cx="50" cy="25" r="0.5" fill="rgba(255,255,255,0.4)" />
      {/* Goal zones */}
      <rect x="0" y="17" width="5" height="16" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.3)" strokeWidth="0.3" />
      <rect x="95" y="17" width="5" height="16" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.3)" strokeWidth="0.3" />
      {/* Penalty areas */}
      <rect x="0" y="12" width="14" height="26" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="0.3" />
      <rect x="86" y="12" width="14" height="26" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="0.3" />
      {/* Ball */}
      <circle
        cx={state.game.x}
        cy={state.game.y}
        r="1.5"
        fill="white"
        stroke="rgba(0,0,0,0.3)"
        strokeWidth="0.3"
      />
    </svg>
  )
}

export function OrderBook({ state }: { state: WorldState }) {
  const { bids, asks } = state.book
  const maxSize = Math.max(
    ...bids.map((b) => b[1]),
    ...asks.map((a) => a[1]),
    1,
  )
  const spread =
    asks.length > 0 && bids.length > 0
      ? (asks[0][0] - bids[0][0]).toFixed(2)
      : '—'
  const mid =
    asks.length > 0 && bids.length > 0
      ? ((asks[0][0] + bids[0][0]) / 2).toFixed(2)
      : '—'

  return (
    <div>
      <div className="text-xs text-muted-foreground mb-2 flex justify-between">
        <span>Spread: {spread}</span>
        <span>Mid: {mid}</span>
      </div>
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left pb-1">Bid Size</th>
            <th className="text-right pb-1">Bid</th>
            <th className="text-left pb-1 pl-3">Ask</th>
            <th className="text-right pb-1">Ask Size</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 5 }).map((_, i) => {
            const bid = bids[i]
            const ask = asks[i]
            return (
              <tr key={i} className="relative h-6">
                <td className="relative text-left" colSpan={2}>
                  <div className="relative flex justify-between px-1">
                    <div
                      className="absolute inset-y-0 right-0 bg-pos/20 rounded-sm"
                      style={{ width: bid ? `${(bid[1] / maxSize) * 100}%` : '0%' }}
                    />
                    <span className="relative z-10">{bid ? bid[1] : ''}</span>
                    <span className="relative z-10 text-pos">{bid ? bid[0].toFixed(2) : ''}</span>
                  </div>
                </td>
                <td className="relative text-right" colSpan={2}>
                  <div className="relative flex justify-between px-1">
                    <div
                      className="absolute inset-y-0 left-0 bg-neg/20 rounded-sm"
                      style={{ width: ask ? `${(ask[1] / maxSize) * 100}%` : '0%' }}
                    />
                    <span className="relative z-10 text-neg">{ask ? ask[0].toFixed(2) : ''}</span>
                    <span className="relative z-10">{ask ? ask[1] : ''}</span>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main App ────────────────────────────────────────────────────────

export default function App() {
  const [wsUrl, setWsUrl] = useState('ws://localhost:8001/ws')
  const { state, connected, chartData: _chartData } = useReplicaSocket(wsUrl)

  void _chartData
  void setWsUrl

  return (
    <div className="min-h-screen p-3 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-primary">Novig</h1>
        <span className="text-sm text-muted-foreground">
          {connected ? `Connected — ${state?.replica_id ?? ''}` : 'Disconnected'}
        </span>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-[1fr_280px] grid-rows-[auto_1fr_auto] gap-3 flex-1">
        {/* Scoreboard */}
        <div className="col-span-2 backdrop-blur-xl rounded-2xl p-4 border shadow-2xl bg-card/80 border-border/30">
          {state ? (
            <Scoreboard state={state} />
          ) : (
            <div className="text-center text-muted-foreground">No data</div>
          )}
        </div>

        {/* Pitch */}
        <div className="backdrop-blur-xl rounded-2xl p-4 border shadow-2xl bg-card/80 border-border/30 flex items-center justify-center">
          {state ? (
            <Pitch state={state} />
          ) : (
            <div className="text-muted-foreground">Waiting for connection...</div>
          )}
        </div>

        {/* Order Book */}
        <div className="backdrop-blur-xl rounded-2xl p-4 border shadow-2xl bg-card/80 border-border/30">
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">Order Book</h2>
          {state ? (
            <OrderBook state={state} />
          ) : (
            <div className="text-muted-foreground text-xs">No data</div>
          )}
        </div>

        {/* Chart placeholder */}
        <div className="backdrop-blur-xl rounded-2xl p-4 border shadow-2xl bg-card/80 border-border/30">
          <div className="text-muted-foreground text-xs">Mid-Price Chart</div>
        </div>

        {/* Controls placeholder */}
        <div className="backdrop-blur-xl rounded-2xl p-4 border shadow-2xl bg-card/80 border-border/30">
          <div className="text-muted-foreground text-xs">Controls</div>
        </div>
      </div>
    </div>
  )
}
