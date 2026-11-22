'use strict';

// CDS mapping from cauliflowermossgrape/idrive7-apps live_data (MIT).
// Vehicle2's electronic parking-brake field and enum are verified in the
// owner's iDrive 7 service catalog. Reception still needs a parked comparison.
const INTERFACE = 'de.bmw.infotainment.vehicle.CDS';
const FIELD = 'statusHandBrake';
const EPB_INTERFACE = 'de.bmw.infotainment.vehicle.Vehicle2';
const EPB_FIELD = 'statusStandstillFunctions';
const MAX_AGE_MS = 2500;
const clock = () => process.uptime() * 1000;
const EPB = {
    PARKBREMSE_MECHANISCH_NICHT_FESTGESTELLT: 0,
    PARKBREMSE_MECHANISCH_FESTGESTELLT: 1,
    PARKBREMSE_IM_STELLVORGANG_LOESEN: 2,
    PARKBREMSE_IM_STELLVORGANG_FESTSTELLEN: 4,
    FUNKTIONSSCHNITTSTELLE_IST_NICHT_VERFUEGBAR: 13,
    FUNKTION_MELDET_FEHLER: 14,
    SIGNAL_UNBEFUELLT: 15,
};

function decode(sample) {
    const value = sample && sample.statusContactHandBrake;
    if (value === 2 || value === 'HANDBREMSE_ANGEZOGEN') return 'applied';
    if (value === 1 || value === 'HANDBREMSE_GELOEST') return 'released';
    return 'unknown';
}
function epbValue(sample) {
    const value = sample && sample.statusParkingBrake;
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EPB, value) ? EPB[value] : value;
}
function decodeEpb(sample) {
    const value = epbValue(sample);
    return value === 1 ? 'applied' : value === 0 ? 'released' : 'unknown';
}
function epbReason(sample) {
    const value = epbValue(sample);
    if (value === 0 || value === 1) return 'live';
    if (value === 2 || value === 4) return 'transition';
    if (value === 13) return 'unsupported';
    if (value === 14) return 'fault';
    return 'invalid';
}
function shutdown(sub) {
    if (sub && sub.shutdown) Promise.resolve().then(() => sub.shutdown()).catch(() => {});
}

class ParkingBrake {
    constructor(ctx, options) {
        this.now = options && options.now || clock;
        this.stopped = false;
        this.sources = {};
        const watches = [
            { id: 'electronic', iface: EPB_INTERFACE, field: EPB_FIELD, member: 'statusParkingBrake', decode: decodeEpb, reason: epbReason },
            { id: 'handbrake', iface: INTERFACE, field: FIELD, member: 'statusContactHandBrake', decode,
                reason: (sample) => decode(sample) === 'unknown' ? 'invalid' : 'live' },
        ];
        watches.forEach((source) => {
            const state = this.sources[source.id] = { sub: null, raw: null, state: 'unknown', at: null,
                reason: 'waiting', source: source.iface + '.' + source.field };
            Promise.resolve().then(() => ctx.signals.watch(source.iface, '1', {
                [source.field]: (sample) => {
                    if (this.stopped) return;
                    if (state.sub && !state.sub.available) { this._clear(state, 'unavailable'); return; }
                    const raw = sample && sample[source.member];
                    const value = source.decode(sample), reason = source.reason(sample);
                    const changed = state.state !== value || state.reason !== reason || state.raw !== raw;
                    state.raw = raw; state.state = value; state.reason = reason; state.at = this.now();
                    if (changed && ctx.log && ctx.log.info) ctx.log.info('parking brake ' + source.id + ': '
                        + value + ' (' + reason + ', raw=' + String(raw) + ')');
                },
            }, ctx.log, { pollMs: 1000, pollFields: [source.field], readTimeoutMs: 700 })).then((sub) => {
                if (this.stopped) { shutdown(sub); return; }
                state.sub = sub;
                if (!sub.available) this._clear(state, 'unavailable');
                if (sub.onAvailability) sub.onAvailability((available) => {
                    if (this.stopped) return;
                    if (!available) this._clear(state, 'unavailable');
                    else if (state.reason === 'unavailable') state.reason = 'waiting';
                });
            }).catch((error) => {
                if (this.stopped) return;
                this._clear(state, 'error');
                if (ctx.log && ctx.log.info) ctx.log.info('parking brake ' + source.id + ' unavailable: ' + error.message);
            });
        });
    }

    _clear(state, reason) {
        state.raw = null; state.state = 'unknown'; state.at = null; state.reason = reason;
    }
    _status(state) {
        const available = !this.stopped && !!(state.sub && state.sub.available);
        if (!available && !this.stopped && state.sub) this._clear(state, 'unavailable');
        const ageMs = state.at === null ? null : this.now() - state.at;
        const fresh = available && ageMs !== null && ageMs >= 0 && ageMs <= MAX_AGE_MS;
        return { source: state.source, available, fresh, raw: state.raw,
            state: fresh ? state.state : 'unknown', ageMs,
            reason: this.stopped ? 'stopped' : available && state.at !== null && !fresh ? 'stale' : state.reason };
    }
    status() {
        const electronic = this._status(this.sources.electronic), handbrake = this._status(this.sources.handbrake);
        // An actual electronic state wins. A transition or reported EPB fault
        // remains unknown; neither may revive an older applied contact.
        const selected = electronic.fresh && (electronic.state !== 'unknown' || electronic.reason === 'transition' || electronic.reason === 'fault')
            ? electronic : handbrake.fresh && handbrake.state !== 'unknown' ? handbrake : electronic;
        return Object.assign({}, selected, { candidates: { electronic, handbrake } });
    }
    value() { return this.status().state; }
    stop() {
        if (this.stopped) return;
        this.stopped = true;
        Object.keys(this.sources).forEach((key) => {
            const state = this.sources[key];
            this._clear(state, 'stopped');
            shutdown(state.sub);
        });
    }
}

module.exports = { ParkingBrake, decode, decodeEpb, epbReason, INTERFACE, FIELD, EPB_INTERFACE, EPB_FIELD, MAX_AGE_MS };
