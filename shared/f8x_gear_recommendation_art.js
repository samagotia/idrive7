'use strict';
// SPDX-License-Identifier: MIT
// Cached vertical direction arrows beside the large sequential gear readout.
function widgetsFor(layout) {
    const gear = layout && Array.isArray(layout.widgets)
        && layout.widgets.find((w) => w.id === 'gear_selector' && w.text === '{{stage}}');
    if (!gear || ![gear.x, gear.y, gear.w, gear.h].every(Number.isFinite) || gear.w <= 0 || gear.h <= 0) return [];
    const h = Math.max(18, Math.min(32, Math.round(gear.h * 0.44))), w = Math.round(h * 0.72);
    const x = Math.round(gear.x + gear.w / 2 + gear.h * 0.66), y = Math.round(gear.y + (gear.h - h) / 2);
    if (x < 0 || y < 0 || x + w > 1920 || y + h > 720) return [];
    return ['up', 'down'].map((direction) => ({
        id: 'f8x_gear_recommendation_' + direction, type: 'icon', icon: direction === 'up' ? 'shiftUp' : 'shiftDown',
        gearRecommendation: direction, x, y, w, h, z: 4, own: true, color: [229, 231, 219, 255],
    }));
}
module.exports = { widgetsFor };
