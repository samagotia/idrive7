'use strict';
const assert = require('assert').strict;
const art = require('../shared/f8x_shift_art');
const sprite = require('../shared/f82_sprite');
const layout = require('../apps/samagotia_clusters/cluster/layouts/our_m4.json');
const read = (id) => require('../apps/samagotia_clusters/cluster/f82/' + id + '.json');
const face = layout.widgets.find((w) => w.shiftTrack), needle = layout.widgets.find((w) => w.signal === 'rpm');
const track = sprite.shiftTrackOf(face, needle), widgets = art.widgetsFor(track);
assert.equal(widgets.length, 34);
assert.equal(widgets.reduce((n, w) => n + w.iw * w.ih * 8, 0), 1392640, 'all resident variants fit within 1.4MB of native double-buffer budget');
assert(widgets.every((w) => w.type === 'f8xshiftlens' && w.own && w.iw === 128 && w.ih === 40));
assert.deepEqual(art.widgetsFor(null), []);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mix = (a, b, t) => a + (b - a) * t;
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// Independent reference in original, full-face shader coordinates. Compare the
// small tangent texture after transforming its pixels back to that source plane.
function reference(px, py, band, night, bloom) {
    const radius = track.shiftTrack[4], y = Math.hypot(px, py) - radius, a = Math.atan2(px, -py), e = band.edges;
    if (Math.abs(y) > 12.3 || a < e[0] || a > e[3]) return [0, 0, 0, 0];
    const segment = a < e[1] ? [e[0], e[1], band.counts[0], false]
        : a < e[2] ? [e[1], e[2], 1, false] : [e[2], e[3], band.counts[1], true];
    const pitch = (segment[1] - segment[0]) / Math.max(1, segment[2]);
    if (pitch <= 0) return [0, 0, 0, 0];
    const width = pitch * radius, frac = (a - segment[0]) / pitch % 1;
    const x = (frac - 0.5) * width, half = (width - Math.min(8, width * 0.24)) / 2, round = Math.min(1.25, half);
    const q = [Math.abs(x) - half + round, Math.abs(y) - 4.3 + round];
    const d = Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0)) + Math.min(Math.max(q[0], q[1]), 0) - round;
    const coverage = 1 - sm(-0.65, 0.65, d), shoulder = 1 - sm(-1.8, -0.3, d);
    const sheen = 1 + 0.04 * (1 - sm(-3.7, 0.2, y)), outside = Math.max(0, d);
    const halo = bloom * (night ? 0.4 : 0.28) * Math.exp(-outside * outside / 18) * (1 - sm(5.5, 8, outside));
    const alpha = coverage + (1 - coverage) * halo;
    const ink = segment[3] ? night ? [255, 61, 96] : [255, 56, 91] : night ? [255, 203, 16] : [240, 184, 20];
    return ink.map((v) => Math.round(clamp(mix(v, v * mix(0.84, sheen, shoulder) * (1 + 0.06 * bloom * shoulder), coverage / Math.max(alpha, 0.0001)), 0, 255)))
        .concat(Math.round(alpha * 255));
}
let compared = 0;
for (const night of [false, true]) for (const limit of [4500, 6000, 7200, 8500]) {
    const band = sprite.shiftBand(needle.curve, limit, track.shiftTrack[5]);
    for (const w of widgets) {
        const f = art.frameFor(w, { band, build: band.counts[0], bloom: w.lensVariant === 'strong' ? 1 : 0.6, night });
        const lens = art.lensAt(band, w.lensSlot);
        if (!lens) { assert.equal(f.visible, false); continue; }
        assert(f.pixels, 'all supported live limits have a resident capsule texture');
        const radius = track.shiftTrack[4];
        for (let iy = 0; iy < art.HEIGHT; iy += 2) for (let ix = 0; ix < art.WIDTH; ix += 2) {
            const u = ix + 0.5 - 64, v = iy + 0.5 - 14;
            if (Math.abs(Math.atan2(u, radius - v)) >= lens.pitch / 2) continue;
            const px = u * Math.cos(lens.angle) + (radius - v) * Math.sin(lens.angle);
            const py = u * Math.sin(lens.angle) - (radius - v) * Math.cos(lens.angle);
            const expected = reference(px, py, band, night, w.lensVariant === 'strong' ? 1 : 0.6);
            const offset = (iy * art.WIDTH + ix) * 4;
            // RGB at alpha zero is immaterial. Lit source pixels retain the
            // analytic curve, colours, antialiasing, bevel and bloom within 1 byte.
            assert(Math.abs(f.pixels[offset + 3] - expected[3]) <= 1);
            if (expected[3] > 0) for (let c = 0; c < 3; c++) assert(Math.abs(f.pixels[offset + c] - expected[c]) <= 1);
            compared++;
        }
        const angle = f.pose.rotate * Math.PI / 180;
        for (const x of [0, f.pose.w]) for (const y of [0, f.pose.h]) {
            const sx = f.pose.x + f.pose.px + (x - f.pose.px) * Math.cos(angle) - (y - f.pose.py) * Math.sin(angle);
            const sy = f.pose.y + f.pose.py + (x - f.pose.px) * Math.sin(angle) + (y - f.pose.py) * Math.cos(angle);
            assert(sx >= 0 && sx <= 1920 && sy >= 0 && sy <= 646, 'even the full rotated transparent quad clears the panel/strip');
        }
    }
}
assert(compared > 10000);
const band = sprite.shiftBand(needle.curve, 7200, track.shiftTrack[5]);
for (const w of widgets) {
    const first = art.frameFor(w, { band, build: 0, bloom: 0.6, night: false });
    if (!first.pixels) continue;
    for (const build of [0, 1, band.counts[0], 0]) for (const bloom of [0.6, 1]) {
        const next = art.frameFor(w, { band, build, bloom, night: false });
        assert.equal(next.pixelsKey, first.pixelsKey);
        assert.equal(next.pixels, first.pixels, 'buildup/flash/bloom only chooses resident layers, never creates different pixels');
    }
}
const arc = sprite.lowerArcOf(layout, read);
const day = art.arcPixelsFor(arc, false), night = art.arcPixelsFor(arc, true);
assert.equal(day.length, arc.w * arc.h * 4); assert.equal(day, art.arcPixelsFor(arc, false));
assert.notDeepEqual(day, night); assert(day.some((v, i) => i % 4 === 3 && v > 0 && v < 255), 'arc edge retains antialiasing');
for (let limit = 4100; limit < 8500; limit += 23) {
    const b = sprite.shiftBand(needle.curve, limit, track.shiftTrack[5]);
    widgets.forEach((w) => art.frameFor(w, { band: b, bloom: 1, build: 0, night: false }));
}
assert(art.cacheSize() <= art.CACHE_LIMIT, 'custom limit changes cannot grow the pixel cache without bound');
assert(art.arcCacheSize() <= 8);
assert.equal(art.frameFor(widgets[0], {}).visible, false, 'unknown limits never illuminate a capsule');
console.log('Resident shift artwork: original shader pixel parity, pink/amber bevel and both blooms, all rotated bounds, fixed small textures, visibility-only buildup/flash and bounded caches passed.');
