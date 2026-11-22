'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sprite = require('../shared/f82_sprite');
const art = require('../shared/f8x_gear_recommendation_art');
const icons = require('../shared/f8x_icons');
const { GearRecommendation, decode, modeOf, INTERFACE, FIELD, MAX_AGE_MS } = require('../shared/f8x_gear_recommendation');
const spec = require('../apps/samagotia_clusters/app.json');
const layout = require('../apps/samagotia_clusters/cluster/layouts/our_m4.json');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const sample = (value) => ({ displayGearShiftIndicatorDrive: value });
const sequential = { demo: false, stage: 'D', gear: 3, program: 'M' };

async function run() {
    assert.equal(spec.signals[INTERFACE][FIELD], 'rs');
    assert(spec.shared.includes('f8x_gear_recommendation.js'));
    assert(spec.shared.includes('f8x_gear_recommendation_art.js'));
    for (const [raw, expected] of [[0, 'off'], [1, 'down'], [2, 'up'], ['ANZEIGE_AUS', 'off'], ['RUNTERSCHALTHINWEIS', 'down'], ['HOCHSCHALTHINWEIS', 'up']]) {
        assert.equal(decode(sample(raw)), expected);
    }
    for (const raw of [3, 'SIGNAL_UNGUELTIG', undefined, null, true, false, -1, 4, '2', 'up', NaN]) assert.equal(decode(sample(raw)), null);
    assert.equal(modeOf({ displayProgramGearbox: 'S_MINUS_PROGRAMM' }), 'S');
    assert.equal(modeOf({ displayProgramGearbox: 2 }), 'M');
    for (const raw of [0, 3, 4, 5, 7, 'D_PROGRAMM', 'SIGNAL_UNGUELTIG', true]) assert.equal(modeOf({ displayProgramGearbox: raw }), null);
    let now = 100, receive, availability, stopped = 0;
    const sub = { available: true, onAvailability(fn) { availability = fn; }, shutdown() { stopped++; } };
    const reader = new GearRecommendation({ log: { info() {} }, signals: { watch(iface, instance, handlers, log, opts) {
        assert.equal(iface, INTERFACE); assert.equal(instance, '1'); assert.deepEqual(Object.keys(handlers), [FIELD]);
        assert.equal(opts.pollMs, 500); assert.deepEqual(opts.pollFields, [FIELD]); assert.equal(opts.readTimeoutMs, 500);
        receive = handlers[FIELD]; return Promise.resolve(sub);
    } } }, { now: () => now });
    await tick();
    assert.equal(reader.value(sequential), null);
    reader.setProgramAvailability(true); reader.setProgram({ displayProgramGearbox: 1 }); receive(sample(2));
    assert.equal(reader.value(sequential), 'up');
    reader.setProgram({ displayProgramGearbox: 2 }); receive(sample('RUNTERSCHALTHINWEIS'));
    assert.equal(reader.value(sequential), 'down');
    for (const patch of [{ demo: true }, { stage: 'P' }, { stage: 'N' }, { stage: 'R', gear: -1 }, { stage: undefined }, { gear: 0 }, { gear: undefined }, { gear: 2.5 }]) {
        assert.equal(reader.value(Object.assign({}, sequential, patch)), null, 'arrows require a real forward sequential gear');
    }
    for (const program of [0, 3, 7, 'D_PROGRAMM', 'SIGNAL_UNGUELTIG']) {
        reader.setProgram({ displayProgramGearbox: program }); assert.equal(reader.value(sequential), null, 'automatic/unsupported modes hide recommendations');
    }
    reader.setProgram({ displayProgramGearbox: 1 });
    reader.setProgramAvailability(false); assert.equal(reader.value(sequential), null);
    reader.setProgramAvailability(true); assert.equal(reader.value(sequential), null, 'reconnect cannot revive an old sequential mode');
    reader.setProgram({ displayProgramGearbox: 2 }); assert.equal(reader.value(sequential), 'down');
    receive(sample(0)); assert.equal(reader.value(sequential), null);
    receive(sample(2)); now += MAX_AGE_MS; assert.equal(reader.value(sequential), 'up');
    now++; assert.equal(reader.value(sequential), null); assert.equal(reader.status().reason, 'stale');
    receive(sample(3)); assert.equal(reader.value(sequential), null);
    receive(sample(2)); sub.available = false; availability(false); assert.equal(reader.value(sequential), null);
    sub.available = true; availability(true); assert.equal(reader.value(sequential), null, 'provider recovery needs a fresh recommendation');
    receive(sample(1)); assert.equal(reader.value(sequential), 'down');
    const savedNow = now; now -= 1; assert.equal(reader.value(sequential), null, 'clock rollback cannot validate a future sample'); now = savedNow;
    reader.stop(); receive(sample(2)); assert.equal(reader.value(sequential), null); await tick(); assert.equal(stopped, 1);

    let resolve, late;
    const pending = new GearRecommendation({ signals: { watch(i, n, handlers) { late = handlers[FIELD]; return new Promise((r) => { resolve = r; }); } } });
    await tick(); pending.stop(); late(sample(2)); let lateStops = 0;
    resolve({ available: true, shutdown() { lateStops++; } }); await tick(); assert.equal(lateStops, 1); assert.equal(pending.value(sequential), null);
    const missing = new GearRecommendation({ signals: { watch() { return Promise.reject(new Error('unsupported')); } } });
    await tick(); assert.equal(missing.value(sequential), null); assert.equal(missing.status().reason, 'error'); missing.stop();

    const widgets = art.widgetsFor({ widgets: layout.widgets.map(sprite.gearWidget) });
    assert.equal(widgets.length, 2); assert.equal(art.widgetsFor({ widgets: [] }).length, 0);
    assert.equal(art.widgetsFor({ widgets: [{ id: 'gear_selector', text: '{{stage}}', x: 1900, y: 10, w: 58, h: 60 }] }).length, 0);
    for (const w of widgets) {
        assert(w.x >= 0 && w.y >= 0 && w.x + w.w <= 1920 && w.y + w.h <= 720);
        const pixels = icons.paintIcon(w.icon, w.w, w.h, w.color);
        assert(pixels.some((v, i) => i % 4 === 3 && v > 0), 'each arrow has supported visible pixels');
    }
    const runtimeModule = { exports: {} };
    let extraSignals;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../shared/f8x_runtime.js'), 'utf8'), {
        module: runtimeModule, Buffer, process: { env: {} }, require(name) {
            if (name === './f8x_icons') return icons;
            if (name === './f8x_vehicle') return class {
                constructor(ctx, groups, extra) { extraSignals = extra; }
                setRedline() {} onSample() {}
            };
            return {};
        },
    });
    let direction = null, creates = [], uploads = [], poses = [];
    const client = { image(opts) { creates.push(opts); return creates.length; }, set(ref, pose) { poses.push({ ref, pose }); } };
    const state = Object.assign(Object.create(runtimeModule.exports.prototype), {
        target: 'panel', theme: {}, widgets: new Map(), _connOf: () => 0, _clientAt: () => client,
        _blit(x, rectangle, pixels) { uploads.push(pixels); }, car: { data: () => sequential }, gearRecommendation: { value: () => direction },
    });
    for (const w of widgets) state._create(w, null);
    assert(creates.every((o) => o.visible === false), 'both directions start hidden before pixels arrive');
    assert(poses.every((p) => p.pose.visible === false));
    const uploadCount = uploads.length;
    for (const next of ['up', 'down', null]) {
        direction = next;
        for (const x of state.widgets.values()) state._update(x, 0, false);
        for (const x of state.widgets.values()) assert.equal(x.last, x.w.gearRecommendation === next, 'only the verified direction shows');
    }
    assert.equal(uploads.length, uploadCount, 'live direction changes send visibility only');
    const programEvents = [];
    const setup = Object.assign(Object.create(runtimeModule.exports.prototype), {
        infoData: {}, ctx: {}, setting: () => 7200, _watchF82Turns() {},
        gearRecommendation: { setProgramAvailability: (available) => programEvents.push(available),
            setProgram: (sample) => programEvents.push(sample.displayProgramGearbox) },
    });
    setup._setupVehicleData();
    const modeSource = extraSignals['de.bmw.infotainment.misc.MDrive'];
    modeSource.$onAvailability(true); modeSource.dataDisplayGearbox({ displayProgramGearbox: 'S_MINUS_PROGRAMM' });
    assert.equal(setup.program, 'S'); modeSource.$onAvailability(false); assert.equal(setup.program, null);
    assert.deepEqual(programEvents, [true, 'S_MINUS_PROGRAMM', false], 'the real setup links verified program and provider state to the reader');
    assert(sprite.isSequential(sequential, 'S')); assert(!sprite.isSequential(Object.assign({}, sequential, { demo: true }), 'S'));
    console.log('F8X gear recommendations: verified enum/source permissions, sequential-only fresh state, invalid/stale/provider/reconnect handling, calibrated icon placement, hidden startup and visibility-only updates passed.');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
