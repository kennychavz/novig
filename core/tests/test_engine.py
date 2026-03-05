import sys
import os

# Add core/ to path so imports work
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from engine import Engine
import config


def test_physics_boundaries():
    """Run 1000 ticks, assert ball never leaves the field."""
    engine = Engine()
    for _ in range(1000):
        event = engine.tick()
        assert 0 <= event["ball_x"] <= 100, f"ball_x out of bounds: {event['ball_x']}"
        assert 0 <= event["ball_y"] <= 50, f"ball_y out of bounds: {event['ball_y']}"


def test_goal_detection_and_reset():
    """Force ball near goal, assert score increments and ball resets."""
    engine = Engine()
    engine.ball_x = 99
    engine.ball_y = 25
    engine.ball_vx = 5.0  # moving toward goal at x=100

    event = engine.tick()
    assert event["score"] == "1-0", f"Expected '1-0', got '{event['score']}'"
    assert event["ball_x"] == 50
    assert event["ball_y"] == 25


def test_pricing_extremes():
    """Set ball to x=50, x=0, x=100. Assert mid-price equals expected values."""
    engine = Engine()

    engine.ball_x = 50
    engine.ball_vx = 0.0
    engine.ball_vy = 0.0
    event = engine.tick()
    assert event["mid"] == config.BASE_PRICE + 0.5 * config.PRICE_RANGE  # 70.0

    engine.ball_x = 0
    engine.ball_y = 10  # outside goal zone to avoid goal detection
    engine.ball_vx = 0.0
    engine.ball_vy = 0.0
    event = engine.tick()
    assert event["mid"] == config.BASE_PRICE  # 50.0

    engine.ball_x = 100
    engine.ball_y = 10  # outside goal zone to avoid goal detection
    engine.ball_vx = 0.0
    engine.ball_vy = 0.0
    event = engine.tick()
    assert event["mid"] == config.BASE_PRICE + config.PRICE_RANGE  # 90.0


def test_volatility_spikes():
    """Set ball to midfield vs danger zone, assert vol values."""
    engine = Engine()

    engine.ball_x = 50
    engine.ball_vx = 0.0
    engine.ball_vy = 0.0
    event_mid = engine.tick()

    engine.ball_x = 5
    engine.ball_y = 10  # outside goal zone to avoid goal detection
    engine.ball_vx = 0.0
    engine.ball_vy = 0.0
    event_danger = engine.tick()

    assert event_danger["vol"] == round(config.BASE_VOL * config.VOL_SPIKE_MULTIPLIER, 4)
    assert event_mid["vol"] == round(config.BASE_VOL, 4)


def test_redis_payload_serialization():
    """Assert tick() returns flat dict with all 8 required keys, no nested types."""
    engine = Engine()
    event = engine.tick()

    required_keys = {"ts", "ball_x", "ball_y", "vol", "mid", "score", "half", "clock"}
    assert required_keys == set(event.keys()), f"Key mismatch: {set(event.keys())} vs {required_keys}"

    # All values must be flat (str, int, float) — no nested dicts/lists
    for k, v in event.items():
        assert isinstance(v, (str, int, float)), f"Key '{k}' has non-flat type: {type(v)}"
