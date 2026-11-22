'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const art = require('../shared/f8x_door_art');
const root = path.resolve(__dirname, '..');
const layout = require('../apps/samagotia_clusters/cluster/layouts/our_m4.json');
const read = (id) => require('../apps/samagotia_clusters/cluster/f82/' + id + '.json');
const widgets = art.widgetsFor(layout, read);
assert.equal(widgets.length, 1, 'one composed image, not a layer per closure');
const widget = widgets[0];
assert.deepEqual([widget.x, widget.y, widget.w, widget.h], [1553, 604, 72, 116]);
const stripWidget = art.widgetsFor(layout, read, 646)[0];
assert.deepEqual([stripWidget.x, stripWidget.y, stripWidget.w, stripWidget.h], [1553, 530, 72, 116]);
assert.equal(stripWidget.y + stripWidget.h, 646, 'the full-sized warning diagram is fitted before strip composition');
assert.equal(widget.type, 'icon'); assert.equal(widget.doorRole, 'diagram'); assert.equal(widget.own, true);
assert.equal(widget.w * widget.h * 8, 66816, 'renderer double-buffer allowance remains small');
assert.deepEqual(art.widgetsFor({ widgets: [] }, read), []);
const free = JSON.parse(JSON.stringify(layout));
free.widgets.forEach((w) => { w.y -= 15; });
const unclamped = art.widgetsFor(free, read)[0];
const shifted = JSON.parse(JSON.stringify(free));
shifted.widgets.forEach((w) => { w.x -= 15; w.y += 8; });
const moved = art.widgetsFor(shifted, read)[0];
assert.equal(moved.x, unclamped.x - 15); assert.equal(moved.y, unclamped.y + 8);
const off = JSON.parse(JSON.stringify(layout));
off.widgets.forEach((w) => { w.y += 100; });
assert.deepEqual(art.widgetsFor(off, read), [], 'do not clip diagrams beyond the bottom');
const cramped = JSON.parse(JSON.stringify(layout));
cramped.widgets.forEach((w) => { if (w.id === 'oil_face' || w.signal === 'oil') w.x -= 130; });
assert.deepEqual(art.widgetsFor(cramped, read, 646), [], 'do not overpaint a nearby oil gauge in the strip mode');

const state = (layoutName, physical) => ({ layout: layoutName, physical });
const left = state('two', { frontLeft: 'open' });
const right = state('two', { frontRight: 'open' });
const a = art.pixelsFor(widget, left, 'day'), b = art.pixelsFor(widget, right, 'day');
assert.equal(a.length, 72 * 116 * 4);
assert.equal(a, art.pixelsFor(widget, left, 'day'), 'steady state returns the same cached image');
assert(!a.equals(b), 'vehicle left and right render differently');
const count = (pixels, predicate) => {
    let total = 0;
    for (let y = 0; y < widget.h; y++) for (let x = 0; x < widget.w; x++) {
        const i = (y * widget.w + x) * 4;
        if (predicate(x, y, pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3])) total++;
    }
    return total;
};
const amber = (r, g, b, alpha) => alpha > 150 && r > 140 && g > 80 && g < r && b < 100;
const amberLeft = count(a, (x, y, r, g, b, alpha) => x < 20 && amber(r, g, b, alpha));
assert(amberLeft > 35);
assert.equal(count(a, (x, y, r, g, b, alpha) => x > 52 && amber(r, g, b, alpha)), 0);
assert(count(b, (x, y, r, g, b, alpha) => x > 52 && amber(r, g, b, alpha)) > 35);
assert(count(a, (x, y, r, g, b, alpha) => alpha > 0 && alpha < 255) > 50, 'supersampled boundaries remain antialiased');
for (let i = 0; i < a.length; i += 4) if (!a[i + 3]) assert.equal(a[i] + a[i + 1] + a[i + 2], 0, 'transparent pixels have no dark RGB fringe');
const night = art.pixelsFor(widget, left, 'night');
assert(!a.equals(night), 'lighting changes material brightness, not orientation');
assert.equal(art.pixelsFor(widget, state('two', { rearLeft: 'open', rearRight: 'open' }), 'day').some(Boolean), false,
    'coupe never invents rear-door graphics');
const rear = art.pixelsFor(widget, state('four', { rearLeft: 'open' }), 'day');
assert(count(rear, (x, y, r, g, b, alpha) => x < 20 && y > 65 && amber(r, g, b, alpha)) > 15);
const hood = art.pixelsFor(widget, state('two', { bonnet: 'open' }), 'day');
assert(count(hood, (x, y, r, g, b, alpha) => y < 40 && alpha > 150 && r > 150 && g < 90) > 30);
const boot = art.pixelsFor(widget, state('two', { boot: 'open' }), 'day');
assert(count(boot, (x, y, r, g, b, alpha) => y > 94 && alpha > 150 && r > 150 && g < 90) > 20);
assert(boot.equals(art.pixelsFor(widget, state('two', { boot2: 'open' }), 'day')), 'second flap is generic rear warning, not an invented upper/lower assignment');
for (const missing of [null, {}, state('two', {}), state('two', { frontLeft: 'unknown', bonnet: 'closed' }), state(null, { frontLeft: 'open' })]) {
    assert.equal(art.pixelsFor(widget, missing, 'day').some(Boolean), false, 'unknown/all-closed data never draws an all-clear car');
}
assert(art.pixelsFor(widget, state(null, { bonnet: 'open' }), 'day').some(Boolean), 'known bonnet can use a neutral profile without guessed doors');
assert.equal(art.normalized(state('two', { frontLeft: 'open' })).drawable, true);
assert.equal(art.normalized(state(null, { frontLeft: 'open' })).drawable, false);
assert.throws(() => art.pixelsFor({ w: 10000, h: 116 }, left, 'day'), /invalid door/);
// Cache remains bounded instead of pre-baking all body/light/closure combinations.
const first = state('four', { frontLeft: 'open' });
const original = art.pixelsFor(widget, first, 'day');
for (let mask = 2; mask < 24; mask++) {
    const keys = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight', 'bonnet', 'boot'];
    const panels = {}; keys.forEach((key, bit) => { panels[key] = mask & (1 << bit) ? 'open' : 'closed'; });
    art.pixelsFor(widget, state('four', panels), 'day');
}
const renewed = art.pixelsFor(widget, first, 'day');
assert.notEqual(original, renewed, 'old state was evicted from bounded LRU'); assert(original.equals(renewed));
assert.equal(art.CACHE_LIMIT, 16);

const data = { json: (name) => JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster', name))) };
const textModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_text.js'), 'utf8'), {
    module: textModule, Buffer, console, require: () => data,
});
const font = data.json('fonts/f82_info.json');
for (const label of ['Door open', 'Doors open', 'Hood open', 'Boot open', 'Tailgate open', 'Panels open']) {
    for (const ch of label) assert(font.glyphs[ch], 'warning label needs glyph ' + ch);
    assert(textModule.exports.measure(label, 'f82_info', 0) <= 190, label + ' fits existing warning row');
    const pixels = textModule.exports.drawText(190, 30, label, { font: 'f82_info', color: [240, 240, 230, 255] });
    assert(pixels.some((v, i) => i % 4 === 3 && v > 128));
}
console.log('F8X door art: one bounded cached image, saved-layout placement/clearance, two/four-door and physical sides, bonnet/boot highlights, unknown-state suppression, Day/Night antialiasing and complete measured warning glyphs passed.');
