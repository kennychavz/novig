import time
import logging

import redis

import config

logger = logging.getLogger(__name__)


class Publisher:
    def __init__(self, redis_url=None):
        self.redis_url = redis_url or config.REDIS_URL
        self._connect()

    def _connect(self):
        self.r = redis.Redis.from_url(self.redis_url, decode_responses=True)

    def publish(self, event):
        # Flatten all values to strings for Redis hash fields
        flat = {k: str(v) for k, v in event.items()}

        backoff = 0.1
        max_backoff = 30.0

        while True:
            try:
                self.r.xadd(
                    config.STREAM_KEY,
                    flat,
                    maxlen=config.STREAM_MAXLEN,
                    approximate=True,
                )
                return
            except redis.ConnectionError as e:
                logger.warning("Redis connection lost: %s — retrying in %.1fs", e, backoff)
                time.sleep(backoff)
                backoff = min(backoff * 2, max_backoff)
                self._connect()
