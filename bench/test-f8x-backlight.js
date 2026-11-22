'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sprite = require('../shared/f82_sprite');
const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'apps/samagotia_clusters/cluster/f82');
const spec = require('../apps/samagotia_clusters/app.json');
const option = spec.settings.find((s) => s.key === 'f8xBacklightColour');
assert.equal(option.default, 'original');
assert.deepEqual(option.options, [['original', 'Original'], ['amber', 'Amber']]);
assert(require('../apps/samagotia_clusters/release.json').visibleSettings.includes(option.key));
const runtimeModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_runtime.js'), 'utf8'), {
    module: runtimeModule, Buffer,
    require: (name) => name === './f82_sprite' ? sprite : {},
});
const paint = runtimeModule.exports.prototype._paintF82;
const load = (id) => JSON.parse(fs.readFileSync(path.join(assets, id + '.json')));
const faces = ['speed-face', 'speed-face-mph', 'rpm-face', 'rpm-face-diesel',
    'fuel-face', 'oil-face', 'oil-face-fahrenheit', 'oil-face-50-150', 'oil-face-50-150-fahrenheit'];
for (const face of faces) for (const light of ['day', 'night']) {
    const id = face + (light === 'night' ? '-night' : '');
    const original = load(id), amber = load(id + '-amber');
    assert.equal(original.w, amber.w); assert.equal(original.h, amber.h);
    const a = Buffer.from(original.rgba, 'base64'), b = Buffer.from(amber.rgba, 'base64');
    let changed = 0;
    const small = /^(fuel|oil)/.test(face), scale = small ? 1.085 : 1.15;
    const cx = (small ? 12 : 20) + (small ? 107 : 239) * scale;
    const cy = (small ? 7 : 8) + (small ? 137 : 239) * scale;
    for (let i = 0; i < a.length; i += 4) {
        assert.equal(a[i + 3], b[i + 3], 'coverage stays identical');
        assert(b[i] >= a[i], 'Amber strengthens the red printing channel');
        assert(b[i + 1] <= a[i + 1] && b[i + 2] <= a[i + 2]);
        const radius = Math.hypot((i / 4) % original.w - cx, Math.floor(i / 4 / original.w) - cy);
        if (radius < (small ? 17 : 43) * scale) assert(a.subarray(i, i + 4).equals(b.subarray(i, i + 4)), 'hub finish is preserved');
        const bezelY = (small ? 7 : 8) + (small ? 107 : 239) * scale;
        const rimRadius = Math.hypot((i / 4) % original.w - cx, Math.floor(i / 4 / original.w) - bezelY);
        if (rimRadius > (small ? 94 : 219) * scale) assert(a.subarray(i, i + 4).equals(b.subarray(i, i + 4)), 'metal rim finish is preserved');
        if (a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) changed++;
    }
    assert(changed > 300 && changed < original.w * original.h * 0.20, 'only the dial printing changes');
    for (const colour of ['original', 'amber', 'invalid']) {
        const uploads = [], requests = [];
        const state = { f82Light: light, setting: () => colour, _f82Asset: (name) => { requests.push(name); return load(name); } };
        paint.call(state, { w: { asset: face, nightAsset: face + '-night' }, ref: 3,
            c: { pixels: (ref, rect, bytes) => { assert.equal(ref, 3); uploads.push(bytes); } } }, load(face));
        assert.equal(uploads.length, 1);
        assert(uploads[0].equals(colour === 'amber' ? b : a), 'Original round-trip restores exact saved bytes');
    }
}
for (const id of ['background', 'background-night', 'fuel-needle-v2', 'rpm-needle-v2-shadow-day', 'oil-needle-v2-glass-night']) {
    assert.equal(sprite.backlightAsset(id, 'amber'), id, 'unrelated images are never tinted');
}
console.log('F8X backlight: defaults, all Day/Night/unit/engine/oil-scale variants, exact Original restoration, preserved hubs/coverage and isolated dial printing passed.');
