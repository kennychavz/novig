Hey, welcome to the Novig repository.

Here is the entire flow that I have gone through when making this project. This is a journal of my thought process, decisions, and tradeoffs.

---

## The Problem

Build a distributed real-time system to simulate a soccer match where ball position drives a live order book via the Avellaneda-Stoikov market making model. The core produces game state, replicas consume and enrich it into a 5-level book, and a React frontend renders everything.

---

## What I Built

### Core (4 commits on `core` branch)
The source of truth. A synchronous Python loop that simulates a soccer match: ball moves around a 100x50 pitch, goals happen, score updates. The interesting part is that ball position directly drives a mid-price (closer to a goal = higher price for that side) and volatility spikes when the ball enters danger zones. All of this gets published as flat dicts to Redis Streams. Intentionally simple: no async, no HTTP server, just a tight loop that ticks and publishes.

### Replica (5 commits on `replica` branch)
The consumer that makes it interesting. Each replica reads from the same Redis stream independently, takes the raw game state, and runs Avellaneda-Stoikov to generate a live 5-level order book around the mid-price. Replicas start asleep and wake on command, so you can spin them up, compare how they track the same source, and inject chaos (artificial lag) to watch one fall behind while the other stays current. This is where the distributed systems story lives.

### UI (6 commits on `ui` branch + 4 on `ui-overhaul`)
A note on scope here: the UI looks polished but it was not a time sink. The dark finance theme, chart patterns, and component structure were recycled from a previous trading dashboard project. The reason the UI exists at all is engineering, not aesthetics: the lag sparkline proves replica degradation is observable, the dual-replica view proves independent consumption works, and the chaos/kill controls prove fault tolerance is real. Without the UI, those are just claims in a README.

### Orchestration
One `docker-compose.yml` brings up all 5 services. Each component has its own Dockerfile. Replicas are parameterized by env vars (`REPLICA_ID`, `PORT`), so scaling is just adding another service block.

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
                  restart key            └───│  (FastAPI)   │       │            │
                  (control plane)            │   :8002      │       └────────────┘
                                             └──────────────┘
                                                                    ┌────────────┐
                                                                    │ UI (Nginx) │
                                                                    │   :3000    │
                                                                    └────────────┘
```

**Data flow:** Core ticks the game at 2-60Hz, publishes ball position + mid-price + volatility to a Redis Stream (`XADD`). Replicas independently consume via `XREAD BLOCK`, compute Avellaneda-Stoikov spreads, generate a 5-level order book, and broadcast enriched state over WebSocket. The React UI connects to replicas and renders everything in real time.

**Control plane:** The UI adjusts tick rate and sends restart commands through the replica, which writes Redis keys that core polls each tick. No extra API server in core.

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

### Demo

1. `docker compose up --build -d` → open `http://localhost:3000`
2. Replica 1 auto-wakes. Ball starts moving, book starts quoting.
3. Click "Replica 2" → click "Wake" → both replicas consume independently, switch between them to compare.
4. Drag Chaos slider to 3000ms → watch lag spike in the chart, book updates fall behind, system log shows warnings.
5. Slide chaos back to 0 → replica catches up, lag returns to normal, system log shows recovery.
6. Click "Kill WS" → force-closes all WebSocket connections, pauses replica for 3s, auto-recovers. UI reconnects via exponential backoff.

---

## How I Built This

Started with no code (~45 min). Sat down and thought through the architecture end-to-end. Considered Kafka (too heavy under time pressure), file-based JSON logs (too much I/O), binary logs (fast but kills readability). Landed on **Redis Streams** as the transport: append-only log with built-in ordering, `XREAD BLOCK` for efficient waiting, and replay capability. Debated gRPC vs WebSockets for inter-service comms; gRPC is the right call for a production matching engine, but for this scale WebSockets are simpler to wire up and the concepts are language-agnostic.

The ball moves on a 100x50 pitch via random walk with momentum. Ball X position maps linearly to mid-price (50..90 range). Volatility is base 0.15 but spikes to 0.45 near either goal zone (x < 15 or x > 85). Think of it as implied vol jumping when there's a scoring opportunity. Replicas take that mid-price + vol and run Avellaneda-Stoikov:

$$r = s - q \cdot \gamma \cdot \sigma^2 (T - t)$$

$$\delta = \gamma \cdot \sigma^2 (T - t) + \frac{2}{\gamma} \ln\left(1 + \frac{\gamma}{k}\right)$$

$$\text{bid} = r - \frac{\delta}{2}, \quad \text{ask} = r + \frac{\delta}{2}$$

This generates a reservation price and optimal spread. 5 levels deep with fixed tick increments. The book visually skews when volatility spikes, which is exactly what you'd expect near a goal.

Before writing any code (~30 min), I stress-tested the architecture. Confirmed Redis Streams covers my needs without Kafka's operational overhead. Validated state recovery: a replica can read from `$` (current only) or `0` (full history), giving stateless vs stateful recovery without changing the architecture.

### Parallel Worktrees (~2 hrs)

The three components are independent until integration. I created three git worktrees off the same repo, each with its own branch, implementation plan, test suite, and Dockerfile. Merges are sequential: core first (fast-forward), then replica, then UI. After all three merged, I opened a `ui-overhaul` branch for observability refinements, now merged into `main`. See `docs/flow/git_flow.png` for the visual.

| Phase | Branch | Commits | Description |
|-------|--------|---------|-------------|
| 1 | `main` | 1 | Architecture docs and implementation plans |
| 2 | `core` | 4 | Game engine, Redis publisher, tests, Dockerfile |
| 3 | `replica` | 5 | A-S engine, FastAPI app, tests, Dockerfile |
| 4 | `ui` | 6 | Vite scaffold, WebSocket hook, components, tests |
| 5 | `main` | 2 | Docker Compose orchestration, readme |
| 6 | `ui-overhaul` | 4 | Score-aware pricing, dual-socket dashboard, test stages |

Phases 2-4 ran in parallel across worktrees. Total: 26 commits.

### Integration (~30 min)

Tested in this order:

1. **A → B** (core → replica): verify core publishes to Redis, replica consumes and generates valid book.
2. **B → C** (replica → UI): verify WebSocket delivers WorldState, UI renders correctly.
3. **A → B → C** (full pipeline): end-to-end with Docker Compose.

Each component has pytest/Vitest tests that validate the data contract independently.

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

**UI polish (~1h).** Used Claude Code for dashboard refinement. Dark finance theme recycled from a previous trading dashboard project (exquant-frontend), not built from scratch.

**Documentation (~30 min).** Report + README written from journal notes.

**Where I disagreed with AI:**
- Claude proposed separate files (pitch.py, pricing.py, types.py) in core. Collapsed to single engine.py (~135 lines). Splitting would be overengineering.
- Claude wanted Recharts for the order book. HTML table with CSS depth bars is faster and cleaner at high update rates.
- Claude suggested incremental book updates. Full snapshots at 5 levels are tiny, avoids add/remove/modify complexity.
- Claude insists on long long documentation, I disagree

---

## What's Next

- Stateless vs stateful replica spawn: let replicas choose `$` (current only) vs `0` (full replay) on wake, useful for load balancing scenarios.
- Redis consumer groups: right now each replica tracks its own cursor independently. Consumer groups would add coordinated consumption if replicas needed to shard the workload rather than replicate it.
