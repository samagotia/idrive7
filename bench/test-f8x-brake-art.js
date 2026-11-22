'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { widgetOf, pivotOf } = require('../shared/f8x_brake_art');
const { paintIcon } = require('../shared/f8x_icons');
const root = path.resolve(__dirname, '../apps/samagotia_clusters/cluster');
const layout = JSON.parse(fs.readFileSync(path.join(root, 'layouts/our_m4.json'), 'utf8'));
const readAsset = (id) => JSON.parse(fs.readFileSync(path.join(root, 'f82', id + '.json'), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
// Actual retained font pixels, rather than treating the whole 80px box as glyph ink.
const moduleStub = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../shared/f8x_text.js'), 'utf8'), {
    module: moduleStub, Buffer, console,
    require: () => ({ json: (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')) }),
});
function ink(widget) {
    const px = widget.type === 'text' ? moduleStub.exports.drawText(widget.w, widget.h, widget.text, {
        font: widget.font, color: widget.color, align: widget.align,
    }) : paintIcon(widget.icon, widget.w, widget.h, widget.color);
    const rows = [];
    for (let y = 0; y < widget.h; y++) {
        let left = widget.w, right = -1;
        for (let x = 0; x < widget.w; x++) if (px[(y * widget.w + x) * 4 + 3]) {
            left = Math.min(left, x); right = Math.max(right, x);
        }
        if (right >= left) rows.push({ y, left, right });
    }
    return rows;
}
function face(input, signal) {
    const w = input.widgets.find((widget) => widget.id === signal + '_face');
    const texture = readAsset(w.asset);
    return { w, texture, px: Buffer.from(texture.rgba, 'base64') };
}
function edgeAtRow(f, top, side) {
    let edge = side === 'right' ? -Infinity : Infinity;
    for (let y = 0; y < f.texture.h; y++) {
        const y0 = f.w.y + y * f.w.h / f.texture.h, y1 = y0 + f.w.h / f.texture.h;
        if (y1 <= top || y0 >= top + 1) continue;
        for (let x = 0; x < f.texture.w; x++) {
            if (f.px[(y * f.texture.w + x) * 4 + 3] < 224) continue;
            const boundary = f.w.x + (x + (side === 'right' ? 1 : 0)) * f.w.w / f.texture.w;
            edge = side === 'right' ? Math.max(edge, boundary) : Math.min(edge, boundary);
        }
    }
    return edge;
}
function check(input) {
    const icon = widgetOf(input, 'icon', readAsset), text = widgetOf(input, 'text', readAsset);
    assert(icon && text, 'a usable saved layout has a warning column');
    const centre = text.x + text.w / 2;
    const midpoint = (pivotOf(input, 'speed', readAsset).x + pivotOf(input, 'rpm', readAsset).x) / 2;
    assert(centre < midpoint, 'warning column remains on the speedometer side of the digital speed');
    const speedFace = face(input, 'speed'), rpmFace = face(input, 'rpm');
    for (const widget of [icon, text]) {
        assert.equal(widget.x + widget.w / 2, centre, 'EU and US warnings share one column');
        assert.equal(widget.y + widget.h / 2, 431);
        assert.equal(widget.warning, 'parkingBrake');
        assert.equal(widget.own, true);
        for (const row of ink(widget)) {
            const left = widget.x + row.left, right = widget.x + row.right + 1, top = widget.y + row.y;
            assert(left >= edgeAtRow(speedFace, top, 'right') + 8 - 1e-9,
                'actual warning ink must clear the speedometer rim by at least 8px');
            assert(right <= edgeAtRow(rpmFace, top, 'left') - 8 + 1e-9,
                'actual warning ink must clear the tachometer rim by at least 8px');
        }
    }
    assert.equal(icon.w, 42); assert.equal(icon.h, 42);
    assert.equal(text.w, 80); assert.equal(text.h, 30);
    assert.equal(icon.icon, 'parkingBrake'); assert.equal(text.text, 'BRAKE');
    assert.equal(text.font, 'r_label'); assert.equal(text.align, 'center');
    return centre;
}
assert.equal(pivotOf(layout, 'speed', readAsset).x, 626);
assert.equal(pivotOf(layout, 'rpm', readAsset).x, 1294);
const centre = check(layout);
assert(centre >= 930 && centre <= 940, 'factory column is near 930px, with measured rim clearance');
assert.notEqual(centre, 900, 'the old rim-overlapping position is rejected');
const text = widgetOf(layout, 'text', readAsset), rows = ink(text);
const left = Math.min(...rows.map((row) => row.left)), right = Math.max(...rows.map((row) => row.right));
assert.equal(right - left + 1, 63, 'retained BRAKE glyph ink stays inside the reserved 64px width');
assert(Math.abs(text.x + (left + right + 1) / 2 - centre) <= 0.5);
function moveGauge(input, signal, dx, scaleX, scaleY) {
    const pivot = pivotOf(input, signal, readAsset);
    for (const w of input.widgets.filter((widget) => widget.id === signal + '_face' || widget.signal === signal)) {
        w.x = pivot.x + dx + (w.x - pivot.x) * scaleX;
        w.y = pivot.y + (w.y - pivot.y) * scaleY;
        w.w *= scaleX; w.h *= scaleY;
    }
}
const translated = clone(layout);
moveGauge(translated, 'speed', 15, 1, 1); moveGauge(translated, 'rpm', 15, 1, 1);
assert.equal(check(translated), centre + 15, 'saved translations move the safe column with the dials');
const scaled = clone(layout);
moveGauge(scaled, 'speed', -25, 0.94, 0.85); moveGauge(scaled, 'rpm', 20, 0.96, 1.08);
check(scaled);
const tight = clone(layout);
moveGauge(tight, 'speed', 70, 1, 1); moveGauge(tight, 'rpm', -70, 1, 1);
for (const style of ['icon', 'text']) assert.equal(widgetOf(tight, style, readAsset), null,
    'a gap too narrow for a shared safe column must not put ink back onto a rim');
assert.equal(widgetOf({ widgets: [] }, 'icon', readAsset), null);
assert.equal(widgetOf(layout, 'icon', () => ({})), null);
assert.deepEqual(widgetOf(layout, 'invalid', readAsset), widgetOf(layout, 'icon', readAsset));
// The runtime creates the literal BRAKE texture once; status changes only toggle it.
const runtimeModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../shared/f8x_runtime.js'), 'utf8'), {
    module: runtimeModule, Buffer, console,
    require: (name) => name === './f8x_text' ? moduleStub.exports : {},
});
const runtime = Object.create(runtimeModule.exports.prototype);
let pixelWrites = 0, brakeState = 'unknown';
const visibility = [];
const client = { image(options) { assert.equal(options.visible, false); return 7; },
    pixels(ref, rects, bytes) { assert.equal(ref, 7); assert.equal(bytes.length, 80 * 30 * 4); pixelWrites++; },
    set(ref, pose) { assert.equal(ref, 7); visibility.push(pose.visible); } };
runtime._clientAt = () => client;
runtime.widgets = new Map(); runtime.theme = {}; runtime.parkingBrake = { value: () => brakeState };
runtime._create(text, null);
assert.equal(pixelWrites, 1);
const liveWidget = runtime.widgets.get('f8x_parking_brake');
brakeState = 'applied'; runtime._update(liveWidget, 1, false);
brakeState = 'released'; runtime._update(liveWidget, 2, false);
assert.equal(pixelWrites, 1, 'parking-brake status changes must not upload the text again');
assert.deepEqual(visibility, [false, true, false]);
console.log('F8X brake artwork: actual glyph/rim clearance, shared EU/US column, saved/scaled layouts, narrow-gap rejection and one-time raster passed. Centre=' + centre);
