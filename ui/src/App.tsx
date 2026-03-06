import { useState, useEffect, useRef, useCallback } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Line,
  Legend,
  Tooltip,
} from 'recharts'

// ─── Types ───────────────────────────────────────────────────────────

export interface WorldState {
  replica_id: string
  lag_ms: number
  core_mid?: number
  replica_mid?: number
  vol?: number
  game: { x: number; y: number; score: string; half: number; clock: number }
  book: {
    bids: [number, number][]
    asks: [number, number][]
  }
}

interface ChartPoint {
  ts: number
  mid: number
  coreMid: number
  lag: number
  vol: number
}

type StatusLevel = 'HEALTHY' | 'LAGGING' | 'DISCONNECTED'

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

function getStatus(lagMs: number, connected: boolean): StatusLevel {
  if (!connected) return 'DISCONNECTED'
  if (lagMs < 50) return 'HEALTHY'
  return 'LAGGING'
}

function statusDotColor(status: StatusLevel): string {
  if (status === 'HEALTHY') return 'hsl(var(--pos))'
  if (status === 'LAGGING') return 'hsl(var(--warn))'
  return 'hsl(var(--neg))'
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatTime(epochSec: number): string {
  const d = new Date(epochSec * 1000)
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ─── WebSocket Hook ──────────────────────────────────────────────────

function useReplicaSocket(url: string, onLog?: (msg: string) => void) {
  const [state, setState] = useState<WorldState | null>(null)
  const [connected, setConnected] = useState(false)
  const [chartData, setChartData] = useState<ChartPoint[]>([])
  const historyRef = useRef<ChartPoint[]>([])
  const lastClockRef = useRef(0)
  const wsRef = useRef<WebSocket | null>(null)
  const backoffRef = useRef(200)

  const clearHistory = useCallback(() => {
    historyRef.current = []
    setChartData([])
  }, [])

  useEffect(() => {
    backoffRef.current = 200
    let isRetry = false

    function connect() {
      if (isRetry) onLog?.('Attempting reconnect...')
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        backoffRef.current = 200
        isRetry = false
      }

      ws.onmessage = (event) => {
        const data: WorldState = JSON.parse(event.data)
        setState(data)

        // Detect game restart (clock jumped backwards)
        if (data.game.clock < lastClockRef.current - 10) {
          historyRef.current = []
        }
        lastClockRef.current = data.game.clock

        const mid = data.replica_mid ?? (
          data.book.bids.length > 0 && data.book.asks.length > 0
            ? (data.book.bids[0][0] + data.book.asks[0][0]) / 2
            : 0
        )
        const coreMid = data.core_mid ?? mid
        const vol = data.vol ?? 0
        const now = Date.now() / 1000
        historyRef.current = [
          ...historyRef.current.slice(-(MAX_HISTORY - 1)),
          { ts: now, mid, coreMid, lag: data.lag_ms, vol },
        ]
        setChartData([...historyRef.current])
      }

      ws.onclose = () => {
        setConnected(false)
        isRetry = true
        const delay = backoffRef.current
        backoffRef.current = Math.min(backoffRef.current * 2, 3000)
        onLog?.(`Reconnecting in ${delay}ms...`)
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
  }, [url, onLog])

  return { state, connected, chartData, clearHistory }
}

// ─── Sub-Components (exported for testing) ───────────────────────────

export function Scoreboard({ state }: { state: WorldState }) {
  const [home, away] = state.game.score.split('-')
  return (
    <div className="flex items-center justify-center gap-4">
      <span className="text-sm font-semibold text-foreground">CAN</span>
      <span className="text-4xl font-bold font-mono tracking-wider">
        {home}
      </span>
      <div className="flex flex-col items-center text-muted-foreground text-xs">
        <span>{state.game.half === 1 ? '1st Half' : '2nd Half'}</span>
        <span className="font-mono text-foreground text-base">
          {formatClock(state.game.clock)}
        </span>
      </div>
      <span className="text-4xl font-bold font-mono tracking-wider">
        {away}
      </span>
      <span className="text-sm font-semibold text-foreground">USA</span>
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
  if (!bids.length || !asks.length) return null

  const spread = (asks[0][0] - bids[0][0]).toFixed(2)

  // Cumulative depth: bids right-to-left (highest price first), asks left-to-right (lowest price first)
  const bidCum: { price: number; cum: number }[] = []
  let cumB = 0
  for (const [price, size] of bids) {
    cumB += size
    bidCum.push({ price, cum: cumB })
  }

  const askCum: { price: number; cum: number }[] = []
  let cumA = 0
  for (const [price, size] of asks) {
    cumA += size
    askCum.push({ price, cum: cumA })
  }

  const maxCum = Math.max(bidCum[bidCum.length - 1]?.cum ?? 0, askCum[askCum.length - 1]?.cum ?? 0, 1)

  // Split layout: bids fill left half, asks fill right half, thin gap in middle
  const w = 300
  const h = 160
  const pad = { top: 8, bottom: 20, left: 4, right: 4 }
  const gap = 20 // pixels between bid and ask sides
  const halfW = (w - pad.left - pad.right - gap) / 2
  const plotH = h - pad.top - pad.bottom

  // Bid side: worst bid (left edge) to best bid (center-left)
  const bidWorst = bids[bids.length - 1][0]
  const bidBest = bids[0][0]
  const bidRange = Math.max(bidBest - bidWorst, 0.001)
  const pxBid = (price: number) => pad.left + ((price - bidWorst) / bidRange) * halfW

  // Ask side: best ask (center-right) to worst ask (right edge)
  const askBest = asks[0][0]
  const askWorst = asks[asks.length - 1][0]
  const askRange = Math.max(askWorst - askBest, 0.001)
  const pxAsk = (price: number) => pad.left + halfW + gap + ((price - askBest) / askRange) * halfW

  const py = (cum: number) => pad.top + plotH - (cum / maxCum) * plotH

  // Build staircase paths
  // Bids: from worst (left) stepping up to best (right)
  const bidReversed = [...bidCum].reverse()
  let bidPath = `M ${pxBid(bidReversed[0].price)},${py(0)}`
  for (const { price, cum } of bidReversed) {
    bidPath += ` L ${pxBid(price)},${py(cum)}`
  }
  const bidFill = bidPath + ` L ${pxBid(bidReversed[bidReversed.length - 1].price)},${py(0)} Z`

  // Asks: from best (left of right half) stepping up to worst (right)
  let askPath = `M ${pxAsk(askCum[0].price)},${py(0)}`
  for (const { price, cum } of askCum) {
    askPath += ` L ${pxAsk(price)},${py(cum)}`
  }
  const askFill = askPath + ` L ${pxAsk(askCum[askCum.length - 1].price)},${py(0)} Z`

  // Tick labels
  const bidLabels = [bidReversed[0], bidReversed[bidReversed.length - 1]]
  const askLabels = [askCum[0], askCum[askCum.length - 1]]

  return (
    <div>
      <div className="text-[10px] text-muted-foreground mb-1 flex justify-between">
        <span>Spread: {spread}</span>
        <span>Best Bid: {bids[0][0].toFixed(2)} / Ask: {asks[0][0].toFixed(2)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1={pad.left} x2={w - pad.right} y1={py(maxCum * f)} y2={py(maxCum * f)}
            stroke="hsl(var(--border))" strokeWidth={0.5} opacity={0.2} />
        ))}
        {/* Bid fill + line */}
        <path d={bidFill} fill="hsl(var(--pos))" opacity={0.15} />
        <path d={bidPath} fill="none" stroke="hsl(var(--pos))" strokeWidth={1.5} />
        {/* Ask fill + line */}
        <path d={askFill} fill="hsl(var(--neg))" opacity={0.15} />
        <path d={askPath} fill="none" stroke="hsl(var(--neg))" strokeWidth={1.5} />
        {/* Spread lines at inner edges */}
        <line x1={pxBid(bids[0][0])} x2={pxBid(bids[0][0])} y1={pad.top} y2={h - pad.bottom}
          stroke="hsl(var(--pos))" strokeWidth={0.5} strokeDasharray="2 2" opacity={0.4} />
        <line x1={pxAsk(asks[0][0])} x2={pxAsk(asks[0][0])} y1={pad.top} y2={h - pad.bottom}
          stroke="hsl(var(--neg))" strokeWidth={0.5} strokeDasharray="2 2" opacity={0.4} />
        {/* Spread label in gap */}
        <text x={pad.left + halfW + gap / 2} y={pad.top + 10} textAnchor="middle"
          fontSize={7} fill="hsl(var(--muted-foreground))" opacity={0.6}>{spread}</text>
        {/* Price labels */}
        {bidLabels.map((b, i) => (
          <text key={`bl-${i}`} x={pxBid(b.price)} y={h - 4} textAnchor="middle"
            fontSize={8} fill="hsl(var(--pos))" opacity={0.7}>{b.price.toFixed(1)}</text>
        ))}
        {askLabels.map((a, i) => (
          <text key={`al-${i}`} x={pxAsk(a.price)} y={h - 4} textAnchor="middle"
            fontSize={8} fill="hsl(var(--neg))" opacity={0.7}>{a.price.toFixed(1)}</text>
        ))}
        {/* Y-axis label */}
        <text x={pad.left + 2} y={pad.top + 6} fontSize={7} fill="hsl(var(--muted-foreground))" opacity={0.5}>Size</text>
      </svg>
      <div className="flex gap-2 mt-2">
        <button className="flex-1 py-2 rounded text-sm font-semibold bg-pos/20 text-pos hover:bg-pos/30 transition-colors">
          CAN Wins {bids[0][0].toFixed(2)}
        </button>
        <button className="flex-1 py-2 rounded text-sm font-semibold bg-neg/20 text-neg hover:bg-neg/30 transition-colors">
          USA Wins {asks[0][0].toFixed(2)}
        </button>
      </div>
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
  const status = getStatus(lagMs, connected)
  const dotColor = statusDotColor(status)

  return (
    <div className="flex items-center gap-4 text-sm">
      <div className="flex items-center gap-2">
        <div
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: dotColor, boxShadow: `0 0 8px ${dotColor}` }}
        />
        <span className="font-mono text-muted-foreground">{replicaId}</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">Lag:</span>
        <span data-testid="lag-indicator" className={`font-mono ${lagClass(lagMs)}`}>
          {lagMs.toFixed(0)}ms
        </span>
      </div>
      <span className="text-xs text-muted-foreground">{status}</span>
    </div>
  )
}

export function Controls({
  onReplicaChange,
  activePort,
  onRestart,
}: {
  onReplicaChange: (port: number) => void
  activePort: number
  onRestart?: () => void
}) {
  const [chaosMap, setChaosMap] = useState<Record<number, number>>({ 8001: 0, 8002: 0 })
  const chaosMs = chaosMap[activePort] ?? 0

  const handleWake = async (port: number) => {
    try {
      await fetch(`http://localhost:${port}/api/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'wake' }),
      })
    } catch { /* ignore */ }
  }

  const handleSleep = async (port: number) => {
    try {
      await fetch(`http://localhost:${port}/api/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sleep' }),
      })
    } catch { /* ignore */ }
  }

  const handleChaos = async (port: number, ms: number) => {
    setChaosMap(prev => ({ ...prev, [port]: ms }))
    try {
      await fetch(`http://localhost:${port}/api/chaos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lag_ms: ms }),
      })
    } catch { /* ignore */ }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {REPLICAS.map((r) => (
          <button
            key={r.id}
            onClick={() => onReplicaChange(r.port)}
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
        <button onClick={() => {
          fetch(`http://localhost:${activePort}/api/fault`, { method: 'POST' }).catch(() => {})
        }} className="px-3 py-1 rounded text-xs bg-neg/40 text-neg hover:bg-neg/50 transition-colors border border-neg/30">Kill WS</button>
        <button onClick={() => {
          fetch('http://localhost:8001/api/restart', { method: 'POST' }).catch(() => {})
          fetch('http://localhost:8002/api/restart', { method: 'POST' }).catch(() => {})
          onRestart?.()
        }} className="px-3 py-1 rounded text-xs bg-warn/20 text-warn hover:bg-warn/30 transition-colors">Restart</button>
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
        <XAxis dataKey="ts" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(v: number) => formatTime(v)} />
        <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          domain={[(min: number) => Math.floor(min - 2), (max: number) => Math.ceil(max + 2)]} />
        <Line type="monotone" dataKey="mid" name="Mid" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} activeDot={{ r: 4, fill: 'hsl(var(--primary))' }} />
        <Tooltip content={<CustomTooltip />} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function LagChart({ data, currentLag }: { data: ChartPoint[]; currentLag: number }) {
  if (data.length < 2) return null
  const strokeColor = lagColor(currentLag)

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 5, right: 20, left: 40, bottom: 24 }}>
        <CartesianGrid strokeDasharray="1 3" stroke="hsl(var(--border))" opacity={0.1} vertical={false} />
        <XAxis dataKey="ts" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(v: number) => formatTime(v)} />
        <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} unit="ms" />
        <Line type="monotone" dataKey="lag" name="Lag (ms)" stroke={strokeColor} strokeWidth={1.5} dot={false} />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: 10, color: 'hsl(var(--muted-foreground))' }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}


// ─── Main App ────────────────────────────────────────────────────────

export default function App() {
  const [activePort, setActivePort] = useState(8001)
  const activePortRef = useRef(8001)
  const [tickHz, setTickHz] = useState(2)
  const [controlsKey, setControlsKey] = useState(0)

  // Per-replica logs (declared before hooks so callbacks can be passed)
  const MAX_LOG_ENTRIES = 100
  const logs1Ref = useRef<string[]>([])
  const logs2Ref = useRef<string[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const logBoxRef = useRef<HTMLDivElement>(null)
  const prev1Ref = useRef<{ connected: boolean; lagWarning: boolean }>({ connected: false, lagWarning: false })
  const prev2Ref = useRef<{ connected: boolean; lagWarning: boolean }>({ connected: false, lagWarning: false })

  const pushLog1 = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false })
    logs1Ref.current = [...logs1Ref.current.slice(-(MAX_LOG_ENTRIES - 1)), `[${ts}] ${msg}`]
    if (activePortRef.current === 8001) setLogs([...logs1Ref.current])
  }, [])
  const pushLog2 = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false })
    logs2Ref.current = [...logs2Ref.current.slice(-(MAX_LOG_ENTRIES - 1)), `[${ts}] ${msg}`]
    if (activePortRef.current === 8002) setLogs([...logs2Ref.current])
  }, [])

  // Both replicas run simultaneously
  const rep1 = useReplicaSocket('ws://localhost:8001/ws', pushLog1)
  const rep2 = useReplicaSocket('ws://localhost:8002/ws', pushLog2)
  const active = activePort === 8001 ? rep1 : rep2
  const { state, connected, chartData } = active

  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
  }, [logs])

  // Auto-wake only replica-1 on initial load
  useEffect(() => {
    fetch('http://localhost:8001/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'wake' }),
    }).catch(() => {})
  }, [])

  // Auto-log for replica 1
  useEffect(() => {
    const prev = prev1Ref.current
    if (rep1.connected && !prev.connected) pushLog1('WS connected to rep-1')
    else if (!rep1.connected && prev.connected) pushLog1('WS disconnected from rep-1')
    prev.connected = rep1.connected
    if (rep1.state) {
      if (rep1.state.lag_ms > 2000 && !prev.lagWarning) { pushLog1(`Lag spike: ${rep1.state.lag_ms.toFixed(0)}ms`); prev.lagWarning = true }
      else if (rep1.state.lag_ms < 200 && prev.lagWarning) { pushLog1('Lag recovered'); prev.lagWarning = false }
    }
  }, [rep1.connected, rep1.state])

  // Auto-log for replica 2
  useEffect(() => {
    const prev = prev2Ref.current
    if (rep2.connected && !prev.connected) pushLog2('WS connected to rep-2')
    else if (!rep2.connected && prev.connected) pushLog2('WS disconnected from rep-2')
    prev.connected = rep2.connected
    if (rep2.state) {
      if (rep2.state.lag_ms > 2000 && !prev.lagWarning) { pushLog2(`Lag spike: ${rep2.state.lag_ms.toFixed(0)}ms`); prev.lagWarning = true }
      else if (rep2.state.lag_ms < 200 && prev.lagWarning) { pushLog2('Lag recovered'); prev.lagWarning = false }
    }
  }, [rep2.connected, rep2.state])

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
      <div className="grid grid-cols-[1fr_400px] gap-3 flex-1">
        {/* Left column */}
        <div className="flex flex-col gap-3">
          {/* Scoreboard */}
          <div className="backdrop-blur-xl rounded-2xl p-3 border shadow-2xl bg-card/80 border-border/30">
            {state ? <Scoreboard state={state} /> : <div className="text-center text-muted-foreground">No data</div>}
          </div>

          {/* Pitch + tick rate */}
          <div className="backdrop-blur-xl rounded-2xl p-3 border shadow-2xl bg-card/80 border-border/30">
            <div className="max-w-sm mx-auto">
              {state ? <Pitch state={state} /> : <div className="text-muted-foreground text-center text-sm">Waiting for connection...</div>}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-muted-foreground">Tick Rate:</span>
              <input type="range" min="1" max="30" step="1" value={tickHz}
                onChange={(e) => {
                  const hz = Number(e.target.value)
                  setTickHz(hz)
                  fetch(`http://localhost:${activePort}/api/tick_rate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hz }),
                  }).catch(() => {})
                }}
                className="flex-1 accent-primary" />
              <span className="text-xs font-mono text-primary w-12 text-right">{tickHz} Hz</span>
            </div>
          </div>

          {/* Charts */}
          <div className="backdrop-blur-xl rounded-2xl p-3 border shadow-2xl bg-card/80 border-border/30 flex-1">
            <h2 className="text-sm font-semibold text-muted-foreground mb-2">Mid-Price</h2>
            <div className="h-48">
              {chartData.length > 1 ? <MidPriceChart data={chartData} /> : <div className="h-full flex items-center justify-center text-muted-foreground text-xs">Collecting data...</div>}
            </div>

            <div className="mt-3">
              <h3 className="text-xs text-muted-foreground mb-1">Lag</h3>
              <div className="h-40">
                {chartData.length > 1 ? <LagChart data={chartData} currentLag={state?.lag_ms ?? 0} /> : <div className="h-full flex items-center justify-center text-muted-foreground text-xs">Collecting data...</div>}
              </div>
            </div>

            <div className="mt-3">
              <h3 className="text-xs text-muted-foreground mb-1">Core Mid vs Replica Mid</h3>
              <div className="h-40">
                {chartData.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 40, bottom: 24 }}>
                      <CartesianGrid strokeDasharray="1 3" stroke="hsl(var(--border))" opacity={0.1} vertical={false} />
                      <XAxis dataKey="ts" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(v: number) => formatTime(v)} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                        domain={[(min: number) => Math.floor(min - 2), (max: number) => Math.ceil(max + 2)]} />
                      <Line type="monotone" dataKey="coreMid" name="Core" stroke="hsl(var(--warn))" strokeWidth={1.5} dot={false} />
                      <Line type="monotone" dataKey="mid" name="Replica" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 10, color: 'hsl(var(--muted-foreground))' }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : <div className="h-full flex items-center justify-center text-muted-foreground text-xs">Collecting data...</div>}
              </div>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-3">
          {/* Order Book */}
          <div className="backdrop-blur-xl rounded-2xl p-3 border shadow-2xl bg-card/80 border-border/30">
            <h2 className="text-xs font-semibold text-muted-foreground mb-1">Order Book</h2>
            {state ? <OrderBook state={state} /> : <div className="text-muted-foreground text-xs">No data</div>}
          </div>

          {/* Controls */}
          <div className="backdrop-blur-xl rounded-2xl p-3 border shadow-2xl bg-card/80 border-border/30">
            <h2 className="text-xs font-semibold text-muted-foreground mb-2">Controls</h2>
            <Controls key={controlsKey} onReplicaChange={(port) => {
              setActivePort(port)
              activePortRef.current = port
              setLogs(port === 8001 ? [...logs1Ref.current] : [...logs2Ref.current])
            }} activePort={activePort} onRestart={() => {
              rep1.clearHistory()
              rep2.clearHistory()
              logs1Ref.current = []
              logs2Ref.current = []
              setLogs([])
              setTickHz(2)
              setControlsKey(k => k + 1)
            }} />
          </div>

          {/* System Logs */}
          <div className="backdrop-blur-xl rounded-2xl p-3 border shadow-2xl bg-card/80 border-border/30 flex-1">
            <h2 className="text-xs font-semibold text-muted-foreground mb-1">System Log</h2>
            <div ref={logBoxRef} className="font-mono text-[10px] text-muted-foreground h-32 overflow-y-auto">
              {logs.length === 0 && <span className="opacity-50">No events yet...</span>}
              {logs.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
