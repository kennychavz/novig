import json
from fastapi import WebSocket


class Broadcaster:
    def __init__(self):
        self.clients: set[WebSocket] = set()

    def connect(self, ws: WebSocket) -> None:
        self.clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def broadcast(self, world_state: dict) -> None:
        payload = json.dumps(world_state)
        dead = []
        for ws in self.clients:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)
