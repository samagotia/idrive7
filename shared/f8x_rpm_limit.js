'use strict';

/*
 * Read-only permitted-RPM subscription. No temperature model or limiter learning.
 * Catalog: BMW M8 i-Level 20-07-510, publicly attached to idrive7-apps issue 15:
 * https://github.com/user-attachments/files/34052657/someip-interfaces.json
 * SHA-256: 25d91c40bfa6eae0f415caf5b4be2d3a8099db19f1ff927b2b0317dc1a166887
 * Exact field/type is verified in that catalog; it contains no physical scaling.
 * Factor 50 is independently corroborated by CAN 0x3F9 Rpm_MAX at bits 56..63:
 * https://github.com/billyjack2/CAN-DBC-Collection/blob/6e2f88fd6cd9c1f47d0db7bd022711b106f27027/BMW/F_Series/can1.dbc
 * The historical IterioDev 0.5.x implementation used the same SOME/IP field:
 * https://github.com/IterioDev/car-apps/blob/22a141241d6d329ea671426749a8a029ac22258e/tools/iteriodev-overlays/shiftlights.js
 * Current IterioDev 0.6.0 omits that automatic input; the historical example
 * does not verify S58 scaling. G82 delivery and cold tracking need comparison with
 * the factory tachometer. A catalog entry is not proof that every car sends it.
 */
const INTERFACE = 'de.bmw.infrastructure.VehicleInformation';
const FIELD = 'DataPowerTrain2CRC';
const SOURCE = 'VehicleInformation.' + FIELD;
const MAX_AGE_MS = 3000;
const FACTOR = 50;
const REDUCTIONS = {
    IN_ORDNUNG: 0,
    KLEINE_REDUZIERUNG_DER_ABREGELDREHZAHL: 1,
    GROSSE_REDUZIERUNG_DER_ABREGELDREHZAHL: 2,
};
const clock = () => process.uptime() * 1000;

function decode(sample) {
    const raw = sample && sample.rPMEngineMaximumAllowed;
    // UInt8 default 255 means invalid. Zero is not a usable permitted RPM.
    if (!Number.isInteger(raw) || raw <= 0 || raw >= 255) return null;
    const rpm = raw * FACTOR;
    // Do not mistake an implausible or differently scaled value for a limit.
    return rpm >= 1000 && rpm <= 10000 ? rpm : null;
}
function reductionOf(sample) {
    const raw = sample && sample.reductionDownControlRPMDrive2;
    const value = typeof raw === 'string' ? REDUCTIONS[raw] : raw;
    return Number.isInteger(value) && value >= 0 && value <= 2 ? value : null;
}
function shutdown(sub) {
    if (sub && sub.shutdown) Promise.resolve().then(() => sub.shutdown()).catch(() => {});
}

class RpmLimit {
    constructor(ctx, options) {
        this.now = options && options.now || clock;
        this.sub = null;
        this.raw = null;
        this.rpm = null;
        this.reduction = null;
        this.at = null;
        this.reason = 'waiting';
        this.stopped = false;
        this.wasAvailable = false;
        // Availability is exposed as a property by signals.watch. Observe it even
        // while Auto display is disabled, so reconnect cannot revive old data.
        this.timer = setInterval(() => this._availability(), 100);
        if (this.timer.unref) this.timer.unref();
        Promise.resolve().then(() => ctx.signals.watch(INTERFACE, '1', {
            [FIELD]: (sample) => {
                if (this.stopped) return;
                if (this.sub && !this.sub.available) { this._clear('unavailable'); return; }
                this.raw = sample && sample.rPMEngineMaximumAllowed;
                this.rpm = decode(sample);
                this.reduction = reductionOf(sample);
                this.at = this.now();
                this.reason = this.rpm === null ? 'invalid' : 'live';
            },
        }, ctx.log)).then((sub) => {
            if (this.stopped) { shutdown(sub); return; }
            this.sub = sub;
            this._availability();
        }).catch((error) => {
            if (this.stopped) return;
            this._clear('error');
            if (ctx.log && ctx.log.info) ctx.log.info('permitted RPM unavailable: ' + error.message);
        });
    }

    _clear(reason) {
        this.raw = null;
        this.rpm = null;
        this.reduction = null;
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
        const fresh = available && ageMs !== null && ageMs <= MAX_AGE_MS && this.rpm !== null;
        const reason = this.stopped ? 'stopped'
            : this.reason === 'live' && !fresh && available ? 'stale' : this.reason;
        return { source: SOURCE, available, fresh, raw: this.raw,
            rpm: fresh ? this.rpm : null, reduction: fresh ? this.reduction : null, ageMs, reason };
    }
    value() { return this.status().rpm; }
    stop() {
        if (this.stopped) return;
        this.stopped = true;
        clearInterval(this.timer);
        this.timer = null;
        this._clear('stopped');
        shutdown(this.sub);
    }
}

module.exports = { RpmLimit, decode, reductionOf, INTERFACE, FIELD, MAX_AGE_MS, FACTOR };
