# Tick rate
TICK_RATE_HZ = 10

# Field
FIELD_W, FIELD_H = 100, 50
GOAL_Y_MIN, GOAL_Y_MAX = 20, 30

# Pricing
BASE_PRICE = 50.0
PRICE_RANGE = 40.0  # mid ranges 50..90

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
