'use strict';
// BMW owns stock turn/brake telltales; old preferences must not add replicas.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sprite = require('../shared/f82_sprite');
const cruise = require('../shared/f8x_cruise_art');
const icons = require('../shared/f8x_icons');
const spec = require('../apps/samagotia_clusters/app.json');
const release = require('../apps/samagotia_clusters/release.json');
const layout = require('../apps/samagotia_clusters/cluster/layouts/our_m4.json');
const root = path.resolve(__dirname, '..');
const removed = ['f8xTurnIndicators', 'f8xBrakeStyle'];
for (const key of removed) {
    assert(!spec.settings.some((s) => s.key === key), key + ' must not be offered');
    assert(!release.visibleSettings.includes(key));
}
assert.equal(spec.signals['de.bmw.body.Light'], undefined, 'no custom turn subscription permissions');
assert.equal(spec.signals['de.bmw.infotainment.vehicle.CDS'].statusHandBrake, undefined);
assert.equal(spec.signals['de.bmw.infotainment.vehicle.Vehicle2'].statusStandstillFunctions, undefined);
assert(!spec.shared.includes('f8x_brake.js')); assert(!spec.shared.includes('f8x_brake_art.js'));
assert.equal(sprite.turnIndicatorWidgets, undefined); assert.equal(sprite.turnDirection, undefined);
for (const name of ['turnLeft', 'turnRight', 'parkingBrake', 'cruise', 'attentionTriangle']) assert(!icons.paintIcon(name, 32, 32, [255, 255, 255, 255]).some(Boolean), 'removed icon ' + name);

const read = (id) => JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster/f82', id + '.json')));
const legacy = [
    { id: 'legacy_left', indicator: 'left' }, { id: 'legacy_right', indicator: 'right' },
    { id: 'legacy_icon_left', icon: 'turnLeft' }, { id: 'f82_turn_right' },
    { id: 'f8x_parking_brake' }, { id: 'legacy_brake', warning: 'parkingBrake' },
    { id: 'legacy_brake_icon', icon: 'parkingBrake' },
    { id: 'f8x_cruise_symbol', text: 'CRUISE' },
    { id: 'legacy_cruise_role', cruiseRole: 'symbol', text: 'CRUISE' },
    { id: 'legacy_cruise_icon', icon: 'cruise', text: 'CRUISE' },
    { id: 'f8x_attention_triangle', text: 'WARN' },
    { id: 'legacy_attention_role', warningRole: 'attentionTriangle', text: 'WARN' },
    { id: 'legacy_attention_icon', icon: 'attentionTriangle', text: 'WARN' },
].map((w) => Object.assign({ type: 'atext', font: 'f82_gear', text: 'BRAKE', x: 1, y: 1, w: 80, h: 30 }, w));
const source = Object.assign({}, layout, { widgets: layout.widgets.concat(legacy) });
const sourceBefore = JSON.stringify(source);
const runtimeModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_runtime.js'), 'utf8'), {
    module: runtimeModule, Buffer, process: { env: {}, uptime: () => 0 }, clearTimeout() {},
    require(name) {
        if (name === './f82_sprite') return sprite;
        if (name === './f8x_panel_backing') return require('../shared/f8x_panel_backing');
        if (name === './f8x_gear_recommendation_art') return require('../shared/f8x_gear_recommendation_art');
        if (name === './f8x_cruise_art') return { widgetsFor: (input) => cruise.widgetsFor(input, read) };
        if (name === './f8x_fuel_warning_art' || name === './f8x_door_art') return { widgetsFor: () => [] };
        return {};
    },
});
assert.equal(runtimeModule.exports.prototype._watchF82Turns, undefined, 'no custom turn signal reader remains');
assert.equal(runtimeModule.exports.prototype._setF82TurnDirection, undefined);
for (const turn of [undefined, 'stock', 'f8x', 'invalid']) for (const brake of ['icon', 'text']) {
    let planned;
    const done = new Error('captured layer plan');
    const state = Object.assign(Object.create(runtimeModule.exports.prototype), {
        ctx: { settings: { item: (key) => spec.settings.find((s) => s.key === key),
            get: (key) => key === removed[0] ? turn : key === removed[1] ? brake : undefined } },
        client: { ready: true }, _layerRefs: () => [], widgets: new Map(), f82Motion: new Map(), layerStates: new Map(),
        _f82Asset: read, _oilScaleInfo: () => ({ scale: '50-150' }),
        layouts: { load: () => source }, size: [1920, 720], car: { data: () => ({}), setRedline() {} },
        _updateF82Startup() {}, _effectiveFormat: () => 'metric',
        _plan(layers) { planned = layers; throw done; }, log: { warn() {} },
    });
    assert.throws(() => state._rebuildInner('our_m4'), (error) => error === done);
    for (const old of legacy) assert(!planned.some((w) => w.id === old.id), 'saved widget cannot duplicate BMW: ' + old.id);
    assert(!planned.some((w) => w.indicator || /turnLeft|turnRight|parkingBrake/.test(w.icon || '')));
    assert(!planned.some((w) => w.cruiseRole === 'symbol' || w.icon === 'cruise'), 'standalone cruise status is omitted');
    assert(!planned.some((w) => w.warningRole === 'attentionTriangle' || w.icon === 'attentionTriangle'), 'generic attention telltale is omitted');
    assert(planned.some((w) => w.cruiseRole === 'marker'), 'cruise set-speed marker remains');
    assert(planned.some((w) => w.gearRecommendation), 'verified sequential gear recommendations remain');
}
assert.equal(JSON.stringify(source), sourceBefore, 'loading a legacy saved layout does not mutate it');

const pageModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_page.js'), 'utf8'), {
    module: pageModule, require(name) {
        if (name === './kit/themes') return { THEMES: { m_tricolour: {} } };
        if (name === './f82_sprite') return sprite;
        return {};
    },
});
const controls = [];
const page = Object.assign(Object.create(pageModule.exports.prototype), {
    runtime: { doorStatusText: () => 'All doors closed', setting: (key) => spec.settings.find((s) => s.key === key).default },
    ctx: { settings: { item: (key) => spec.settings.find((s) => s.key === key) } },
});
const canvas = { text() {}, roundRect() {}, target(x, y, w, h, fn, id) { controls.push({ x, y, w, h, id }); } };
page.drawVehicle(canvas); page.drawSettings(canvas);
for (const key of removed) assert(!controls.some((c) => c.id === 'setting:' + key));
assert(controls.every((c) => c.y + c.h < 440), 'retained preferences fit above diagnostics');
console.log('F8X BMW telltales: custom turn/brake code, permissions and controls removed; all old preferences/saved widgets stay omitted; cruise marker and verified gear arrows remain.');
