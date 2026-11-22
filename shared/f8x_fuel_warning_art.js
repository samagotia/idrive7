'use strict';
// SPDX-License-Identifier: MIT
// The warning column follows the tachometer and auxiliary oil-gauge placements.
const { pivotOf } = require('./f8x_gauge_geometry');
const { paintIcon } = require('./f8x_icons');
const textRaster = require('./f8x_text');
const LCD_DAY = [184, 187, 139, 255], LCD_NIGHT = [229, 231, 190, 255];
const cached = new Map();
function assetOf(id) { return require('./f8x_data').json('f82/' + id + '.json'); }

function widgetsFor(layout, readAsset = assetOf, bottom = 720) {
    const rpm = pivotOf(layout, 'rpm', readAsset), oil = pivotOf(layout, 'oil', readAsset);
    const face = layout && Array.isArray(layout.widgets) && layout.widgets.find((w) => w.id === 'rpm_face' && w.type === 'f82sprite');
    const texture = face && readAsset(face.asset);
    if (!rpm || !oil || oil.x <= rpm.x || !texture || ![face.w, face.h, texture.w, texture.h].every((n) => Number.isFinite(n) && n > 0)) return [];
    const sx = face.w / texture.w, sy = face.h / texture.h;
    // The message and pump belong to the information panel. BMW retains
    // responsibility for general attention and other status telltales.
    const column = Math.round(rpm.x + (oil.x - rpm.x) * 0.62);
    const common = { z: 4, own: true, color: LCD_DAY.slice(), nightColor: LCD_NIGHT.slice() };
    const widgets = [
        Object.assign({}, common, { id: 'f8x_fuel_reserve_text', warningRole: 'fuelReserveText', type: 'text',
            font: 'f82_info', text: 'Fuel reserve', align: 'left', x: Math.round(rpm.x - 156 * sx),
            y: Math.round(rpm.y + 284 * sy), w: 190, h: 30 }),
        Object.assign({}, common, { id: 'f8x_fuel_reserve_icon', warningRole: 'fuelReserveIcon', type: 'icon',
            icon: 'fuelReservePump', x: column - 25, y: Math.round(rpm.y + 277 * sy), w: 50, h: 58 }),
    ];
    if (widgets.some((w) => w.y + w.h > bottom) && bottom < 720) {
        // The enlarged tachometer's lower arc occupies the old warning row.
        // Put the shared message and a compact pump beyond that arc, below
        // the gap between the tachometer and oil face. Keep clear of the oil rim.
        const oilFace = layout.widgets.find((w) => w.id === 'oil_face' && w.type === 'f82sprite');
        let right = column + 100;
        if (oilFace) {
            const cx = oilFace.x + oilFace.w / 2, cy = oilFace.y + oilFace.h / 2;
            const r = Math.min(oilFace.w, oilFace.h) / 2;
            const nearest = Math.max(bottom - 36, Math.min(bottom, cy));
            if (Math.abs(nearest - cy) < r) {
                right = Math.min(right, Math.floor(cx - Math.sqrt(r * r - (nearest - cy) * (nearest - cy)) - 8));
            }
        }
        Object.assign(widgets[0], { x: right - 190, y: bottom - 30 });
        Object.assign(widgets[1], { x: right - 232, y: bottom - 36, w: 32, h: 36 });
    }
    // A custom saved layout must leave room for warning labels. Don't draw
    // clipped or misplaced fragments if the gauges have been moved off panel.
    return widgets.every((w) => w.x >= 0 && w.y >= 0 && w.x + w.w <= 1920 && w.y + w.h <= bottom) ? widgets : [];
}

function pixelsFor(widget, lighting) {
    const ink = lighting === 'night' ? widget.nightColor : widget.color;
    const key = [widget.warningRole, widget.w, widget.h, widget.font, widget.text, ink.join(',')].join('|');
    if (!cached.has(key)) cached.set(key, widget.warningRole === 'fuelReserveText'
        ? textRaster.drawText(widget.w, widget.h, widget.text, { font: widget.font, color: ink, align: 'left', spacing: 0 })
        : paintIcon(widget.icon, widget.w, widget.h, ink));
    return cached.get(key);
}

module.exports = { widgetsFor, pixelsFor, LCD_DAY, LCD_NIGHT };
