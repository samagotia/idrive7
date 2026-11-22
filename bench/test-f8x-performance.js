'use strict';
const assert = require('assert').strict;
const { Performance } = require('../shared/f8x_performance');
const near = (a, b) => assert(Math.abs(a - b) < 1e-8, a + ' != ' + b);
{
    const p = new Performance();
    assert.equal(p.snapshot(0).ready, false);
    p.signal('rpm', 0, 0); p.pose(0, undefined, 0);
    for (let now = 10; now <= 3000; now += 10) {
        p.signal('rpm', 0, now);
        if (now % 50 === 0) p.signal('speed', 0, now);
    }
    const s = p.snapshot(3000);
    assert(s.ready);
    near(s.signals.rpm.receivedHz, 100); near(s.signals.rpm.changedHz, 0);
    near(s.signals.speed.receivedHz, 20); near(s.signals.speed.changedHz, 0);
    assert.equal(s.signals.rpm.lastValue, 0); assert.equal(s.signals.rpm.changedAt, 0);
    assert.equal(s.signals.rpm.ageMs, 0); assert.equal(s.output.commandHz, 0);
    assert.equal(s.output.meanDispatchMs, null, 'no stale initial delay remains in the rolling window');
    assert.equal(s.capped, false);
    const expired = p.snapshot(5500);
    assert.equal(expired.signals.rpm.receivedHz, 0); assert.equal(expired.signals.rpm.ageMs, 2500);
    assert.equal(expired.signals.rpm.lastValue, 0, 'age is distinct from validity/fallback policy');
}
{
    const p = new Performance();
    p.signal('rpm', 1000, 0); p.pose(1000, undefined, 0);
    assert.equal(p.snapshot(499).output.commandHz, null, 'rates are withheld during warmup');
    assert.equal(p.snapshot(500).ready, true);
    p.signal('rpm', 1100, 510); p.signal('speed', 20, 510);
    p.pose(undefined, 20, 515); // only speed was sent
    p.signal('rpm', 1100, 520); // duplicate getter is not a changed sample
    p.pose(1100, undefined, 530);
    p.pose(1100, 20, 540); // repeats must not add another dispatch delay
    const s = p.snapshot(550);
    near(s.output.meanDispatchMs, 12.5); near(s.output.p95DispatchMs, 20);
    near(s.output.commandHz, 3 / 0.55);
    assert.equal(s.signals.rpm.changedAt, 510); assert.equal(s.signals.rpm.ageMs, 30);
    assert.equal(p.delays.length, 2, 'one local dispatch observation per changed field, not per frame');
    s.signals.rpm.lastValue = 9999;
    assert.equal(p.snapshot(550).signals.rpm.lastValue, 1100, 'snapshots cannot mutate internal state');
}
{
    const p = new Performance();
    p.signal('rpm', 1000, 0);
    p.signal('rpm', 1100, 100);
    p.signal('rpm', 1200, 150);
    p.pose(1100, undefined, 155);
    assert.equal(p.delays.length, 0, 'an old pose cannot be credited to a newer reading');
    p.pose(1200, undefined, 160);
    assert.equal(p.delays[0].value, 10, 'coalesced command age starts at the latest actual change');
    for (const bad of [null, undefined, NaN, Infinity, -1]) p.signal('rpm', bad, 200);
    assert.equal(p.signals.rpm.pendingAt, null);
    p.pose(1200, undefined, 220);
    assert.equal(p.delays.length, 1, 'invalid input clears pending command association');
    const invalid = p.snapshot(500);
    assert.equal(invalid.signals.rpm.lastValue, null); assert.equal(invalid.signals.rpm.changedAt, null);
    assert.equal(invalid.signals.rpm.invalidCount, 5);
    p.signal('rpm', 1200, 600); p.pose(1200, undefined, 610);
    assert.equal(p.delays.length, 2, 'valid recovery is a new real measurement');
    assert.equal(p.delays[1].value, 10);
}
{
    const p = new Performance({ windowMs: 100 });
    p.signal('rpm', 1, 0);
    assert.equal(p.snapshot(100).ready, false, 'a short configured window cannot bypass 500ms warmup');
    p.signal('rpm', 2, 490);
    const s = p.snapshot(500);
    assert(s.ready); assert.equal(s.signals.rpm.receivedHz, 10);
}
{
    const p = new Performance({ maxEvents: 4 });
    p.signal('rpm', 0, 0);
    for (let i = 1; i <= 1000; i++) {
        p.signal('rpm', i, i); p.signal('speed', i, i); p.pose(i, i, i);
        p.signal('unexpected_' + i, i, i);
    }
    assert.deepEqual(Object.keys(p.signals), ['rpm', 'speed']);
    for (const s of Object.values(p.signals)) for (const events of [s.received, s.changes, s.invalid]) assert(events.length <= 4);
    assert(p.commands.length <= 4 && p.delays.length <= 4);
    assert(p.snapshot(1000).capped, 'truncation is explicit rather than reported as exact throughput');
    assert.equal(p.snapshot(4001).capped, false, 'the flag expires with its affected rolling window');
    assert.equal(p.delays.length + p.commands.length, 0);
    const rollback = p.snapshot(10);
    assert.equal(rollback.ready, false); assert.equal(rollback.signals.rpm.lastValue, null);
    p.signal('speed', 0, 20); p.pose(undefined, 0, 30);
    assert.equal(p.delays[0].value, 10);
    p.clear(); assert.equal(p.snapshot(100).signals.speed.lastValue, null);
    p.signal('rpm', 1, NaN); assert.equal(p.snapshot(200).ready, false);
}
console.log('Performance diagnostics: rolling receive/change/command rates, duplicate freshness, actual local dispatch association, invalid recovery, warmup, clock reset, bounded storage and snapshot isolation passed.');
