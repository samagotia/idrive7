'use strict';
const assert = require('assert').strict;
const sprite = require('../shared/f82_sprite');
const cruise = require('../shared/f8x_cruise_art');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const layout = require('../apps/samagotia_clusters/cluster/layouts/our_m4.json');
const spec = require('../apps/samagotia_clusters/app.json');
const release = require('../apps/samagotia_clusters/release.json');
const option = spec.settings.find((s) => s.key === 'f8xTurnIndicators');
assert.equal(option.default, 'stock');
assert.deepEqual(option.options, [['stock', 'BMW indicators'], ['f8x', 'F8X indicators']]);
assert(release.visibleSettings.includes(option.key));
assert.equal(spec.signals['de.bmw.infotainment.vehicle.Vehicle2'].statusStandstillFunctions, 'rs',
    'the electronic parking brake reader has both getter and notification permissions');
const original = JSON.stringify(sprite.turnIndicators);

for (const style of [undefined, null, '', 'stock', 'auto', 'invalid', true]) {
    assert.deepEqual(sprite.turnIndicatorWidgets(style), [], 'unconfigured and BMW mode must not add duplicate in-panel arrows');
}
const widgets = sprite.turnIndicatorWidgets('f8x');
assert.equal(widgets.length, 2);
assert.deepEqual(widgets, sprite.turnIndicators, 'explicit F8X mode retains the reference artwork and positions');
assert.deepEqual(widgets.map((w) => w.indicator), ['left', 'right']);
widgets[0].x = 0; widgets[0].color[0] = 0;
assert.equal(JSON.stringify(sprite.turnIndicators), original, 'a layout cannot mutate the shared cruise/turn reference');

const read = (id) => JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster/f82', id + '.json')));
for (const style of ['stock', 'f8x']) {
    const input = { widgets: layout.widgets.concat(sprite.turnIndicatorWidgets(style)) };
    const symbol = cruise.widgetsFor(input, read).find((w) => w.cruiseRole === 'symbol');
    assert(symbol, 'cruise indication remains available with either turn presentation');
    assert.equal(symbol.x, sprite.turnIndicators[0].x + sprite.turnIndicators[0].w + 10,
        'using stock turns does not move the cruise icon into the centre');
}

// Exercise the runtime's real visibility path using only explicit in-panel widgets.
const runtimeModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_runtime.js'), 'utf8'), {
    module: runtimeModule, Buffer, process: { env: {}, uptime: () => 0 },
    clearTimeout() {},
    require(name) {
        if (name === './f82_sprite') return sprite;
        if (name === './f8x_engine_profile') return require('../shared/f8x_engine_profile');
        if (name === './f8x_panel_backing') return require('../shared/f8x_panel_backing');
        if (name === './f8x_gear_recommendation_art') return require('../shared/f8x_gear_recommendation_art');
        if (name === './f8x_cruise_art') return { widgetsFor: (input) => cruise.widgetsFor(input, read) };
        if (name === './f8x_brake_art') return { widgetOf: () => null };
        if (name === './f8x_fuel_warning_art' || name === './f8x_door_art') return { widgetsFor: () => [] };
        return {};
    },
});
const runtime = Object.assign(Object.create(runtimeModule.exports.prototype), {
    f82TurnDirection: 'off', f82TurnChangedAt: 1000,
});
const visible = (indicator, now, direction) => {
    let pose;
    runtime.f82TurnDirection = direction;
    const x = { w: sprite.turnIndicatorWidgets('f8x').find((w) => w.indicator === indicator), last: null,
        c: { set(ref, value) { pose = value; } }, ref: 1 };
    runtime._update(x, now, true);
    return pose.visible;
};
for (const direction of ['off', 'left', 'right', 'both']) {
    for (const indicator of ['left', 'right']) {
        assert.equal(visible(indicator, 1000, direction), direction === 'both' || direction === indicator,
            'only the signalled side illuminates');
        assert.equal(visible(indicator, 1330, direction), false, 'the dark blink phase hides either arrow');
    }
}
assert.equal(sprite.turnDirection({ controlIndicateDirection: 'DAUER_BLINKEN_RECHTS_EIN' }), 'right');
assert.equal(sprite.turnDirection({ activeFunctionIndicateDirection: 'WARNBLINKEN_MANUELL' }), 'both');
assert.equal(sprite.turnDirection({ controlIndicateDirection: 'unrecognised' }), null);

// Capture the real rebuild's planned layers before renderer transport/allocation.
for (const saved of [undefined, 'stock', 'f8x', 'invalid']) {
    let planned;
    const done = new Error('captured layer plan');
    const state = Object.assign(Object.create(runtimeModule.exports.prototype), {
        ctx: { settings: { item: (key) => spec.settings.find((s) => s.key === key),
            get: (key) => key === option.key ? saved : undefined } },
        client: { ready: true }, _layerRefs: () => [], widgets: new Map(),
        f82Motion: new Map(), layerStates: new Map(), _f82Asset: read,
        layouts: { load: () => layout }, size: [1920, 720],
        car: { data: () => ({}), setRedline() {} },
        _updateF82Startup() {}, _effectiveFormat: () => 'metric',
        _plan(layers) { planned = layers; throw done; }, log: { warn() {} },
    });
    assert.throws(() => state._rebuildInner('our_m4'), (error) => error === done);
    assert.equal(planned.filter((w) => w.indicator).length, saved === 'f8x' ? 2 : 0,
        'the actual runtime rebuild respects the persisted mode and safe default');
    assert(planned.some((w) => w.cruiseRole === 'symbol'), 'the cruise symbol survives the rebuild');
}

// The control lives on Vehicle rather than overflowing the General settings grid.
const pageModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_page.js'), 'utf8'), {
    module: pageModule,
    require(name) {
        if (name === './kit/themes') return { THEMES: { m_tricolour: {} } };
        if (name === './f82_sprite') return sprite;
        if (name === './f8x_engine_profile') return require('../shared/f8x_engine_profile');
        return {};
    },
});
const controls = [], textRows = [];
const page = Object.assign(Object.create(pageModule.exports.prototype), {
    runtime: { doorStatusText: () => 'All doors closed', setting: (key) => spec.settings.find((s) => s.key === key).default },
    ctx: { settings: { item: (key) => spec.settings.find((s) => s.key === key) } },
});
page.drawVehicle({
    text(text, x, y) { textRows.push({ text, y }); }, roundRect() {},
    target(x, y, w, h, fn, id) { controls.push({ x, y, w, h, id }); },
});
assert(controls.some((c) => c.id === 'setting:f8xTurnIndicators'));
for (const c of controls) assert(c.y >= 92 && c.y + c.h < 300, 'Vehicle settings fit clear of status/help text');
assert(textRows.some((r) => r.text === 'BMW indicators'), 'the default is presented explicitly in the UI');
assert(textRows.every((r) => r.y <= 411), 'Vehicle text stays clear of bottom diagnostics');
console.log('F8X turn presentation: BMW defaults omit duplicate arrows, explicit F8X arrows keep reference positions and live blinking, cruise anchor and shared artwork are preserved.');
