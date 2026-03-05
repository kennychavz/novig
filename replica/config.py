import os

# Identity
REPLICA_ID = os.getenv("REPLICA_ID", "rep-1")

# Network
HOST = "0.0.0.0"
PORT = int(os.getenv("PORT", "8001"))

# Redis
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")
STREAM_KEY = "game:events"

# Avellaneda-Stoikov
GAMMA = 0.1          # risk aversion
K = 1.5              # order arrival intensity
TICK_SIZE = 0.25     # book level spacing
LEVEL_SIZES = [100, 200, 300, 200, 150]

# Match (must match core)
MATCH_DURATION = 5400  # 90 min simulated, for T-t calculation
