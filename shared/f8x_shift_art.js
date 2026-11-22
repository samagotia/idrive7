'use strict';
// SPDX-License-Identifier: MIT
// Resident, small RGBA capsules replacing the full-face limiter fragment shader.
// Buildup/flash selects existing layers; expensive capsule maths runs only when
// radius, pitch, lighting or the preloaded bloom variant changes.
const WIDTH = 128, HEIGHT = 40, PX = 64, PY = 14;
const MAX_LENSES = 17, CACHE_LIMIT = 32;
const cache = new Map();
const arcCache = new Map();
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mix = (a, b, t) => a + (b - a) * t;
function smooth(a, b, v) { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

function widgetsFor(track) {
    if (!track || !Array.isArray(track.shiftTrack) || track.shiftTrack.length !== 6) return [];
    const [sw, sh, cx, cy, radius] = track.shiftTrack;
    if (![track.x, track.y, track.w, track.h, sw, sh, cx, cy, radius].every(Number.isFinite)
        || sw <= 0 || sh <= 0 || radius <= 0 || track.w <= 0 || track.h <= 0) return [];
    const sx = track.w / sw, sy = track.h / sh;
    const source = { x: track.x, y: track.y, sx, sy, cx, cy, radius };
    const out = [];
    for (let slot = 0; slot < MAX_LENSES; slot++) for (const variant of ['normal', 'strong']) {
        out.push({ id: track.id + ' lens ' + slot + ' ' + variant, type: 'f8xshiftlens', own: true,
            class: track.class, conn: track.conn, z: track.z || 0, x: track.x, y: track.y,
            w: WIDTH * sx, h: HEIGHT * sy, iw: WIDTH, ih: HEIGHT,
            shiftTrack: track.shiftTrack, curve: track.curve,
            lensSlot: slot, lensVariant: variant, lensSource: source });
    }
    return out;
}

function lensAt(band, slot) {
    if (!band || !Array.isArray(band.edges) || band.edges.length !== 4 || !band.edges.every(Number.isFinite)
        || !Array.isArray(band.counts) || band.counts.length !== 2
        || !band.counts.every((n) => Number.isInteger(n) && n >= 0 && n <= MAX_LENSES)) return null;
    const e = band.edges, counts = band.counts;
    if (e[0] > e[1] || e[1] > e[2] || e[2] > e[3] || counts[0] + counts[1] + 1 > MAX_LENSES) return null;
    const groups = [
        { start: e[0], end: e[1], count: counts[0], kind: 'build' },
        { start: e[1], end: e[2], count: e[2] > e[1] ? 1 : 0, kind: 'amber' },
        { start: e[2], end: e[3], count: counts[1], kind: 'red' },
    ];
    let offset = 0;
    for (const g of groups) {
        if (!g.count || g.end <= g.start) continue;
        if (slot < offset + g.count) {
            const index = slot - offset, pitch = (g.end - g.start) / g.count;
            return { kind: g.kind, index, pitch, angle: g.start + (index + 0.5) * pitch };
        }
        offset += g.count;
    }
    return null;
}

function pixelsFor(radius, pitch, kind, night, variant) {
    const key = [radius.toFixed(6), pitch.toFixed(9), kind === 'red' ? 'red' : 'amber', night ? 1 : 0, variant].join(':');
    if (cache.has(key)) {
        const value = cache.get(key); cache.delete(key); cache.set(key, value); return value;
    }
    // A tangent quad must contain the curved angular cell, including its bloom.
    // Refuse unsupported custom geometry instead of clipping the illuminated edge.
    const half = pitch / 2;
    if (half <= 0 || half >= Math.PI / 2 || (radius + 12.3) * Math.sin(half) > PX - 1
        || radius - (radius - 12.3) * Math.cos(half) > HEIGHT - PY - 1) return null;
    const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
    const width = pitch * radius, gap = Math.min(8, width * 0.24);
    const halfLength = (width - gap) / 2, roundness = Math.min(1.25, halfLength);
    const bloom = variant === 'strong' ? 1 : 0.6;
    const ink = kind === 'red' ? (night ? [255, 61, 96] : [255, 56, 91])
        : night ? [255, 203, 16] : [240, 184, 20];
    for (let iy = 0; iy < HEIGHT; iy++) for (let ix = 0; ix < WIDTH; ix++) {
        const u = ix + 0.5 - PX, v = iy + 0.5 - PY;
        // Rotate this local tangent plane to the capsule's angle using the
        // compositor. In the source circle, v points inward, not radially out.
        const y = Math.hypot(u, radius - v) - radius;
        if (Math.abs(y) > 12.3) continue;
        const a = Math.atan2(u, radius - v);
        if (a < -half || a >= half) continue; // adjacent cells never double-composite bloom
        const x = a * radius;
        const qx = Math.abs(x) - halfLength + roundness;
        const qy = Math.abs(y) - 4.3 + roundness;
        const dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - roundness;
        const coverage = 1 - smooth(-0.65, 0.65, dist);
        const shoulder = 1 - smooth(-1.8, -0.3, dist);
        const sheen = 1 + 0.04 * (1 - smooth(-3.7, 0.2, y));
        const outside = Math.max(0, dist);
        const halo = bloom * (night ? 0.4 : 0.28) * Math.exp(-0.5 * outside * outside / 9)
            * (1 - smooth(5.5, 8, outside));
        const alpha = coverage + (1 - coverage) * halo;
        if (alpha <= 0) continue;
        const offset = (iy * WIDTH + ix) * 4;
        for (let c = 0; c < 3; c++) {
            const core = ink[c] * mix(0.84, sheen, shoulder) * (1 + 0.06 * bloom * shoulder);
            pixels[offset + c] = Math.round(clamp(mix(ink[c], core, coverage / Math.max(alpha, 0.0001)), 0, 255));
        }
        pixels[offset + 3] = Math.round(alpha * 255);
    }
    const value = { key, pixels };
    cache.set(key, value);
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return value;
}

function frameFor(widget, state) {
    const s = state || {}, source = widget && widget.lensSource;
    if (!source) return { visible: false };
    const lens = lensAt(s.band, widget.lensSlot);
    if (!lens) return { visible: false };
    const art = pixelsFor(source.radius, lens.pitch, lens.kind, !!s.night, widget.lensVariant);
    if (!art) return { visible: false };
    const px = PX * source.sx, py = PY * source.sy;
    const pose = {
        x: source.x + (source.cx + source.radius * Math.sin(lens.angle)) * source.sx - px,
        y: source.y + (source.cy - source.radius * Math.cos(lens.angle)) * source.sy - py,
        w: WIDTH * source.sx, h: HEIGHT * source.sy, px, py,
        rotate: lens.angle * 180 / Math.PI,
    };
    const variant = s.bloom >= 1 ? 'strong' : 'normal';
    const visible = widget.lensVariant === variant && (lens.kind !== 'build' || lens.index < (s.build || 0));
    return { visible, pose, pixelsKey: art.key, pixels: art.pixels };
}

function arcPixelsFor(widget, night) {
    const w = widget && widget.w, h = widget && widget.h;
    const center = widget && widget.arcCenter, radii = widget && widget.arcRadii;
    const ink = widget && (night && widget.nightColor ? widget.nightColor : widget.color);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0 || w > 1920 || h > 720
        || !Array.isArray(center) || center.length !== 2 || !center.every(Number.isFinite)
        || !Array.isArray(radii) || radii.length !== 2 || !radii.every((v) => Number.isFinite(v) && v > 0)
        || !Number.isFinite(widget.arcHalfAngle) || !Number.isFinite(widget.arcThickness)
        || !Array.isArray(ink) || ink.length !== 4 || !ink.every(Number.isFinite)) throw new Error('invalid F8X lower arc');
    const key = JSON.stringify([w, h, center, radii, widget.arcHalfAngle, widget.arcThickness, ink]);
    if (arcCache.has(key)) { const value = arcCache.get(key); arcCache.delete(key); arcCache.set(key, value); return value; }
    const pixels = Buffer.alloc(w * h * 4), scale = Math.min(radii[0], radii[1]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const qx = (x + 0.5 - center[0]) / radii[0], qy = (y + 0.5 - center[1]) / radii[1];
        const rail = Math.abs(Math.hypot(qx, qy) - 1) * scale - widget.arcThickness / 2;
        const ends = (Math.abs(Math.atan2(qx, qy)) - widget.arcHalfAngle) * scale;
        const coverage = 1 - smooth(-0.65, 0.65, Math.max(rail, ends));
        const offset = (y * w + x) * 4;
        pixels[offset] = ink[0]; pixels[offset + 1] = ink[1]; pixels[offset + 2] = ink[2];
        pixels[offset + 3] = Math.round(clamp(ink[3] * coverage, 0, 255));
    }
    arcCache.set(key, pixels);
    while (arcCache.size > 8) arcCache.delete(arcCache.keys().next().value);
    return pixels;
}

module.exports = { widgetsFor, frameFor, lensAt, WIDTH, HEIGHT, MAX_LENSES, CACHE_LIMIT,
    arcPixelsFor, cacheSize: () => cache.size, arcCacheSize: () => arcCache.size };
