class ThrottleManager {
  constructor(config = {}) {
    this.config = {
      max_requests_per_second: asOptionalNumber(config.max_requests_per_second),
      max_requests_per_minute: asOptionalNumber(config.max_requests_per_minute),
      max_requests_per_hour: asOptionalNumber(config.max_requests_per_hour),
      max_requests_per_day: asOptionalNumber(config.max_requests_per_day),
    };

    const now = Date.now();
    this.state = {
      requests_per_second: 0,
      requests_per_minute: 0,
      requests_per_hour: 0,
      requests_per_day: 0,
      last_reset_second: now,
      last_reset_minute: now,
      last_reset_hour: now,
      last_reset_day: now,
    };
  }

  resetIfNeeded() {
    const now = Date.now();

    if (now - this.state.last_reset_second >= 1000) {
      this.state.requests_per_second = 0;
      this.state.last_reset_second = now;
    }

    if (now - this.state.last_reset_minute >= 60_000) {
      this.state.requests_per_minute = 0;
      this.state.last_reset_minute = now;
    }

    if (now - this.state.last_reset_hour >= 3_600_000) {
      this.state.requests_per_hour = 0;
      this.state.last_reset_hour = now;
    }

    if (now - this.state.last_reset_day >= 86_400_000) {
      this.state.requests_per_day = 0;
      this.state.last_reset_day = now;
    }
  }

  checkThrottle() {
    this.resetIfNeeded();

    const now = Date.now();

    if (
      this.config.max_requests_per_second !== null &&
      this.state.requests_per_second >= this.config.max_requests_per_second
    ) {
      return {
        delay_ms: Math.max(0, 1000 - (now - this.state.last_reset_second)),
        limit_type: "per second",
      };
    }

    if (
      this.config.max_requests_per_minute !== null &&
      this.state.requests_per_minute >= this.config.max_requests_per_minute
    ) {
      return {
        delay_ms: Math.max(0, 60_000 - (now - this.state.last_reset_minute)),
        limit_type: "per minute",
      };
    }

    if (
      this.config.max_requests_per_hour !== null &&
      this.state.requests_per_hour >= this.config.max_requests_per_hour
    ) {
      return {
        delay_ms: Math.max(0, 3_600_000 - (now - this.state.last_reset_hour)),
        limit_type: "per hour",
      };
    }

    if (
      this.config.max_requests_per_day !== null &&
      this.state.requests_per_day >= this.config.max_requests_per_day
    ) {
      return {
        delay_ms: Math.max(0, 86_400_000 - (now - this.state.last_reset_day)),
        limit_type: "per day",
      };
    }

    return null;
  }

  incrementCounters() {
    this.state.requests_per_second += 1;
    this.state.requests_per_minute += 1;
    this.state.requests_per_hour += 1;
    this.state.requests_per_day += 1;
  }
}

function asOptionalNumber(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = {
  ThrottleManager,
};
