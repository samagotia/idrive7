'use strict';
const assert = require('assert').strict;
const { Cruise, decode, reasonOf, INTERFACE, FIELD, MAX_AGE_MS } = require('../shared/f8x_cruise');
const tick = () => new Promise((resolve) => setImmediate(resolve));
function sample(icon, state, colour, speed, unit) {
    return { ldmIconId: icon, ldmIconState: state,
        ldmSetSpeed: { ldmSetSpeedValue: speed, ldmSetSpeedColour: colour },
        speed: { unitFirstSpeed: unit } };
}
const active = () => sample(3, 2, 1, 110, 1);

async function run() {
    assert.deepEqual(decode(active()), { mode: 'dcc', state: 'active', active: true,
        setSpeedKmh: 110, rawSetSpeed: 110, unit: 'km/h' });
    const mph = decode(sample('ACC_WITH_TARGET_OBJECT', 'STANDBY', 'INACTIVE_GREY', 69, 'MPH'));
    assert.equal(mph.mode, 'acc'); assert.equal(mph.state, 'standby'); assert.equal(mph.active, false);
    assert.equal(mph.unit, 'mph'); assert.equal(mph.rawSetSpeed, 69);
    assert.ok(Math.abs(mph.setSpeedKmh - 111.044736) < 1e-10);
    for (const icon of [3, 4, 5, 6]) assert.ok(decode(sample(icon, 2, 1, 100, 1)));
    for (const icon of [0, 1, 2, 7, 255, 'SLD', 'HDC', 'unknown', null, true]) {
        assert.equal(decode(sample(icon, 2, 1, 100, 1)), null, 'must not show non-cruise ' + icon);
    }
    for (const state of [0, 3, 4, 5, 6, 7, 255, 'OVERRIDE', 'BRAKE_ONLY', 'TAKE_OVER_REQUEST']) {
        assert.equal(decode(sample(3, state, 1, 100, 1)), null, 'must not mislabel state ' + state);
    }
    assert.equal(decode(sample(3, 2, 2, 110, 1)), null, 'active state and standby colour disagree');
    assert.equal(decode(sample(3, 1, 1, 110, 1)), null, 'standby state and active colour disagree');
    for (const speed of [0, 400, 65535, -1, 65536, 100.5, '110', undefined, null, NaN, Infinity]) {
        const v = decode(sample(3, 2, 1, speed, 1));
        assert.equal(v.active, true); assert.equal(v.setSpeedKmh, null); assert.equal(v.rawSetSpeed, null);
    }
    for (const unit of [0, 3, 255, undefined, null, 'OFF', 'unknown']) {
        const v = decode(sample(3, 2, 1, 110, unit));
        assert.equal(v.active, true); assert.equal(v.setSpeedKmh, null); assert.equal(v.unit, null);
        assert.equal(v.rawSetSpeed, 110, 'raw is diagnostic only when unit is unknown');
    }
    assert.equal(decode(null), null); assert.equal(decode({}), null);
    assert.equal(reasonOf(sample(3, 0, 0, 110, 1)), 'off');
    assert.equal(reasonOf(sample(1, 2, 1, 110, 1)), 'not-cruise');

    let now = 0, receive, availability, shutdowns = 0;
    const sub = { available: true, shutdown() { shutdowns++; }, onAvailability(fn) { availability = fn; } };
    const ctx = { log: { info() {} }, signals: { watch(iface, instance, handlers, log, opts) {
        assert.equal(iface, INTERFACE); assert.equal(instance, '1'); assert.deepEqual(Object.keys(handlers), [FIELD]);
        assert.deepEqual(opts, { pollMs: 1000, pollFields: [FIELD], readTimeoutMs: 1000 });
        receive = handlers[FIELD]; return Promise.resolve(sub);
    } } };
    const tracker = new Cruise(ctx, { now: () => now });
    await tick(); assert.equal(tracker.value(), null); assert.equal(tracker.status().reason, 'waiting');
    receive(active()); assert.equal(tracker.value().setSpeedKmh, 110); assert.equal(tracker.status().fresh, true);
    now = MAX_AGE_MS; assert.ok(tracker.value());
    now++; assert.equal(tracker.value(), null); assert.equal(tracker.status().reason, 'stale');
    receive(sample(3, 1, 2, 100, 1)); assert.equal(tracker.value().state, 'standby');
    receive(sample(3, 0, 0, 110, 1)); assert.equal(tracker.value(), null); assert.equal(tracker.status().reason, 'off');
    receive(active()); receive({}); assert.equal(tracker.value(), null); assert.equal(tracker.status().reason, 'invalid');
    receive(active()); sub.available = false; availability(); assert.equal(tracker.value(), null);
    assert.equal(tracker.status().reason, 'unavailable');
    sub.available = true; availability(); assert.equal(tracker.value(), null, 'recovery must not revive old stored target');
    assert.equal(tracker.status().reason, 'waiting');
    receive(active()); assert.equal(tracker.value().active, true);
    const copy = tracker.value(); copy.setSpeedKmh = 1; assert.equal(tracker.value().setSpeedKmh, 110);
    tracker.stop(); receive(active()); assert.equal(tracker.value(), null); assert.equal(tracker.status().reason, 'stopped');
    await tick(); assert.equal(shutdowns, 1); tracker.stop(); await tick(); assert.equal(shutdowns, 1);

    let resolveWatch, lateReceive, lateShutdowns = 0;
    const pending = new Cruise({ log: ctx.log, signals: { watch(iface, instance, handlers) {
        lateReceive = handlers[FIELD]; return new Promise((resolve) => { resolveWatch = resolve; });
    } } });
    await tick(); pending.stop(); lateReceive(active());
    resolveWatch({ available: true, shutdown() { lateShutdowns++; } });
    await tick(); assert.equal(lateShutdowns, 1); assert.equal(pending.value(), null);
    const failed = new Cruise({ log: ctx.log, signals: { watch() { throw new Error('missing optional interface'); } } });
    await tick(); assert.equal(failed.status().reason, 'error'); assert.equal(failed.value(), null); failed.stop();
    console.log('Passed: cruise DCC/ACC state and unit decode, LIM/HDC/override exclusion, MPH conversion, unknown-unit and invalid-speed marker hiding, getter polling, freshness, provider recovery and late teardown.');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
