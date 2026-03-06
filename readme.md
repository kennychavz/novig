hey, welcome to the novig repository.

here is the entire flow that i have gone through when making this project. this is a journal of my thought process, decisions, and tradeoffs — written as i built it.

---

## the problem

build a distributed real-time system that shows data flowing from A → B → C. i chose to simulate a soccer match where ball position drives a live order book via the Avellaneda-Stoikov market making model. the core produces game state, replicas consume and enrich it into a 5-level book, and a react frontend renders everything.

why soccer + market making? because it touches on exactly the kind of problems novig cares about: real-time event processing, state replication, latency-sensitive pricing, and the interplay between a fast source of truth and consumer services that need to keep up.

---

## deployment

prerequisites: Docker and Docker Compose.

```bash
# start everything (builds + runs all 5 services)
docker compose up --build -d

# open the UI
open http://localhost:3000

# stop everything
docker compose down
```

### docker services

| service | image | port | what it does |
|---------|-------|------|-------------|
| `redis` | `redis:7-alpine` | 6379 | event stream bus — core writes to `game:events`, replicas consume via `XREAD` |
| `core` | custom Python | — | match simulation loop, publishes game events at `TICK_RATE_HZ` (default 2). no HTTP server, just a sync loop |
| `replica-1` | custom Python (FastAPI) | 8001 | consumes Redis stream, computes A-S order book, serves WebSocket + REST API |
| `replica-2` | same image as replica-1 | 8002 | independent second replica, own chaos/lag state, parameterized by `REPLICA_ID` and `PORT` env vars |
| `ui` | Node build → nginx | 3000 | React dashboard served as static files via nginx |

### how they connect

```
docker network (novig_default)
┌──────────────────────────────────────────────────────┐
│                                                      │
│  core ──XADD──> redis <──XREAD── replica-1 ──WS──>  │──port 8001──> browser
│                       <──XREAD── replica-2 ──WS──>  │──port 8002──> browser
│                                                      │
│  ui (nginx static)                                   │──port 3000──> browser
└──────────────────────────────────────────────────────┘
```

- core and replicas reference redis as `redis://redis:6379` (docker DNS)
- replicas also write `core:tick_rate_hz` to redis when the UI adjusts the tick rate slider — core reads this key each tick
- the UI runs in the browser and connects to replicas via `ws://localhost:{port}/ws`
- replicas start in sleep mode — the UI auto-wakes whichever replica it connects to

---

## demo walkthrough

1. `docker compose up --build -d` → open `http://localhost:3000`
2. Replica 1 auto-wakes — ball starts moving, book starts quoting
3. Click "Replica 2" → click "Wake" → both replicas consume independently, switch between them to compare
4. Drag Chaos slider to 3000ms → watch lag spike in the chart, book updates fall behind, system log shows warnings
5. Slide chaos back to 0 → replica catches up, lag returns to normal, system log shows recovery
6. Click "Kill WS" → force-closes all WebSocket connections, pauses replica for 3s, auto-recovers. UI reconnects automatically via exponential backoff

---

## the thinking phase (~45 min)

started with no code. just sat down and thought through the architecture end-to-end.

**transport layer** — first big decision. considered kafka (too heavy to set up under time pressure), file-based JSON logs (too much I/O, no ordering guarantees), binary logs (fast but kills readability). landed on **Redis Streams**: it gives me an append-only log with built-in ordering, consumer groups for free, `XREAD BLOCK` for efficient waiting, and replay capability. it's the sweet spot between kafka and a flat file.

**inter-service comms** — debated gRPC vs WebSockets. gRPC is the right call for a production matching engine where every microsecond counts. but for this scale and time budget, WebSockets are simpler to wire up and debug. the concepts are language-agnostic anyway — swap the transport later, the architecture holds.

**core layer design** — considered putting everything (game + orderbook + pricing) in one process. decided against it. the core should be the authoritative brain: ball physics, mid-price, volatility. that's it. the replicas do the A-S computation and book generation. this separation is the whole point of the exercise — showing how a replica reconstructs and enriches state from an upstream source.

**the domain math** — the ball moves on a 100x50 pitch via random walk with momentum. ball X position maps linearly to mid-price (50..90 range). volatility is base 0.15 but spikes to 0.45 when the ball enters either goal zone (x < 15 or x > 85). think of it as implied vol jumping when there's a scoring opportunity.

replicas take that mid-price + vol and run Avellaneda-Stoikov:

```
r = s - q * γ * σ² * (T - t)
δ = γ * σ² * (T - t) + (2/γ) * ln(1 + γ/k)
bid = r - δ/2,  ask = r + δ/2
```

this generates a reservation price and optimal spread. from there, 5 levels deep with fixed tick increments. the book visually skews when volatility spikes — which is exactly what you'd expect near a goal.

**orderbook updates vs full snapshots** — thought about incremental add/remove/modify operations. decided full book replacement per tick is better here. at 10Hz with 5 levels, the payload is tiny. incremental updates introduce complexity on both the producer and consumer side that isn't worth it at this scale. ship the whole book, let the UI just render what it gets.

**dynamic replicas** — the prompt mentions multiple windows. my approach: replicas start in a hibernation state. they're already running but idle (just `asyncio.sleep`). a REST endpoint (`POST /api/control`) wakes them up — they connect to Redis with cursor `$` (skip history, only new events) and start broadcasting. this avoids the complexity of dynamic container orchestration while still demonstrating the pattern.

**fault injection** — added a chaos endpoint (`POST /api/chaos?lag=5`) that injects artificial delay before broadcasting. Redis holds the data so nothing is lost — the replica just falls behind, and the UI shows the lag spiking. this lets you visually demonstrate what happens when a replica degrades, which is the observability story.

---

## stress testing the plan (~30 min)

before writing any code, i stress-tested the architecture:

- **redis streams vs kafka** — confirmed Redis Streams covers my needs (ordering, durability, replay, consumer groups) without the operational overhead of kafka. for a single-node demo this is the right call.
- **sync core vs async core** — the core is a pure 10Hz producer. no incoming connections, no need for async. synchronous `time.sleep(0.1)` + `redis.Redis` is simpler and correct.
- **async replica** — replicas must be async. they handle concurrent WebSocket clients, REST endpoints, and the Redis consumer loop simultaneously. FastAPI + `redis.asyncio` with lifespan context manager.
- **state recovery** — if a replica crashes and restarts, it can either read from `$` (current only) or `0` (full history). this gives me stateless vs stateful recovery without changing the architecture.
- **event sourcing snapshots** — considered periodic snapshots for crash recovery. not needed at this scale since Redis Streams already holds the full history, but the pattern would be: dump in-memory state to a JSON snapshot every N seconds, on restart load snapshot + replay events after that point.

---

## execution strategy: parallel worktrees ~1hr

this is where things get interesting. the three components (core, replica, ui) are independent until integration. so i created three git worktrees off the same repo:

```
novig/          → main branch (docs, docker-compose, orchestration)
novig-core/     → core branch (python game engine + redis publisher)
novig-replica/  → replica branch (FastAPI + A-S model + WebSocket)
novig-ui/       → ui branch (React + TypeScript dashboard)
```

each worktree gets its own implementation plan, its own test suite, and its own Dockerfile. the branches are isolated — no merge conflicts during development. this lets me (or multiple agents) work on all three simultaneously.

the merge strategy is sequential: core first (it has no dependencies), then replica (depends on core's data contract), then ui (depends on replica's WebSocket schema). each component has integration-ready tests that verify the data contract before connecting anything.

see `docs/worktree_flow.png` for the visual.

---

## what i built

### core (5 commits on `core` branch)
synchronous python process. 10Hz game loop. ball physics with random walk + momentum, wall bounces, goal detection with score tracking and center reset. mid-price derived from ball X, volatility spikes near goals. publishes flat 8-field dicts to Redis Streams via `XADD`. no async, no server, no complexity beyond what's needed.

### replica (5 commits on `replica` branch)
FastAPI app with async Redis consumer. hibernation pattern — sits idle until woken via REST. on activation, connects to Redis Streams with `XREAD BLOCK 1000` (1-second timeout lets the event loop re-evaluate control flags). computes A-S reservation price and optimal spread, generates 5-level book, broadcasts enriched WorldState over WebSocket. includes chaos injection for fault demonstration.

### ui (5 commits on `ui` branch)
React 18 + TypeScript + Tailwind dark theme. SVG soccer pitch with ball tracking, HTML table order book with depth bars (not Recharts — tables are better for this), mid-price timeline chart, lag sparkline, replica controls (wake/sleep/chaos). WebSocket hook with capped buffer (50 entries via `useRef`) and exponential backoff reconnect. dark finance theme and chart patterns recycled from a previous trading dashboard project (exquant-frontend) — not built from scratch for this exercise.

### orchestration
`docker-compose.yml` wires redis + core + replicas + ui. each component has its own Dockerfile. replicas are parameterized by `REPLICA_ID` and `PORT` env vars.

---

## integration flow ~ 30min

tested in this order:

1. **A → B** (core → replica): verify core publishes to Redis, replica consumes and generates valid book
2. **B → C** (replica → ui): verify WebSocket delivers WorldState, ui renders correctly
3. **A → B → C** (full pipeline): end-to-end with docker-compose

this incremental approach catches 80% of issues before the full stack is up. each component has pytest/vitest tests that validate the data contract independently.

---

## key tradeoffs

| decision | chose | over | why |
|----------|-------|------|-----|
| transport | Redis Streams | kafka / file logs | right balance of durability, ordering, and setup time |
| core comms | sync redis | async / gRPC | no inbound connections, pure producer, keep it simple |
| replica comms | async FastAPI + WS | gRPC streaming | simpler client integration, sufficient for demo scale |
| book delivery | full snapshot per tick | incremental updates | 5 levels × 10Hz is tiny, avoids add/remove/modify complexity |
| replica scaling | hibernation pattern | dynamic container spawn | demonstrates the concept without k8s overhead |
| order book render | HTML table | Recharts | tabular data renders faster and cleaner at 10Hz |
| state buffer | useRef (50 cap) | unlimited array | prevents memory leaks, only copies to state for renders |

---

## AI & tools

**brainstorming (~45 min):** no AI — architecture designed from first principles on paper.

**stress testing (~30 min):** used Gemini to validate transport decisions (Redis Streams vs Kafka), async patterns, state recovery, and identify edge cases in the A-S model.

**planning (~30 min):** used Gemini to generate the development flow diagrams (`docs/flow/work_flow.png` shows the 6-phase timeline, `docs/flow/git_flow.png` shows branch/merge/test strategy). also used Gemini to structure the implementation specs in `docs/`.

**execution (~3 hrs):** used Claude Code with 3 parallel worktree agents — one per component (core, replica, ui). each agent received a detailed implementation spec and executed independently. `docs/flow/worktree_agent_instructions.png` shows an actual agent prompt.

**UI polish (~1 hr):** used Claude Code for dashboard refinement. dark finance theme recycled from a previous trading dashboard project (exquant-frontend) — not built from scratch.

**where i disagreed with AI:**
- Claude proposed separate files (pitch.py, pricing.py, types.py) in core — collapsed to single engine.py (~135 lines). splitting would be overengineering
- Claude wanted Recharts for the order book — HTML table with CSS depth bars is faster and cleaner at 10Hz
- Claude suggested incremental book updates — full snapshots at 5 levels × 10Hz are tiny, avoids add/remove/modify complexity

---

## directory structure

```
novig/
├── docs/                          # agent specs — implementation blueprints given to each worktree agent
│   ├── 1_high_level.md            # system overview, data flow, docker services
│   ├── 2.1_core.md                # core layer spec + implementation notes
│   ├── 2.2_replica.md             # replica layer spec + implementation notes
│   ├── 2.3_ui.md                  # ui layer spec + implementation notes
│   └── flow/                      # development flow diagrams
│       ├── work_flow.png          # 6-phase timeline
│       ├── git_flow.png           # branch/merge/test strategy
│       └── worktree_agent_instructions.png  # actual agent prompt example
├── core/                          # → novig-core worktree
├── replica/                       # → novig-replica worktree
├── ui/                            # → novig-ui worktree
├── docker-compose.yml             # orchestration
├── Dockerfile.replica
└── readme.md                      # you are here
```

each component is lean on purpose:

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

## what's next

- full docker-compose integration test across all three services
- overlay core state vs replica state in the UI to visualize replication lag
- chaos testing: disconnect replicas, inject lag, watch recovery
- potentially: specify stateless vs stateful on replica spawn (read from `$` vs `0`) for load balancing scenarios