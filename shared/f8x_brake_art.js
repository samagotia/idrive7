'use strict';
// SPDX-License-Identifier: MIT
// The factory brake warning occupies the speedometer-side warning column,
// left of the digital speed. Follow that position when the main dials move.
const BAND_Y = 410, BAND_HEIGHT = 42;
const COLOUR = [255, 36, 30, 255];
const RIM_CLEARANCE = 8;
// Retained 80px BRAKE texture has 63px of glyph ink, centred within 0.5px.
// Reserve 64px for both styles so toggling the wording never shifts the column.
const INK_HALF_WIDTH = 32;
const decodedFaces = new WeakMap();

function assetOf(id) { return require('./f8x_data').json('f82/' + id + '.json'); }

function pivotOf(layout, signal, readAsset = assetOf) {
    const needle = layout && Array.isArray(layout.widgets)
        && layout.widgets.find((widget) => widget.type === 'f82sprite' && widget.signal === signal && !widget.shadowOnly && !widget.glassOnly);
    if (!needle || !Array.isArray(needle.pivot) || needle.pivot.length !== 2) return null;
    const texture = readAsset(needle.asset);
    if (!texture || ![texture.w, texture.h].every((value) => Number.isFinite(value) && value > 0)
        || ![needle.x, needle.y, needle.w, needle.h, ...needle.pivot].every(Number.isFinite)) return null;
    return { x: needle.x + needle.pivot[0] * needle.w / texture.w,
        y: needle.y + needle.pivot[1] * needle.h / texture.h };
}

function rimEdge(layout, signal, side, readAsset) {
    const face = layout.widgets.find((widget) => widget.type === 'f82sprite'
        && widget.id === signal + '_face');
    if (!face || ![face.x, face.y, face.w, face.h].every(Number.isFinite) || face.w <= 0 || face.h <= 0) return null;
    const texture = readAsset(face.asset);
    if (!texture || !Number.isInteger(texture.w) || !Number.isInteger(texture.h)
        || texture.w < 1 || texture.h < 1 || typeof texture.rgba !== 'string') return null;
    let pixels = decodedFaces.get(texture);
    if (!pixels) {
        pixels = Buffer.from(texture.rgba, 'base64');
        if (pixels.length !== texture.w * texture.h * 4) return null;
        decodedFaces.set(texture, pixels);
    }
    const firstY = Math.max(0, Math.floor((BAND_Y - face.y) * texture.h / face.h));
    const lastY = Math.min(texture.h, Math.ceil((BAND_Y + BAND_HEIGHT - face.y) * texture.h / face.h));
    let edge = side === 'right' ? -Infinity : Infinity;
    for (let y = firstY; y < lastY; y++) {
        for (let x = side === 'right' ? texture.w - 1 : 0;
             x >= 0 && x < texture.w; x += side === 'right' ? -1 : 1) {
            // Strong face/rim coverage defines the boundary, rather than its faint cast shadow.
            if (pixels[(y * texture.w + x) * 4 + 3] < 224) continue;
            const boundary = face.x + (x + (side === 'right' ? 1 : 0)) * face.w / texture.w;
            edge = side === 'right' ? Math.max(edge, boundary) : Math.min(edge, boundary);
            break;
        }
    }
    return edge;
}

function widgetOf(layout, style, readAsset = assetOf) {
    const speed = pivotOf(layout, 'speed', readAsset), rpm = pivotOf(layout, 'rpm', readAsset);
    if (!speed || !rpm || rpm.x <= speed.x) return null;
    const speedEdge = rimEdge(layout, 'speed', 'right', readAsset);
    const rpmEdge = rimEdge(layout, 'rpm', 'left', readAsset);
    if (speedEdge === null || rpmEdge === null) return null;
    const minimum = Math.ceil(speedEdge + RIM_CLEARANCE + INK_HALF_WIDTH);
    const maximum = Math.floor(Math.min(rpmEdge - RIM_CLEARANCE - INK_HALF_WIDTH,
        (speed.x + rpm.x) / 2 - 12));
    if (minimum > maximum) return null; // A saved layout must leave a clear warning column.
    const preferred = Math.round(speed.x + (rpm.x - speed.x) * 0.455);
    const center = Math.max(minimum, Math.min(maximum, preferred));
    const text = style === 'text', width = text ? 80 : 42, height = text ? 30 : BAND_HEIGHT;
    const widget = { id: 'f8x_parking_brake', warning: 'parkingBrake',
        x: center - width / 2, y: BAND_Y + (BAND_HEIGHT - height) / 2,
        w: width, h: height, z: 4, own: true, color: COLOUR.slice() };
    return Object.assign(widget, text ? { type: 'text', font: 'r_label', text: 'BRAKE', align: 'center' }
        : { type: 'icon', icon: 'parkingBrake' });
}

module.exports = { widgetOf, pivotOf };
