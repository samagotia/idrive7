'use strict';
// SPDX-License-Identifier: MIT
// Cruise display only. Target input is canonical km/h from the explicit vehicle unit.
const { pivotOf } = require('./f8x_brake_art');
const { angle, turnIndicators } = require('./f82_sprite');
const { paintIcon } = require('./f8x_icons');
const GREEN = [55, 236, 80, 255], AMBER = [255, 166, 35, 255];
const MARKER_RADIUS = 203 * 1.15 + 11;
const cached = new Map();
function assetOf(id) { return require('./f8x_data').json('f82/' + id + '.json'); }

function widgetsFor(layout, readAsset = assetOf) {
    const speed = pivotOf(layout, 'speed', readAsset), rpm = pivotOf(layout, 'rpm', readAsset);
    if (!speed || !rpm) return [];
    const needle = layout.widgets.find((w) => w.signal === 'speed' && !w.shadowOnly && !w.glassOnly);
    const face = layout.widgets.find((w) => w.id === 'speed_face' && w.type === 'f82sprite');
    const texture = face && readAsset(face.asset);
    if (!needle || !Array.isArray(needle.curve) || needle.curve.length < 2 || !texture
        || ![texture.w, texture.h, face.w, face.h].every((n) => Number.isFinite(n) && n > 0)) return [];
    const common = { type: 'icon', z: 4, own: true, color: GREEN.slice() };
    const leftTurn = layout.widgets.find((w) => w.indicator === 'left') || turnIndicators[0];
    return [
        Object.assign({}, common, { id: 'f8x_cruise_symbol', icon: 'cruise', cruiseRole: 'symbol',
            x: Math.round(leftTurn.x + leftTurn.w + 10), y: Math.round(leftTurn.y + (leftTurn.h - 40) / 2), w: 40, h: 40 }),
        Object.assign({}, common, { id: 'f8x_cruise_marker', icon: 'cruiseMarker', cruiseRole: 'marker',
            x: 0, y: 0, w: 18, h: 22,
            cruiseGeometry: { cx: speed.x, cy: speed.y, rx: MARKER_RADIUS * face.w / texture.w,
                ry: MARKER_RADIUS * face.h / texture.h, curve: needle.curve } }),
    ];
}

function markerPose(widget, reading) {
    const g = widget.cruiseGeometry, value = reading && reading.setSpeedKmh;
    if (!g || !Number.isFinite(value) || value < g.curve[0][0] || value > g.curve[g.curve.length - 1][0]) return null;
    const degrees = angle(g.curve, value);
    if (!Number.isFinite(degrees)) return null;
    const a = degrees * Math.PI / 180;
    const round = (n) => Math.round(n * 100) / 100;
    return { visible: true, x: round(g.cx + Math.sin(a) * g.rx - widget.w / 2),
        y: round(g.cy - Math.cos(a) * g.ry - widget.h / 2), rotate: round(degrees + 180) };
}

function pixelsFor(widget, state) {
    const key = widget.icon + '|' + widget.w + '|' + widget.h + '|' + state;
    if (!cached.has(key)) cached.set(key, paintIcon(widget.icon, widget.w, widget.h, state === 'standby' ? AMBER : GREEN));
    return cached.get(key);
}

module.exports = { widgetsFor, markerPose, pixelsFor, MARKER_RADIUS, GREEN, AMBER };
