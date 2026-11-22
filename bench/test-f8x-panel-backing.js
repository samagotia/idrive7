'use strict';
// Opaque full-panel backing prevents native readouts bleeding through the lower fade.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sprites = require('../shared/f82_sprite');
const { ClusterRender } = require('../shared/cluster_render_client');
const root = path.resolve(__dirname, '..');
const layout = require('../apps/samagotia_clusters/cluster/layouts/our_m4.json');
const backdrop = layout.widgets.find((w) => w.id === 'backdrop');
assert.deepEqual([backdrop.x, backdrop.y, backdrop.w, backdrop.h], [0, 0, 1920, 720]);
assert.equal(backdrop.own, true);
assert(!backdrop.exclusive);
assert(layout.widgets.every((w) => (w.z || 0) >= backdrop.z && !w.exclusive));
const load = (id) => JSON.parse(fs.readFileSync(path.join(root,
    'apps/samagotia_clusters/cluster/f82', id + '.json'), 'utf8'));
const runtimeModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_runtime.js'), 'utf8'), {
    module: runtimeModule, Buffer,
    require: (name) => name === './f82_sprite' ? sprites : {},
});
const paint = runtimeModule.exports.prototype._paintF82;
for (const light of ['day', 'night']) for (const backlight of ['original', 'amber']) {
    let uploaded = null;
    paint.call({ f82Light: light, setting: () => backlight, _f82Asset: load }, {
        w: backdrop, ref: 7, c: { pixels(ref, rect, bytes) {
            assert.equal(ref, 7); uploaded = bytes;
        } },
    }, load(backdrop.asset));
    const expected = load(light === 'night' ? backdrop.nightAsset : backdrop.asset);
    assert(uploaded);
    assert.equal(uploaded.length, expected.w * expected.h * 4);
    assert(uploaded.equals(Buffer.from(expected.rgba, 'base64')));
    let darkLowerPixels = 0;
    for (let i = 0; i < uploaded.length; i += 4) {
        const alpha = uploaded[i + 3];
        assert.equal(alpha, 255, 'every pixel must fully occlude the underlying stock artwork');
        for (const under of [0, 255]) for (let channel = 0; channel < 3; channel++) {
            const composited = Math.round(uploaded[i + channel] * alpha / 255 + under * (1 - alpha / 255));
            assert.equal(composited, uploaded[i + channel], 'bright stock content cannot affect any pixel');
        }
        if (i >= uploaded.length * 0.75 && Math.max(...uploaded.subarray(i, i + 3)) < 8) darkLowerPixels++;
    }
    assert(darkLowerPixels > expected.w, 'the lower colour fade still reaches black');

    // Exercise the real client framing, not only a mocked pixels() call. A
    // delayed first backing upload must retain its whole opaque texture and
    // full-panel destination when the socket becomes writable.
    const wire = [];
    const client = new ClusterRender('panel-backing-test', '/tmp/no-car');
    client.connected = client.ready = true;
    client.sock = { write(bytes) { wire.push(Buffer.from(bytes)); return true; } };
    const ref = client.image({ target: 'panel', klass: 'content', z: backdrop.z,
        x: backdrop.x, y: backdrop.y, w: backdrop.w, h: backdrop.h,
        iw: expected.w, ih: expected.h, sampling: 'bilinear' });
    assert(ref);
    const description = JSON.parse(wire[0].subarray(5));
    assert.deepEqual([description.target, description.x, description.y, description.w, description.h],
        ['panel', 0, 0, 1920, 720], 'the actual wire destination covers the whole custom panel');
    assert.equal(description.opacity, undefined, 'no layer opacity reduces the opaque backing');
    assert.equal(description.exclusive, undefined, 'backing never takes exclusive ownership');
    client.blocked = true;
    paint.call({ f82Light: light, setting: () => backlight, _f82Asset: load },
        { w: backdrop, ref, c: client }, load(backdrop.asset));
    assert.equal(wire.length, 1, 'a blocked socket retains the backing without a partial upload');
    assert.equal(client.layers.get(ref).whole, true);
    client.blocked = false;
    client._pump();
    assert.equal(wire.length, 2);
    const frame = wire[1];
    assert.equal(frame[4], 0x46, 'backing uses the binary frame protocol');
    assert.equal(frame.readUInt32LE(0), frame.length - 4);
    assert.equal(frame.readUInt32LE(5), ref);
    assert.equal(frame.readUInt16LE(17), 0, 'no rectangles means a whole-texture upload');
    assert(frame.subarray(19).equals(uploaded), 'the wire preserves every opaque RGBA byte');
    assert.equal(client.layers.get(ref).whole, false);
}
console.log('F8X panel backing: full coverage, Day/Night/backlight transitions, opaque actual-client wire upload after backpressure, colour fade and non-exclusive policy passed.');
