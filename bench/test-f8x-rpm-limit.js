'use strict';
const assert = require('assert').strict;
const { RpmLimit, decode, reductionOf, INTERFACE, FIELD, MAX_AGE_MS } = require('../shared/f8x_rpm_limit');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const sample = (raw, reduction) => ({ rPMEngineMaximumAllowed: raw, reductionDownControlRPMDrive2: reduction });

async function run() {
    assert.equal(decode(sample(144)), 7200);
    assert.equal(decode(sample(90)), 4500);
    assert.equal(decode(sample(100)), 5000);
    for (const raw of [undefined, null, 0, 255, 256, -1, 144.5, '144', NaN, Infinity, 1, 254]) {
        assert.equal(decode(sample(raw)), null, 'invalid raw ' + raw);
    }
    for (const raw of [0, 1, 2]) assert.equal(reductionOf(sample(144, raw)), raw);
    assert.equal(reductionOf(sample(144, 'KLEINE_REDUZIERUNG_DER_ABREGELDREHZAHL')), 1);
    for (const raw of [undefined, 3, 'SIGNAL_UNGUELTIG', true]) assert.equal(reductionOf(sample(144, raw)), null);

    let now = 0, receive, shutdowns = 0;
    const sub = { available: true, shutdown() { shutdowns++; } };
    const ctx = { log: { info() {} }, signals: { watch(iface, instance, handlers, log, opts) {
        assert.equal(iface, INTERFACE); assert.equal(instance, '1'); assert.deepEqual(Object.keys(handlers), [FIELD]);
        assert.equal(opts, undefined, 'notifier-only field must never be polled or read');
        receive = handlers[FIELD];
        return Promise.resolve(sub);
    } } };
    const tracker = new RpmLimit(ctx, { now: () => now });
    await tick();
    assert.equal(tracker.value(), null); assert.equal(tracker.status().reason, 'waiting');
    receive(sample(144, 0)); assert.equal(tracker.value(), 7200); assert.equal(tracker.status().fresh, true);
    now = 1000; receive(sample(90, 2)); assert.equal(tracker.value(), 4500); assert.equal(tracker.status().reduction, 2);
    now += MAX_AGE_MS; assert.equal(tracker.value(), 4500);
    now++; assert.equal(tracker.value(), null); assert.equal(tracker.status().reason, 'stale');
    receive(sample(144, 3)); assert.equal(tracker.value(), 7200); assert.equal(tracker.status().reduction, null);
    receive(sample(255)); assert.equal(tracker.value(), null); assert.equal(tracker.status().reason, 'invalid');
    receive(sample(144)); sub.available = false;
    assert.equal(tracker.value(), null); assert.equal(tracker.status().reason, 'unavailable');
    sub.available = true; assert.equal(tracker.value(), null, 'reconnect cannot revive old permitted RPM');
    assert.equal(tracker.status().reason, 'waiting');
    receive(sample(144)); assert.equal(tracker.value(), 7200);
    tracker.stop(); receive(sample(90)); assert.equal(tracker.value(), null); assert.equal(tracker.status().reason, 'stopped');
    await tick(); assert.equal(shutdowns, 1); tracker.stop(); await tick(); assert.equal(shutdowns, 1);

    // An in-flight subscription must be closed if teardown beats its completion.
    let resolveWatch, lateShutdown = 0, lateReceive;
    const pending = new RpmLimit({ log: ctx.log, signals: { watch(iface, instance, handlers) {
        lateReceive = handlers[FIELD]; return new Promise((resolve) => { resolveWatch = resolve; });
    } } });
    await tick(); pending.stop(); lateReceive(sample(144));
    resolveWatch({ available: true, shutdown() { lateShutdown++; } });
    await tick(); assert.equal(lateShutdown, 1); assert.equal(pending.value(), null);

    const failed = new RpmLimit({ log: ctx.log, signals: { watch() { return Promise.reject(new Error('missing interface')); } } });
    await tick(); assert.equal(failed.value(), null); assert.equal(failed.status().reason, 'error'); failed.stop();
    console.log('Passed: permitted-RPM raw decode, notifier-only subscription, reduction enum, monotonic freshness, invalid input, provider loss/recovery, late teardown, and missing interface.');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
