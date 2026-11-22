'use strict';
// SPDX-License-Identifier: MIT
// Shared dial geometry for the retained cruise, fuel and closure presentations.
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


module.exports = { pivotOf };
