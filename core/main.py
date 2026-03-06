import time
import signal
import logging

from engine import Engine
from publisher import Publisher
import config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger("core")

running = True


def _shutdown(signum, frame):
    global running
    logger.info("Received signal %s, shutting down...", signum)
    running = False


signal.signal(signal.SIGINT, _shutdown)
signal.signal(signal.SIGTERM, _shutdown)


def main():
    global running

    engine = Engine()
    pub = Publisher(config.REDIS_URL)
    dt = 1.0 / config.TICK_RATE_HZ

    logger.info("Core started — tick rate %d Hz, match duration %ds", config.TICK_RATE_HZ, config.MATCH_DURATION)

    while running:
        t0 = time.monotonic()

        # Check for dynamic tick rate update from Redis
        try:
            val = pub.r.get("core:tick_rate_hz")
            if val is not None:
                new_hz = max(1, min(60, int(val)))
                dt = 1.0 / new_hz
        except Exception:
            pass

        # Check for restart signal
        try:
            restart = pub.r.get("core:restart")
            if restart:
                pub.r.delete("core:restart")
                pub.r.delete("core:tick_rate_hz")
                engine = Engine()
                dt = 1.0 / config.TICK_RATE_HZ
                logger.info("Game restarted")
        except Exception:
            pass

        if not engine.finished:
            event = engine.tick(dt)
            pub.publish(event)

        # Sleep for remainder of tick interval
        elapsed = time.monotonic() - t0
        sleep_time = max(0, dt - elapsed)
        time.sleep(sleep_time)

    logger.info("Core stopped")


if __name__ == "__main__":
    main()
