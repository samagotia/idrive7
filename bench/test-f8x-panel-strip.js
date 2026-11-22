'use strict';
// The workaround is a geometry condition, not simply transparent pixels.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const strip = require('../shared/f8x_panel_strip');
const sprites = require('../shared/f82_sprite');
const backing = require('../shared/f8x_panel_backing');
const { ClusterRender } = require('../shared/cluster_render_client');
const root = path.resolve(__dirname, '..');
const layout = require('../apps/samagotia_clusters/cluster/layouts/our_m4.json');
const read = (id) => require('../apps/samagotia_clusters/cluster/f82/' + id + '.json');
function art(name) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'shared', name), 'utf8'), {
        module, Buffer, require: (id) => id === './f8x_text' ? {} : require(path.join(root, 'shared', id)),
    });
    return module.exports;
}
const before = JSON.stringify(layout);
const needles = layout.widgets.filter((w) => w.signal);
const extras = needles.filter((w) => w.shadow).map(sprites.shadowOf)
    .concat(needles.filter((w) => w.glass).map(sprites.glassOf));
const input = [backing.widget()].concat(layout.widgets, sprites.infoWidgets,
    art('f8x_fuel_warning_art.js').widgetsFor(layout, read),
    art('f8x_door_art.js').widgetsFor(layout, read), extras);
const prepared = strip.prepare(input, read);
assert.equal(JSON.stringify(layout), before, 'source layout is never edited by the test mode');
assert.equal(strip.BOTTOM, 646);
assert(!prepared.some((w) => w.id.indexOf('f82_footer') === 0 || w.id === 'f82_odometer' || w.id === 'f82_trip_distance'));
for (const original of layout.widgets.filter((w) => w.id !== 'backdrop').concat(extras)) {
    assert.equal(prepared.find((w) => w.id === original.id), original, original.id + ': exact original geometry and metadata retained');
}
for (const w of prepared) assert(w.y + w.h <= 646, w.id + ': even an invisible layer must avoid the strip');
// Check the entire rotated quad, not only its upright bounding rectangle.
for (const w of prepared.filter((w) => w.signal)) {
    const image = read(w.asset), px = w.pivot[0] * w.w / image.w, py = w.pivot[1] * w.h / image.h;
    for (let degrees = w.curve[0][1]; degrees <= w.curve[w.curve.length - 1][1]; degrees++) {
        const theta = degrees * Math.PI / 180;
        for (const x of [0, w.w * (w.glassOnly ? 1.1 : 1)]) for (const y of [0, w.h]) {
            // Allow more screen-space shadow displacement than the runtime uses.
            const bottom = w.y + py + (x - px) * Math.sin(theta) + (y - py) * Math.cos(theta) + (w.shadowOnly ? 20 : 0);
            assert(bottom <= 646, w.id + ': complete sweep remains above the native strip');
        }
    }
}
const backdrop = prepared.find((w) => w.id === 'backdrop');
assert.deepEqual([backdrop.w, backdrop.h, backdrop.sourceRows], [1920, 645, 258]);
assert.equal(backdrop.h / backdrop.sourceRows, 720 / read('background').h, 'background keeps its original vertical scale');
const moduleStub = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_runtime.js'), 'utf8'), {
    module: moduleStub, Buffer, Date,
    require: (name) => name === './f82_sprite' ? sprites : {},
});
for (const light of ['day', 'night']) for (const backlight of ['original', 'amber']) {
    const wire = [];
    const client = new ClusterRender('bottom-strip-test', '/tmp/no-car');
    client.connected = client.ready = true;
    client.sock = { write(bytes) { wire.push(Buffer.from(bytes)); return true; } };
    const runtime = Object.assign(Object.create(moduleStub.exports.prototype), {
        widgets: new Map(), theme: {}, target: 'panel', f82Light: light,
        setting: () => backlight, _f82Asset: read, _connOf: () => 0, _clientAt: () => client,
        _update() {}, log: { warn(message) { throw new Error(message); } },
    });
    runtime._create(backdrop, null);
    const op = JSON.parse(wire[0].slice(5));
    assert.deepEqual([op.x, op.y, op.w, op.h, op.iw, op.ih], [0, 0, 1920, 645, 768, 258]);
    const image = read(light === 'day' ? 'background' : 'background-night');
    const expected = Buffer.from(image.rgba, 'base64').slice(0, image.w * 258 * 4);
    assert(wire[1].slice(19).equals(expected), 'actual wire carries only uncropped-width top source rows, for both lighting modes');
    client.blocked = true;
    runtime._paintF82(runtime.widgets.get('backdrop'), read('background'));
    client.blocked = false; client._pump();
    assert(client.layers.get(op.ref).image.equals(expected), 'backpressure cannot restore full-height pixels');
}
assert.throws(() => strip.prepare([{ id: 'saved_dial', type: 'f82sprite', x: 0, y: 400, w: 250, h: 251 }], read),
    /reaches BMW bottom strip/, 'an incompatible saved layout is refused, never silently shrunk or moved');
const spec = require('../apps/samagotia_clusters/app.json');
assert.equal(spec.settings.find((s) => s.key === 'f8xNativeBottomStrip').default, true);
assert(spec.shared.includes('f8x_panel_strip.js'));
assert(require('../apps/samagotia_clusters/release.json').visibleSettings.includes('f8xNativeBottomStrip'));
console.log('F8X native strip: untouched dial geometry and sweeps, no footer quads, exact cropped Day/Night pixels on real client wire, backpressure and saved-layout refusal passed.');
