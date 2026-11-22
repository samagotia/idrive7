'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const data = { json: (name) => JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster', name))) };
const textModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_text.js'), 'utf8'), {
    module: textModule, Buffer, console, require: (name) => { assert.equal(name, './f8x_data'); return data; },
});
const artModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_fuel_warning_art.js'), 'utf8'), {
    module: artModule, Buffer, require: (name) => name === './f8x_text' ? textModule.exports : require('../shared/' + name.slice(2)),
});
const { widgetsFor, pixelsFor } = artModule.exports;
const layout = JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster/layouts/our_m4.json')));
const read = (id) => JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster/f82', id + '.json')));
const widgets = widgetsFor(layout, read);
assert.equal(widgets.length, 2);
assert.deepEqual(Array.from(widgets, (w) => w.warningRole), ['fuelReserveText', 'fuelReserveIcon']);
const [text, pump] = widgets;
assert.equal(text.text, 'Fuel reserve'); assert.equal(text.font, 'f82_info'); assert.equal(text.align, 'left');
assert.deepEqual([text.x, text.y, text.w, text.h], [1132, 667, 190, 30]);
assert(pump.x > 1500 && pump.x + pump.w < 1700, 'pump stays in the information column');
assert(text.y > 645 && text.y + text.h <= 720, 'full-height message sits below the enlarged lower arc');
const stripWidgets = widgetsFor(layout, read, 646);
assert.deepEqual(Array.from(stripWidgets, (w) => [w.x, w.y, w.w, w.h]), [[1499, 616, 190, 30], [1457, 610, 32, 36]],
    'strip mode fits the message and compact pump beyond the lower arc');
assert(stripWidgets.every((w) => w.y + w.h <= 646));
assert.equal(pixelsFor(stripWidgets[1], 'day').length, 32 * 36 * 4);
assert.equal(widgetsFor({ widgets: [] }, read).length, 0);
const shifted = JSON.parse(JSON.stringify(layout));
for (const w of shifted.widgets) { w.x -= 20; w.y -= 5; }
const moved = widgetsFor(shifted, read);
assert.equal(moved[0].x, text.x - 20); assert.equal(moved[0].y, text.y - 5);
assert.equal(moved[1].x, pump.x - 20); assert.equal(moved[1].y, pump.y - 5);
const pixel = (bytes, w, x, y) => Array.from(bytes.subarray((y * w + x) * 4, (y * w + x + 1) * 4));
const pumpPixels = pixelsFor(pump, 'day');
assert.equal(pumpPixels, pixelsFor(pump, 'day'), 'icon buffer is cached');
assert.notDeepEqual(pumpPixels, pixelsFor(pump, 'night'), 'lighting changes tint only the image');
assert(pixel(pumpPixels, 50, 15, 30)[3] > 240, 'pump body is filled');
assert.equal(pixel(pumpPixels, 50, 18, 18)[3], 0, 'pump display window is open');
assert(!widgets.some((w) => w.icon === 'attentionTriangle'), 'general BMW telltales are not recreated');
const font = JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster/fonts/f82_info.json')));
for (const ch of text.text) assert(font.glyphs[ch], 'Fuel reserve needs a retained glyph for ' + JSON.stringify(ch));
const textPixels = pixelsFor(text, 'day');
assert.equal(textPixels, pixelsFor(text, 'day'), 'message is cached');
assert(textPixels.some((v, i) => i % 4 === 3 && v > 128));
console.log('F8X fuel warning artwork: information-panel placement, filled pump, no general telltale replica, complete font and cached lighting passed.');
