'use strict';
// SPDX-License-Identifier: MIT
// Optional visual estimate between sparse *changed* engine readings. This does
// not change vehicle data, shift decisions, digital readings or engine limits.
// A real sample always wins immediately. Default/unknown mode is measured.
const MIN_INTERVAL_MS = 25;
const MAX_HORIZON_MS = 50;
const MAX_HOLD_MS = 150;
const MAX_LEAD_RPM = 100;
const FORWARD_STAGES = ['D', 'M', 'S'];

function result(rpm, lead, moving) {
    return { rpm, estimated: lead > 0, leadRpm: lead, moving: !!moving };
}

class RpmPresentation {
    constructor() { this.clear(); }

    clear() {
        this.measured = null;
        this.changedAt = null;
        this.lastNow = null;
        this.stage = null;
        this.gear = null;
        this.pedal = null;
        this.rate = 0;
        this.rises = 0;
        this.horizon = 0;
        this.needsBaseline = true;
    }

    _baseline(rpm, now, context) {
        this.measured = rpm;
        this.changedAt = this.lastNow = now;
        this.stage = context.stage;
        this.gear = context.gear;
        this.pedal = context.pedal;
        this.rate = this.rises = this.horizon = 0;
        this.needsBaseline = false;
    }

    sample(rpm, now, context) {
        const c = context || {};
        if (!Number.isFinite(rpm) || rpm < 0 || !Number.isFinite(now) || now < 0) {
            this.clear();
            return result(null, 0, false);
        }
        // Known provider loss/staleness cannot be used even for a visual pose.
        if (c.available === false || c.fresh === false) {
            this.clear();
            return result(null, 0, false);
        }
        const operating = c.mode === 'smooth' && c.available === true && c.fresh === true
            && !c.blocked && !c.lifting && FORWARD_STAGES.indexOf(c.stage) >= 0
            && Number.isInteger(c.gear) && c.gear > 0
            && Number.isFinite(c.pedal) && c.pedal > 0 && c.pedal <= 100 && this._limit(c) > 0;
        const discontinuity = this.lastNow !== null && (now < this.lastNow
            || c.stage !== this.stage || c.gear !== this.gear
            || (Number.isFinite(this.pedal) && c.pedal < this.pedal));
        if (!operating || discontinuity || this.measured === null) {
            this._baseline(rpm, now, c);
            return result(rpm, 0, false);
        }
        this.lastNow = now;
        this.pedal = c.pedal;
        if (rpm !== this.measured) {
            const interval = now - this.changedAt;
            const delta = rpm - this.measured;
            const rising = !this.needsBaseline && delta > 0
                && interval >= MIN_INTERVAL_MS && interval <= MAX_HOLD_MS;
            this.rises = rising ? this.rises + 1 : 0;
            this.rate = rising && this.rises >= 2 ? delta / interval : 0;
            this.horizon = this.rate ? Math.min(MAX_HORIZON_MS, interval) : 0;
            this.measured = rpm;
            this.changedAt = now;
            this.needsBaseline = false;
            // The real reading is never eased, delayed or replaced by a lead.
            return result(rpm, 0, this.rate > 0 && this._limit(c) > 0);
        }

        const age = now - this.changedAt;
        if (age > MAX_HOLD_MS) {
            // A constant value is not evidence that the engine kept rising.
            // Do not treat repeated getter values as a new source timestamp.
            this.rate = this.rises = this.horizon = 0;
            this.needsBaseline = true;
            return result(rpm, 0, false);
        }
        const limit = this._limit(c);
        const lead = Math.min(limit, this.rate * Math.min(age, this.horizon));
        // At the horizon/lead cap, stop scheduling visual frames and hold the
        // bounded pose. A new real reading, lift/shift/loss or hold expiry wins.
        return result(rpm + lead, lead, this.rate > 0 && age < this.horizon && lead < limit);
    }

    _limit(context) {
        // The caller can further cap the lead to one degree of its actual dial
        // curve. This module never assumes a particular engine or gauge scale.
        return Number.isFinite(context.maxLeadRpm)
            ? Math.max(0, Math.min(MAX_LEAD_RPM, context.maxLeadRpm)) : MAX_LEAD_RPM;
    }
}

module.exports = { RpmPresentation, MIN_INTERVAL_MS, MAX_HORIZON_MS, MAX_HOLD_MS, MAX_LEAD_RPM };
