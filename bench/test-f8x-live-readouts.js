'use strict';
// Exercise the actual rendering gate for live speed and gear. Clocks/info keep
// their slower cadence; changing live values must not wait 200ms behind it.
const assert = require('assert').strict;
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const sprite = require('../shared/f82_sprite');
const layout = require('../apps/samagotia_clusters/cluster/layouts/our_m4.json');
const moduleStub = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../shared/f8x_runtime.js'), 'utf8'), {
    module: moduleStub, Buffer, process,
    require: (id) => id === './f8x_text' ? { drawText: (w, h) => Buffer.alloc(w * h * 4) } : {},
});
const widgets = [sprite.digitalSpeedWidgets[0],
    sprite.gearWidget(layout.widgets.find((w) => w.id === 'gear_selector')),
    sprite.gearWidget(layout.widgets.find((w) => w.id === 'gear_number'))];
for (const w of widgets) {
    assert.equal(w.rate, 50, w.id + ': fast live readout cadence');
    let value = '0', sends = 0;
    const runtime = Object.assign(Object.create(moduleStub.exports.prototype), {
        theme: { fg: [240, 240, 240, 255] }, f82Light: 'day',
        _resolve: () => value, _atlasCodes: () => [1], _blitDiff: () => { sends++; },
    });
    const x = { w, last: null, lastPaint: 0, ref: 1, c: { uniform() { sends++; } } };
    runtime._update(x, 0, true);
    assert.equal(sends, 1);
    value = '1'; runtime._update(x, 49, false);
    assert.equal(sends, 1, 'frame gating still bounds repeated work');
    runtime._update(x, 50, false);
    assert.equal(sends, 2, 'changed speed/gear draws at the first 50ms housekeeping tick');
    runtime._update(x, 100, false);
    assert.equal(sends, 2, 'an unchanged live value causes no text upload');
    value = '2'; runtime._update(x, 100, false);
    assert.equal(sends, 3, 'fresh changes are not held behind the old 200ms gate');
}
console.log('Live readouts: actual speed/gear render gates accept changes at 50ms, retain bounded work and skip unchanged values.');
