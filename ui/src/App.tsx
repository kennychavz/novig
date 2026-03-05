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
        {/* Scoreboard placeholder */}
        <div className="col-span-2 backdrop-blur-xl rounded-2xl p-4 border shadow-2xl bg-card/80 border-border/30">
          <div className="text-center text-muted-foreground">Scoreboard</div>
        </div>

        {/* Pitch placeholder */}
        <div className="backdrop-blur-xl rounded-2xl p-4 border shadow-2xl bg-card/80 border-border/30 flex items-center justify-center">
          <div className="text-muted-foreground">Pitch</div>
        </div>

        {/* Order Book placeholder */}
        <div className="backdrop-blur-xl rounded-2xl p-4 border shadow-2xl bg-card/80 border-border/30">
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">Order Book</h2>
          <div className="text-muted-foreground text-xs">No data</div>
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
