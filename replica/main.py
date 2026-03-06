import asyncio
import time
from contextlib import asynccontextmanager

import redis.asyncio as redis
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from replica import config
from replica.engine import ReplicaEngine
from replica.publisher import Broadcaster

# Module-level state (importable for tests)
is_active: bool = False
injected_lag_ms: int = 0
last_id: str = "$"
_ws_blocked: bool = False  # reject new WS connections during fault

engine = ReplicaEngine()
broadcaster = Broadcaster()

# Metrics
_start_time: float = 0.0
_events_consumed: int = 0
_last_lag_ms: float = 0.0
_core_mid: float = 0.0  # real-time core mid (no chaos delay)


async def _fetch_core_mid(r) -> float:
    """Read the latest event from Redis to get real-time core mid (bypasses chaos)."""
    try:
        result = await r.xrevrange(config.STREAM_KEY, "+", "-", count=1)
        if result:
            _, fields = result[0]
            return float(fields["mid"])
    except Exception:
        pass
    return _core_mid


async def consume_redis_stream() -> None:
    global is_active, last_id, _events_consumed, _last_lag_ms, _core_mid

    r = redis.Redis.from_url(config.REDIS_URL, decode_responses=True)
    try:
        while True:
            if not is_active:
                await asyncio.sleep(1)
                continue

            try:
                result = await r.xread(
                    {config.STREAM_KEY: last_id}, block=200
                )
            except redis.ConnectionError:
                await asyncio.sleep(1)
                continue

            if not result:
                continue

            # Process all events, broadcast only the latest
            latest_event = None
            for stream_name, messages in result:
                for msg_id, fields in messages:
                    latest_event = {
                        "ball_x": float(fields["ball_x"]),
                        "ball_y": float(fields["ball_y"]),
                        "vol": float(fields["vol"]),
                        "mid": float(fields["mid"]),
                        "score": fields["score"],
                        "half": int(fields["half"]),
                        "clock": float(fields["clock"]),
                        "ts": float(fields["ts"]),
                    }
                    engine.update(latest_event)
                    _events_consumed += 1
                    last_id = msg_id

            if latest_event is not None:
                # Measure baseline lag before chaos (natural transport delay only)
                baseline_lag_ms = (time.time() - latest_event["ts"]) * 1000

                # Apply chaos delay once per read cycle
                if injected_lag_ms > 0:
                    await asyncio.sleep(injected_lag_ms / 1000)

                # Report lag = baseline + injected, not re-measured wall clock
                lag_ms = baseline_lag_ms + injected_lag_ms
                _last_lag_ms = lag_ms

                _core_mid = await _fetch_core_mid(r)

                world_state = engine.get_world_state(
                    replica_id=config.REPLICA_ID,
                    lag_ms=lag_ms,
                )
                world_state["core_mid"] = _core_mid
                await broadcaster.broadcast(world_state)
    finally:
        await r.aclose()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _start_time
    _start_time = time.time()
    task = asyncio.create_task(consume_redis_stream())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/state")
async def get_state():
    return engine.get_world_state(
        replica_id=config.REPLICA_ID,
        lag_ms=_last_lag_ms,
    )


@app.get("/api/health")
async def get_health():
    return {
        "status": "ok",
        "replica_id": config.REPLICA_ID,
        "is_active": is_active,
        "lag_ms": _last_lag_ms,
        "uptime_s": round(time.time() - _start_time, 1) if _start_time else 0,
        "events_consumed": _events_consumed,
    }


@app.post("/api/control")
async def control(body: dict):
    global is_active, last_id
    action = body.get("action")
    if action == "wake":
        last_id = "$"
        is_active = True
    elif action == "sleep":
        is_active = False
    return {"status": "ok", "is_active": is_active}


@app.post("/api/fault")
async def inject_fault(body: dict = {}):
    """Force-close all WS clients and block reconnects for duration."""
    global is_active, _ws_blocked
    duration = max(1, min(30, int(body.get("duration_s", 3))))
    count = len(broadcaster.clients)
    # Block new WS connections
    _ws_blocked = True
    # Kill all existing WebSocket connections
    for ws in list(broadcaster.clients):
        try:
            await ws.close(code=1011, reason="fault injection")
        except Exception:
            pass
    broadcaster.clients.clear()
    # Pause the replica
    is_active = False
    # Schedule recovery after duration
    async def _recover():
        global is_active, _ws_blocked
        await asyncio.sleep(duration)
        _ws_blocked = False
        is_active = True
    asyncio.create_task(_recover())
    return {"status": "ok", "disconnected": count, "blocked_s": duration}


@app.post("/api/restart")
async def restart_game():
    global last_id, injected_lag_ms, engine
    r = redis.Redis.from_url(config.REDIS_URL, decode_responses=True)
    try:
        await r.set("core:restart", "1")
        await r.delete("core:tick_rate_hz")
    finally:
        await r.aclose()
    last_id = "$"
    injected_lag_ms = 0
    engine = ReplicaEngine()
    return {"status": "ok"}


@app.post("/api/tick_rate")
async def set_tick_rate(body: dict):
    hz = max(1, min(60, int(body.get("hz", 2))))
    r = redis.Redis.from_url(config.REDIS_URL, decode_responses=True)
    try:
        await r.set("core:tick_rate_hz", str(hz))
    finally:
        await r.aclose()
    return {"status": "ok", "tick_rate_hz": hz}


@app.post("/api/chaos")
async def chaos(body: dict):
    global injected_lag_ms
    injected_lag_ms = int(body.get("lag_ms", 0))
    return {"status": "ok", "injected_lag_ms": injected_lag_ms}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    if _ws_blocked:
        await ws.close(code=1013, reason="service restarting")
        return
    await ws.accept()
    broadcaster.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        broadcaster.disconnect(ws)
