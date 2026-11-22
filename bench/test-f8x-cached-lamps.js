'use strict';
// Actual runtime and client framing; only transport, provider values and clock
// are simulated. Image updates are forbidden during buildup/flash/bloom changes.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sprite = require('../shared/f82_sprite');
const art = require('../shared/f8x_shift_art');
const { ClusterRender } = require('../shared/cluster_render_client');
const { frames } = require('./renderer-wire');
const root = path.resolve(__dirname, '..');
const layout = require('../apps/samagotia_clusters/cluster/layouts/our_m4.json');
const spec = require('../apps/samagotia_clusters/app.json');
const read = (id) => require('../apps/samagotia_clusters/cluster/f82/' + id + '.json');
const moduleStub = { exports: {} };
let now = 1000;
function artModule(filename) {
    const mod = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'shared', filename), 'utf8'), {
        module: mod, Buffer,
        require: (id) => id === './f8x_text' ? {} : require(path.join(root, 'shared', id)),
    });
    return mod.exports;
}
const cruise = require('../shared/f8x_cruise_art');
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_runtime.js'), 'utf8'), {
    module: moduleStub, Buffer, process, Date: { now: () => now }, clearTimeout, setTimeout,
    require(name) {
        if (name === './f82_sprite') return sprite;
        if (name === './f8x_shift_art') return art;
        if (name === './f8x_cruise_art') return { widgetsFor: (l) => cruise.widgetsFor(l, read) };
        if (name === './f8x_fuel_warning_art') return artModule('f8x_fuel_warning_art.js');
        if (name === './f8x_door_art') return require('../shared/f8x_door_art');
        if (name === './f8x_panel_strip') return require('../shared/f8x_panel_strip');
        if (name === './f8x_panel_backing') return require('../shared/f8x_panel_backing');
        if (name === './f8x_gear_recommendation_art') return require('../shared/f8x_gear_recommendation_art');
        return {};
    },
});
const proto = moduleStub.exports.prototype;

// The real composition and sheet planner, including all lamps, not just a
// hand-picked layer count. Source-side texture accounting is conservative for
// the cropped background, as in the runtime's own status calculation.
let maximumLayers = 0, maximumBytes = 0;
for (const nativeStrip of [true, false]) {
    const stop = new Error('captured actual plan');
    let plan, layers;
    const settings = { f8xLampRenderer: 'cached', f8xNativeBottomStrip: nativeStrip, f82DigitalSpeed: true };
    const runtime = Object.assign(Object.create(proto), {
        client: { ready: true }, _layerRefs: () => [], widgets: new Map(), f82Motion: new Map(), layerStates: new Map(),
        ctx: { settings: { item: (key) => spec.settings.find((s) => s.key === key), get: (key) => settings[key] } },
        _f82Asset: read, _oilScaleInfo: () => ({ scale: '50-150' }), layouts: { load: () => layout },
        size: [1920, 720], car: { data: () => ({}), setRedline() {} },
        _updateF82Startup() {}, _effectiveFormat: () => 'metric', log: { warn(msg) { throw new Error(msg); } },
        _plan(input, maxPx, waste) { layers = input; plan = proto._plan.call(this, input, maxPx, waste); throw stop; },
    });
    assert.throws(() => runtime._rebuildInner('our_m4'), (e) => e === stop);
    assert.equal(layers.filter((w) => w.type === 'f8xshiftlens').length, 34);
    assert.equal(layers.filter((w) => w.type === 'f8xarcimage').length, 1);
    assert(!layers.some((w) => w.type === 'f82shift' || w.type === 'f8xarc'), 'default plan contains no analytic ring shaders');
    const counts = runtime._connCounts(plan);
    assert(counts.every((n) => n <= 64));
    assert(plan.length <= 96, 'cached comparison respects global native layer count');
    let bytes = 0;
    const fonts = new Map();
    for (const p of plan) {
        if (p.kind === 'sheet') bytes += p.w * p.h * 8;
        else if (p.w.type === 'f82sprite') { const a = read(p.w.asset); bytes += a.w * a.h * 8; }
        else if (['text', 'icon', 'f8xshiftlens', 'f8xarcimage'].includes(p.w.type)) {
            bytes += (p.w.iw || p.w.w) * (p.w.ih || p.w.h) * 8;
        }
        for (const w of p.kind === 'sheet' ? p.members : [p.w]) if (w.type === 'atext') fonts.set(p.conn + ':' + w.font, w.font);
    }
    for (const name of fonts.values()) {
        const f = require('../apps/samagotia_clusters/cluster/fonts/' + name + '.json');
        const chars = Object.keys(f.glyphs).filter((c) => c.length === 1 && c >= ' ' && c <= '~').sort().slice(0, 64);
        const cw = Math.ceil(Math.max(...chars.map((c) => f.glyphs[c].advance))) + 2;
        const cols = Math.min(16, Math.floor(2048 / cw));
        bytes += cols * cw * Math.ceil(chars.length / cols) * f.cellHeight * 2;
    }
    assert(bytes <= 16 * 1024 * 1024, 'all source images, cached lamps and font atlases fit native pixel budget');
    maximumLayers = Math.max(maximumLayers, plan.length); maximumBytes = Math.max(maximumBytes, bytes);
}

const writes = [], client = new ClusterRender('cached-lamps-test', '/tmp/no-car');
client.ready = client.connected = true;
client.sock = { write(bytes) { writes.push(Buffer.from(bytes)); return true; } };
let rpm = 1000, pedal = 0, limit = 7200;
const runtime = Object.assign(Object.create(proto), {
    widgets: new Map(), f82Needles: [], f82Light: 'day', target: 'panel', theme: {},
    _clientAt: () => client, _connOf: () => 0, _testRpm: () => null,
    _f82ShiftLimit: () => limit, _f82PedalPercent: () => pedal,
    car: { data: () => ({ rpm, oil: 100 }) }, setting: () => 300,
    log: { info() {}, warn(msg) { throw new Error(msg); } },
});
const track = sprite.shiftTrackOf(layout.widgets.find((w) => w.shiftTrack), layout.widgets.find((w) => w.signal === 'rpm'));
const lamps = art.widgetsFor(track);
const arc = Object.assign({}, sprite.lowerArcOf(layout, read), { type: 'f8xarcimage' });
lamps.concat(arc).forEach((w) => runtime._create(w, null));
assert.equal(client.layers.size, 35);
const commands = () => frames(writes).filter((b) => b[4] === 0x4a).map((b) => JSON.parse(b.slice(5)));
assert(commands().filter((op) => op.op === 'layer').every((op) => op.kind === 'image' && !op.fs));
assert(Array.from(client.layers.values()).every((l) => l.anims.size === 0));
const imageCopies = new Map(Array.from(runtime.widgets.values()).map((x) => [x.ref, Buffer.from(client.layers.get(x.ref).image)]));
const legacyUniforms = {};
const legacy = { w: track, ref: 999, last: null, c: {
    uniform(ref, name, values) { legacyUniforms[name] = values; }, set() {},
} };
runtime._updateF82Shift(legacy, now, true);
const tick = () => {
    now += 50;
    runtime._updateF82Shift(legacy, now, false);
    runtime.widgets.forEach((x) => runtime._update(x, now, false));
    const state = runtime._shiftFrame(track, now);
    if (state) {
        assert.equal(state.build, legacyUniforms.u_build[0], 'cached buildup/flash decisions match retained analytic comparison path');
        assert.equal(state.bloom, legacyUniforms.u_bloom[0], 'normal/strong bloom decisions match retained analytic path');
    }
};
writes.length = 0;
for (let i = 0; i < 30; i++) tick();
assert.equal(writes.length, 0, 'steady cached lamps/arc cause no commands or uploads');
pedal = 100;
for (const value of [4200, 4800, 5500, 6200, 6800, 7100, 7100, 7100, 7100, 7100]) { rpm = value; tick(); }
pedal = 0; tick();
assert(writes.length > 0, 'buildup and flashing actually exercise visibility commands');
assert(frames(writes).every((b) => b[4] === 0x4a), 'buildup/flash/bloom toggles send zero pixel frames');
assert(commands().every((op) => op.op === 'set' && op.visible !== undefined));
for (const [ref, image] of imageCopies) assert(client.layers.get(ref).image.equals(image), 'resident RGBA never changes during buildup/flash');
writes.length = 0;
runtime.f82Light = 'night'; tick();
assert(frames(writes).some((b) => b[4] === 0x46), 'lighting change refreshes palette exactly when required');
writes.length = 0; tick(); assert.equal(writes.length, 0);
limit = null; tick();
assert(Array.from(runtime.widgets.values()).filter((x) => x.w.type === 'f8xshiftlens')
    .every((x) => client.layers.get(x.ref).opts.visible === false), 'unknown/stale limit hides all lens variants');
limit = 7200; tick();
writes.length = 0; limit = 6500; tick();
assert(frames(writes).some((b) => b[4] === 0x46), 'a changed limit can update changed capsule pitch');
writes.length = 0; tick(); assert.equal(writes.length, 0);
for (const ref of Array.from(client.layers.keys())) client.drop(ref);
assert.equal(client.layers.size, 0, 'cached layers release through normal fallback cleanup');
console.log('Cached runtime lamps: actual default composition ' + maximumLayers + '/64 layers, '
    + (maximumBytes / 1048576).toFixed(2) + '/16MiB, resident images, zero idle/buildup/flash/bloom pixels, palette/limit refresh and cleanup passed.');
