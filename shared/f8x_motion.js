'use strict';
// SPDX-License-Identifier: MIT
// Bounded settling for resident GPU needle layers. Targets are never predicted.
const FPS = 60;
const SETTLE_MS = 36;
const MAX_STEP_MS = 100;
const MAX_RATE = 3.6; // degrees per millisecond, used to size a large-step transition

function framePlan(now, nextAt, fps) {
    const interval = 1000 / (fps || FPS);
    const due = Number.isFinite(nextAt) && Math.abs(now - nextAt) <= interval + 0.000001 ? nextAt : now;
    return { delay: Math.max(0, Math.ceil(due - now)), nextAt: due + interval, interval };
}

class NeedleMotion {
    constructor(options) {
        const o = options || {};
        this.settleMs = Number.isFinite(o.settleMs) && o.settleMs > 0 ? o.settleMs : SETTLE_MS;
        this.maxStepMs = Number.isFinite(o.maxStepMs) && o.maxStepMs >= this.settleMs ? o.maxStepMs : MAX_STEP_MS;
        this.clear();
    }
    clear() { this.target = null; this.from = 0; this.at = null; this.lastNow = null; this.duration = 0; this.slope = 0; }
    _pose(now) {
        if (this.target === null) return { angle: null, velocity: 0 };
        if (now >= this.at + this.duration || !this.duration) return { angle: this.target, velocity: 0 };
        const fraction = Math.max(0, (now - this.at) / this.duration);
        const s = this.slope, distance = this.target - this.from;
        const progress = fraction * (s + fraction * (3 - 2 * s + fraction * (s - 2)));
        const derivative = s + fraction * (6 - 4 * s + fraction * (3 * s - 6));
        return { angle: this.from + distance * progress, velocity: distance * derivative / this.duration };
    }
    sample(target, now) {
        if (!Number.isFinite(target) || !Number.isFinite(now)) { this.clear(); return null; }
        if (this.target === null || (this.lastNow !== null && now < this.lastNow)) {
            this.target = this.from = target; this.at = this.lastNow = now; this.duration = 0; this.slope = 0;
            return target;
        }
        const current = this._pose(now);
        if (target !== this.target) {
            const distance = target - current.angle;
            this.duration = Math.min(this.maxStepMs, Math.max(this.settleMs, 1.5 * Math.abs(distance) / MAX_RATE));
            this.slope = distance ? Math.min(2.5, Math.max(0, current.velocity * this.duration / distance)) : 0;
            this.from = current.angle; this.target = target; this.at = now;
        }
        this.lastNow = now;
        return this._pose(now).angle;
    }
    moving(now) { return this.target !== null && this.from !== this.target && now < this.at + this.duration; }
}

module.exports = { NeedleMotion, framePlan, FPS, SETTLE_MS, MAX_STEP_MS };
