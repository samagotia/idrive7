'use strict';
// SPDX-License-Identifier: MIT
// Read-only direction from the owner's iDrive 7 service catalog. This field is
// explicit; no direction is inferred from RPM, oil temperature or target gear.
const INTERFACE = 'de.bmw.infotainment.vehicle.CDS';
const FIELD = 'statusGearIndicator';
const SOURCE = INTERFACE + '.' + FIELD + '.displayGearShiftIndicatorDrive';
const MAX_AGE_MS = 1500;
const { isSequential } = require('./f82_sprite');
const clock = () => process.uptime() * 1000;
const DIRECTIONS = { ANZEIGE_AUS: 'off', RUNTERSCHALTHINWEIS: 'down', HOCHSCHALTHINWEIS: 'up',
    0: 'off', 1: 'down', 2: 'up' };

function decode(sample) {
    const raw = sample && sample.displayGearShiftIndicatorDrive;
    return (typeof raw === 'string' && /^[A-Z_]+$/.test(raw) || Number.isInteger(raw))
        && Object.prototype.hasOwnProperty.call(DIRECTIONS, raw) ? DIRECTIONS[raw] : null;
}
function modeOf(sample) {
    const raw = sample && sample.displayProgramGearbox;
    if (raw === 1 || raw === 'S_MINUS_PROGRAMM') return 'S';
    if (raw === 2 || raw === 'M_MINUS_PROGRAMM') return 'M';
    return null;
}
function shutdown(sub) {
    if (sub && sub.shutdown) Promise.resolve().then(() => sub.shutdown()).catch(() => {});
}

class GearRecommendation {
    constructor(ctx, options) {
        this.now = options && options.now || clock;
        this.sub = null; this.at = null; this.direction = null;
        this.mode = null; this.modeAvailable = null; this.stopped = false;
        this.reason = 'waiting';
        Promise.resolve().then(() => ctx.signals.watch(INTERFACE, '1', {
            [FIELD]: (sample) => {
                if (this.stopped) return;
                if (this.sub && !this.sub.available) { this._clear('unavailable'); return; }
                this.direction = decode(sample); this.at = this.now();
                this.reason = this.direction === null ? 'invalid' : 'live';
            },
        }, ctx.log, { pollMs: 500, pollFields: [FIELD], readTimeoutMs: 500 })).then((sub) => {
            if (this.stopped) { shutdown(sub); return; }
            this.sub = sub;
            if (!sub.available) this._clear('unavailable');
            if (sub.onAvailability) sub.onAvailability((available) => {
                if (this.stopped) return;
                if (!available) this._clear('unavailable');
                else if (this.reason === 'unavailable') this.reason = 'waiting';
            });
        }).catch((error) => {
            if (this.stopped) return;
            this._clear('error');
            if (ctx.log && ctx.log.info) ctx.log.info('gear recommendation unavailable: ' + error.message);
        });
    }
    _clear(reason) { this.at = null; this.direction = null; this.reason = reason; }
    setProgramAvailability(available) {
        if (this.stopped) return;
        this.modeAvailable = !!available;
        if (!available) this.mode = null;
    }
    setProgram(sample) {
        if (!this.stopped && this.modeAvailable !== false) this.mode = modeOf(sample);
    }
    status() {
        const available = !this.stopped && !!(this.sub && this.sub.available);
        if (!available && this.sub && !this.stopped) this._clear('unavailable');
        const ageMs = this.at === null ? null : this.now() - this.at;
        const fresh = available && ageMs !== null && ageMs >= 0 && ageMs <= MAX_AGE_MS && this.direction !== null;
        return { source: SOURCE, available, fresh, ageMs, direction: fresh ? this.direction : null,
            sequentialMode: this.modeAvailable === true ? this.mode : null,
            reason: this.stopped ? 'stopped' : available && this.at !== null && !fresh && this.direction !== null ? 'stale' : this.reason };
    }
    value(data) {
        const state = this.status();
        if (!data || data.stage !== 'D' || !Number.isInteger(data.gear) || data.gear < 1
            || !state.sequentialMode || !isSequential(data, state.sequentialMode) || !state.fresh || state.direction === 'off') return null;
        return state.direction;
    }
    stop() {
        if (this.stopped) return;
        this.stopped = true; this.mode = null; this.modeAvailable = false;
        this._clear('stopped'); shutdown(this.sub);
    }
}

module.exports = { GearRecommendation, decode, modeOf, INTERFACE, FIELD, SOURCE, MAX_AGE_MS };
