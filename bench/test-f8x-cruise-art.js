'use strict';
// Host-side artwork/state checks, not a claim of live vehicle delivery.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const art = require('../shared/f8x_cruise_art');
const sprite = require('../shared/f82_sprite');
const { decode } = require('../shared/f8x_cruise');
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'apps/samagotia_clusters/cluster');
const readAsset = (id) => JSON.parse(fs.readFileSync(path.join(dataDir, 'f82', id + '.json'), 'utf8'));
const layout = JSON.parse(fs.readFileSync(path.join(dataDir, 'layouts/our_m4.json'), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const sample = (speed = 110, unit = 1, state = 2) => ({ ldmIconId: 3, ldmIconState: state,
    ldmSetSpeed: { ldmSetSpeedColour: state === 2 ? 1 : 2, ldmSetSpeedValue: speed },
    speed: { unitFirstSpeed: unit } });
function checkGeometry(input, speed) {
    const widgets = art.widgetsFor(input, readAsset);
    assert.equal(widgets.length, 1);
    assert(widgets.every((w) => w.own && w.type === 'icon'));
    const [marker] = widgets, pose = art.markerPose(marker, { setSpeedKmh: speed });
    const g = marker.cruiseGeometry, radians = (pose.rotate - 180) * Math.PI / 180;
    const needle = input.widgets.find((w) => w.signal === 'speed');
    assert.equal(pose.rotate, Math.round((sprite.angle(needle.curve, speed) + 180) * 100) / 100);
    assert(Math.abs(pose.x + marker.w / 2 - g.cx - Math.sin(radians) * g.rx) < .03);
    assert(Math.abs(pose.y + marker.h / 2 - g.cy + Math.cos(radians) * g.ry) < .03);
    for (const value of [null, undefined, NaN, -1, needle.curve.at(-1)[0] + 1]) {
        assert.equal(art.markerPose(marker, { setSpeedKmh: value }), null, 'invalid/out-of-face targets hide, never clamp');
    }
    return widgets;
}
const widgets = checkGeometry(layout, 110);
assert.equal(widgets[0].w, 18);
assert.equal(widgets[0].h, 22);
const mphLayout = clone(layout), mphCurve = readAsset('speed-face-mph').speedCurve;
mphLayout.widgets.find((w) => w.id === 'speed_face').asset = 'speed-face-mph';
mphLayout.widgets.find((w) => w.signal === 'speed').curve = mphCurve;
const mph = decode(sample(69, 2));
assert.equal(mph.setSpeedKmh, 111.044736);
checkGeometry(mphLayout, mph.setSpeedKmh);
const saved = clone(layout);
saved.widgets.filter((w) => ['speed_face', 'speed_needle'].includes(w.id)).forEach((w) => {
    w.x = w.x * .8 + 25; w.y = w.y * .8 + 10; w.w *= .8; w.h *= .8;
});
const scaledMarker = checkGeometry(saved, 170)[0];
assert(Math.abs(scaledMarker.cruiseGeometry.rx - widgets[0].cruiseGeometry.rx * .8) < 1e-9,
    'a saved scale is relative to the current source face');
assert.deepEqual(art.widgetsFor({ widgets: [] }, readAsset), []);
for (const w of widgets) {
    const green = art.pixelsFor(w, 'active'), amber = art.pixelsFor(w, 'standby');
    assert.strictEqual(green, art.pixelsFor(w, 'active'), 'same state reuses the cached texture');
    assert.equal(green.length, w.w * w.h * 4);
    const index = green.findIndex((v, i) => i % 4 === 3 && v > 200) - 3;
    assert(index >= 0, 'artwork must contain solid ink');
    assert.deepEqual([...green.subarray(index, index + 3)], art.GREEN.slice(0, 3));
    assert.deepEqual([...amber.subarray(index, index + 3)], art.AMBER.slice(0, 3));
}

const runtimeModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_runtime.js'), 'utf8'), {
    module: runtimeModule, Buffer, clearInterval, clearTimeout,
    require: (name) => name === './f8x_cruise_art' ? art : {},
}, { filename: 'f8x_runtime.js' });
const Runtime = runtimeModule.exports;
let reading = null, uploads = 0;
const poses = [];
const runtime = Object.assign(Object.create(Runtime.prototype), {
    cruise: { value: () => reading }, _blit(x, rect, pixels) { uploads++; assert(pixels.length < 7000); },
});
const layers = widgets.map((w, ref) => ({ w, ref, last: null, cruiseTint: 'active',
    c: { set(id, pose) { poses.push({ id, ...clone(pose) }); } } }));
const tick = (force = false) => layers.forEach((x) => runtime._update(x, 0, force));
tick(true);
assert(poses.every((p) => p.visible === false));
reading = decode(sample()); tick();
assert(poses.slice(-1).every((p) => p.visible));
assert.equal(uploads, 0, 'active texture was uploaded once at creation');
const stationary = poses.length; tick(); assert.equal(poses.length, stationary);
for (let speed = 111; speed <= 160; speed++) { reading = decode(sample(speed)); tick(); }
assert.equal(uploads, 0, 'moving marker does not upload textures');
assert.equal(poses.length, stationary + 50, 'only the marker moves with target changes');
reading = decode(sample(160, 1, 1)); tick(); assert.equal(uploads, 1, 'state change repaints the small marker once');
tick(); assert.equal(uploads, 1);
const noUnit = sample(160, 1, 1); delete noUnit.speed;
reading = decode(noUnit); // explicit unit absent: marker must hide
tick();
assert.equal(poses.at(-1).id, 0); assert.equal(poses.at(-1).visible, false);
for (const reason of ['off', 'LIM', 'HDC', 'invalid', 'stale', 'provider lost']) {
    reading = decode(sample()); tick(); reading = null; tick();
    assert(poses.slice(-1).every((p) => !p.visible), reason + ' clears the marker');
}
let stopped = 0;
const stoppedRuntime = Object.assign(Object.create(Runtime.prototype), {
    f82Motion: new Map(), layouts: {}, car: { stop() {} },
    rpmLimit: { stop() {} }, cruise: { stop() { stopped++; } }, clients: [], atlases: new Map(),
});
stoppedRuntime.stop(); assert.equal(stopped, 1, 'runtime teardown stops the cruise subscription');
const created = [], createdPoses = [], initialUploads = [];
const transport = { image(options) { created.push(options); return created.length; },
    pixels(ref, rect, pixels) { initialUploads.push({ ref, size: pixels.length }); },
    set(ref, pose) { createdPoses.push({ ref, ...clone(pose) }); } };
const creationRuntime = Object.assign(Object.create(Runtime.prototype), {
    target: 'panel', theme: {}, widgets: new Map(), cruise: { value: () => null },
    _connOf: () => 0, _clientAt: () => transport,
});
widgets.forEach((w) => creationRuntime._create(w, null));
assert(created.every((w) => w.visible === false), 'small cruise layers are hidden from initial allocation');
assert(createdPoses.every((w) => w.visible === false), 'absent data cannot expose a startup icon');
assert.deepEqual(initialUploads.map((w) => w.size), [18 * 22 * 4]);
const spec = JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/app.json'), 'utf8'));
assert(spec.shared.includes('f8x_cruise.js') && spec.shared.includes('f8x_cruise_art.js'));
assert.equal(spec.signals['de.bmw.infotainment.displaydata.DisplayDataServer2'].functionalLibraryData, 'rs');
assert(spec.signals['de.bmw.infotainment.displaydata.DisplayDataServer2']._optional);
console.log('F8X cruise artwork: metric/MPH curve, saved geometry, hidden invalid states, cached colours, pose-only movement and teardown passed.');
