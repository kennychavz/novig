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
GAMMA = 0.3          # risk aversion
K = 15.0             # order arrival intensity (higher = tighter spread)
TICK_SIZE = 0.03     # book level spacing
LEVEL_SIZES = [100, 200, 300, 200, 150]
BASE_VOL = 0.15      # must match core

# Match (must match core)
MATCH_DURATION = 5400  # 90 min simulated
# Normalize T-t to [0,1] so A-S spread stays reasonable
T_NORM = 0.5         # total normalized time
