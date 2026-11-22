'use strict';
// SPDX-License-Identifier: MIT
// Preview settling and renderer-clock needle segments for the head unit.
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
    constructor() { this.clear(); }
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
            this.duration = Math.min(MAX_STEP_MS, Math.max(SETTLE_MS, 1.5 * Math.abs(distance) / MAX_RATE));
            this.slope = distance ? Math.min(2.5, Math.max(0, current.velocity * this.duration / distance)) : 0;
            this.from = current.angle; this.target = target; this.at = now;
        }
        this.lastNow = now;
        return this._pose(now).angle;
    }
    moving(now) { return this.target !== null && this.from !== this.target && now < this.at + this.duration; }
}

// The native renderer interpolates these segments on its own clock. Retarget
// from the expected current angle, never from the previous target, so a new
// sample (including a reversal) cannot introduce a discontinuity.
const NATIVE_DEFAULT_MS = 80;
const NATIVE_MIN_MS = 50;
const NATIVE_MAX_MS = 120;

class NativeNeedleMotion {
    constructor() {
        this.change = 0;
        this.clear();
    }
    clear() {
        this.change++;
        this.target = null;
        this.from = 0;
        this.at = this.lastNow = this.lastTargetAt = null;
        this.duration = 0;
    }
    valueAt(now) {
        if (this.target === null) return null;
        if (!this.duration || now >= this.at + this.duration) return this.target;
        const progress = Math.max(0, Math.min(1, (now - this.at) / this.duration));
        return this.from + (this.target - this.from) * progress;
    }
    sample(target, now) {
        if (!Number.isFinite(target) || !Number.isFinite(now)) {
            if (this.target !== null) this.clear();
            return null;
        }
        if (this.target === null || (this.lastNow !== null && now < this.lastNow)) {
            this.from = this.target = target;
            this.at = this.lastNow = this.lastTargetAt = now;
            this.duration = 0;
            this.change++;
            return target;
        }
        const current = this.valueAt(now);
        if (target !== this.target) {
            const gap = now - this.lastTargetAt;
            this.duration = Math.max(NATIVE_MIN_MS, Math.min(NATIVE_MAX_MS,
                Number.isFinite(gap) && gap > 0 ? gap : NATIVE_DEFAULT_MS));
            this.from = current;
            this.target = target;
            this.at = this.lastTargetAt = now;
            this.change++;
        }
        this.lastNow = now;
        return this.valueAt(now);
    }
    get segment() {
        return this.target === null ? null : {
            change: this.change, from: this.from, to: this.target,
            at: this.at, duration: this.duration,
            snap: !this.duration || this.from === this.target,
        };
    }
    moving(now) {
        return this.target !== null && this.from !== this.target
            && now >= this.at && now < this.at + this.duration;
    }
}

function rotationKeys(keys) {
    const entries = typeof keys === 'string'
        ? keys.trim().split(/\s+/).map((key) => key.split(':').map(Number)) : keys;
    if (!Array.isArray(entries) || entries.length < 2 || entries.length > 256) return null;
    let previous = -1;
    for (const key of entries) {
        if (!Array.isArray(key) || key.length !== 2 || !key.every(Number.isFinite)
            || key[0] < 0 || key[0] <= previous) return null;
        previous = key[0];
    }
    return entries.map((key) => key[0] + ':' + key[1]).join(' ');
}

// Protocol v1 replaces an animation when its layer-local ID is reused. The
// client caches that same message for replay, as the peer cluster apps do.
// Return 0 on local failure so the caller can use its direct-pose fallback.
// Renderer-side asynchronous refusals still belong to the caller's event path.
function applyNativeRotation(client, ref, keys, priorAnim) {
    const serialized = rotationKeys(keys);
    const fail = () => {
        if (client && Number.isInteger(priorAnim) && priorAnim > 0 && typeof client.stop === 'function') {
            try { client.stop(ref, priorAnim); } catch (error) { /* direct-pose fallback remains available */ }
        }
        return 0;
    };
    if (!serialized || !client || typeof client.animate !== 'function') return fail();
    const layer = client.layers && client.layers.get(ref);
    if (!layer || !layer.anims) return fail();
    if (Number.isInteger(priorAnim) && priorAnim > 0 && layer.anims.has(priorAnim)) {
        const old = layer.anims.get(priorAnim);
        if (old.property !== 'rotate' || typeof client._send !== 'function') return fail();
        const message = Object.assign({}, old, { keys: serialized, loop: 0, interp: 'linear' });
        try {
            layer.anims.set(priorAnim, message);
            client._send(message);
            return priorAnim;
        } catch (error) { return fail(); }
    }
    try {
        const id = client.animate(ref, { property: 'rotate', keys: serialized, loop: false, interp: 'linear' });
        return Number.isInteger(id) && id > 0 ? id : fail();
    } catch (error) { return fail(); }
}

module.exports = { NeedleMotion, NativeNeedleMotion, applyNativeRotation, framePlan,
    FPS, SETTLE_MS, MAX_STEP_MS, NATIVE_DEFAULT_MS, NATIVE_MIN_MS, NATIVE_MAX_MS };
