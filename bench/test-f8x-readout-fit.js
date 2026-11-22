'use strict';
const assert = require('assert').strict;
const sprites = require('../shared/f82_sprite');
const strip = require('../shared/f8x_panel_strip');
const layout = require('../apps/samagotia_clusters/cluster/layouts/our_m4.json');
const read = (id) => require('../apps/samagotia_clusters/cluster/f82/' + id + '.json');
const frozen = JSON.stringify([layout, sprites.digitalSpeedWidgets, sprites.infoWidgets, sprites.infoClock, sprites.infoAmbient]);
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const near = (a, b) => assert(Math.abs(a - b) < 1e-7, a + ' differs from ' + b);
for (const digital of [false, true]) for (const native of [false, true]) {
    const produced = sprites.readoutWidgetsFor(layout, digital, read, native);
    const rendered = native ? strip.prepare(produced, read) : produced;
    assert.equal(new Set(rendered.map((w) => w.id)).size, rendered.length);
    assert(rendered.some((w) => w.id === 'f82_info'));
    for (const w of rendered) {
        if (w.type === 'text' || w.type === 'icon') {
            for (const field of ['x', 'y', 'w', 'h']) assert(Number.isInteger(w[field]),
                w.id + ': bitmap ' + field + ' must align to whole sheet pixels');
        }
        assert(w.x >= 0 && w.x + w.w <= 1920 && w.y >= 0 && w.y + w.h <= (native ? 646 : 720), w.id + ' fits its mode');
        for (const other of rendered) if (w !== other) assert(!overlaps(w, other), w.id + ' overlaps ' + other.id);
        // Inspect source artwork alpha, rather than merely its outer rectangle:
        // the LCD belongs in the genuine spaces around the open-bottom dials.
        for (const id of ['speed_face', 'rpm_face', 'fuel_face', 'oil_face']) {
            const dial = layout.widgets.find((v) => v.id === id), image = read(dial.asset), pixels = Buffer.from(image.rgba, 'base64');
            for (let y = Math.ceil(w.y); y < w.y + w.h; y++) for (let x = Math.ceil(w.x); x < w.x + w.w; x++) {
                const sx = Math.floor((x - dial.x) * image.w / dial.w), sy = Math.floor((y - dial.y) * image.h / dial.h);
                if (sx < 0 || sy < 0 || sx >= image.w || sy >= image.h) continue;
                assert(pixels[(sy * image.w + sx) * 4 + 3] <= 32, w.id + ' crosses opaque dial artwork in ' + id);
            }
        }
    }
    if (native) assert(!rendered.some((w) => /footer|odometer|trip_distance|info_clock|info_ambient/.test(w.id)),
        'BMW strip owners have no duplicate fixed footer objects');
    if (digital) {
        const speed = produced.find((w) => w.id === 'f82_speed_value'), face = layout.widgets.find((w) => w.id === 'speed_face');
        const image = read(face.asset), scale = Math.min(face.w / image.w, face.h / image.h);
        near(speed.w / sprites.digitalSpeedWidgets[0].w, scale);
        near(speed.h / sprites.digitalSpeedWidgets[0].h, scale);
        near(speed.h, 47 * 1.026); // 0.16.7's 1.14 scale, reduced by 10%.
    }
}
const shifted = JSON.parse(JSON.stringify(layout));
shifted.widgets.forEach((w) => { w.x += 20; w.y -= 8; });
const original = sprites.readoutWidgetsFor(layout, true, read, false);
const moved = sprites.readoutWidgetsFor(shifted, true, read, false);
for (let i = 0; i < moved.length; i++) {
    near(moved[i].x - original[i].x, 20);
    near(moved[i].y - original[i].y, -8);
}
const mph = JSON.parse(JSON.stringify(layout));
mph.widgets.find((w) => w.id === 'speed_face').asset = 'speed-face-mph';
assert.deepEqual(sprites.readoutWidgetsFor(mph, true, read, true), sprites.readoutWidgetsFor(layout, true, read, true),
    'distance-unit artwork selection does not fall back to old readout geometry');
assert.equal(JSON.stringify([layout, sprites.digitalSpeedWidgets, sprites.infoWidgets, sprites.infoClock, sprites.infoAmbient]), frozen,
    'per-layout anchors never mutate source widgets or legacy constants');
console.log('F8X readout fit: proportional resized speed glyphs, source-alpha dial clearance, non-overlapping information rows, native-strip/full-height modes, translated anchors and MPH parity passed.');
