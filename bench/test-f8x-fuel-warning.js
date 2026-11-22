'use strict';
const assert = require('assert').strict;
const { decodeReserve, evaluateFuelWarning, MAX_AGE_MS, RANGE_THRESHOLD_KM } = require('../shared/f8x_fuel_warning');
assert.equal(RANGE_THRESHOLD_KM, 50);
for (const value of [1, 'AKTIV']) assert.equal(decodeReserve(value), true);
for (const value of [0, 'NICHT_AKTIV']) assert.equal(decodeReserve(value), false);
for (const value of [undefined, null, true, false, '1', '0', 2, 3, 255, 'SIGNAL_UNGUELTIG', {}, []]) {
    assert.equal(decodeReserve(value), null);
}
const live = { available: true, ageMs: 0, reserve: undefined, rangeKm: 450 };
const evaluate = (patch) => evaluateFuelWarning({ ...live, ...patch });
assert.deepEqual(evaluate({ reserve: 1, rangeKm: 450 }), { active: true, source: 'bmw-reserve', rangeKm: 450 });
assert.deepEqual(evaluate({ reserve: 0, rangeKm: 20 }), { active: false, source: 'bmw-reserve', rangeKm: 20 });
assert.equal(evaluate({ reserve: 'AKTIV', rangeKm: 4095 }).active, true, 'valid reserve flag needs no range');
assert.equal(evaluate({ reserve: 'NICHT_AKTIV', rangeKm: null }).active, false);
for (const rangeKm of [0, 1, 49.999, 50]) {
    const state = evaluate({ reserve: 3, rangeKm });
    assert.equal(state.active, true); assert.equal(state.source, 'range-fallback');
}
for (const rangeKm of [50.001, 51, 4094]) assert.equal(evaluate({ rangeKm }).active, false);
for (const rangeKm of [-1, 4095, Infinity, NaN, null, undefined, '50']) assert.equal(evaluate({ rangeKm }).active, null);
assert.equal(evaluate({ ageMs: MAX_AGE_MS - 1, rangeKm: 50 }).active, true);
for (const ageMs of [-1, MAX_AGE_MS, MAX_AGE_MS + 1, Infinity, NaN, null, undefined]) {
    assert.deepEqual(evaluate({ reserve: 1, rangeKm: 20, ageMs }), { active: null, source: 'unavailable', rangeKm: null });
}
for (const available of [false, undefined, null, 1, 'true']) {
    assert.equal(evaluate({ available, reserve: 1, rangeKm: 20 }).active, null, 'provider loss cannot preserve a warning');
}
assert.equal(evaluateFuelWarning(null).active, null);
// Units are canonical km here; display-unit changes must not change the threshold.
assert.equal(evaluate({ rangeKm: 50, displayUnits: 'us' }).active, true);
assert.equal(evaluate({ rangeKm: 50.1, displayUnits: 'us' }).active, false);
// No latching/hysteresis invents an extra policy: fresh authoritative updates replace state.
assert.equal(evaluate({ reserve: 1 }).active, true);
assert.equal(evaluate({ reserve: 0 }).active, false);
assert.equal(evaluate({ rangeKm: 50 }).active, true);
assert.equal(evaluate({ rangeKm: 51 }).active, false);
console.log('F8X fuel warning: BMW enum priority, inclusive 50 km fallback, invalid/missing data, freshness/provider loss and unit independence passed.');
