'use strict';

/*
 * Read-only factory cruise display, never an inferred cruise state.
 * Public BMW M8 i-Level 20-07-510 catalog, idrive7-apps issue 15 attachment:
 * https://github.com/user-attachments/files/34052657/someip-interfaces.json
 * SHA256 25d91c40bfa6eae0f415caf5b4be2d3a8099db19f1ff927b2b0317dc1a166887
 * DisplayDataServer2: service 45222, v1.0, instance 1; functionalLibraryData
 * getter 1, notifier 32769 / eventgroup 1. All members/enums below are exact.
 * LDMSetSpeedValue is UInt16, with no physical scaling/default in this catalog.
 * Independent app reads it directly as the speed the cluster shows:
 * https://github.com/ALMSTRA/idv7lol/blob/ff54c2cabd465eea1521770573701f26c36f880b/apps/idv7lol/signals.js
 * The older display's direct value is independently documented in display units:
 * https://github.com/eroobeeroo/idrive7-cluster-info/blob/10cefda018e59a4b21b4aa8026fc9116f0f4bd9e/shared/data.js
 * Use only the explicit unitFirstSpeed in the SAME Server2 payload. No theme
 * unit, default metric unit, speed-ratio inference or legacy fallback is used.
 * The public catalog and independent decoder support this interpretation;
 * Server2 delivery and a live MPH comparison on the G82 remain unverified.
 * Factory standby colour is INACTIVE_GREY; amber is the F8X theme's styling.
 */
const INTERFACE = 'de.bmw.infotainment.displaydata.DisplayDataServer2';
const FIELD = 'functionalLibraryData';
const SOURCE = 'DisplayDataServer2.' + FIELD;
const MAX_AGE_MS = 3500;
const MPH_TO_KMH = 1.609344;
const ICON = { OFF: 0, SLD: 1, HDC: 2, DCC: 3, DCC_DEGRADED: 4,
    ACC_WITHOUT_TARGET_OBJECT: 5, ACC_WITH_TARGET_OBJECT: 6 };
const STATE = { OFF: 0, STANDBY: 1, ACTIVE: 2, OVERRIDE: 3, GO_REQUEST: 4,
    BRAKE_ONLY: 5, TAKE_OVER_REQUEST: 6, WARNING_FOR_SLD: 7 };
const COLOUR = { OFF: 0, ACTIVE_GREEN: 1, INACTIVE_GREY: 2 };
const UNIT = { OFF: 0, KMH: 1, MPH: 2 };
const clock = () => process.uptime() * 1000;

function enumOf(value, names) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(names, value)
        ? names[value] : value;
}
function fields(sample) {
    const v = sample && typeof sample === 'object' ? sample : {};
    const set = v.ldmSetSpeed && typeof v.ldmSetSpeed === 'object' ? v.ldmSetSpeed : {};
    return { icon: enumOf(v.ldmIconId, ICON), state: enumOf(v.ldmIconState, STATE),
        colour: enumOf(set.ldmSetSpeedColour, COLOUR), raw: set.ldmSetSpeedValue,
        unit: enumOf(v.speed && v.speed.unitFirstSpeed, UNIT) };
}
function reasonOf(sample) {
    const f = fields(sample);
    if (f.icon === 0 || f.state === 0 || f.colour === 0) return 'off';
    if (f.icon === 1 || f.icon === 2) return 'not-cruise';
    if (f.icon !== 3 && f.icon !== 4 && f.icon !== 5 && f.icon !== 6) return 'invalid';
    // Override, braking, takeover and other assistance states are intentionally
    // not presented as a normal engaged/standby cruise indication.
    if (f.state !== 1 && f.state !== 2) return 'unsupported-state';
    if ((f.state === 2 && f.colour !== 1) || (f.state === 1 && f.colour !== 2)) return 'inconsistent';
    return 'live';
}
function decode(sample) {
    if (reasonOf(sample) !== 'live') return null;
    const f = fields(sample);
    const unit = f.unit === 1 ? 'km/h' : f.unit === 2 ? 'mph' : null;
    // 0/65535 and out-of-range UInt16 values never become a stored target.
    // The independent direct decoder uses the conservative display range <400.
    const validSpeed = Number.isInteger(f.raw) && f.raw > 0 && f.raw < 400;
    return { mode: f.icon === 3 || f.icon === 4 ? 'dcc' : 'acc',
        state: f.state === 2 ? 'active' : 'standby', active: f.state === 2,
        setSpeedKmh: validSpeed && unit ? f.raw * (unit === 'mph' ? MPH_TO_KMH : 1) : null,
        rawSetSpeed: validSpeed ? f.raw : null, unit };
}
function shutdown(sub) {
    if (sub && sub.shutdown) Promise.resolve().then(() => sub.shutdown()).catch(() => {});
}

class Cruise {
    constructor(ctx, options) {
        this.now = options && options.now || clock;
        this.sub = null;
        this.reading = null;
        this.at = null;
        this.reason = 'waiting';
        this.stopped = false;
        this.wasAvailable = false;
        this.timer = setInterval(() => this._availability(), 100);
        if (this.timer.unref) this.timer.unref();
        Promise.resolve().then(() => ctx.signals.watch(INTERFACE, '1', {
            [FIELD]: (sample) => {
                if (this.stopped) return;
                if (this.sub && !this.sub.available) { this._clear('unavailable'); return; }
                this.reading = decode(sample);
                this.at = this.now();
                this.reason = reasonOf(sample);
            },
        }, ctx.log, { pollMs: 1000, pollFields: [FIELD], readTimeoutMs: 1000 })).then((sub) => {
            if (this.stopped) { shutdown(sub); return; }
            this.sub = sub;
            if (sub.onAvailability) sub.onAvailability(() => this._availability());
            this._availability();
        }).catch((error) => {
            if (this.stopped) return;
            this._clear('error');
            if (ctx.log && ctx.log.info) ctx.log.info('cruise display unavailable: ' + error.message);
        });
    }
    _clear(reason) {
        this.reading = null;
        this.at = null;
        this.reason = reason;
    }
    _availability() {
        if (this.stopped || !this.sub) return;
        const available = !!this.sub.available;
        if (!available) this._clear('unavailable');
        else if (!this.wasAvailable && this.reason === 'unavailable') this.reason = 'waiting';
        this.wasAvailable = available;
    }
    status() {
        this._availability();
        const available = !this.stopped && !!(this.sub && this.sub.available);
        const ageMs = this.at === null ? null : Math.max(0, this.now() - this.at);
        const timely = available && ageMs !== null && ageMs <= MAX_AGE_MS;
        const fresh = timely && this.reading !== null;
        const reason = this.stopped ? 'stopped'
            : available && ageMs !== null && !timely ? 'stale' : this.reason;
        return { source: SOURCE, available, fresh, ageMs, reason,
            cruise: fresh ? Object.assign({}, this.reading) : null };
    }
    value() { return this.status().cruise; }
    stop() {
        if (this.stopped) return;
        this.stopped = true;
        clearInterval(this.timer);
        this.timer = null;
        this._clear('stopped');
        shutdown(this.sub);
    }
}

module.exports = { Cruise, decode, reasonOf, INTERFACE, FIELD, MAX_AGE_MS, MPH_TO_KMH };
