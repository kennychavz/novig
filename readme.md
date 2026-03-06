Hey, welcome to the Novig repository.

Here is the entire flow that I have gone through when making this project. This is a journal of my thought process, decisions, and tradeoffs.

---

## Architecture

```
                         Docker network (novig_default)

  ┌────────────┐       ┌─────────────┐       ┌──────────────┐       ┌────────────┐
  │            │ XADD  │             │ XREAD │              │  WS   │            │
  │    CORE    │──────>│    REDIS    │<──────│  REPLICA-1   │──────>│  BROWSER   │
  │  (Python)  │       │  (Streams)  │<──┐   │  (FastAPI)   │       │            │
  │            │<──GET─│             │   │   │   :8001      │       │            │
  └────────────┘       └─────────────┘   │   └──────────────┘       │ connects   │
   sync loop            :6379            │                          │ to :3000   │
   no HTTP port                          │   ┌──────────────┐       │ for static │
                                         │   │              │  WS   │ assets     │
                  tick_rate_hz ──────────>│   │  REPLICA-2   │──────>│            │
                  restart key            └───│  (FastAPI)    │       │            │
                  (control plane)            │   :8002       │       └────────────┘
                                             └──────────────┘
                                                                    ┌────────────┐
                                                                    │ UI (Nginx) │
                                                                    │   :3000    │
                                                                    └────────────┘
```

**Data flow:** Core ticks the game at 2-60Hz, publishes ball position + mid-price + volatility to a Redis Stream (`XADD`). Replicas independently consume via `XREAD BLOCK`, compute Avellaneda-Stoikov spreads, generate a 5-level order book, and broadcast enriched state over WebSocket. The React UI connects to replicas and renders everything in real time.

**Control plane:** The UI adjusts tick rate and sends restart commands through the replica, which writes Redis keys that core polls each tick. No extra API server in core.

---

## The Problem

Build a distributed real-time system that shows data flowing from A → B → C. I chose to simulate a soccer match where ball position drives a live order book via the Avellaneda-Stoikov market making model. The core produces game state, replicas consume and enrich it into a 5-level book, and a React frontend renders everything.

Why soccer + market making? Because it touches on exactly the kind of problems Novig cares about as well as a personal passion of mine.

---

## Deployment

Prerequisites: Docker and Docker Compose.

```bash
# start everything (builds + runs all 5 services)
docker compose up --build -d

# open the UI
open http://localhost:3000

# stop everything
docker compose down
```

| Service | Port | Role |
|---------|------|------|
| `redis` | 6379 | Append-only event stream (`game:events`) |
| `core` | none | Sync game loop, publishes to Redis |
| `replica-1` | 8001 | Consumes stream, computes A-S book, serves WS + REST |
| `replica-2` | 8002 | Independent second replica, own state |
| `ui` | 3000 | React dashboard via Nginx |

---

## Demo Walkthrough

1. `docker compose up --build -d` → open `http://localhost:3000`
2. Replica 1 auto-wakes. Ball starts moving, book starts quoting.
3. Click "Replica 2" → click "Wake" → both replicas consume independently, switch between them to compare.
4. Drag Chaos slider to 3000ms → watch lag spike in the chart, book updates fall behind, system log shows warnings.
5. Slide chaos back to 0 → replica catches up, lag returns to normal, system log shows recovery.
6. Click "Kill WS" → force-closes all WebSocket connections, pauses replica for 3s, auto-recovers. UI reconnects via exponential backoff.

---

## How I Built This

Started with no code (~45 min). Sat down and thought through the architecture end-to-end.

**Transport layer.** Considered Kafka (too heavy under time pressure), file-based JSON logs (too much I/O, no ordering guarantees), binary logs (fast but kills readability). Landed on **Redis Streams**: append-only log with built-in ordering, `XREAD BLOCK` for efficient waiting, and replay capability. Sweet spot between Kafka and a flat file.

**Inter-service comms.** Debated gRPC vs WebSockets. gRPC is the right call for a production matching engine where every microsecond counts. But for this scale and time budget, WebSockets are simpler to wire up and debug. The concepts are language-agnostic; swap the transport later, the architecture holds.

**The domain math.** The ball moves on a 100x50 pitch via random walk with momentum. Ball X position maps linearly to mid-price (50..90 range). Volatility is base 0.15 but spikes to 0.45 when the ball enters either goal zone (x < 15 or x > 85). Think of it as implied vol jumping when there's a scoring opportunity.

Replicas take that mid-price + vol and run Avellaneda-Stoikov:

$$r = s - q \cdot \gamma \cdot \sigma^2 (T - t)$$

$$\delta = \gamma \cdot \sigma^2 (T - t) + \frac{2}{\gamma} \ln\left(1 + \frac{\gamma}{k}\right)$$

$$\text{bid} = r - \frac{\delta}{2}, \quad \text{ask} = r + \frac{\delta}{2}$$

This generates a reservation price and optimal spread. From there, 5 levels deep with fixed tick increments. The book visually skews when volatility spikes, which is exactly what you'd expect near a goal.

**Dynamic replicas.** The prompt mentions multiple windows. My approach: replicas start in a hibernation state. They're already running but idle (just `asyncio.sleep`). A REST endpoint (`POST /api/control`) wakes them up, they connect to Redis with cursor `$` (skip history, only new events) and start broadcasting. This avoids the complexity of dynamic container orchestration while still demonstrating the pattern.

**Fault injection.** Added a chaos endpoint (`POST /api/chaos?lag=5`) that injects artificial delay before broadcasting. Redis holds the data so nothing is lost, the replica just falls behind, and the UI shows the lag spiking. This lets you visually demonstrate what happens when a replica degrades, which is the observability story.

Before writing any code (~30 min), I stress-tested the architecture. Confirmed Redis Streams covers my needs without the operational overhead of Kafka. Validated state recovery: a replica can read from `$` (current only) or `0` (full history), giving stateless vs stateful recovery without changing the architecture. Considered periodic snapshots for crash recovery but not needed at this scale since Redis Streams already holds the full history.

---

## Execution Strategy: Parallel Worktrees (~2 hrs)

The three components (core, replica, UI) are independent until integration. So I created three git worktrees off the same repo, each with its own branch, implementation plan, test suite, and Dockerfile. This lets me (or multiple agents) work on all three simultaneously with zero merge conflicts.

Merges are sequential: core first (fast-forward), then replica, then UI. After all three merged, I opened a `ui-overhaul` branch for observability refinements, now merged into `main`.

See `docs/flow/git_flow.png` for the visual.

### Git History

| Phase | Branch | Commits | Description |
|-------|--------|---------|-------------|
| 1 | `main` | 1 | Architecture docs and implementation plans |
| 2 | `core` | 4 | Game engine, Redis publisher, tests, Dockerfile |
| 3 | `replica` | 5 | A-S engine, FastAPI app, tests, Dockerfile |
| 4 | `ui` | 6 | Vite scaffold, WebSocket hook, components, tests |
| 5 | `main` | 2 | Docker Compose orchestration, readme |
| 6 | `ui-overhaul` | 4 | Score-aware pricing, dual-socket dashboard, test stages |

Phases 2-4 ran in parallel across worktrees. Total: 26 commits.

---

## What I Built

### Core (4 commits on `core` branch)
Synchronous Python process. Game loop running at a configurable tick rate. Ball physics with random walk + momentum, wall bounces, goal detection with score tracking and center reset. Mid-price derived from ball X, volatility spikes near goals. Publishes flat 8-field dicts to Redis Streams via `XADD`. No async, no server, no complexity beyond what's needed.

### Replica (5 commits on `replica` branch)
FastAPI app with async Redis consumer. Hibernation pattern: sits idle until woken via REST. On activation, connects to Redis Streams with `XREAD BLOCK 200` (200ms timeout lets the event loop re-evaluate control flags without busy-spinning). Computes A-S reservation price and optimal spread, generates a 5-level book, broadcasts enriched WorldState over WebSocket. Includes chaos injection for fault demonstration.

### UI (6 commits on `ui` branch + 4 on `ui-overhaul`)
A note on scope here: the UI looks polished but it was not a time sink. The dark finance theme, chart patterns, and component structure were recycled from a previous trading dashboard project (exquant-frontend). I didn't build glassmorphism cards and Recharts wrappers from scratch. The AI agents scaffolded the rest. The reason the UI exists at all is engineering, not aesthetics: the lag sparkline proves replica degradation is observable, the dual-replica view proves independent consumption works, and the chaos/kill controls prove fault tolerance is real. Without the UI, those are just claims in a README.

React 18 + TypeScript + Tailwind. SVG soccer pitch with ball tracking, HTML table order book with depth bars (not Recharts, tables are faster for tabular data at high update rates), mid-price timeline chart, lag sparkline, replica controls (wake/sleep/chaos/kill WS/tick rate/restart). WebSocket hook with capped buffer (50 entries via `useRef`) and exponential backoff reconnect.

### Orchestration
`docker-compose.yml` wires Redis + core + replicas + UI. Each component has its own Dockerfile. Replicas are parameterized by `REPLICA_ID` and `PORT` env vars.

---

## Integration Flow (~30 min)

Tested in this order:

1. **A → B** (core → replica): verify core publishes to Redis, replica consumes and generates valid book.
2. **B → C** (replica → UI): verify WebSocket delivers WorldState, UI renders correctly.
3. **A → B → C** (full pipeline): end-to-end with Docker Compose.

This incremental approach catches 80% of issues before the full stack is up. Each component has pytest/Vitest tests that validate the data contract independently.

---

## Key Tradeoffs

| Decision | Chose | Over | Why |
|----------|-------|------|-----|
| Transport | Redis Streams | Kafka / file logs | Right balance of durability, ordering, and setup time |
| Core comms | Sync Redis | Async / gRPC | No inbound connections, pure producer, keep it simple |
| Replica comms | Async FastAPI + WS | gRPC streaming | Simpler client integration, sufficient for demo scale |
| Replica scaling | Hibernation pattern | Dynamic container spawn | Demonstrates the concept without K8s overhead |
| Order book render | HTML table | Recharts | Tabular data renders faster and cleaner at high update rates |
| State buffer | useRef (50 cap) | Unlimited array | Prevents memory leaks, only copies to state for renders |

---

## AI & Tools

**Brainstorming (~45 min).** No AI. Architecture designed from first principles on paper.

**Stress testing (~30 min).** Used Gemini to validate transport decisions (Redis Streams vs Kafka), async patterns, state recovery, and identify edge cases in the A-S model.

**Planning (~30 min).** Used Gemini to generate the development flow diagrams (`docs/flow/work_flow.png` shows the 6-phase timeline, `docs/flow/git_flow.png` shows branch/merge/test strategy). Also used Gemini to structure the implementation specs in `docs/`.

**Execution (~2 hrs).** Used Claude Code with 3 parallel worktree agents, one per component (core, replica, UI). Each agent received a detailed implementation spec and executed independently. `docs/flow/worktree_agent_instructions.png` shows an actual agent prompt.

**UI polish (~30 min).** Used Claude Code for dashboard refinement. Dark finance theme recycled from a previous trading dashboard project (exquant-frontend), not built from scratch.

**Documentation (~30 min).** Report + README written from journal notes.

**Where I disagreed with AI:**
- Claude proposed separate files (pitch.py, pricing.py, types.py) in core. Collapsed to single engine.py (~135 lines). Splitting would be overengineering.
- Claude wanted Recharts for the order book. HTML table with CSS depth bars is faster and cleaner at high update rates.
- Claude suggested incremental book updates. Full snapshots at 5 levels are tiny, avoids add/remove/modify complexity.

---

## Directory Structure

```
novig/
├── docs/                          # Agent specs: implementation blueprints for each worktree agent
│   ├── 1_high_level.md            # System overview, data flow, Docker services
│   ├── 2.1_core.md                # Core layer spec + implementation notes
│   ├── 2.2_replica.md             # Replica layer spec + implementation notes
│   ├── 2.3_ui.md                  # UI layer spec + implementation notes
│   └── flow/                      # Development flow diagrams
│       ├── work_flow.png          # 6-phase timeline
│       ├── git_flow.png           # Branch/merge/test strategy
│       └── worktree_agent_instructions.png  # Actual agent prompt example
├── core/                          # Python game engine + Redis publisher
├── replica/                       # FastAPI + A-S model + WebSocket
├── ui/                            # React + TypeScript dashboard
├── docker-compose.yml             # Orchestration
├── Dockerfile.replica
└── readme.md                      # You are here
```

Each component is lean on purpose:

```
core/                    replica/                  ui/src/
├── main.py              ├── main.py               ├── App.tsx
├── engine.py            ├── engine.py             ├── hooks/useReplicaSocket.ts
├── publisher.py         ├── publisher.py          ├── components/
├── config.py            ├── config.py             │   ├── Pitch.tsx
├── tests/               ├── tests/                │   ├── OrderBook.tsx
└── Dockerfile           └── Dockerfile            │   ├── Scoreboard.tsx
                                                   │   ├── MidPriceChart.tsx
                                                   │   ├── LagSparkline.tsx
                                                   │   ├── Controls.tsx
                                                   │   └── MiniConsole.tsx
                                                   └── tests/
```

---

## What's Next

- Stateless vs stateful replica spawn: let replicas choose `$` (current only) vs `0` (full replay) on wake, useful for load balancing scenarios.
- Redis consumer groups: right now each replica tracks its own cursor independently. Consumer groups would add coordinated consumption if replicas needed to shard the workload rather than replicate it.
