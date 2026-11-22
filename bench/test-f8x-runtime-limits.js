'use strict';
// Render/state integration only. Live field availability and cold tracking need a car capture.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sprite = require('../shared/f82_sprite');
const root = path.resolve(__dirname, '..');
const environment = {};
const runtimeModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_runtime.js'), 'utf8'), {
    module: runtimeModule, Buffer, process: { env: environment },
    require: (name) => name === './f82_sprite' ? sprite : name === './f8x_motion' ? require('../shared/f8x_motion') : {},
}, { filename: 'f8x_runtime.js' });
const Runtime = runtimeModule.exports;
const settings = { f8xLimitSource: 'auto', f82Redline: 7200, shiftBefore: 300, coldGuard: true };
const data = { oil: 90, rpm: 7050, demo: false, speed: 0 };
let liveLimit = null;
const runtime = Object.assign(Object.create(Runtime.prototype), {
    setting: (key) => settings[key], car: { data: () => data }, rpmLimit: { value: () => liveLimit },
    f82Light: 'day', f82Pedal: 100, f82PedalAt: 1000, testAt: null, previewF82Engine: 'petrol',
    log: { info() {} },
});
const layout = JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster/layouts/our_m4.json'), 'utf8'));
const face = layout.widgets.find((w) => w.id === 'rpm_face');
const needle = layout.widgets.find((w) => w.signal === 'rpm');
const calls = [];
const widget = { w: sprite.shiftTrackOf(face, needle), ref: 1, last: null, c: {
    uniform(ref, name, value) { assert.equal(ref, 1); calls.push({ name, value: [...value] }); },
    set(ref, pose) { assert.equal(ref, 1); calls.push({ pose: JSON.parse(JSON.stringify(pose)) }); },
} };
const lastUniform = (name) => [...calls].reverse().find((c) => c.name === name).value;
const lastPose = () => [...calls].reverse().find((c) => c.pose).pose;
const tick = (force = false) => runtime._updateF82Shift(widget, 1000, force);

assert.equal(runtime._f82ShiftLimit(data.oil), null, 'Auto never substitutes the manual preset');
tick(true);
assert.deepEqual(lastPose(), { visible: false });
assert.deepEqual(lastUniform('u_edges'), [0, 0, 0, 0]);
assert.deepEqual(lastUniform('u_build'), [0]);
assert.deepEqual(lastUniform('u_bloom'), [0]);
assert.equal(runtime.testShift(), false, 'no limit means no synthetic shift-light test');
assert.match(runtime.rpmLimitStatus(), /BMW live max RPM: unavailable/);

for (const limit of [4000, 7200, 4500, 7200]) {
    liveLimit = limit;
    tick();
    assert.equal(runtime._f82ShiftLimit(data.oil), limit);
    assert.deepEqual(lastPose(), { visible: true });
    const expected = sprite.shiftBand(widget.w.curve, limit, widget.w.shiftTrack[5]);
    assert.deepEqual(lastUniform('u_edges'), expected.edges);
    assert.deepEqual(lastUniform('u_cells'), expected.counts);
    assert.match(runtime.rpmLimitStatus(), new RegExp('BMW live max RPM: ' + limit));
}
assert(widget.shiftBuildCount > 0, 'warm full pedal builds the lights with a valid limit');
assert.notEqual(widget.shiftFlashAt, null, 'warm full pedal near the limit starts flashing');
assert.deepEqual(lastUniform('u_bloom'), [1], 'full-throttle shift cue has a restrained bloom');

// Valid warning lenses retain a 60% bloom. Full strength belongs to the
// warm full-throttle sequence and follows its lit flash phase.
data.rpm = 6100; tick();
assert.deepEqual(lastUniform('u_bloom'), [1], 'bloom accompanies the buildup before the shift cue');
const settledCalls = calls.length; tick();
assert.equal(calls.length, settledCalls, 'unchanged buildup sends no repeated bloom commands');
runtime.f82Pedal = 99; tick();
assert.deepEqual(lastUniform('u_bloom'), [0.6], 'partial throttle returns to the normal bloom');
const normalCalls = calls.length; tick();
assert.equal(calls.length, normalCalls, 'normal bloom sends no repeated idle commands');
runtime.f82Pedal = 100; data.rpm = 3900; tick();
assert.deepEqual(lastUniform('u_bloom'), [0.6], 'below-track RPM retains only the normal limiter glow');
assert.deepEqual(lastUniform('u_build'), [0], 'no buildup cells are lit below 4000 RPM');
data.rpm = 6100; data.oil = 50; tick();
assert.deepEqual(lastUniform('u_bloom'), [0.6], 'cold engine retains only the normal limiter glow');
data.oil = 90; data.rpm = 7050; tick();
runtime._updateF82Shift(widget, 1200, false);
assert.deepEqual(lastUniform('u_bloom'), [0.6], 'dark flash phase returns the fixed lenses to normal bloom');
assert.deepEqual(lastUniform('u_build'), [0], 'dark flash phase has no buildup lenses');
widget.shiftFlashAt = null; tick();
runtime._updateF82Shift(widget, 2000, false);
assert.deepEqual(lastUniform('u_bloom'), [0.6], 'stale accelerator data cannot sustain full-strength bloom');
tick();

// The tracker returns null for invalid values, staleness, and provider loss.
for (const reason of ['invalid', 'stale', 'provider lost']) {
    liveLimit = null;
    tick();
    assert.deepEqual(lastPose(), { visible: false }, reason);
    assert.deepEqual(lastUniform('u_build'), [0], reason);
    assert.deepEqual(lastUniform('u_bloom'), [0], reason);
    assert.deepEqual(lastUniform('u_edges'), [0, 0, 0, 0], reason);
    assert.equal(widget.shiftBand, null, reason);
    assert.equal(widget.shiftBuildCount, 0, reason);
    assert.equal(widget.shiftFlashAt, null, reason);
    liveLimit = 7200;
    tick();
    assert.deepEqual(lastPose(), { visible: true }, 'fresh valid data recovers');
}

liveLimit = null;
settings.f82Redline = 6500;
assert.equal(runtime._f82ShiftLimit(90), null, 'changing the manual number does not enable it in Auto');
settings.f8xLimitSource = 'manual';
assert.equal(runtime._f82ShiftLimit(90), 6500);
assert.match(runtime.rpmLimitStatus(), /Manual max RPM: 6500/);
tick(true);
assert.deepEqual(lastPose(), { visible: true });
settings.f8xLimitSource = 'auto';
tick(true);
assert.deepEqual(lastPose(), { visible: false }, 'switching back to unavailable Auto clears manual artwork');

// A Mac simulation is explicitly labelled and cannot run in a vehicle environment.
environment.M4_PREVIEW_ONLY = '1';
data.demo = true; data.oil = 30; settings.f82Redline = 7200;
assert.equal(runtime._f82ShiftLimit(data.oil), 4500);
assert.match(runtime.rpmLimitStatus(), /^SIM ONLY/);
data.demo = false;
assert.equal(runtime._f82ShiftLimit(30), null, 'injected signal mode does not use the demo curve');
assert.match(runtime.rpmLimitStatus(), /^SIM signal/);
delete environment.M4_PREVIEW_ONLY;
data.demo = true;
assert.equal(runtime._f82ShiftLimit(30), null, 'a demo flag cannot enable simulator limits on a car');
console.log('F8X live-limit runtime: cold/warm/shrinking bands, clearing and recovery, explicit Manual and simulation isolation passed.');
