'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { paintIcon } = require('../shared/f8x_icons');
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
const { widgetsFor, pixelsFor, TRIANGLE_DAY } = artModule.exports;
const layout = JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster/layouts/our_m4.json')));
const read = (id) => JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster/f82', id + '.json')));
const widgets = widgetsFor(layout, read);
assert.equal(widgets.length, 3);
assert.deepEqual(Array.from(widgets, (w) => w.warningRole), ['fuelReserveText', 'fuelReserveIcon', 'attentionTriangle']);
const [text, pump, triangle] = widgets;
assert.equal(text.text, 'Fuel reserve'); assert.equal(text.font, 'f82_info'); assert.equal(text.align, 'left');
assert.deepEqual([text.x, text.y, text.w, text.h], [1138, 635, 190, 30]);
assert.equal(pump.x + pump.w / 2, triangle.x + triangle.w / 2, 'warning symbols share their own column');
assert(triangle.x > 1495 && triangle.x + triangle.w < 1560, 'triangle clears the tachometer and oil rims');
assert(text.y > 620 && text.y + text.h < 690, 'message sits below the lower arc');
assert.equal(widgetsFor({ widgets: [] }, read).length, 0);
const shifted = JSON.parse(JSON.stringify(layout));
for (const w of shifted.widgets) { w.x -= 20; w.y += 5; }
const moved = widgetsFor(shifted, read);
assert.equal(moved[0].x, text.x - 20); assert.equal(moved[0].y, text.y + 5);
assert.equal(moved[1].x, pump.x - 20); assert.equal(moved[2].y, triangle.y + 5);
const pixel = (bytes, w, x, y) => Array.from(bytes.subarray((y * w + x) * 4, (y * w + x + 1) * 4));
const pumpPixels = pixelsFor(pump, 'day');
assert.equal(pumpPixels, pixelsFor(pump, 'day'), 'icon buffer is cached');
assert.notDeepEqual(pumpPixels, pixelsFor(pump, 'night'), 'lighting changes tint only the image');
assert(pixel(pumpPixels, 50, 15, 30)[3] > 240, 'pump body is filled');
assert.equal(pixel(pumpPixels, 50, 18, 18)[3], 0, 'pump display window is open');
const trianglePixels = pixelsFor(triangle, 'day');
assert(pixel(trianglePixels, 28, 14, 15)[3] > 240);
assert(pixel(trianglePixels, 28, 14, 15)[0] < 20, 'exclamation stem is dark opaque ink');
assert(pixel(trianglePixels, 28, 10, 21)[0] > 200, 'triangle remains amber around the exclamation');
assert.equal(pixel(trianglePixels, 28, 0, 0)[3], 0, 'transparent surroundings');
// Existing icon names still use their original single-colour rendering path.
const cruise = paintIcon('cruise', 40, 40, TRIANGLE_DAY);
for (let i = 0; i < cruise.length; i += 4) if (cruise[i + 3]) assert.deepEqual(Array.from(cruise.subarray(i, i + 3)), Array.from(TRIANGLE_DAY).slice(0, 3));
const font = JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster/fonts/f82_info.json')));
for (const ch of text.text) assert(font.glyphs[ch], 'Fuel reserve needs a retained glyph for ' + JSON.stringify(ch));
const textPixels = pixelsFor(text, 'day');
assert.equal(textPixels, pixelsFor(text, 'day'), 'message is cached');
assert(textPixels.some((v, i) => i % 4 === 3 && v > 128));
console.log('F8X fuel warning artwork: factory placement, aligned warning column, filled pump, opaque triangle ink, complete font, cached lighting and unrelated icons passed.');
