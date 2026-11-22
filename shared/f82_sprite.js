'use strict';

// Needle angles are clockwise from 12 o'clock. Each face uses the same
// breakpoints for its marks as the live needle uses for its rotation.
function angle(curve, value) {
    if (!Number.isFinite(value)) return null;
    if (value <= curve[0][0]) return curve[0][1];
    for (let i = 1; i < curve.length; i++) {
        const lower = curve[i - 1], upper = curve[i];
        if (value <= upper[0]) {
            return lower[1] + (upper[1] - lower[1]) * (value - lower[0]) / (upper[0] - lower[0]);
        }
    }
    return curve[curve.length - 1][1];
}

function rpmAngle(curve, rpm, driveReady) {
    if (!Number.isFinite(rpm) || rpm < 0) return null;
    const ready = angle(curve, 500); // READY is a position in the baked artwork.
    if (rpm === 0) return driveReady ? ready : angle(curve, 0);
    if (rpm >= 1000) return angle(curve, rpm);
    return ready + (angle(curve, 1000) - ready) * rpm / 1000;
}

function isSequential(data, mDriveProgram) {
    return !!(data && !data.demo && (mDriveProgram ? mDriveProgram === 'S' || mDriveProgram === 'M' : data.program === 'M'));
}

function gearReadout(data, mDriveProgram, showGearInD) {
    const { stage, gear } = data;
    if (stage === 'P' || stage === 'N' || stage === 'R') return { main: stage, small: '' };
    if (!stage && gear === -1) return { main: 'R', small: '' };
    const number = !data.gearGuessed && Number.isInteger(gear) && gear > 0 ? String(gear) : '';
    if (stage !== 'D' && !number) return { main: '-', small: '' };
    // MDrive S is sequential. S from a regular gearbox can be automatic Sport.
    const sequential = isSequential(data, mDriveProgram);
    return sequential ? { main: number || '-', small: '' }
        : { main: 'D', small: showGearInD ? number : '' };
}

function gearWidget(widget) {
    if (widget.id === 'gear_selector' && widget.text === '{{stage}}') {
        return Object.assign({}, widget, {
            type: 'text', align: 'center',
            x: widget.x - Math.floor(widget.w / 2), w: widget.w * 2,
        });
    }
    if (widget.id === 'gear_number' && widget.text === '{{gearInD}}') {
        return Object.assign({}, widget, { align: 'right', cells: 2, x: widget.x - widget.w, w: widget.w * 2 });
    }
    return widget;
}

const digitalSpeedWidgets = [
    { id: 'f82_speed_value', type: 'atext', font: 'f82_speed', align: 'right', cells: 3,
        x: 885, y: 511, w: 102, h: 47, z: 3, text: '{{f82Speed}}',
        color: [151, 157, 131, 255], nightColor: [229, 231, 219, 255] },
    { id: 'f82_speed_unit', type: 'text', font: 'r_label',
        x: 998, y: 534, w: 54, h: 30, z: 3, text: '{{f82SpeedUnit}}',
        color: [88, 99, 90, 255], nightColor: [158, 166, 149, 255] },
];

function infoWidget(id, token, x, y, w, align = 'center') {
    return { id, type: 'text', font: 'f82_info', align, x, y, w, h: 30, z: 3, text: '{{' + token + '}}',
        color: [151, 157, 131, 255], nightColor: [213, 218, 196, 255] };
}

const infoAmbient = infoWidget('f82_info_ambient', 'f82InfoAmbient', 874, 511, 186);
const infoClock = infoWidget('f82_info_clock', 'f82InfoClock', 874, 552, 186);
const footerUnit = Object.assign(infoWidget('f82_footer_unit', 'f82FooterUnit', 845, 628, 31, 'left'), {
    font: 'r_label', color: [124, 132, 112, 255], nightColor: [184, 194, 175, 255],
});
const infoWidgets = [
    infoWidget('f82_info', 'f82Info', 842, 594, 250),
    footerUnit,
    infoWidget('f82_footer_rule', 'f82FooterRule', 876, 628, 206, 'left'),
    infoWidget('f82_odometer', 'f82Odometer', 845, 658, 126, 'left'),
    infoWidget('f82_trip_distance', 'f82TripDistance', 974, 658, 108, 'right'),
];

function infoPage(page, digitalSpeed) {
    return !digitalSpeed && (page === 'outsideTemperature' || page === 'time') ? 'off' : page;
}

function infoPageOptions(options, digitalSpeed) {
    return options.filter(([page]) => infoPage(page, digitalSpeed) === page);
}

function validate(widget) {
    if (!/^[a-z0-9-]+$/.test(widget.asset)) throw new Error('invalid baked F82 asset name');
    if (widget.nightAsset !== undefined && (typeof widget.nightAsset !== 'string' || !/^[a-z0-9-]+$/.test(widget.nightAsset))) {
        throw new Error('invalid baked F82 night asset name');
    }
    const shadow = widget.shadow;
    if (shadow !== undefined && (!widget.signal || !shadow || typeof shadow.asset !== 'string'
        || !/^[a-z0-9-]+$/.test(shadow.asset) || !Number.isFinite(shadow.offsetY) || shadow.offsetY < 0 || shadow.offsetY > 0.1
        || (shadow.dayAsset !== undefined && (typeof shadow.dayAsset !== 'string' || !/^[a-z0-9-]+$/.test(shadow.dayAsset)))
        || (shadow.offsetX !== undefined && (!Number.isFinite(shadow.offsetX) || Math.abs(shadow.offsetX) > 0.3)))) {
        throw new Error('invalid F82 needle shadow');
    }
    const glass = widget.glass;
    if (glass !== undefined && (!widget.signal || !glass || ![-1, 1].includes(glass.outward)
        || ![glass.asset, glass.nightAsset].every((id) => typeof id === 'string' && /^[a-z0-9-]+$/.test(id)))) {
        throw new Error('invalid F82 needle glass');
    }
    const track = widget.shiftTrack;
    if (track !== undefined && (!Array.isArray(track) || track.length !== 6 || !track.every(Number.isFinite)
        || track[0] <= 0 || track[1] <= 0 || track[4] <= 0 || track[5] <= 0 || track[5] >= 180 || widget.signal)) {
        throw new Error('invalid F82 tachometer warning track');
    }
    if (widget.signal === undefined) return;
    if (['speed', 'rpm', 'fuel', 'oil'].indexOf(widget.signal) < 0) throw new Error('unknown F82 signal');
    const curve = widget.curve;
    if (!Array.isArray(curve) || curve.length < 2 || !curve.every((p, i) =>
        Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && (i === 0 || p[0] > curve[i - 1][0]))) {
        throw new Error('F82 needle curve needs ascending [reading, angle] pairs');
    }
    if (!Array.isArray(widget.pivot) || widget.pivot.length !== 2 || !widget.pivot.every(Number.isFinite)) {
        throw new Error('F82 needle needs an [x, y] pivot');
    }
}

function lightOf(value) {
    const raw = value && typeof value === 'object' ? value.dayNightChangeOver : value;
    if (raw === 'TAG' || raw === 1) return 'day';
    if (raw === 'NACHT' || raw === 2) return 'night';
    return null;
}

function backlightAsset(asset, colour) {
    // Only dial printing has colour variants. Never tint metal, needles,
    // warning lamps, shift lights, shadows or the information display.
    return colour === 'amber' && /^(speed|rpm|fuel|oil)-face(?:-(mph|diesel|50-150))?(?:-fahrenheit)?(?:-night)?$/.test(asset)
        ? asset + '-amber' : asset;
}

// The car supplies the reading and preferred units, not verified gauge limits.
// A scale choice must replace the printing and Celsius needle calibration together.
function oilScaleWidgets(widgets, scale, fahrenheit, readAsset) {
    if (!widgets.some((w) => w.type === 'f82sprite' && w.asset === 'oil-face')) return widgets;
    const base = scale === '70-170' ? 'oil-face' : 'oil-face-50-150';
    const asset = base + (fahrenheit ? '-fahrenheit' : '');
    const curve = readAsset(asset).oilCurve || [[70, -54], [170, 54]];
    return widgets.map((w) => {
        if (w.type !== 'f82sprite') return w;
        if (w.asset === 'oil-face') return Object.assign({}, w, { asset, nightAsset: asset + '-night' });
        if (w.signal === 'oil') return Object.assign({}, w, { curve });
        return w;
    });
}

function lowerArcOf(layout, readAsset) {
    const widgets = layout && layout.widgets;
    if (!Array.isArray(widgets)) return null;
    const face = widgets.find((w) => w.type === 'f82sprite' && w.id === 'rpm_face');
    const needle = widgets.find((w) => w.type === 'f82sprite' && w.signal === 'rpm' && !w.shadowOnly && !w.glassOnly);
    if (!face || !needle || !Array.isArray(needle.pivot) || needle.pivot.length !== 2) return null;
    const texture = readAsset(face.asset), shaft = readAsset(needle.asset);
    if (!texture || !shaft || ![texture.w, texture.h, shaft.w, shaft.h, face.w, face.h, needle.w, needle.h].every((v) => Number.isFinite(v) && v > 0)
        || ![face.x, face.y, needle.x, needle.y, ...needle.pivot].every(Number.isFinite)) return null;
    const cx = needle.x + needle.pivot[0] * needle.w / shaft.w;
    const cy = needle.y + needle.pivot[1] * needle.h / shaft.h;
    const sx = face.w / texture.w, sy = face.h / texture.h;
    const rx = 258.5 * sx, ry = 258.5 * sy, thickness = 8 * Math.min(sx, sy);
    const halfAngle = 40 * Math.PI / 180, padding = thickness / 2 + 2;
    const x = Math.floor(cx - rx * Math.sin(halfAngle) - padding);
    const y = Math.floor(cy + ry * Math.cos(halfAngle) - padding);
    const w = Math.ceil(cx + rx * Math.sin(halfAngle) + padding) - x;
    const h = Math.ceil(cy + ry + padding) - y;
    if (x < 0 || y < 0 || x + w > 1920 || y + h > 720) return null;
    return { id: 'f8x_rpm_lower_arc', type: 'f8xarc', own: true, x, y, w, h, z: 1,
        arcCenter: [cx - x, cy - y], arcRadii: [rx, ry], arcHalfAngle: halfAngle, arcThickness: thickness,
        color: [126, 132, 128, 255], nightColor: [165, 173, 164, 255] };
}

function shadowOf(needle) {
    const [dx, dy] = shadowOffset(needle);
    return Object.assign({}, needle, {
        id: needle.id + ' (shadow)',
        asset: needle.shadow.asset,
        nightAsset: undefined,
        shadowOnly: true,
        needleId: needle.id,
        x: needle.x + dx,
        y: needle.y + dy,
        z: (needle.z || 0) - 1,
    });
}

function shadowOffset(needle) {
    return [Math.round(needle.w * (needle.shadow.offsetX || 0)), Math.round(needle.h * needle.shadow.offsetY)];
}

function shadowOpacity(degrees, dx, dy) {
    // Project the fixed screen-space offset across the rotating blade.
    const radians = degrees * Math.PI / 180;
    const length = Math.hypot(dx, dy);
    return length ? Math.min(1, Math.abs(dx * Math.cos(radians) + dy * Math.sin(radians)) / length) : 0;
}

function glassOf(needle) {
    return Object.assign({}, needle, {
        id: needle.id + ' (glass)',
        asset: needle.glass.asset,
        nightAsset: needle.glass.nightAsset,
        glassOnly: true,
        needleId: needle.id,
        z: (needle.z || 0) - 1,
    });
}

function glassPose(degrees, outward) {
    // Map the full arc from the inward stop to the outward stop.
    const t = Math.min(1, Math.max(0, (outward * degrees + 54) / 108));
    const opacity = Math.min(1, (t + 0.3 * t * (1 - t)) * 1.25);
    return { sx: (0.9 + 0.1 * t) * 1.10, opacity };
}

const SHIFT_TRACK_START_RPM = 4000;
const SHIFT_OIL_WARM_C = 80;

function previewShiftLimit(nominal, oil) {
    if (!Number.isFinite(oil) || oil >= SHIFT_OIL_WARM_C) return nominal;
    // Display simulation using the same temperature range as the existing cold shift cue.
    const cold = Math.min(4500, nominal), warmup = Math.max(0, (oil - 30) / (SHIFT_OIL_WARM_C - 30));
    return Math.round((cold + (nominal - cold) * warmup) / 50) * 50;
}

function shiftBand(curve, limit, end) {
    const [max, last] = curve[curve.length - 1];
    const [prevRpm, prevAngle] = curve[curve.length - 2];
    // The warning channel runs a little past the last printed RPM mark.
    const map = (rpm) => Math.min(end, rpm <= max ? angle(curve, rpm) : last + (rpm - max) * (last - prevAngle) / (max - prevRpm));
    const start = map(SHIFT_TRACK_START_RPM), red = Math.max(start, map(limit));
    const amber = Math.min(red, map(Math.max(SHIFT_TRACK_START_RPM, limit - 500)));
    const pitch = Math.max(1, angle(curve, max) - angle(curve, max - 500));
    const counts = [Math.ceil((amber - start) / pitch), Math.max(1, Math.ceil((end - red) / (pitch * 1.3)))];
    return { edges: [start, amber, red, end].map((degrees) => degrees * Math.PI / 180), counts };
}

function shiftBuildCount(curve, band, rpm, shiftPoint) {
    const [start, amber] = band.edges;
    const end = Math.min(amber, angle(curve, shiftPoint) * Math.PI / 180);
    if (end <= start || !Number.isFinite(rpm) || rpm < SHIFT_TRACK_START_RPM) return 0;
    const progress = (angle(curve, rpm) * Math.PI / 180 - start) / (end - start);
    return 1 + Math.floor((band.counts[0] - 1) * Math.max(0, Math.min(1, progress)));
}

function shiftTrackOf(face, needle) {
    return {
        id: face.id + ' (warning track)', type: 'f82shift', x: face.x, y: face.y, w: face.w, h: face.h,
        z: face.z || 0, class: face.class, conn: face.conn, shiftTrack: face.shiftTrack, curve: needle.curve,
    };
}

const f82Sprite = { angle, rpmAngle, isSequential, gearReadout, gearWidget, digitalSpeedWidgets, infoAmbient, infoClock, infoWidgets, validate, lightOf, backlightAsset, oilScaleWidgets, lowerArcOf, shadowOf, shadowOffset, shadowOpacity, glassOf, glassPose,
    infoPage, infoPageOptions, previewShiftLimit, shiftBand, shiftBuildCount, shiftTrackOf, SHIFT_TRACK_START_RPM, SHIFT_OIL_WARM_C };
if (typeof module !== 'undefined') module.exports = f82Sprite;
