import { useState, useEffect, useRef } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Line,
  Tooltip,
} from 'recharts'

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
const REPLICAS = [
  { id: 'rep-1', port: 8001 },
  { id: 'rep-2', port: 8002 },
]

// ─── Helpers ─────────────────────────────────────────────────────────

export function lagColor(ms: number): string {
  if (ms < 50) return 'hsl(var(--pos))'
  if (ms < 200) return 'hsl(var(--warn))'
  return 'hsl(var(--neg))'
}

export function lagClass(ms: number): string {
  if (ms < 50) return 'text-pos'
  if (ms < 200) return 'text-warn'
  return 'text-neg'
}

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

// ─── Sub-Components (exported for testing) ───────────────────────────

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
      <rect x="0" y="0" width="100" height="50" fill="#1a6b3c" rx="2" />
      <line x1="50" y1="0" x2="50" y2="50" stroke="rgba(255,255,255,0.3)" strokeWidth="0.3" />
      <circle cx="50" cy="25" r="8" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.3" />
      <circle cx="50" cy="25" r="0.5" fill="rgba(255,255,255,0.4)" />
      <rect x="0" y="17" width="5" height="16" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.3)" strokeWidth="0.3" />
      <rect x="95" y="17" width="5" height="16" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.3)" strokeWidth="0.3" />
      <rect x="0" y="12" width="14" height="26" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="0.3" />
      <rect x="86" y="12" width="14" height="26" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="0.3" />
      <circle cx={state.game.x} cy={state.game.y} r="1.5" fill="white" stroke="rgba(0,0,0,0.3)" strokeWidth="0.3" />
    </svg>
  )
}

export function OrderBook({ state }: { state: WorldState }) {
  const { bids, asks } = state.book
  const maxSize = Math.max(...bids.map((b) => b[1]), ...asks.map((a) => a[1]), 1)
  const spread = asks.length > 0 && bids.length > 0 ? (asks[0][0] - bids[0][0]).toFixed(2) : '—'
  const mid = asks.length > 0 && bids.length > 0 ? ((asks[0][0] + bids[0][0]) / 2).toFixed(2) : '—'

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
                    <div className="absolute inset-y-0 right-0 bg-pos/20 rounded-sm" style={{ width: bid ? `${(bid[1] / maxSize) * 100}%` : '0%' }} />
                    <span className="relative z-10">{bid ? bid[1] : ''}</span>
                    <span className="relative z-10 text-pos">{bid ? bid[0].toFixed(2) : ''}</span>
                  </div>
                </td>
                <td className="relative text-right" colSpan={2}>
                  <div className="relative flex justify-between px-1">
                    <div className="absolute inset-y-0 left-0 bg-neg/20 rounded-sm" style={{ width: ask ? `${(ask[1] / maxSize) * 100}%` : '0%' }} />
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

export function Metrics({
  lagMs,
  replicaId,
  connected,
}: {
  lagMs: number
  replicaId: string
  connected: boolean
}) {
  return (
    <div className="flex items-center gap-4 text-sm">
      <span className="font-mono text-muted-foreground">{replicaId}</span>
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">Lag:</span>
        <span data-testid="lag-indicator" className={`font-mono ${lagClass(lagMs)}`}>
          {lagMs.toFixed(0)}ms
        </span>
      </div>
      <span className="text-xs text-muted-foreground">
        {!connected ? 'DISCONNECTED' : lagMs < 50 ? 'HEALTHY' : lagMs < 200 ? 'LAGGING' : 'DISCONNECTED'}
      </span>
    </div>
  )
}

export function Controls({
  onReplicaChange,
  activePort,
}: {
  onReplicaChange: (url: string) => void
  activePort: number
}) {
  const [chaosMs, setChaosMs] = useState(0)

  const handleWake = async (port: number) => {
    try {
      await fetch(`http://localhost:${port}/api/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'wake' }),
      })
    } catch { /* noop */ }
  }

  const handleSleep = async (port: number) => {
    try {
      await fetch(`http://localhost:${port}/api/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sleep' }),
      })
    } catch { /* noop */ }
  }

  const handleChaos = async (port: number, lagMs: number) => {
    setChaosMs(lagMs)
    try {
      await fetch(`http://localhost:${port}/api/chaos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lag_ms: lagMs }),
      })
    } catch { /* noop */ }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {REPLICAS.map((r) => (
          <button
            key={r.id}
            onClick={() => onReplicaChange(`ws://localhost:${r.port}/ws`)}
            className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
              activePort === r.port
                ? 'bg-primary text-white'
                : 'bg-secondary text-muted-foreground hover:bg-grid'
            }`}
          >
            {r.id === 'rep-1' ? 'Replica 1' : 'Replica 2'}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={() => handleWake(activePort)} className="px-3 py-1 rounded text-xs bg-pos/20 text-pos hover:bg-pos/30 transition-colors">Wake</button>
        <button onClick={() => handleSleep(activePort)} className="px-3 py-1 rounded text-xs bg-neg/20 text-neg hover:bg-neg/30 transition-colors">Sleep</button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Chaos:</span>
        <input type="range" min="0" max="10000" step="500" value={chaosMs} onChange={(e) => handleChaos(activePort, Number(e.target.value))} className="flex-1 accent-warn" />
        <span className="text-xs font-mono text-warn w-16 text-right">{chaosMs}ms</span>
      </div>
    </div>
  )
}

// ─── Recharts ────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card/95 backdrop-blur border border-border/50 rounded-lg p-3 shadow-lg">
      <div className="text-xs text-muted-foreground mb-2">{label}</div>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-4">
            <span className="text-xs font-medium text-foreground">{entry.name}</span>
            <span className="text-xs font-mono text-primary">{entry.value?.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MidPriceChart({ data }: { data: ChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 5, right: 20, left: 40, bottom: 24 }}>
        <CartesianGrid strokeDasharray="1 3" stroke="hsl(var(--border))" opacity={0.1} vertical={false} />
        <XAxis dataKey="ts" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(v: number) => formatClock(v)} />
        <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} domain={['auto', 'auto']} />
        <Line type="monotone" dataKey="mid" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} activeDot={{ r: 4, fill: 'hsl(var(--primary))' }} />
        <Tooltip content={<CustomTooltip />} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function LagSparkline({ data, currentLag }: { data: ChartPoint[]; currentLag: number }) {
  const w = 200
  const h = 40
  const strokeColor = lagColor(currentLag)

  if (data.length < 2) return null

  const maxLag = Math.max(...data.map((d) => d.lag), 1)
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - (d.lag / maxLag) * h * 0.9
    return { x, y }
  })
  const path = `M ${points.map((p) => `${p.x},${p.y}`).join(' L ')}`
  const last = points[points.length - 1]

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="lagFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} />
          <stop offset="100%" stopColor="#00000000" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path d={`${path} L ${w},${h} L 0,${h} Z`} fill="url(#lagFill)" opacity={0.3} />
      <path d={path} stroke={strokeColor} strokeWidth={2} fill="none" filter="url(#glow)" />
      <circle cx={last.x} cy={last.y} r={3} fill={strokeColor} />
    </svg>
  )
}

// ─── Main App ────────────────────────────────────────────────────────

export default function App() {
  const [wsUrl, setWsUrl] = useState('ws://localhost:8001/ws')
  const activePort = wsUrl.includes('8002') ? 8002 : 8001
  const { state, connected, chartData } = useReplicaSocket(wsUrl)

  return (
    <div className="min-h-screen p-3 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-primary">Novig</h1>
        {state ? (
          <Metrics lagMs={state.lag_ms} replicaId={state.replica_id} connected={connected} />
        ) : (
          <span className="text-sm text-muted-foreground">{connected ? 'Waiting for data...' : 'Disconnected'}</span>
        )}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-[1fr_280px] grid-rows-[auto_1fr_auto] gap-3 flex-1">
        {/* Scoreboard */}
        <div className="col-span-2 backdrop-blur-xl rounded-2xl p-4 border shadow-2xl bg-card/80 border-border/30">
          {state ? <Scoreboard state={state} /> : <div className="text-center text-muted-foreground">No data</div>}
        </div>

        {/* Pitch */}
        <div className="backdrop-blur-xl rounded-2xl p-4 border shadow-2xl bg-card/80 border-border/30 flex items-center justify-center">
          {state ? <Pitch state={state} /> : <div className="text-muted-foreground">Waiting for connection...</div>}
        </div>

        {/* Order Book */}
        <div className="backdrop-blur-xl rounded-2xl p-4 border shadow-2xl bg-card/80 border-border/30">
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">Order Book</h2>
          {state ? <OrderBook state={state} /> : <div className="text-muted-foreground text-xs">No data</div>}
        </div>

        {/* Chart + Lag sparkline */}
        <div className="backdrop-blur-xl rounded-2xl p-4 border shadow-2xl bg-card/80 border-border/30">
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">Mid-Price</h2>
          <div className="h-40">
            {chartData.length > 1 ? (
              <MidPriceChart data={chartData} />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-xs">Collecting data...</div>
            )}
          </div>
          <div className="mt-3">
            <h3 className="text-xs text-muted-foreground mb-1">Lag</h3>
            <LagSparkline data={chartData} currentLag={state?.lag_ms ?? 0} />
          </div>
        </div>

        {/* Controls */}
        <div className="backdrop-blur-xl rounded-2xl p-4 border shadow-2xl bg-card/80 border-border/30 flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Controls</h2>
          <Controls onReplicaChange={setWsUrl} activePort={activePort} />
        </div>
      </div>
    </div>
  )
}
