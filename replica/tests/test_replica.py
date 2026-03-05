from fastapi.testclient import TestClient

from replica.engine import ReplicaEngine
import replica.main as main_module


def test_avellaneda_stoikov_spread_logic():
    engine = ReplicaEngine()

    low_vol_event = {
        "ball_x": 50, "ball_y": 25, "vol": 0.1, "mid": 70.0,
        "score": "0-0", "half": 1, "clock": 2700, "ts": 0,
    }
    engine.update(low_vol_event)
    low_spread = engine.book.asks[0][0] - engine.book.bids[0][0]

    high_vol_event = {**low_vol_event, "vol": 0.45}
    engine.update(high_vol_event)
    high_spread = engine.book.asks[0][0] - engine.book.bids[0][0]

    assert high_spread > low_spread


def test_orderbook_monotonicity():
    engine = ReplicaEngine()
    engine.update({
        "ball_x": 50, "ball_y": 25, "vol": 0.2, "mid": 70.0,
        "score": "0-0", "half": 1, "clock": 2700, "ts": 0,
    })

    bids = engine.book.bids
    asks = engine.book.asks

    assert len(bids) == 5
    assert len(asks) == 5

    # Bids descending
    for i in range(len(bids) - 1):
        assert bids[i][0] > bids[i + 1][0]

    # Asks ascending
    for i in range(len(asks) - 1):
        assert asks[i][0] < asks[i + 1][0]

    # No crossed book
    assert bids[0][0] < asks[0][0]


def test_state_update_convergence():
    engine = ReplicaEngine()
    event = {
        "ball_x": 75.5, "ball_y": 30.2, "vol": 0.3, "mid": 80.0,
        "score": "2-1", "half": 2, "clock": 4000, "ts": 1000.0,
    }

    engine.update(event)
    state = engine.get_world_state()

    assert state["game"]["x"] == 75.5
    assert state["game"]["y"] == 30.2
    assert state["game"]["score"] == "2-1"
    assert state["game"]["half"] == 2


def test_control_api_wake_sleep():
    client = TestClient(main_module.app)

    response = client.post("/api/control", json={"action": "wake"})
    assert response.status_code == 200
    assert main_module.is_active is True

    response = client.post("/api/control", json={"action": "sleep"})
    assert response.status_code == 200
    assert main_module.is_active is False


def test_chaos_api():
    client = TestClient(main_module.app)

    response = client.post("/api/chaos", json={"lag_ms": 3000})
    assert response.status_code == 200
    assert main_module.injected_lag_ms == 3000

    # Reset
    client.post("/api/chaos", json={"lag_ms": 0})
