'use strict';
// Read actual package geometry and silhouettes, not a separate layout proposal.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const layout = require('../apps/samagotia_clusters/cluster/layouts/our_m4.json');
const sprite = require('../shared/f82_sprite');
const strip = require('../shared/f8x_panel_strip');
const backing = require('../shared/f8x_panel_backing');
const { pivotOf } = require('../shared/f8x_gauge_geometry');
const doorArt = require('../shared/f8x_door_art');
const cruise = require('../shared/f8x_cruise_art');
const read = (id) => require('../apps/samagotia_clusters/cluster/f82/' + id + '.json');
const textModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_text.js'), 'utf8'), {
    module: textModule, Buffer,
    require: () => ({ json: (name) => JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster', name))) }),
});
const moduleStub = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_fuel_warning_art.js'), 'utf8'), {
    module: moduleStub, Buffer,
    require: (name) => name === './f8x_text' ? textModule.exports : require(path.join(root, 'shared', name)),
});
const fuelArt = moduleStub.exports;
const old = { speed: { w: 655.5, h: 556.32 }, rpm: { w: 655.5, h: 556.32 },
    fuel: { w: 273.9, h: 276.1 }, oil: { w: 273.9, h: 276.1 } };
const faceOf = (signal) => layout.widgets.find((w) => w.id === signal + '_face');
const needleOf = (signal) => layout.widgets.find((w) => w.signal === signal);
for (const signal of Object.keys(old)) {
    const face = faceOf(signal), needle = needleOf(signal), f = read(face.asset), n = read(needle.asset);
    const scale = face.w / f.w;
    const requested = signal === 'speed' || signal === 'rpm' ? 0.9 : 0.8;
    assert(Math.abs(face.w / old[signal].w - requested) < 1e-10
        && Math.abs(face.h / old[signal].h - requested) < 1e-10,
    signal + ': exact requested reduction relative to published 0.16.7');
    assert(Math.abs(scale - face.h / f.h) < 1e-10, signal + ': exact uniform face scale');
    assert(Math.abs(scale - needle.w / n.w) < 1e-10 && Math.abs(scale - needle.h / n.h) < 1e-10,
        signal + ': face and blade share the same scale');
    assert.deepEqual(needle.pivot, signal === 'speed' || signal === 'rpm' ? [13, 227] : [12, 102], signal + ': source-art pivot is unchanged');
    assert(face.x >= 0 && face.y >= 0 && face.x + face.w <= 1920 && face.y + face.h <= 646, signal + ': face clears the strip');
    const pivot = pivotOf(layout, signal, read);
    // Compare the pivot with the face's original optical centre, including the
    // intentionally eccentric auxiliary hubs (the image centre is not the hub).
    const centre = signal === 'speed' || signal === 'rpm' ? [295, 283] : [128, 156];
    assert(Math.abs(pivot.x - (face.x + centre[0] * scale)) < 1e-8);
    assert(Math.abs(pivot.y - (face.y + centre[1] * scale)) < 1e-8);
}
const speedPivot = pivotOf(layout, 'speed', read), rpmPivot = pivotOf(layout, 'rpm', read);
assert.equal(rpmPivot.x - speedPivot.x, 740, 'main hub separation grows from 700 to 740 pixels');
const gap = faceOf('rpm').x - (faceOf('speed').x + faceOf('speed').w);
assert(Math.abs(gap - 150.05) < 1e-8 && gap > 44.5, 'visible inner space grows after reducing and spreading the main dials');
assert(faceOf('fuel').x < 124 && faceOf('oil').x + faceOf('oil').w > 1789, 'auxiliary gauges fill the outer display');
assert(Math.abs(pivotOf(layout, 'speed', read).x + pivotOf(layout, 'rpm', read).x - 1920) < 1e-8, 'main dials balance around display centre');

// Bounding rectangles may overlap at transparent corners. Actual Day/Night
// silhouettes must remain separate, so no silver rim or face is painted over.
for (const light of ['day', 'night']) {
    const faces = Object.keys(old).map(faceOf);
    const textures = new Map(faces.map((w) => {
        const t = read(light === 'night' ? w.nightAsset : w.asset);
        return [w.id, { w: t.w, h: t.h, pixels: Buffer.from(t.rgba, 'base64') }];
    }));
    const alpha = (w, x, y) => {
        const t = textures.get(w.id), ix = Math.floor((x - w.x) * t.w / w.w), iy = Math.floor((y - w.y) * t.h / w.h);
        return ix < 0 || iy < 0 || ix >= t.w || iy >= t.h ? 0 : t.pixels[(iy * t.w + ix) * 4 + 3];
    };
    for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
        const a = faces[i], b = faces[j];
        for (let y = Math.ceil(Math.max(a.y, b.y)); y < Math.min(a.y + a.h, b.y + b.h); y++) {
            for (let x = Math.ceil(Math.max(a.x, b.x)); x < Math.min(a.x + a.w, b.x + b.w); x++) {
                assert(!(alpha(a, x + 0.5, y + 0.5) > 32 && alpha(b, x + 0.5, y + 0.5) > 32),
                    light + ': visible silhouettes of ' + a.id + ' and ' + b.id + ' do not overlap at ' + x + ',' + y);
            }
        }
    }
    for (const w of doorArt.widgetsFor(layout, read, 646).concat(fuelArt.widgetsFor(layout, read, 646))) {
        const pixels = w.doorRole ? doorArt.pixelsFor(w, { layout: 'four', physical: {
            frontLeft: 'open', frontRight: 'open', rearLeft: 'open', rearRight: 'open', bonnet: 'open', boot: 'open',
        } }, light) : fuelArt.pixelsFor(w, light);
        for (let y = w.y; y < w.y + w.h; y++) for (let x = w.x; x < w.x + w.w; x++) {
            if (pixels[((y - w.y) * w.w + x - w.x) * 4 + 3] <= 32) continue;
            for (const face of faces) assert(alpha(face, x + 0.5, y + 0.5) <= 32,
                light + ': visible pixels of ' + w.id + ' stay clear of ' + face.id);
        }
    }
}
const needles = layout.widgets.filter((w) => w.signal);
const companions = needles.filter((w) => w.shadow).map(sprite.shadowOf).concat(needles.filter((w) => w.glass).map(sprite.glassOf));
const rpmFace = faceOf('rpm'), rpmNeedle = needleOf('rpm');
const arc = sprite.lowerArcOf(layout, read);
assert(arc && arc.y + arc.h <= 646, 'the resized lower arc remains in the custom region');
const doors = doorArt.widgetsFor(layout, read, 646), fuel = fuelArt.widgetsFor(layout, read, 646);
assert.equal(doors.length, 1, 'resizing must not accidentally discard the live door diagram');
assert.equal(fuel.length, 2, 'both fuel warning elements survive the resized geometry');
for (const w of doors.concat(fuel)) {
    for (let y = w.y; y < w.y + w.h; y++) for (let x = w.x; x < w.x + w.w; x++) {
        const dx = x + 0.5 - (arc.x + arc.arcCenter[0]), dy = y + 0.5 - (arc.y + arc.arcCenter[1]);
        const theta = Math.abs(Math.atan2(dx / arc.arcRadii[0], dy / arc.arcRadii[1]));
        const radius = Math.hypot(dx, dy);
        assert(!(theta <= arc.arcHalfAngle && Math.abs(radius - arc.arcRadii[0]) <= arc.arcThickness / 2 + 1),
            w.id + ' does not cross the illuminated lower arc');
    }
}
for (const digital of [false, true]) {
    const readouts = sprite.readoutWidgetsFor(layout, digital, read, true);
    const full = [backing.widget()].concat(layout.widgets, companions, readouts, arc,
        sprite.shiftTrackOf(rpmFace, rpmNeedle), doors, fuel, cruise.widgetsFor(layout, read));
    const prepared = strip.prepare(full, read);
    assert(prepared.every((w) => w.y + w.h <= 646), 'all hidden/static/generated layers clear the strip');
    for (const original of layout.widgets.filter((w) => w.id !== 'backdrop').concat(companions)) {
        assert.equal(prepared.find((w) => w.id === original.id), original, 'strip toggle retains resized dial geometry');
    }
    assert(prepared.some((w) => w.doorRole), 'door diagram survives strip composition');
    assert(prepared.some((w) => w.warningRole === 'fuelReserveText'), 'fuel message survives strip composition');
}
console.log('F8X sizing: exact 10% main / 20% auxiliary reductions from 0.16.7 and wider main gap, exact uniform face/blade scale and optical pivots, zero Day/Night silhouette collisions, generated readouts/warnings and native-strip clearance passed.');
