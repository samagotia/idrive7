'use strict';

/*
 * CarFormats(ctx[, {now}]) starts two READ-ONLY watches immediately; stop()
 * releases both. value() returns fresh car preferences (null per unknown
 * member), plus time/date components and displayDate/date. Date objects encode
 * the CAR'S LOCAL components as UTC: consumers MUST use getUTC*(), never local
 * getters, a second timezone offset, or the host clock. No host-date fallback
 * or guessed century is provided. Samples are not extrapolated between reads.
 *
 * Exact fields/types/enums: BMW M8 i-Level20-07-510 public catalog:
 * https://github.com/cauliflowermossgrape/idrive7-apps/issues/15
 * https://github.com/user-attachments/files/34052657/someip-interfaces.json
 * SHA256 25d91c40bfa6eae0f415caf5b4be2d3a8099db19f1ff927b2b0317dc1a166887
 * Vehicle.statusNewCurrentUnitsStatusExt getter46/notifier32814/group1;
 * KombiIF.statusShowTimeDate getter30/notifier32798/group1, instance1.
 * DisplayDateYear is UInt16 (invalid65535), NOT timeDateUTC's UInt8 year.
 * Literal full years2000..2199 are accepted; two-digit/offset years rejected.
 * This interpretation is supported by upstream's full-year clock fixtures:
 * https://github.com/robertnisipeanu/mgu-store/blob/e2c5f10fd46c26239982383b9c8212a8ea7a749f/apps/robertn_store/tools/test_view.js
 * Its src/store_view.js documents displayed local/DST time and valid odd
 * statusDisplayClockTimeDate; even=invalid,15=unfilled. G82 delivery and year
 * encoding still require a live read; these sources are not G82 test evidence.
 *
 * Date preference establishes ORDER/SEPARATOR ONLY. dateOrder is exact;
 * dateFormat uses F8X's two-digit year styling policy, not a claimed BMW year
 * width signal. Explicit app settings must override these automatic values.
 * Preferences and clock have separate freshness windows; invalid payloads
 * immediately clear their own channel instead of preserving a stale value.
 */
const UNITS_INTERFACE = 'de.bmw.infotainment.vehicle.Vehicle';
const UNITS_FIELD = 'statusNewCurrentUnitsStatusExt';
const CLOCK_INTERFACE = 'de.bmw.infotainment.KombiIF';
const CLOCK_FIELD = 'statusShowTimeDate';
const UNITS_MAX_AGE_MS = 25000;
const CLOCK_MAX_AGE_MS = 3500;
const DATE_ORDERS = {
    REIHENFOLGE__TAG_P_MONAT_P_JAHR: 1,
    REIHENFOLGE__MONAT_S_TAG_S_JAHR: 2,
    REIHENFOLGE__TAG_S_MONAT_S_JAHR: 3,
    REIHENFOLGE__TAG_MINUS_MONAT_MINUS_JAHR: 4,
    REIHENFOLGE__JAHR_P_MONAT_P_TAG: 5,
    REIHENFOLGE__JAHR_S_MONAT_S_TAG: 6,
    REIHENFOLGE__JAHR_MINUS_MONAT_MINUS_TAG: 7,
};
const DATE_FORMAT = { 1: ['DMY.', 'DD.MM.YY'], 2: ['MDY/', 'MM/DD/YY'],
    3: ['DMY/', 'DD/MM/YY'], 4: ['DMY-', 'DD-MM-YY'], 5: ['YMD.', 'YY.MM.DD'],
    6: ['YMD/', 'YY/MM/DD'], 7: ['YMD-', 'YY-MM-DD'] };
const monotonicNow = () => process.uptime() * 1000;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function enumValue(v, names) { return typeof v === 'string' && has(names, v) ? names[v] : v; }
function choose(raw, names, choices) {
    const value = enumValue(raw, names);
    return Number.isInteger(value) && has(choices, value) ? choices[value] : null;
}
function decodeUnits(sample) {
    const v = sample && typeof sample === 'object' ? sample : {};
    const dateKey = enumValue(v.unitOfMeasurementDateExtended, DATE_ORDERS);
    const format = Number.isInteger(dateKey) && has(DATE_FORMAT, dateKey) ? DATE_FORMAT[dateKey] : null;
    return {
        temperature: choose(v.unitOfMeasurementTemperature, { C: 1, F: 2 }, { 1: 'metric', 2: 'us' }),
        distance: choose(v.unitOfMeasurementSpeedometerDigital, { KILOMETER: 1, MEILEN: 2 }, { 1: 'metric', 2: 'us' }),
        clock: choose(v.unitOfMeasurementTime, { _12_H: 1, _24_H: 2 }, { 1: '12h', 2: '24h' }),
        consumption: choose(v.unitOfMeasurementConsumption, { L_S_100KM: 1, MPG__UK: 2, MPG__US: 3, KM_S_L: 4 },
            { 1: 'l/100km', 2: 'mpg_uk', 3: 'mpg_us', 4: 'km/l' }),
        dateOrder: format ? format[0] : null,
        dateFormat: format ? format[1] : null,
    };
}
function integerIn(v, min, max) { return Number.isInteger(v) && v >= min && v <= max; }
function decodeClock(sample) {
    const v = sample && typeof sample === 'object' ? sample : {};
    const status = v.statusDisplayClockTimeDate;
    // The catalog's field is UInt8. Accept only the documented filled nibble.
    if (!integerIn(status, 0, 14) || status % 2 !== 1) return null;
    if (!integerIn(v.displayHour, 0, 23) || !integerIn(v.displayMinute, 0, 59)) return null;
    const hour = v.displayHour, minute = v.displayMinute;
    const second = integerIn(v.displaySecond, 0, 59) ? v.displaySecond : null;
    const year = v.displayDateYear, month = v.displayDateMonth, day = v.displayDateDay;
    let calendar = null;
    if (integerIn(year, 2000, 2199) && integerIn(month, 1, 12) && integerIn(day, 1, 31)) {
        const d = new Date(Date.UTC(year, month - 1, day));
        if (d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day) {
            calendar = { year, month, day };
        }
    }
    // An unfilled second does not invalidate a displayed HH:MM, but it is
    // never treated as an observed zero second or used for extrapolation.
    return { hour, minute, second, calendar, status };
}
function shutdown(sub) {
    if (sub && sub.shutdown) Promise.resolve().then(() => sub.shutdown()).catch(() => {});
}
function emptyUnits() { return decodeUnits(null); }
function channel(iface, field, pollMs, maxAgeMs) {
    return { iface, field, pollMs, maxAgeMs, sub: null, at: null,
        reading: null, reason: 'waiting', wasAvailable: false };
}
class CarFormats {
    constructor(ctx, options) {
        this.now = options && options.now || monotonicNow;
        this.stopped = false;
        this.channels = {
            units: channel(UNITS_INTERFACE, UNITS_FIELD, 10000, UNITS_MAX_AGE_MS),
            clock: channel(CLOCK_INTERFACE, CLOCK_FIELD, 1000, CLOCK_MAX_AGE_MS),
        };
        Object.keys(this.channels).forEach((key) => this._watch(ctx, key));
        this.timer = setInterval(() => this._availability(), 100);
        if (this.timer.unref) this.timer.unref();
    }
    _clear(c, reason) { c.reading = null; c.at = null; c.reason = reason; }
    _watch(ctx, key) {
        const c = this.channels[key];
        const handlers = {};
        handlers[c.field] = (sample) => {
            if (this.stopped) return;
            this._availability();
            if (c.sub && !c.sub.available) { this._clear(c, 'unavailable'); return; }
            c.reading = key === 'units' ? decodeUnits(sample) : decodeClock(sample);
            c.at = this.now();
            const valid = key === 'units' ? Object.keys(c.reading).some((k) => c.reading[k] !== null) : c.reading !== null;
            c.reason = valid ? 'live' : 'invalid';
        };
        Promise.resolve().then(() => ctx.signals.watch(c.iface, '1', handlers, ctx.log,
            { pollMs: c.pollMs, pollFields: [c.field], readTimeoutMs: 1000 })).then((sub) => {
            if (this.stopped) { shutdown(sub); return; }
            c.sub = sub;
            if (sub.onAvailability) sub.onAvailability(() => this._availability());
            this._availability();
        }).catch((error) => {
            if (this.stopped) return;
            this._clear(c, 'error');
            if (ctx.log && ctx.log.info) ctx.log.info('car formats ' + key + ' unavailable: ' + error.message);
        });
    }
    _availability() {
        if (this.stopped) return;
        Object.keys(this.channels).forEach((key) => {
            const c = this.channels[key];
            if (!c.sub) return;
            const available = !!c.sub.available;
            if (!available) this._clear(c, 'unavailable');
            else if (!c.wasAvailable && c.reason === 'unavailable') this._clear(c, 'waiting');
            c.wasAvailable = available;
        });
    }
    _status(c) {
        const available = !this.stopped && !!(c.sub && c.sub.available);
        let ageMs = c.at === null ? null : this.now() - c.at;
        // Even an injected/backwards clock cannot make an expired sample live.
        if (ageMs !== null && (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > c.maxAgeMs)) {
            this._clear(c, 'stale');
            ageMs = null;
        }
        const fresh = available && c.at !== null && c.reason === 'live';
        return { source: c.iface + '.' + c.field, available, fresh, ageMs,
            reason: this.stopped ? 'stopped' : c.reason };
    }
    status() {
        this._availability();
        return { units: this._status(this.channels.units), clock: this._status(this.channels.clock) };
    }
    value() {
        const status = this.status();
        const result = status.units.fresh ? Object.assign({}, this.channels.units.reading) : emptyUnits();
        const time = status.clock.fresh ? this.channels.clock.reading : null;
        result.time = time ? { hour: time.hour, minute: time.minute, second: time.second } : null;
        result.components = time && time.calendar ? Object.assign({}, time.calendar, result.time) : null;
        // Missing seconds use00 only as a minute-resolution Date representation.
        result.date = result.components ? new Date(Date.UTC(result.components.year, result.components.month - 1,
            result.components.day, time.hour, time.minute, time.second === null ? 0 : time.second)) : null;
        result.displayDate = result.date ? new Date(result.date.getTime()) : null;
        result.dateYearWidthVerified = false;
        return result;
    }
    stop() {
        if (this.stopped) return;
        this.stopped = true;
        clearInterval(this.timer); this.timer = null;
        Object.keys(this.channels).forEach((key) => {
            const c = this.channels[key]; this._clear(c, 'stopped'); shutdown(c.sub);
        });
    }
}

module.exports = { CarFormats, decodeUnits, decodeClock, DATE_ORDERS,
    UNITS_INTERFACE, UNITS_FIELD, CLOCK_INTERFACE, CLOCK_FIELD, UNITS_MAX_AGE_MS, CLOCK_MAX_AGE_MS };
