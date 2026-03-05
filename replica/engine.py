import math
from dataclasses import dataclass, field
from replica import config


@dataclass
class Book:
    bids: list = field(default_factory=list)
    asks: list = field(default_factory=list)


class ReplicaEngine:
    def __init__(self):
        self.ball_x: float = 50.0
        self.ball_y: float = 25.0
        self.score: str = "0-0"
        self.half: int = 1
        self.clock: float = 0.0
        self.vol: float = 0.15
        self.mid: float = 70.0
        self.book = Book()

    def update(self, event: dict) -> None:
        self.ball_x = float(event["ball_x"])
        self.ball_y = float(event["ball_y"])
        self.score = str(event["score"])
        self.half = int(event["half"])
        self.clock = float(event["clock"])
        self.vol = float(event["vol"])
        self.mid = float(event["mid"])
        self._compute_book()

    def _compute_book(self) -> None:
        gamma = config.GAMMA
        k = config.K
        sigma = self.vol
        t_remaining = max(config.MATCH_DURATION - self.clock, 0.0)

        q = 0  # symmetric book, no inventory
        r = self.mid - q * gamma * (sigma ** 2) * t_remaining

        # Optimal spread
        if t_remaining == 0:
            delta = (2 / gamma) * math.log(1 + gamma / k)
        else:
            delta = gamma * (sigma ** 2) * t_remaining + (2 / gamma) * math.log(1 + gamma / k)

        best_bid = r - delta / 2
        best_ask = r + delta / 2

        bids = []
        asks = []
        for i, size in enumerate(config.LEVEL_SIZES):
            bids.append([round(best_bid - i * config.TICK_SIZE, 2), size])
            asks.append([round(best_ask + i * config.TICK_SIZE, 2), size])

        self.book = Book(bids=bids, asks=asks)

    def get_world_state(self, replica_id: str = None, lag_ms: float = 0) -> dict:
        if replica_id is None:
            replica_id = config.REPLICA_ID
        return {
            "replica_id": replica_id,
            "lag_ms": lag_ms,
            "game": {
                "x": self.ball_x,
                "y": self.ball_y,
                "score": self.score,
                "half": self.half,
                "clock": self.clock,
            },
            "book": {
                "bids": self.book.bids,
                "asks": self.book.asks,
            },
        }
