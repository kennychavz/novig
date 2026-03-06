import math
import random
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
        # Smoothed noise seeds for each level (bid + ask)
        self._bid_noise = [0.0] * 5
        self._ask_noise = [0.0] * 5

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
        # Normalize time remaining to [0, T_NORM] so spread stays reasonable
        t_frac = max(config.MATCH_DURATION - self.clock, 0.0) / config.MATCH_DURATION
        t_remaining = t_frac * config.T_NORM

        q = 0  # symmetric book, no inventory
        r = self.mid - q * gamma * (sigma ** 2) * t_remaining

        # Optimal spread
        if t_remaining == 0:
            delta = (2 / gamma) * math.log(1 + gamma / k)
        else:
            delta = gamma * (sigma ** 2) * t_remaining + (2 / gamma) * math.log(1 + gamma / k)

        best_bid = r - delta / 2
        best_ask = r + delta / 2

        # Dynamic size distribution based on game state
        # Ball position skews liquidity: near home goal (x<30) = more bid depth,
        # near away goal (x>70) = more ask depth
        bid_bias = max(0.5, 1.5 - self.ball_x / 50.0)  # 1.5 at x=0, 0.5 at x=50, ~0.1 at x=100
        ask_bias = max(0.5, (self.ball_x - 50.0) / 50.0 + 0.5)  # mirror

        # Vol multiplier: high vol = thinner book at top, fatter deeper levels
        vol_ratio = sigma / config.BASE_VOL  # 1.0 normal, up to 3.0 in goal zone
        top_thin = max(0.3, 1.0 / vol_ratio)  # thinner top when vol is high

        # Smooth random walk noise per level (EMA with alpha=0.3)
        alpha = 0.3
        for i in range(5):
            self._bid_noise[i] = (1 - alpha) * self._bid_noise[i] + alpha * random.gauss(0, 0.15)
            self._ask_noise[i] = (1 - alpha) * self._ask_noise[i] + alpha * random.gauss(0, 0.15)

        base_sizes = config.LEVEL_SIZES
        bids = []
        asks = []
        for i, base_size in enumerate(base_sizes):
            # Level depth factor: top levels thinner when volatile, deeper levels fatter
            depth_factor = top_thin if i == 0 else (0.7 + 0.3 * i / 4)
            bid_size = max(10, round(base_size * bid_bias * depth_factor * (1 + self._bid_noise[i])))
            ask_size = max(10, round(base_size * ask_bias * depth_factor * (1 + self._ask_noise[i])))
            bids.append([round(best_bid - i * config.TICK_SIZE, 2), bid_size])
            asks.append([round(best_ask + i * config.TICK_SIZE, 2), ask_size])

        self.book = Book(bids=bids, asks=asks)

    def get_world_state(self, replica_id: str = None, lag_ms: float = 0) -> dict:
        if replica_id is None:
            replica_id = config.REPLICA_ID
        return {
            "replica_id": replica_id,
            "lag_ms": lag_ms,
            "replica_mid": self.mid,
            "vol": self.vol,
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
