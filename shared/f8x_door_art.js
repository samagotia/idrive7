'use strict';
// SPDX-License-Identifier: MIT
// Original F8X-style warning artwork. One small cached image, changed only by
// closure state/layout/lighting. BMW's own warning/slot ownership stays authoritative.
const { pivotOf } = require('./f8x_gauge_geometry');
const CACHE_LIMIT = 16;
const cache = new Map();
const W = 72, H = 116, SS = 3;
const PANELS = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight', 'bonnet', 'boot', 'boot2'];
const OPEN = (value) => value === 'open';
function assetOf(id) { return require('./f8x_data').json('f82/' + id + '.json'); }

function normalized(state) {
    const input = state || {}, p = input.physical || input.panels || input;
    const layout = input.layout === 'two' || input.bodyStyle === 'coupe' ? 'two'
        : input.layout === 'four' || input.bodyStyle === 'sedan' ? 'four' : null;
    const panels = {};
    PANELS.forEach((key) => { panels[key] = OPEN(p[key]); });
    // A two-door profile has no rear side doors. Unknown body geometry is not
    // silently promoted to a coupe/sedan; a generic bonnet/boot view is allowed.
    if (layout !== 'four') panels.rearLeft = panels.rearRight = false;
    if (layout === null) panels.frontLeft = panels.frontRight = false;
    return { layout, panels, drawable: PANELS.some((key) => panels[key]) };
}
function keyFor(state, lighting, w = W, h = H) {
    const s = normalized(state);
    return [w, h, lighting === 'night' ? 'night' : 'day', s.layout || 'unknown',
        PANELS.map((key) => s.panels[key] ? '1' : '0').join('')].join(':');
}
function widgetsFor(layout, readAsset = assetOf) {
    const rpm = pivotOf(layout, 'rpm', readAsset), oil = pivotOf(layout, 'oil', readAsset);
    const face = layout && Array.isArray(layout.widgets) && layout.widgets.find((w) => w.id === 'rpm_face' && w.type === 'f82sprite');
    const texture = face && readAsset(face.asset);
    if (!rpm || !oil || oil.x <= rpm.x || !texture || ![face.w, face.h, texture.w, texture.h].every((n) => Number.isFinite(n) && n > 0)) return [];
    const sy = face.h / texture.h;
    const column = Math.round(rpm.x + (oil.x - rpm.x) * 0.62);
    const widget = { id: 'f8x_door_diagram', type: 'icon', doorRole: 'diagram', own: true,
        x: column - W / 2, y: Math.round(rpm.y + 233 * sy), w: W, h: H, z: 4 };
    if (widget.x < 0 || widget.y < 0 || widget.x + W > 1920 || widget.y + H > 720) return [];
    // Moved/scaled layouts must leave real room beyond both gauge rims. Reject
    // an overlapping diagram rather than painting over the tachometer/oil face.
    for (const id of ['rpm_face', 'oil_face']) {
        const dial = layout.widgets.find((w) => w.id === id && w.type === 'f82sprite');
        if (!dial) return [];
        const t = readAsset(dial.asset);
        if (!t || ![dial.x, dial.y, dial.w, dial.h].every(Number.isFinite)) return [];
        const cx = dial.x + dial.w / 2, cy = dial.y + dial.h / 2;
        const x = Math.max(widget.x, Math.min(widget.x + W, cx));
        const y = Math.max(widget.y, Math.min(widget.y + H, cy));
        if (Math.hypot(x - cx, y - cy) < Math.min(dial.w, dial.h) * 0.45 + 3) return [];
    }
    return [widget];
}

function inside(x, y, p) {
    let yes = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        if ((p[i][1] > y) !== (p[j][1] > y)
            && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) yes = !yes;
    }
    return yes;
}
function distance(x, y, p) {
    let best = Infinity;
    for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length], dx = b[0] - a[0], dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        best = Math.min(best, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
    }
    return best;
}
function render(w, h, state, lighting) {
    const s = normalized(state), out = Buffer.alloc(w * h * 4);
    if (!s.drawable) return out;
    const night = lighting === 'night', scaleX = w / W, scaleY = h / H;
    const sw = w * SS, sh = h * SS, hi = Buffer.alloc(sw * sh * 4);
    const silver = night ? [184, 189, 177] : [142, 150, 143];
    const edge = night ? [210, 215, 201] : [181, 189, 180];
    const dark = night ? [22, 28, 27] : [19, 26, 26];
    const amber = night ? [255, 184, 50] : [227, 152, 38];
    const red = night ? [255, 65, 54] : [224, 46, 39];
    function poly(points, fill, stroke, width) {
        const p = points.map((v) => [v[0] * scaleX, v[1] * scaleY]);
        const pad = (width || 0) / 2 + 1;
        const x0 = Math.max(0, Math.floor((Math.min.apply(null, p.map((v) => v[0])) - pad) * SS));
        const x1 = Math.min(sw, Math.ceil((Math.max.apply(null, p.map((v) => v[0])) + pad) * SS));
        const y0 = Math.max(0, Math.floor((Math.min.apply(null, p.map((v) => v[1])) - pad) * SS));
        const y1 = Math.min(sh, Math.ceil((Math.max.apply(null, p.map((v) => v[1])) + pad) * SS));
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const px = (x + 0.5) / SS, py = (y + 0.5) / SS;
            const line = stroke && distance(px, py, p) <= (width || 1) / 2;
            if (!line && (!fill || !inside(px, py, p))) continue;
            const c = line ? stroke : typeof fill === 'function' ? fill(px / scaleX, py / scaleY) : fill;
            const i = (y * sw + x) * 4;
            hi[i] = c[0]; hi[i + 1] = c[1]; hi[i + 2] = c[2]; hi[i + 3] = 255;
        }
    }
    function line(points, ink, width) {
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
            const nx = -dy / l * width / 2, ny = dx / l * width / 2;
            poly([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]], ink);
        }
    }
    const widen = (p) => [36 + (p[0] - 36) * 1.2, p[1]];
    function bodyPoly(points, fill, stroke, width) { poly(points.map(widen), fill, stroke, width); }
    function bodyLine(points, ink, width) { line(points.map(widen), ink, width); }
    // A compact, proportioned body; restrained longitudinal brightness gives
    // a silver shell without chrome bloom, grain, or a large panel reflection.
    const body = [[27, 15], [31, 13], [41, 13], [45, 15], [48, 22], [49, 36], [51, 45],
        [51, 84], [50, 99], [47, 105], [42, 108], [30, 108], [25, 105], [22, 99], [21, 84],
        [21, 45], [23, 36], [24, 22]];
    bodyPoly(body.map((p) => [p[0] + 0.7, p[1] + 0.9]), [4, 7, 7], null, 0);
    bodyPoly(body, (x, y) => {
        const sheen = 10 * Math.cos((x - 31) / 19 * Math.PI) + 4 * Math.cos((y - 38) / 75 * Math.PI);
        return silver.map((c) => Math.max(0, Math.min(255, Math.round(c + sheen))));
    }, edge, 0.8);
    // Front and rear screens are dark glass, and roof follows the same body
    // material. No literal photographic glass reflections are simulated.
    bodyPoly([[26, 39], [46, 39], [48, 51], [24, 51]], dark, [91, 103, 99], 0.6);
    bodyPoly([[25, 52], [47, 52], [47, 78], [44, 83], [28, 83], [25, 78]], (x) => silver.map((c) => c - 22 + Math.round((36 - x) * 0.35)), [104, 117, 110], 0.7);
    bodyPoly([[28, 85], [44, 85], [48, 95], [24, 95]], dark, [82, 95, 90], 0.6);
    bodyLine([[26, 21], [46, 21]], [silver[0] + 10, silver[1] + 10, silver[2] + 10], 0.8);
    bodyLine([[25, 102], [47, 102]], [105, 116, 109], 0.8);
    // Side glass and fitted closed-door seams are subtle, not bright warnings.
    bodyPoly([[23, 45], [25, 52], [25, 80], [23, 87]], dark);
    bodyPoly([[49, 45], [47, 52], [47, 80], [49, 87]], dark);
    if (s.layout === 'four') {
        bodyLine([[22, 65], [25, 65]], [80, 94, 86], 0.7);
        bodyLine([[47, 65], [50, 65]], [80, 94, 86], 0.7);
    }
    function door(left, rear) {
        const mirror = (points) => {
            const fitted = points.map((p) => p[0] > 15 ? widen(p) : p);
            return left ? fitted : fitted.map((p) => [W - p[0], p[1]]);
        };
        const two = s.layout === 'two';
        const hinge = rear ? 65 : 43, end = rear ? 86 : two ? 80 : 63;
        const tipY = hinge + (end - hinge) * 0.88;
        poly(mirror([[22, hinge], [24, hinge + 2], [24, end], [21, end - 2]]), [8, 13, 13]);
        // A visible dark inner face bounded by a continuous amber edge makes
        // the swung-open panel distinct from a painted stripe on the shell.
        const points = mirror([[22, hinge], [6, tipY - 2], [8, tipY + 7], [23, end]]);
        poly(points, (x, y) => [60 + (night ? 12 : 0), 48 + Math.round((end - y) * 0.25), 25], amber, 1.1);
        line(mirror([[21, hinge + 2], [8, tipY]]), night ? [255, 204, 106] : [244, 177, 75], 0.45);
    }
    if (s.panels.frontLeft) door(true, false);
    if (s.panels.frontRight) door(false, false);
    if (s.panels.rearLeft) door(true, true);
    if (s.panels.rearRight) door(false, true);
    if (s.panels.bonnet) {
        bodyPoly([[26, 18], [46, 18], [47, 36], [25, 36]], [106, 24, 22], red, 1.25);
        bodyLine([[27, 19], [45, 19]], night ? [255, 106, 88] : [245, 85, 64], 0.65);
    }
    if (s.panels.boot || s.panels.boot2) {
        // Secondary flap is represented as a shared rear warning area; the
        // wire does not establish an upper/lower physical mapping per model.
        bodyPoly([[25, 97], [47, 97], [46, 104], [41, 106], [31, 106], [26, 104]], [106, 24, 22], red, 1.25);
    }
    // Downsample premultiplied coverage, then return straight RGBA as required
    // by cluster-render. Clear pixels contain zero RGB, preventing dark fringes.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let a = 0, r = 0, g = 0, b = 0;
        for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
            const i = (((y * SS + dy) * sw) + x * SS + dx) * 4;
            a += hi[i + 3]; r += hi[i] * hi[i + 3]; g += hi[i + 1] * hi[i + 3]; b += hi[i + 2] * hi[i + 3];
        }
        const i = (y * w + x) * 4;
        if (a) { out[i] = Math.round(r / a); out[i + 1] = Math.round(g / a); out[i + 2] = Math.round(b / a); out[i + 3] = Math.round(a / (SS * SS)); }
    }
    return out;
}
function pixelsFor(widget, state, lighting) {
    const w = widget.w, h = widget.h;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 256 || h > 256) throw new Error('invalid door diagram size');
    const key = keyFor(state, lighting, w, h);
    if (cache.has(key)) { const value = cache.get(key); cache.delete(key); cache.set(key, value); return value; }
    const value = render(w, h, state, lighting);
    cache.set(key, value);
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return value;
}
module.exports = { widgetsFor, pixelsFor, keyFor, normalized, CACHE_LIMIT };
