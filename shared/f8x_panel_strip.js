'use strict';
// SPDX-License-Identifier: MIT
// Community workaround for native M-cluster rectangles, not a confirmed G82 fix:
// https://github.com/robertnisipeanu/idrive-apps/issues/199
// Keep every layer above the stock strip, including initially invisible layers.
const BOTTOM = 646;
const FOOTER = ['f82_footer_unit', 'f82_footer_rule', 'f82_odometer', 'f82_trip_distance',
    'f82_info_ambient', 'f82_info_clock'];

function prepare(widgets, readAsset) {
    return widgets.filter((w) => FOOTER.indexOf(w.id) < 0).map((original) => {
        let w = original;
        if (w.type === 'f8xpanel') w = Object.assign({}, w, { h: BOTTOM - w.y });
        else if (w.type === 'f82sprite' && w.id === 'backdrop') {
            const image = readAsset(w.asset);
            // Crop complete source rows; preserve the original texel-to-screen
            // ratio rather than squeezing the full background into a shorter quad.
            const rows = Math.min(image.h, Math.floor((BOTTOM - w.y) * image.h / w.h));
            if (rows < 1) throw new Error('F8X background has no room above BMW bottom strip');
            w = Object.assign({}, w, { sourceRows: rows, h: rows * w.h / image.h });
        } else if (w.doorRole === 'diagram' && w.y + w.h > BOTTOM) {
            // Only the lower car diagram becomes smaller. All dial geometry,
            // blades, shadows, glass and warning tracks remain untouched.
            const h = Math.floor(BOTTOM - w.y), width = Math.round(w.w * h / w.h);
            if (h < 1 || width < 1) throw new Error('F8X door diagram has no room above BMW bottom strip');
            w = Object.assign({}, w, { x: Math.round(w.x + (w.w - width) / 2), w: width, h });
        } else if (w.warningRole && w.y + w.h > BOTTOM) {
            w = Object.assign({}, w, { y: BOTTOM - w.h });
        }
        if (w.y < 0 || w.h <= 0 || w.y + w.h > BOTTOM) {
            // Never silently move/scale saved gauges to satisfy the workaround.
            throw new Error('F8X widget "' + w.id + '" reaches BMW bottom strip; use the bundled layout or turn the strip workaround off');
        }
        return w;
    });
}

module.exports = { BOTTOM, prepare };
