'use strict';
// Pose checks use the shipped artwork geometry; no vehicle or renderer transport.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const sprite = require('../shared/f82_sprite');
const runtimeModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_runtime.js'), 'utf8'), {
    module: runtimeModule, Buffer, process: { uptime: () => 0 },
    require: (name) => name === './f82_sprite' ? sprite : name === './f8x_motion' ? require('../shared/f8x_motion') : {},
}, { filename: 'f8x_runtime.js' });
const update = runtimeModule.exports.prototype._updateF82;
const layout = JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster/layouts/our_m4.json'), 'utf8'));
const needles = layout.widgets.filter((w) => w.signal && w.shadow);
assert.equal(needles.length, 4);

const values = { fuel: 0.5, oil: 120, speed: 90, rpm: 3000 };
const runtime = { f82Light: 'day', _raw: (signal) => values[signal], _testRpm: () => null,
    car: { data: () => ({ rpm: values.rpm, condition: 2 }) } };
const record = (w) => {
    const poses = [];
    return { w, ref: 1, last: null, poses, c: {
        set(ref, pose) { assert.equal(ref, 1); poses.push(JSON.parse(JSON.stringify(pose))); },
        pixels() { throw new Error('Needle movement must not upload textures'); },
        image() { throw new Error('Needle movement must not allocate textures'); },
    } };
};
const close = (a, b) => assert(Math.abs(a - b) < 1e-9, `${a} differs from ${b}`);
const angleOf = (w) => w.signal === 'rpm' ? sprite.rpmAngle(w.curve, values.rpm, false)
    : sprite.angle(w.curve, values[w.signal]);

for (const needle of needles) {
    const front = record(needle);
    runtime.f82Light = 'day';
    update.call(runtime, front, 0, true);
    const frontDay = front.poses.at(-1);
    runtime.f82Light = 'night';
    update.call(runtime, front, 0, true);
    assert.deepEqual(front.poses.at(-1), frontDay, 'front needle geometry is unchanged by lighting');
    const x = record(sprite.shadowOf(needle));
    const [dx, dy] = sprite.shadowOffset(needle);
    runtime.f82Light = 'day';
    update.call(runtime, x, 0, true);
    const day = x.poses.at(-1);
    assert.equal(day.visible, true);
    assert.equal(day.opacity, 0.90, 'Day shadow is not faded a second time by blade alignment');
    assert.equal(update.call(runtime, x, 1, false), false, 'unchanged pose needs no update');
    const auxiliary = ['fuel', 'oil'].includes(needle.signal);
    if (auxiliary) {
        close(day.x - needle.x, dx * 1.60);
        close(day.y - needle.y, dy * 1.60);
    } else {
        close(day.x - needle.x, dx * 1.25);
        close(day.y - needle.y, dy * 1.25);
    }
    runtime.f82Light = 'night';
    update.call(runtime, x, 2, true); // same angle, forced lighting transition
    const night = x.poses.at(-1);
    if (auxiliary) {
        assert.equal(night.visible, true);
        assert(night.opacity > 0 && night.opacity <= 0.24);
        close(night.x - needle.x, dx * 0.60);
        close(night.y - needle.y, dy * 0.60);
        assert.equal(night.rotate, day.rotate);
        for (const [value] of needle.curve) {
            values[needle.signal] = value;
            runtime.f82Motion.clear(); // geometry test uses a settled pose
            update.call(runtime, x, 3, true);
            const stop = x.poses.at(-1);
            assert.equal(stop.visible, true);
            assert(stop.opacity >= 0 && stop.opacity <= 0.24);
        }
    } else assert.deepEqual(night, { visible: false }, 'main Night shadows remain suppressed');
    values[needle.signal] = { fuel: 0.5, oil: 120, speed: 90, rpm: 3000 }[needle.signal];
    runtime.f82Light = 'day';
    runtime.f82Motion.clear();
    update.call(runtime, x, 4, true);
    assert.deepEqual(x.poses.at(-1), day, 'Night→Day restores the original pose exactly');
    if (auxiliary) {
        runtime.f82Light = 'night';
        values[needle.signal] = null;
        update.call(runtime, x, 5, true);
        assert.deepEqual(x.poses.at(-1), { visible: false }, 'invalid auxiliary data hides the shadow');
        values[needle.signal] = needle.curve[0][0];
        update.call(runtime, x, 6, true);
        assert.equal(x.poses.at(-1).visible, true, 'fresh valid data restores the shadow');
        const glass = record(sprite.glassOf(needle));
        update.call(runtime, glass, 7, true);
        const degrees = Math.round(angleOf(needle) * 4) / 4;
        assert.deepEqual(glass.poses.at(-1), { visible: true, rotate: degrees,
            ...sprite.glassPose(degrees, needle.glass.outward) }, 'glass fade is unchanged');
    }
}

// A fixed light direction makes the cast shadow change apparent sides as the
// needle crosses twelve o'clock. At twelve it lies behind the blade itself.
// These are geometric checks of the displayed shaft, not an opacity animation.
for (const signal of ['speed', 'rpm']) {
    const needle = needles.find((w) => w.signal === signal);
    const shadow = sprite.shadowOf(needle);
    const offset = [shadow.x - needle.x, shadow.y - needle.y];
    const across = (degrees) => offset[0] * Math.cos(degrees * Math.PI / 180)
        + offset[1] * Math.sin(degrees * Math.PI / 180);
    assert(across(-90) <= -7, 'left-facing main needle casts its shadow below the blade');
    close(across(0), 0);
    assert(across(90) >= 7, 'right-facing main needle reveals the same shadow on the opposite side');
    for (const degrees of [-120, -90, -45, 0, 45, 90, 120]) {
        values[signal] = signal === 'speed' ? (degrees + 120) * 330 / 240
            : degrees <= 0 ? 4000 + degrees * 4000 / 120 : 4000 + degrees * 4000 / 106;
        runtime.f82Motion.clear();
        const sample = record(shadow);
        runtime.f82Light = 'day';
        update.call(runtime, sample, 0, true);
        assert.equal(sample.poses.at(-1).opacity, 0.90);
    }
}

// Actual Day and Night pixels are selected independently, without changing
// the stored canvas dimensions or allocating a new image layer.
const paint = runtimeModule.exports.prototype._paintF82;
for (const needle of needles) {
    assert(needle.shadow.dayAsset, `${needle.id} needs a dedicated Day shaft shadow`);
    sprite.validate(needle);
    assert.throws(() => sprite.validate({ ...needle, shadow: { ...needle.shadow, dayAsset: '../bad' } }),
        /invalid F82 needle shadow/);
    const base = JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster/f82', needle.shadow.asset + '.json')));
    const day = JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster/f82', needle.shadow.dayAsset + '.json')));
    const shadow = sprite.shadowOf(needle), uploads = [];
    const painting = { f82Light: 'day', _f82Asset: (id) => {
        assert.equal(id, needle.shadow.dayAsset); return day;
    } };
    const target = { w: shadow, ref: 1, c: { pixels: (ref, _, pixels) => uploads.push(pixels) } };
    paint.call(painting, target, base);
    assert(uploads.at(-1).equals(Buffer.from(day.rgba, 'base64')));
    painting.f82Light = 'night';
    paint.call(painting, target, base);
    assert(uploads.at(-1).equals(Buffer.from(base.rgba, 'base64')), 'Night retains its original shadow pixels');
}
// Mirrored auxiliary geometry keeps the same shadow strength at mirrored angles.
const fuel = sprite.shadowOf(needles.find((w) => w.signal === 'fuel'));
const oil = sprite.shadowOf(needles.find((w) => w.signal === 'oil'));
for (const degrees of [-54, -27, 0, 27, 54]) {
    close(sprite.shadowOpacity(degrees, ...sprite.shadowOffset(fuel)),
        sprite.shadowOpacity(-degrees, ...sprite.shadowOffset(oil)));
}
console.log('F8X needle shadows: fixed-light side changes, dedicated Day pixels, Night preservation, tight mirrored offsets, transitions, invalid data and unchanged glass passed.');
