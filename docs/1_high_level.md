# 1. High-Level Architecture

## System Overview

Soccer match simulation with Avellaneda-Stoikov market making.
Core owns the game state, publishes to Redis Streams, replicas consume + generate order books, UI renders in real-time.

```
Core (10Hz) ──▶ Redis Streams ──▶ Replica(s) ──▶ UI (WebSocket)
```

## Data Flow: A -> B -> C

```
A: Core                    B: Redis Streams              C: Replica(s) -> UI
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────────┐
│ Ball physics     │       │ Append-only log  │       │ XREAD BLOCK consumer │
│ Mid-price calc   │──XADD─▶│ Ordered, durable │──XREAD─▶│ A-S spread calc      │
│ Volatility calc  │       │ Sequential IDs   │       │ 5-level book gen     │
│ Score tracking   │       │                  │       │ WS broadcast to UI   │
└──────────────────┘       └──────────────────┘       └──────────────────────┘
```

## Repo Structure

```
novig/
├── core/
│   ├── main.py             # Entry point + game loop
│   ├── engine.py           # Ball physics, pricing, volatility — all game logic
│   ├── publisher.py        # Redis Streams XADD transport layer
│   ├── config.py           # All tunables
│   ├── requirements.txt
│   ├── Dockerfile
│   └── tests/
│       └── test_engine.py  # Physics, pricing, volatility, serialization
├── replica/
│   ├── main.py             # FastAPI app, WS endpoint, REST routes, consumer loop
│   ├── engine.py           # A-S spread calc, book generation, local state
│   ├── publisher.py        # WS broadcast manager (fan-out to connected clients)
│   ├── config.py           # Replica tunables + A-S parameters
│   ├── requirements.txt
│   ├── Dockerfile
│   └── tests/
│       └── test_replica.py # A-S model, book validity, API endpoints
├── ui/
│   ├── src/
│   │   ├── main.tsx        # React entry
│   │   └── App.tsx         # Layout, WS hook, all components
│   ├── src/__tests__/
│   │   └── App.test.tsx    # Order book, lag colors, replica switch
│   ├── index.html
│   ├── index.css           # Theme variables
│   ├── package.json
│   ├── tailwind.config.ts
│   └── Dockerfile
├── docker-compose.yml
├── docs/
│   ├── 1_high_level.md
│   ├── 2.1_core.md
│   ├── 2.2_replica.md
│   └── 2.3_ui.md
└── README.md
```

## Transport: Redis Streams

- Stream key: `game:events`
- Core writes via `XADD`
- Replicas read via `XREAD BLOCK 1000` (1s timeout, so consumer can re-evaluate control flags between reads)
- Sequential IDs (`<timestamp_ms>-<seq>`) give total ordering for free
- Replicas track their own cursor — natural catch-up on restart

## Canonical Payloads

**Core -> Redis (Game Event):**
```json
{
  "ts": 1709654321.12,
  "ball_x": 88.5,
  "ball_y": 25.1,
  "vol": 0.45,
  "mid": 69.25,
  "score": "0-0",
  "half": 1,
  "clock": 2340.5
}
```

**Replica -> UI (World State):**
```json
{
  "replica_id": "rep-1",
  "lag_ms": 12,
  "game": {"x": 88.5, "y": 25.1, "score": "0-0", "half": 1, "clock": 2340.5},
  "book": {
    "bids": [[69.00, 100], [68.75, 200], [68.50, 300], [68.25, 150], [68.00, 250]],
    "asks": [[69.50, 100], [69.75, 200], [70.00, 300], [70.25, 150], [70.50, 250]]
  }
}
```

## Key Trade-offs

| Decision | Choice | Why |
|----------|--------|-----|
| Transport | Redis Streams over WS/SSE | Durable, ordered, built-in consumer groups, replay for free |
| Consistency | Eventually consistent | Replicas may lag — that's the point, we measure and display it |
| Tick rate | 10Hz core | Fast enough for real-time feel, cheap enough to not overwhelm Redis |
| Book generation | Replica-side (A-S) | Keeps core lean, replicas do the heavy math independently |
| Order book UI | HTML table, not recharts | Charting libs fight you for tabular data — table + CSS depth bars is cleaner |

## Docker Services

| Service | Image | Ports |
|---------|-------|-------|
| `redis` | `redis:7-alpine` | 6379 |
| `core` | Python 3.12 | — (no external port) |
| `replica-1` | FastAPI | 8001 (HTTP + WS) |
| `replica-2` | FastAPI | 8002 (HTTP + WS) |
| `ui` | Nginx (serves Vite build) | 3000 -> 80 |

## docker-compose.yml

Root orchestration file — ties the full distributed system together locally.

```yaml
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  core:
    build: ./core
    depends_on: [redis]
    environment:
      - REDIS_URL=redis://redis:6379

  replica-1:
    build: ./replica
    ports: ["8001:8001"]
    depends_on: [redis]
    environment:
      - REPLICA_ID=rep-1
      - PORT=8001
      - REDIS_URL=redis://redis:6379

  replica-2:
    build: ./replica
    ports: ["8002:8002"]
    depends_on: [redis]
    environment:
      - REPLICA_ID=rep-2
      - PORT=8002
      - REDIS_URL=redis://redis:6379

  ui:
    build: ./ui
    ports: ["3000:80"]
```

Run: `docker compose up --build`
