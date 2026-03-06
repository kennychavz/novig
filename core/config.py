import os

# Tick rate
TICK_RATE_HZ = int(os.getenv("TICK_RATE_HZ", "10"))

# Field
FIELD_W, FIELD_H = 100, 50
GOAL_Y_MIN, GOAL_Y_MAX = 20, 30

# Pricing
# Mid = probability CAN wins (in cents). Ball at midfield (x=50) → 50 (even odds)
# Ball near USA goal (x=100) → 75 (CAN likely to score), near CAN goal (x=0) → 25
BASE_PRICE = 25.0
PRICE_RANGE = 50.0  # mid ranges 25..75 from position alone
GOAL_MID_SHIFT = 20.0  # max mid shift per goal (saturates via tanh)

# Volatility
BASE_VOL = 0.15
VOL_SPIKE_MULTIPLIER = 3.0
GOAL_ZONE = 15  # distance from goal line for vol spike

# Match
MATCH_DURATION = 5400  # 90 min simulated

# Redis
REDIS_URL = "redis://redis:6379"
STREAM_KEY = "game:events"
STREAM_MAXLEN = 1000
