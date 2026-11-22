'use strict';
// GPU callbacks can arrive at 60 Hz; unchanged settings must not record a canvas.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = path.resolve(__dirname, '../shared/f8x_page.js');
let now = 1000, canvases = 0, images = 0, kicks = 0, tick;
let settingsChanged, layoutChanged, statusChanged;
let info = 'range live', doors = 'doors closed', details = 'limit age 0s', oilScale = 'Auto G82: 50–150 °C';
let performance = ['RPM received 100/s', 'App command timing only'];
const targets = new Map();
const values = { hudLayout: 'off', units: 'metric', f8xLimitSource: 'auto', clockSource: 'car', f82InfoPage: 'off' };
const schema = (key) => ({ key, label: key, type: 'choice', options: key === 'hudLayout'
    ? [['off', 'BMW'], ['our_m4', 'F8X']] : [['metric', 'Celsius'], ['us', 'Fahrenheit']] });
const cv = new Proxy({
    textWidth: (text) => String(text).length * 7,
    target(x, y, w, h, fn, id) { targets.set(id, fn); },
}, { get: (object, key) => object[key] || (() => {}) });
const ctx = {
    loop(name, fps, fn) { assert.equal(name, 'MAIN'); tick = fn; return { kick() { kicks++; } }; },
    settings: { item: schema, onChange(fn) { settingsChanged = fn; },
        get: (key) => values[key], set(key, value) { values[key] = value; settingsChanged(); } },
    onLayout(fn) { layoutChanged = fn; }, theme: () => ({}),
    canvas(w, h) { assert.equal(w, 1600); assert.equal(h, 520); canvases++; return cv; },
    ui: { image(name) { assert.equal(name, 'MAIN_GFX'); images++; return Promise.resolve(); } },
};
const runtime = { activeName: 'off', lastStatus: 'BMW cluster',
    setting: (key) => values[key], onStatus(fn) { statusChanged = fn; },
    rpmLimitStatus: () => 'BMW live max RPM: 7200 rpm',
    rpmLimitDetails: () => details, infoStatus: () => info, doorStatusText: () => doors, oilScaleStatus: () => oilScale,
    performanceLines: () => performance,
};
const moduleUnderTest = { exports: {} };
vm.runInNewContext(fs.readFileSync(source, 'utf8'), {
    module: moduleUnderTest, Date: { now: () => now },
    require(name) {
        if (name === './kit/gauges') return { pageBottom: () => 500, frame() {} };
        if (name === './kit/themes') return { THEMES: { m_tricolour: {} } };
        if (name === './kit/sheet') return {};
        if (name === './f82_sprite') return {};
        throw new Error('Unexpected dependency ' + name);
    },
}, { filename: source });
const page = new moduleUnderTest.exports(ctx, runtime);
const next = async (ms) => { now += ms; await tick(); };
(async () => {
    page.start();
    assert.equal(canvases, 1);
    for (let i = 0; i < 120; i++) await next(17);
    assert.equal(canvases, 1, 'unchanged Designs records no extra frame across 60 Hz callbacks');
    runtime.activeName = 'our_m4'; runtime.lastStatus = 'F8X on'; statusChanged(); await next(0);
    assert.equal(canvases, 2, 'status event repaints immediately');
    page.set('units', 'us'); await next(0);
    assert.equal(canvases, 3, 'setting event repaints immediately');
    targets.get('tab:readouts')(); await next(0);
    assert.equal(canvases, 4, 'tab change repaints immediately');
    info = 'range changed';
    for (let i = 0; i < 58; i++) await next(17);
    assert.equal(canvases, 4, 'live readouts do not repaint at refresh rate');
    await next(14); assert.equal(canvases, 5, 'changed readouts refresh at one second');
    await next(1000); assert.equal(canvases, 5, 'unchanged readouts reuse their frame');
    targets.get('tab:vehicle')(); await next(0); const vehiclePaints = canvases;
    doors = 'driver door open'; await next(500); assert.equal(canvases, vehiclePaints);
    await next(500); assert.equal(canvases, vehiclePaints + 1, 'vehicle diagnostics remain live');
    targets.get('tab:settings')(); await next(0); const settingsPaints = canvases;
    details = 'limit age 1s'; await next(1000);
    assert.equal(canvases, settingsPaints + 1, 'settings diagnostics remain live');
    layoutChanged(); await next(0); assert.equal(canvases, settingsPaints + 2, 'layout event bypasses throttle');
    now -= 2000; await tick();
    details = 'limit age 2s'; await next(1000);
    assert.equal(canvases, settingsPaints + 3, 'clock rollback cannot freeze later updates');
    const beforeModelLoss = canvases; oilScale = 'Fallback: 50–150 °C';
    await next(1000); assert.equal(canvases, beforeModelLoss + 1, 'oil-scale source changes repaint even when the scale values stay the same');
    targets.get('tab:performance')(); await next(0);
    const performancePaints = canvases;
    assert(targets.has('setting:f8xLampRenderer') && targets.has('setting:f8xRpmNeedleMode'), 'render comparison and explicit RPM presentation controls are reachable');
    performance = ['RPM received 100/s, changed 20/s', 'App command timing only'];
    for (let i = 0; i < 58; i++) await next(17);
    assert.equal(canvases, performancePaints, 'timing diagnostics do not add 60Hz settings-page rendering');
    await next(14);
    assert.equal(canvases, performancePaints + 1, 'timing diagnostics refresh at 1Hz');
    assert.equal(images, canvases); assert(kicks >= 6);
    console.log('F8X settings performance: unchanged 60 Hz callbacks skip canvas recording, live diagnostics refresh at 1 Hz, and settings/status/layout/tab events repaint immediately.');
})().catch((error) => { console.error(error.stack); process.exitCode = 1; });
