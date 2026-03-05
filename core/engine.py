import random
import time

import config


class Engine:
    def __init__(self):
        # Ball state
        self.ball_x = 50.0
        self.ball_y = 25.0
        self.ball_vx = 0.0
        self.ball_vy = 0.0

        # Match state
        self.score_home = 0
        self.score_away = 0
        self.half = 1
        self.clock = 0.0
        self.finished = False

    def tick(self, dt=0.1):
        if self.finished:
            return self._build_event()

        # 1. Update position from current velocity
        self.ball_x += self.ball_vx
        self.ball_y += self.ball_vy

        # 2. Wall bounces (y boundaries)
        if self.ball_y <= 0:
            self.ball_y = -self.ball_y
            self.ball_vy = abs(self.ball_vy)
        elif self.ball_y >= config.FIELD_H:
            self.ball_y = 2 * config.FIELD_H - self.ball_y
            self.ball_vy = -abs(self.ball_vy)

        # 3. Goal detection
        goal_scored = False
        if self.ball_x >= config.FIELD_W and config.GOAL_Y_MIN <= self.ball_y <= config.GOAL_Y_MAX:
            self.score_home += 1
            goal_scored = True
        elif self.ball_x <= 0 and config.GOAL_Y_MIN <= self.ball_y <= config.GOAL_Y_MAX:
            self.score_away += 1
            goal_scored = True

        if goal_scored:
            self._reset_ball()

        # 4. Clamp to field boundaries (non-goal out of bounds)
        self.ball_x = max(0.0, min(float(config.FIELD_W), self.ball_x))
        self.ball_y = max(0.0, min(float(config.FIELD_H), self.ball_y))

        # 5. Advance clock
        self.clock += dt

        # 6. Halftime and full time
        if self.half == 1 and self.clock >= config.MATCH_DURATION / 2:
            self.half = 2
        if self.clock >= config.MATCH_DURATION:
            self.finished = True

        # 7. Build event from current state (before perturbing for next tick)
        event = self._build_event()

        # 8. Perturb velocity for next tick (random walk with momentum)
        self.ball_vx += random.gauss(0, 0.5)
        self.ball_vy += random.gauss(0, 0.5)
        self.ball_vx *= 0.95
        self.ball_vy *= 0.95

        return event

    def _reset_ball(self):
        self.ball_x = 50.0
        self.ball_y = 25.0
        self.ball_vx = 0.0
        self.ball_vy = 0.0

    def _compute_mid(self):
        return config.BASE_PRICE + (self.ball_x / config.FIELD_W) * config.PRICE_RANGE

    def _compute_vol(self):
        x = self.ball_x
        zone = config.GOAL_ZONE  # 15
        transition = 10  # smooth over 10 units (15-25 and 75-85)

        if x < zone:
            return config.BASE_VOL * config.VOL_SPIKE_MULTIPLIER
        elif x < zone + transition:
            # Smooth transition from spike to base (x=15..25)
            t = (x - zone) / transition  # 0 at x=15, 1 at x=25
            return config.BASE_VOL * (config.VOL_SPIKE_MULTIPLIER * (1 - t) + t)
        elif x > config.FIELD_W - zone:
            return config.BASE_VOL * config.VOL_SPIKE_MULTIPLIER
        elif x > config.FIELD_W - zone - transition:
            # Smooth transition from base to spike (x=75..85)
            t = (x - (config.FIELD_W - zone - transition)) / transition  # 0 at x=75, 1 at x=85
            return config.BASE_VOL * (1 - t + config.VOL_SPIKE_MULTIPLIER * t)
        else:
            return config.BASE_VOL

    def _build_event(self):
        return {
            "ts": time.time(),
            "ball_x": round(self.ball_x, 2),
            "ball_y": round(self.ball_y, 2),
            "vol": round(self._compute_vol(), 4),
            "mid": round(self._compute_mid(), 2),
            "score": f"{self.score_home}-{self.score_away}",
            "half": self.half,
            "clock": round(self.clock, 1),
        }
