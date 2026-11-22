'use strict';
// SPDX-License-Identifier: MIT
// Local receive/command diagnostics only. These are neither physical display
// FPS nor engine-sensor-to-display latency. No timers, I/O or per-frame logs.
const FIELDS = ['rpm', 'speed'];
const READY_MS = 500;

function field() {
    return { received: [], changes: [], invalid: [], lastReceivedAt: null,
        lastValue: null, changedAt: null, pendingAt: null };
}
function timestamp(event) { return typeof event === 'number' ? event : event.at; }

class Performance {
    constructor(options) {
        const o = options || {};
        this.windowMs = Number.isFinite(o.windowMs) && o.windowMs > 0 ? o.windowMs : 2000;
        this.maxEvents = Number.isInteger(o.maxEvents) && o.maxEvents > 0 ? Math.min(o.maxEvents, 4096) : 512;
        this.clear();
    }

    clear() {
        this.signals = { rpm: field(), speed: field() };
        this.commands = [];
        this.delays = [];
        this.startedAt = this.lastNow = this.cappedAt = null;
    }

    _touch(now) {
        if (!Number.isFinite(now) || now < 0) { this.clear(); return false; }
        if (this.lastNow !== null && now < this.lastNow) this.clear();
        if (this.startedAt === null) this.startedAt = now;
        this.lastNow = now;
        const cut = Math.max(this.startedAt, now - this.windowMs);
        const prune = (events) => {
            while (events.length && timestamp(events[0]) <= cut) events.shift();
        };
        FIELDS.forEach((name) => {
            const s = this.signals[name];
            prune(s.received); prune(s.changes); prune(s.invalid);
        });
        prune(this.commands); prune(this.delays);
        return true;
    }

    _push(events, event, now) {
        if (events.length >= this.maxEvents) { events.shift(); this.cappedAt = now; }
        events.push(event);
    }

    signal(name, value, now) {
        if (FIELDS.indexOf(name) < 0 || !this._touch(now)) return;
        const s = this.signals[name];
        this._push(s.received, now, now);
        s.lastReceivedAt = now;
        if (!Number.isFinite(value) || value < 0) {
            this._push(s.invalid, now, now);
            s.lastValue = s.changedAt = s.pendingAt = null;
            return;
        }
        if (s.lastValue !== value) {
            this._push(s.changes, now, now);
            s.changedAt = s.pendingAt = now;
        }
        s.lastValue = value;
    }

    pose(rpm, speed, now) {
        if (!this._touch(now)) return;
        this._push(this.commands, now, now);
        const values = { rpm, speed };
        FIELDS.forEach((name) => {
            const s = this.signals[name], value = values[name];
            // Pass a field's raw value only when its command was submitted in
            // this batch; undefined/null cannot credit another field's update.
            if (s.pendingAt === null || !Number.isFinite(value) || value !== s.lastValue) return;
            this._push(this.delays, { at: now, value: Math.max(0, now - s.pendingAt) }, now);
            s.pendingAt = null;
        });
    }

    snapshot(now) {
        const validClock = this._touch(now);
        const observed = validClock ? now - this.startedAt : 0;
        const elapsed = Math.min(this.windowMs, observed);
        const ready = observed >= READY_MS && validClock;
        const hz = (events) => ready && elapsed > 0 ? events.length * 1000 / elapsed : null;
        const signals = {};
        FIELDS.forEach((name) => {
            const s = this.signals[name];
            signals[name] = { receivedHz: hz(s.received), changedHz: hz(s.changes),
                ageMs: s.lastReceivedAt === null ? null : Math.max(0, now - s.lastReceivedAt),
                lastValue: s.lastValue, changedAt: s.changedAt, invalidCount: s.invalid.length };
        });
        const delays = this.delays.map((v) => v.value).sort((a, b) => a - b);
        return { ready, windowMs: this.windowMs, signals,
            output: { commandHz: hz(this.commands),
                meanDispatchMs: ready && delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null,
                p95DispatchMs: ready && delays.length ? delays[Math.ceil(delays.length * 0.95) - 1] : null },
            capped: this.cappedAt !== null && validClock && now - this.cappedAt <= this.windowMs };
    }
}

module.exports = { Performance, READY_MS };
