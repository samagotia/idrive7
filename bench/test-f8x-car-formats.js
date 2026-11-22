'use strict';
const assert = require('assert');
const { CarFormats, decodeUnits, decodeClock, DATE_ORDERS, UNITS_INTERFACE, UNITS_FIELD,
    CLOCK_INTERFACE, CLOCK_FIELD, UNITS_MAX_AGE_MS, CLOCK_MAX_AGE_MS } = require('../shared/f8x_car_formats');
const tick = () => new Promise((resolve) => setImmediate(resolve));
function units(overrides) {
    return Object.assign({ unitOfMeasurementTemperature: 1, unitOfMeasurementSpeedometerDigital: 1,
        unitOfMeasurementTime: 2, unitOfMeasurementConsumption: 1, unitOfMeasurementDateExtended: 1 }, overrides);
}
function clock(overrides) {
    return Object.assign({ displayHour: 23, displayMinute: 59, displaySecond: 58,
        displayDateYear: 2024, displayDateMonth: 2, displayDateDay: 29, statusDisplayClockTimeDate: 1 }, overrides);
}
async function run() {
    assert.deepStrictEqual(decodeUnits(units()), { temperature: 'metric', distance: 'metric', clock: '24h',
        consumption: 'l/100km', dateOrder: 'DMY.', dateFormat: 'DD.MM.YY' });
    assert.deepStrictEqual(decodeUnits(units({ unitOfMeasurementTemperature: 'F', unitOfMeasurementSpeedometerDigital: 'MEILEN',
        unitOfMeasurementTime: '_12_H', unitOfMeasurementConsumption: 'MPG__UK',
        unitOfMeasurementDateExtended: 'REIHENFOLGE__MONAT_S_TAG_S_JAHR' })),
    { temperature: 'us', distance: 'us', clock: '12h', consumption: 'mpg_uk', dateOrder: 'MDY/', dateFormat: 'MM/DD/YY' });
    for (const n of [0, 3, 7, 31, 255, null, undefined, NaN, Infinity, true, '1', 'DEFAULT', 'SIGNAL_UNGUELTIG', {}]) {
        assert.strictEqual(decodeUnits(units({ unitOfMeasurementTemperature: n })).temperature, null);
        assert.strictEqual(decodeUnits(units({ unitOfMeasurementTime: n })).clock, null);
        assert.strictEqual(decodeUnits(units({ unitOfMeasurementSpeedometerDigital: n })).distance, null);
    }
    const consumption = [null, 'l/100km', 'mpg_uk', 'mpg_us', 'km/l'];
    consumption.forEach((want, raw) => assert.strictEqual(decodeUnits(units({ unitOfMeasurementConsumption: raw })).consumption, want));
    ['L_S_100KM', 'MPG__UK', 'MPG__US', 'KM_S_L'].forEach((raw, i) =>
        assert.strictEqual(decodeUnits(units({ unitOfMeasurementConsumption: raw })).consumption, consumption[i + 1]));
    [0, 5, 6, 7, '4', true, null].forEach((raw) => assert.strictEqual(decodeUnits(units({ unitOfMeasurementConsumption: raw })).consumption, null));
    const dateFormats = ['DD.MM.YY', 'MM/DD/YY', 'DD/MM/YY', 'DD-MM-YY', 'YY.MM.DD', 'YY/MM/DD', 'YY-MM-DD'];
    Object.keys(DATE_ORDERS).forEach((name) => {
        assert.strictEqual(decodeUnits(units({ unitOfMeasurementDateExtended: name })).dateFormat, dateFormats[DATE_ORDERS[name] - 1]);
        assert.strictEqual(decodeUnits(units({ unitOfMeasurementDateExtended: DATE_ORDERS[name] })).dateFormat, dateFormats[DATE_ORDERS[name] - 1]);
    });
    [0, 8, 31, 'DEFAULT', 'SIGNAL_UNGUELTIG', '1', true].forEach((raw) =>
        assert.strictEqual(decodeUnits(units({ unitOfMeasurementDateExtended: raw })).dateFormat, null));
    assert.deepStrictEqual(decodeClock(clock()), { hour: 23, minute: 59, second: 58,
        calendar: { year: 2024, month: 2, day: 29 }, status: 1 });
    [0, 2, 4, 6, 8, 10, 12, 14, 15, 255, -1, 256, '1', true, null, undefined, NaN].forEach((status) =>
        assert.strictEqual(decodeClock(clock({ statusDisplayClockTimeDate: status })), null));
    [1, 3, 5, 7, 9, 11, 13].forEach((status) => assert.ok(decodeClock(clock({ statusDisplayClockTimeDate: status }))));
    for (const pair of [['displayHour', 24], ['displayHour', -1], ['displayHour', 255], ['displayHour', '1'],
        ['displayMinute', 60], ['displayMinute', null], ['displayMinute', true], ['displayMinute', 1.5]]) {
        const v = {}; v[pair[0]] = pair[1]; assert.strictEqual(decodeClock(clock(v)), null);
    }
    assert.strictEqual(decodeClock(clock({ displaySecond: 255 })).second, null);
    assert.strictEqual(decodeClock(clock({ displaySecond: '0' })).second, null);
    for (const v of [{ displayDateYear: 26 }, { displayDateYear: 126 }, { displayDateYear: 65535 },
        { displayDateYear: '2024' }, { displayDateYear: 2200 }, { displayDateMonth: 0 }, { displayDateMonth: 15 },
        { displayDateDay: 0 }, { displayDateDay: 255 }, { displayDateYear: 2023 },
        { displayDateYear: 2100 }, { displayDateMonth: 4, displayDateDay: 31 }]) {
        const decoded = decodeClock(clock(v)); assert.ok(decoded); assert.strictEqual(decoded.calendar, null);
    }
    assert.ok(decodeClock(clock({ displayDateYear: 2000 })).calendar, 'century divisible400 is leapyear');

    let now = 0, shutdowns = 0;
    const watches = {};
    const ctx = { log: { info() {} }, signals: { watch(iface, instance, handlers, log, opts) {
        assert.strictEqual(instance, '1');
        const field = Object.keys(handlers)[0];
        assert.strictEqual(Object.keys(handlers).length, 1);
        assert.strictEqual(iface, field === UNITS_FIELD ? UNITS_INTERFACE : CLOCK_INTERFACE);
        assert.deepStrictEqual(opts, { pollMs: field === UNITS_FIELD ? 10000 : 1000,
            pollFields: [field], readTimeoutMs: 1000 });
        const w = { receive: handlers[field], available: true, availability: null,
            shutdown() { shutdowns++; }, onAvailability(fn) { w.availability = fn; } };
        watches[field] = w;
        return Promise.resolve(w);
    } } };
    const tracker = new CarFormats(ctx, { now: () => now });
    await tick();
    assert.strictEqual(tracker.value().temperature, null); assert.strictEqual(tracker.value().date, null);
    const u = watches[UNITS_FIELD], c = watches[CLOCK_FIELD];
    u.receive(units()); c.receive(clock());
    assert.strictEqual(tracker.value().temperature, 'metric');
    assert.strictEqual(tracker.value().displayDate.toISOString(), '2024-02-29T23:59:58.000Z');
    assert.strictEqual(tracker.value().dateYearWidthVerified, false);
    assert.deepStrictEqual(tracker.value().time, { hour: 23, minute: 59, second: 58 });
    const copy = tracker.value(); copy.date.setUTCFullYear(2099); copy.components.year = 2099; copy.time.hour = 0; copy.distance = 'us';
    assert.strictEqual(tracker.value().date.getUTCFullYear(), 2024); assert.strictEqual(tracker.value().time.hour, 23);
    assert.strictEqual(tracker.value().distance, 'metric');
    now = CLOCK_MAX_AGE_MS; assert.ok(tracker.value().date);
    now++; assert.strictEqual(tracker.value().date, null); assert.strictEqual(tracker.status().clock.reason, 'stale');
    assert.strictEqual(tracker.value().distance, 'metric');
    now = 0; assert.strictEqual(tracker.value().date, null, 'clock rollback cannot revive expired data');
    c.receive(clock({ displayDateYear: 26 }));
    assert.strictEqual(tracker.value().date, null); assert.ok(tracker.value().time, 'unsupported year must not erase valid displayed time');
    c.receive(clock({ displaySecond: 255 })); assert.strictEqual(tracker.value().date.toISOString(), '2024-02-29T23:59:00.000Z');
    assert.strictEqual(tracker.value().components.second, null, 'minute representation must not claim observed00sec');
    c.receive(clock({ displayMinute: 255 })); assert.strictEqual(tracker.value().time, null);
    c.receive(clock());
    now = NaN; assert.strictEqual(tracker.value().date, null, 'nonfinite time cannot keep a sample live');
    now = 0; assert.strictEqual(tracker.value().date, null, 'recovering test clock requires a new sample');
    c.receive(clock());
    now = UNITS_MAX_AGE_MS + 1;
    assert.strictEqual(tracker.value().distance, null); assert.strictEqual(tracker.status().units.reason, 'stale');
    now = 100; assert.strictEqual(tracker.value().distance, null);
    u.receive(units()); c.receive(clock());
    u.available = false; u.availability(false);
    assert.strictEqual(tracker.value().distance, null); assert.ok(tracker.value().date);
    u.receive(units()); assert.strictEqual(tracker.value().distance, null, 'reject late data while provider unavailable');
    u.available = true; u.availability(true); assert.strictEqual(tracker.value().distance, null, 'provider recovery requires new sample');
    u.receive(units()); assert.strictEqual(tracker.value().distance, 'metric');
    c.available = false; c.availability(false); c.available = true; c.availability(true);
    assert.strictEqual(tracker.value().time, null); c.receive(clock()); assert.ok(tracker.value().time);
    u.receive({}); assert.strictEqual(tracker.value().temperature, null); assert.strictEqual(tracker.status().units.reason, 'invalid');
    u.receive(units()); c.receive({}); assert.strictEqual(tracker.value().date, null);
    tracker.stop(); u.receive(units()); c.receive(clock());
    assert.strictEqual(tracker.value().temperature, null); assert.strictEqual(tracker.value().date, null);
    assert.strictEqual(tracker.status().clock.reason, 'stopped');
    await tick(); assert.strictEqual(shutdowns, 2); tracker.stop(); await tick(); assert.strictEqual(shutdowns, 2);

    const pendingWatches = [];
    let lateShutdowns = 0;
    const pending = new CarFormats({ signals: { watch(iface, instance, handlers) {
        return new Promise((resolve) => pendingWatches.push({ resolve, handlers }));
    } } });
    await tick(); pending.stop();
    pendingWatches.forEach((w) => { Object.keys(w.handlers).forEach((f) => w.handlers[f](f === UNITS_FIELD ? units() : clock()));
        w.resolve({ available: true, shutdown() { lateShutdowns++; } }); });
    await tick(); assert.strictEqual(lateShutdowns, 2); assert.strictEqual(pending.value().date, null);
    const failed = new CarFormats({ signals: { watch() { throw new Error('interface missing'); } } });
    await tick(); assert.strictEqual(failed.status().units.reason, 'error'); assert.strictEqual(failed.status().clock.reason, 'error');
    failed.stop();
    console.log('Passed: car-unit numeric/named enums, invalid defaults, date order, clock status, full-year/leap-date validation, timezone-safe dates, read-only polling, independent freshness, reconnect, rollback and late teardown.');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
