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

engine = ReplicaEngine()
broadcaster = Broadcaster()

# Metrics
_start_time: float = 0.0
_events_consumed: int = 0
_last_lag_ms: float = 0.0


async def consume_redis_stream() -> None:
    global is_active, last_id, _events_consumed, _last_lag_ms

    r = redis.Redis.from_url(config.REDIS_URL, decode_responses=True)
    try:
        while True:
            if not is_active:
                await asyncio.sleep(1)
                continue

            try:
                result = await r.xread(
                    {config.STREAM_KEY: last_id}, block=1000
                )
            except redis.ConnectionError:
                await asyncio.sleep(1)
                continue

            if not result:
                continue

            for stream_name, messages in result:
                for msg_id, fields in messages:
                    event = {
                        "ball_x": float(fields["ball_x"]),
                        "ball_y": float(fields["ball_y"]),
                        "vol": float(fields["vol"]),
                        "mid": float(fields["mid"]),
                        "score": fields["score"],
                        "half": int(fields["half"]),
                        "clock": float(fields["clock"]),
                        "ts": float(fields["ts"]),
                    }

                    engine.update(event)
                    _events_consumed += 1

                    lag_ms = (time.time() - event["ts"]) * 1000
                    _last_lag_ms = lag_ms

                    if injected_lag_ms > 0:
                        await asyncio.sleep(injected_lag_ms / 1000)

                    world_state = engine.get_world_state(
                        replica_id=config.REPLICA_ID,
                        lag_ms=lag_ms,
                    )
                    await broadcaster.broadcast(world_state)

                    last_id = msg_id
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


@app.post("/api/chaos")
async def chaos(body: dict):
    global injected_lag_ms
    injected_lag_ms = int(body.get("lag_ms", 0))
    return {"status": "ok", "injected_lag_ms": injected_lag_ms}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    broadcaster.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        broadcaster.disconnect(ws)
