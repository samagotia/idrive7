'use strict';
const assert = require('assert').strict;
const { RpmPresentation, MAX_HOLD_MS, MAX_LEAD_RPM } = require('../shared/f8x_rpm_presentation');
const driving = { mode: 'smooth', stage: 'D', gear: 2, pedal: 75,
    fresh: true, available: true, blocked: false };
const near = (a, b) => assert(Math.abs(a - b) < 1e-8, a + ' != ' + b);
function ready(context = driving, interval = 50, rise = 100) {
    const p = new RpmPresentation();
    p.sample(1000, 0, context);
    p.sample(1000 + rise, interval, context);
    const actual = p.sample(1000 + 2 * rise, interval * 2, context);
    assert.equal(actual.rpm, 1000 + 2 * rise, 'every new real reading is shown immediately');
    return p;
}

for (const mode of [undefined, 'measured', 'unexpected']) {
    const p = ready(Object.assign({}, driving, { mode }));
    for (const now of [100, 110, 125, 150, 1000]) {
        assert.deepEqual(p.sample(1200, now, Object.assign({}, driving, { mode })),
            { rpm: 1200, estimated: false, leadRpm: 0, moving: false }, 'estimation is explicit opt-in');
    }
}
{
    const p = ready();
    const a = p.sample(1200, 116, driving);
    near(a.rpm, 1232); assert(a.estimated && a.moving);
    assert.deepEqual(p.sample(1200, 116, driving), a, 'needle and shadow share an identical same-clock pose');
    assert.equal(p.changedAt, 100, 'frame sampling does not manufacture a changed source timestamp');
    const end = p.sample(1200, 150, driving);
    assert.equal(end.rpm, 1300); assert.equal(end.moving, false);
    for (const now of [151, 200, 250]) {
        const held = p.sample(1200, now, driving);
        assert.equal(held.rpm, 1300, 'the bounded horizon cannot accumulate further extrapolation');
        assert(!held.moving);
    }
    const holdExpired = p.sample(1200, 100 + MAX_HOLD_MS + 1, driving);
    assert.equal(holdExpired.rpm, 1200); assert(!holdExpired.estimated && !holdExpired.moving);
    assert.equal(p.changedAt, 100, 'a long-held value is not a new source sample');
    assert.equal(p.sample(1250, 300, driving).rpm, 1250);
    assert.equal(p.sample(1250, 310, driving).estimated, false, 'hold recovery cannot reuse an old derivative');
}
{
    const c = Object.assign({}, driving, { maxLeadRpm: 24.5 });
    const p = ready(c);
    const a = p.sample(1200, 140, c);
    near(a.rpm, 1224.5); near(a.leadRpm, 24.5); assert(!a.moving);
    assert.equal(p.sample(1210, 150, c).rpm, 1210, 'a changed actual reading wins even below the estimated pose');
}
for (const [interval, rise] of [[25, 1000], [50, 1000], [100, 1000], [150, 1000]]) {
    const p = ready(driving, interval, rise), target = 1000 + rise * 2;
    for (let age = 1; age <= 150; age++) {
        const a = p.sample(target, 2 * interval + age, driving);
        assert(a.rpm >= target && a.rpm <= target + MAX_LEAD_RPM);
        if (age >= Math.min(50, interval)) assert(!a.moving, 'no extrapolation past its bounded horizon');
    }
}
for (const interval of [5, 10, 16, 24, 151, 500]) {
    const p = ready(driving, interval);
    const a = p.sample(1200, interval * 2 + 5, driving);
    assert.equal(a.rpm, 1200); assert(!a.estimated && !a.moving, 'fast or irregular sources use measured values');
}
for (const override of [{ gear: 3 }, { stage: 'N' }, { stage: 'P' }, { stage: 'R' },
    { pedal: 0 }, { pedal: 74 }, { pedal: null }, { lifting: true }, { blocked: true },
    { mode: 'measured' }, { gear: 0 }, { gear: null }, { maxLeadRpm: 0 }]) {
    const p = ready(), c = Object.assign({}, driving, override);
    const a = p.sample(1200, 125, c);
    assert.equal(a.rpm, 1200); assert(!a.estimated && !a.moving, JSON.stringify(override));
    const resumed = p.sample(1200, 130, driving);
    assert.equal(resumed.rpm, 1200, 'resume cannot replay an estimate from before a lift, shift or block');
}
for (const override of [{ fresh: false }, { available: false }]) {
    const p = ready(); assert.equal(p.sample(1200, 125, Object.assign({}, driving, override)).rpm, null);
    assert.equal(p.sample(1300, 150, driving).rpm, 1300);
    assert.equal(p.sample(1300, 166, driving).estimated, false, 'provider/freshness recovery begins from real data');
}
{
    const p = ready();
    assert.equal(p.sample(1100, 150, driving).rpm, 1100, 'a measured reversal is immediate');
    assert.equal(p.sample(1100, 166, driving).estimated, false);
    assert.equal(p.sample(1000, 200, driving).rpm, 1000);
    assert.equal(p.sample(1000, 216, driving).estimated, false);
}
for (const bad of [null, undefined, NaN, Infinity, -1]) {
    const p = ready(); assert.equal(p.sample(bad, 125, driving).rpm, null);
    assert.equal(p.sample(2000, 150, driving).rpm, 2000);
    assert.equal(p.sample(2000, 166, driving).estimated, false);
}
{
    const p = ready(); assert.equal(p.sample(1200, 50, driving).rpm, 1200);
    assert.equal(p.sample(1200, 66, driving).estimated, false, 'clock rollback clears history');
    assert.equal(p.sample(1200, NaN, driving).rpm, null);
    p.clear(); assert.equal(p.sample(3000, 1000, driving).rpm, 3000);
    assert.equal(p.sample(3000, 1016, driving).estimated, false, 'clear removes every old derivative');
}
console.log('RPM presentation: measured default, immediate real readings, sparse-only bounded lead, paired poses, fixed horizon, hold expiry, shift/lift/invalid/provider/backpressure reset and recovery passed.');
