'use strict';
// SPDX-License-Identifier: MIT
// Adapted from Cluster Themes, Copyright (c) 2026 bimmer-lab. See LICENSE and NOTICE.
function turnArrow(x, y) {
    const fromCenter = Math.abs(y - 0.5);
    const tail = 0.03;
    const tip = 0.97;
    const shoulder = 0.50;
    const halfHeadHeight = 0.45;
    const slope = (tip - shoulder) / halfHeadHeight;
    const shaft = Math.max(tail - x, x - (shoulder + 0.05), fromCenter - 0.24);
    const head = Math.max(shoulder - x, (x + slope * fromCenter - tip) / Math.hypot(1, slope));
    return Math.min(shaft, head);
}

function segmentDistance(x, y, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

function cruiseMarker(x, y) {
    // A slim inward-pointing index when the runtime adds 180 degrees.
    const triangle = Math.max(0.10 - y, y - 0.82, Math.abs(x - 0.5) - (y - 0.10) * 0.36);
    return triangle;
}

function rectangle(x, y, left, top, right, bottom) {
    return Math.max(left - x, x - right, top - y, y - bottom);
}

function fuelReservePump(x, y) {
    // Filled pump housing with an open display window and a separate hose.
    const body = rectangle(x, y, 0.14, 0.10, 0.61, 0.91);
    const window = rectangle(x, y, 0.215, 0.19, 0.535, 0.40);
    const housing = Math.max(body, -window);
    const foot = rectangle(x, y, 0.08, 0.88, 0.66, 0.95);
    const pipe = Math.min(
        segmentDistance(x, y, 0.60, 0.45, 0.70, 0.52),
        segmentDistance(x, y, 0.70, 0.52, 0.70, 0.81),
        segmentDistance(x, y, 0.70, 0.81, 0.81, 0.84),
        segmentDistance(x, y, 0.81, 0.84, 0.86, 0.77),
        segmentDistance(x, y, 0.86, 0.77, 0.86, 0.36),
        segmentDistance(x, y, 0.86, 0.36, 0.74, 0.22)) - 0.024;
    const nozzle = segmentDistance(x, y, 0.75, 0.23, 0.86, 0.36) - 0.041;
    return Math.min(housing, foot, pipe, nozzle);
}

const ICONS = { cruiseMarker,
    shiftUp: (x, y) => turnArrow(1 - y, x), shiftDown: (x, y) => turnArrow(y, x),
    fuelReservePump };

function paintIcon(name, w, h, color) {
    const f = ICONS[name], out = Buffer.alloc(w * h * 4, 0);
    if (!f) return out;
    const s = Math.min(w, h), ox = (w - s) / 2, oy = (h - s) / 2, aa = 1 / s;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const d = f((x + 0.5 - ox) / s, (y + 0.5 - oy) / s);
            const a = Math.max(0, Math.min(1, 0.5 - d / aa));
            if (a <= 0) continue;
            const o = (y * w + x) * 4;
            out[o] = color[0]; out[o + 1] = color[1]; out[o + 2] = color[2]; out[o + 3] = Math.round(a * (color[3] === undefined ? 255 : color[3]));
        }
    }
    return out;
}

module.exports = { paintIcon };
