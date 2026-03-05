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

    while running and not engine.finished:
        t0 = time.monotonic()

        event = engine.tick(dt)
        pub.publish(event)

        # Sleep for remainder of tick interval
        elapsed = time.monotonic() - t0
        sleep_time = max(0, dt - elapsed)
        time.sleep(sleep_time)

    logger.info("Core stopped — final score %s, clock %.1f", event["score"], event["clock"])


if __name__ == "__main__":
    main()
