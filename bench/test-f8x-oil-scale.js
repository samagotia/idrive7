'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const sprite = require('../shared/f82_sprite');
const Car = require('../shared/f8x_vehicle');
const spec = require('../apps/samagotia_clusters/app.json');
const release = require('../apps/samagotia_clusters/release.json');
const layout = require('../apps/samagotia_clusters/cluster/layouts/our_m4.json');
const option = spec.settings.find((s) => s.key === 'f8xOilScale');
const load = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '../apps/samagotia_clusters/cluster/f82', id + '.json')));
assert.equal(option.default, 'auto');
assert(release.visibleSettings.includes(option.key));
assert(option.options.some((o) => o[0] === 'auto' && /vehicle model/i.test(o[1])), 'automatic selection states its model source');
const untouched = JSON.stringify(layout);
for (const scale of ['50-150', '70-170']) for (const us of [false, true]) {
    const widgets = sprite.oilScaleWidgets(layout.widgets, scale, us, load);
    const face = widgets.find((w) => w.id === 'oil_face');
    const needle = widgets.find((w) => w.signal === 'oil');
    const endpoints = scale === '50-150' ? [50, 100, 150] : us ? [(160 - 32) * 5 / 9, (250 - 32) * 5 / 9, (340 - 32) * 5 / 9] : [70, 120, 170];
    for (let i = 0; i < 3; i++) assert(Math.abs(sprite.angle(needle.curve, endpoints[i]) - [-54, 0, 54][i]) < 1e-10,
        'live Celsius reading must land on the selected printed stop');
    assert.equal(sprite.angle(needle.curve, null), null);
    assert.equal(sprite.angle(needle.curve, NaN), null);
    assert.equal(sprite.angle(needle.curve, endpoints[0] - 20), -54);
    assert.equal(sprite.angle(needle.curve, endpoints[2] + 20), 54);
    for (const light of ['day', 'night']) for (const colour of ['original', 'amber']) {
        const id = (light === 'night' ? face.nightAsset : face.asset);
        const image = load(sprite.backlightAsset(id, colour));
        const original = load(sprite.backlightAsset('oil-face' + (us ? '-fahrenheit' : '') + (light === 'night' ? '-night' : ''), colour));
        assert.equal(image.w, original.w); assert.equal(image.h, original.h);
        if (scale === '70-170') { assert.deepEqual(image, original); continue; }
        assert.deepEqual(image.temperatureLabels, us ? [122, 212, 302] : [50, 100, 150]);
        const a = Buffer.from(original.rgba, 'base64'), b = Buffer.from(image.rgba, 'base64');
        let changed = 0;
        const cx = 12 + 107 * 1.085, bezelY = 7 + 107 * 1.085, hubY = 7 + 137 * 1.085;
        for (let i = 0; i < a.length; i += 4) {
            assert.equal(a[i + 3], b[i + 3], 'face coverage is preserved');
            const x = (i / 4) % image.w, y = Math.floor(i / 4 / image.w);
            if (Math.hypot(x - cx, y - bezelY) > 94 * 1.085 || Math.hypot(x - cx, y - hubY) < 17 * 1.085) {
                assert(a.subarray(i, i + 4).equals(b.subarray(i, i + 4)), 'metal and hub remain identical');
            }
            if (!a.subarray(i, i + 4).equals(b.subarray(i, i + 4))) changed++;
        }
        assert(changed > 300 && changed < image.w * image.h * 0.12, 'localized printing changes');
    }
    for (const w of widgets.filter((w) => !/^oil_/.test(w.id))) assert.equal(w, layout.widgets.find((o) => o.id === w.id), 'other dials are unchanged');
    assert.deepEqual(sprite.shadowOf(needle).curve, needle.curve);
    assert.deepEqual(sprite.glassOf(needle).curve, needle.curve);
}
assert.equal(JSON.stringify(layout), untouched, 'saved source is not mutated');
const custom = layout.widgets.filter((w) => w.id !== 'oil_face');
assert.equal(sprite.oilScaleWidgets(custom, '50-150', false, () => { throw new Error('unexpected load'); }), custom);
const defaultFace = sprite.oilScaleWidgets(layout.widgets, undefined, false, load).find((w) => w.id === 'oil_face');
assert.equal(defaultFace.asset, 'oil-face-50-150', 'existing installations without a saved scale get 50–150');

(async () => {
    let receive;
    const car = new Car({ spec: { config: {} }, settings: { get: () => 'off' }, log: { info() {}, warn() {} },
        signals: { watch(iface, instance, handlers) { receive = handlers.statusEngineTemperature; return Promise.resolve({ available: true }); } },
    }, ['temps']);
    await new Promise((resolve) => setImmediate(resolve));
    receive({ temperatureEngineOilDrive: 148, temperatureEngineDrive: 138 });
    assert.equal(car.data().oil, 100, 'live oil decoding stays raw minus 48 Celsius');
    assert.equal(car.data().coolant, 90, 'coolant is not substituted for oil');
    const needle = sprite.oilScaleWidgets(layout.widgets, '50-150', false, load).find((w) => w.signal === 'oil');
    assert.equal(sprite.angle(needle.curve, car.data().oil), 0, '100 °C live oil is centred on the new scale');
    car.stop();
    console.log('F8X oil scale: live Celsius reading, calibrated C/F stops, scale switching, companions, Day/Night/Amber artwork preservation and missing-setting default passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
