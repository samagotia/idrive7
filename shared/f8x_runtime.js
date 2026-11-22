/*
 * F8X runtime derived from bimmer-lab Cluster Themes.
 * Copyright (c) 2026 bimmer-lab. MIT licence retained in LICENSE and NOTICE.
 * Renderer client and shader adaptations retain Robert Nisipeanu's MPL-2.0 credits.
 */
'use strict';

const fs = require('fs');
const { ClusterRender, DEFAULT_PATH } = require('./cluster_render_client');
const Layouts = require('./f8x_layouts');
const textRaster = require('./f8x_text');
const { paintIcon } = require('./f8x_icons');
const shaders = require('./f8x_shaders');
const panelBacking = require('./f8x_panel_backing');
const Car = require('./f8x_vehicle');
const { InfoData } = require('./f8x_info_data');
const { CarFormats } = require('./f8x_car_formats');
const infoFormat = require('./f8x_info_format');
const bakedData = require('./f8x_data');
const f82Sprite = require('./f82_sprite');
const { RpmLimit } = require('./f8x_rpm_limit');
const { Cruise } = require('./f8x_cruise');
const { GearRecommendation } = require('./f8x_gear_recommendation');
const gearRecommendationArt = require('./f8x_gear_recommendation_art');
const cruiseArt = require('./f8x_cruise_art');
const { NeedleMotion, framePlan } = require('./f8x_motion');
const { evaluateFuelWarning } = require('./f8x_fuel_warning');
const fuelWarningArt = require('./f8x_fuel_warning_art');
const { Doors } = require('./f8x_doors');
const engineProfile = require('./f8x_engine_profile');
const doorArt = require('./f8x_door_art');
const { present: presentWarning } = require('./f8x_warning');

const IMAGE_TYPES = { text: true, icon: true, f82sprite: true };
const STATUS_ASK_MS = 2000;
const MAX_CONN = 4;
const PIXEL_BYTES = 16 * 1024 * 1024;
const SHEET_AREA_FRAC = 4;
const TICK_MS = 50;
// Pose commands move resident GPU layers; no native animation-system replacement.
const F82_AUX_POSE_MS = 50;
const PARKED_TEST_SIGNAL_MAX_AGE_MS = 1500;
const TEXT_MS = 200;
const F82_STARTUP_SECONDS = 15;
const F82_PEDAL_FRESH_MS = 1000;
const F82_SHIFT_HALF_PERIOD_MS = 1000 / 6;
const F82_AUX_NIGHT_SHADOW_OPACITY = 0.24;
const F82_AUX_NIGHT_SHADOW_OFFSET = 0.60;
const F82_AUX_DAY_SHADOW_OFFSET = 1.60;
const F82_MAIN_DAY_SHADOW_OFFSET = 1.25;
const F82_DAY_SHADOW_OPACITY = 0.90;
const TEST_FROM = 1500, TEST_CLIMB_MS = 2500, TEST_HOLD_MS = 1200;
const TZ_AUTO = -9999;
const FUEL_OBD = { obd: '2F', bytes: 1, at: 0, factor: 100 / 255, offset: 0, min: 0, max: 100, timeoutMs: 1000 };
const FUEL_EVERY_MS = 10000, FUEL_RETRY_MS = 300000, FUEL_STALE_MS = 60000;
const motionClockMs = () => process.uptime() * 1000;
const PROGRAMS = { D_PROGRAMM: 'D', S_MINUS_PROGRAMM: 'S', M_MINUS_PROGRAMM: 'M', 0: 'D', 1: 'S', 2: 'M' };
const THEME = { name: 'F8X', fg: [243, 246, 250, 255], glow: 0 };
const color = (theme, value) => Array.isArray(value) ? value : theme[value] || theme.fg;
const rgba = (c) => [c[0] / 255, c[1] / 255, c[2] / 255, (c[3] === undefined ? 255 : c[3]) / 255];
const isNum = (value) => typeof value === 'number' && isFinite(value);
const pad2 = (value) => value < 10 ? '0' + value : String(value);
const mib = (bytes) => (bytes / 1048576).toFixed(1) + ' MiB';

function changes(was, now, w, h) {
    const row = w * 4;
    const sameRow = (y) => now.compare(was, y * row, (y + 1) * row, y * row, (y + 1) * row) === 0;
    const samePx = (o) => now[o] === was[o] && now[o + 1] === was[o + 1] && now[o + 2] === was[o + 2] && now[o + 3] === was[o + 3];
    let top = 0;
    while (top < h && sameRow(top)) top++;
    if (top === h) return null;
    let bottom = h - 1;
    while (sameRow(bottom)) bottom--;
    let left = w, right = -1;
    for (let y = top; y <= bottom; y++) {
        if (sameRow(y)) continue;
        const o = y * row;
        for (let x = 0; x < left; x++) if (!samePx(o + x * 4)) { left = x; break; }
        for (let x = w - 1; x > right; x--) if (!samePx(o + x * 4)) { right = x; break; }
    }
    const rect = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
    const px = Buffer.allocUnsafe(rect.w * rect.h * 4);
    for (let y = 0; y < rect.h; y++) now.copy(px, y * rect.w * 4, (top + y) * row + left * 4, (top + y) * row + (right + 1) * 4);
    return { rect, px };
}

class F8xRuntime {
    constructor(ctx) {
        this.ctx = ctx;
        this.log = ctx.log;
        this.config = (ctx.spec && ctx.spec.config) || {};
        this.socketPath = process.env.HUD_CLUSTER_SOCKET || this.config.socketPath || DEFAULT_PATH;
        this.clients = [];
        this.started = false;
        this.stopped = false;
        this.layerStates = new Map();
        this.target = 'panel';
        this.size = [1920, 720];
        this.label = this.config.statusName || 'Cluster';
        this.parkedTest = this.config.parkedTest === true && process.env.M4_PREVIEW_ONLY !== '1';
        this.parkedTestNotice = null;
        if (this.parkedTest) {
            for (const [key, value] of [['hudLayout', 'off'], ['demo', 'off']]) {
                if (ctx.settings.get(key) !== value) ctx.settings.set(key, value);
            }
        }
        this.client = this._clientAt(0);
        this.layouts = new Layouts(ctx.dataDir, this.log, this.size);
        this.widgets = new Map();
        this.sheets = [];
        this.atlases = new Map();
        this.activeName = null;
        this.f82Readouts = false;
        this.f82Needles = [];
        this.f82Timer = null;
        this.f82SentAt = 0;
        this.f82NextFrameAt = null;
        this.f82Motion = new Map();
        this.f82Light = 'day';
        this.f82Pedal = null;
        this.f82PedalAt = 0;
        this.f82StartupUntil = null;
        this.f82WasDriveReady = false;
        this.previewF82Engine = 'petrol';
        this.f82LightTimer = null;
        this.f82PendingLight = null;
        this.fuelObd = null;
        this.fuelObdAt = 0;
        this.needsFuel = false;
        this.program = null;
        this.fuelWarningSample = null;
        this.kombiAvailable = false;
        this.pixelBytes = 0;
        this.targetState = null;
        this.problem = null;
        this.statusListeners = [];
        this.lastStatus = null;
        this.testAt = null;
        this.theme = THEME;
        this.infoData = new InfoData();
        this.carFormats = new CarFormats(ctx);
        this.gearRecommendation = new GearRecommendation(ctx);
        this._formatSignature = null;
        this._setupVehicleData();
        this.rpmLimit = new RpmLimit(ctx);
        this.cruise = new Cruise(ctx);
        this.doors = new Doors(ctx);
        this.layouts.onChange(() => this._rebuild());
        ctx.settings.onChange((key) => {
            if (this.parkedTest && key === 'demo' && ctx.settings.get(key) !== 'off') {
                ctx.settings.set(key, 'off');
                return;
            }
            if (key === 'f8xBacklightColour') {
                // Replace existing face textures in place; motion and layer
                // ownership remain intact, with no extra resident images.
                this.widgets.forEach((x) => {
                    if (x.w.type === 'f82sprite' && f82Sprite.backlightAsset(x.w.asset, 'amber') !== x.w.asset) {
                        this._guard('F8X backlight ' + x.w.id, () => this._paintF82(x, this._f82Asset(x.w.asset)));
                    }
                });
                this._status();
            } else if (['f8xLimitSource', 'f82Redline', 'f82InfoPage', 'f82ShowGearInD', 'f82DateFormat', 'f82Footer', 'f8xVehicleLayout', 'f8xSteeringSide'].indexOf(key) >= 0) {
                this.widgets.forEach((widget) => { widget.last = null; });
                this._status();
            } else if (key !== 'demo') this._rebuild();
            else this._status();
        });
    }

    setting(key) {
        const schema = this.ctx.settings.item(key);
        const saved = this.ctx.settings.get(key);
        if (!schema) return saved;
        const valid = schema.type === 'bool' ? typeof saved === 'boolean'
            : schema.type === 'choice' ? (schema.options || []).some((option) => option[0] === saved)
                : schema.type === 'number' ? isNum(saved) && (!schema.steps || schema.steps.indexOf(saved) >= 0) : true;
        const value = valid ? saved : schema.default;
        return key === 'f82InfoPage' ? f82Sprite.infoPage(value, this.setting('f82DigitalSpeed')) : value;
    }

    _setupVehicleData() {
        if (!this.infoData) this.infoData = new InfoData();
        const extra = {
            'de.bmw.powertrain.AcceleratorPedal': {
                AngleAcceleratorPedal: (v) => {
                    // Live Data's candidate scaling: 0.025 percentage points per count.
                    const raw = v && v.actualValueAngleAcceleratorPedal;
                    this.f82Pedal = isNum(raw) && raw >= 0 && raw <= 4080 ? Math.min(100, raw * 0.025) : null;
                    this.f82PedalAt = Date.now();
                },
            },
            // fuel and range (cauliflowermossgrape's live_data, MIT): litres (255 = none) and km (4095 = none)
            'de.bmw.infotainment.KombiIF': {
                $pollMs: 10000,
                $onAvailability: (available) => {
                    this.kombiAvailable = available;
                    this.infoData.availability('kombi', available);
                    if (!available) this.fuelWarningSample = null;
                },
                statusRangeTankStatus: (v) => {
                    this.infoData.range(v);
                    this.fuelWarningSample = this.kombiAvailable ? { reserve: v && v.statusFluidLevelFuelTankSpare,
                        rangeKm: this.infoData.value('rangeKm'), at: motionClockMs() } : null;
                },
                statusBordcomputerAverage: (v) => this.infoData.average(v),
            },
            'de.bmw.infotainment.vehicle.Vehicle': {
                statusDayNightChangeOver: (value) => this._onF82Light(value),
            },
            // S / M next to the gear: the gearbox status carries no programme on some cars, the M drive display does
            'de.bmw.infotainment.misc.MDrive': {
                $onAvailability: (available) => {
                    if (!available) this.program = null;
                    this.gearRecommendation.setProgramAvailability(available);
                },
                dataDisplayGearbox: (v) => {
                    const raw = v && v.displayProgramGearbox;
                    this.program = PROGRAMS[raw] || (typeof raw === 'string' && /^D(?:_|$)/.test(raw) ? 'D' : null);
                    this.gearRecommendation.setProgram(v);
                },
            },
            // The G82 catalog exposes a notifier only; no getter or polling.
            'de.bmw.infrastructure.EnvironmentalInformation': {
                $onAvailability: (available) => this.infoData.availability('ambient', available),
                ExteriorTemperature: (v) => this.infoData.ambient(v),
            },
        };
        this.car = new Car(this.ctx, ['rpm', 'speed', 'temps', 'gear', 'condition'], extra, this.parkedTest);
        this.car.setRedline(this.setting('f82Redline'));
        this.car.onSample(() => this._queueF82());
    }

    fuelWarningState() {
        const sample = this.fuelWarningSample;
        return evaluateFuelWarning({ reserve: sample && sample.reserve, rangeKm: sample && sample.rangeKm,
            ageMs: sample ? motionClockMs() - sample.at : null, available: this.kombiAvailable });
    }

    warningPresentation() {
        const doors = this.doors ? this.doors.value({ layout: this.setting('f8xVehicleLayout'),
            steering: this.setting('f8xSteeringSide') }) : null;
        return presentWarning(doors, this.fuelWarningState());
    }

    doorStatusText() {
        if (!this.doors) return 'Door status unavailable';
        const value = this.doors.value({ layout: this.setting('f8xVehicleLayout'), steering: this.setting('f8xSteeringSide') });
        return (value.model || 'Unknown model') + ' · '
            + (value.layout === 'two' ? '2 doors' : value.layout === 'four' ? '4 doors' : 'Body unknown') + ' · '
            + (value.steering === 'lhd' ? 'Left-hand drive' : value.steering === 'rhd' ? 'Right-hand drive' : 'Steering side unknown')
            + (value.source ? ' · door status received' : ' · awaiting door status');
    }

    _warningPixels(w, presentation) {
        const p = presentation || this.warningPresentation();
        if (w.doorRole) return doorArt.pixelsFor(w, p.doorState, this.f82Light);
        const original = fuelWarningArt.pixelsFor;
        if (w.warningRole !== 'fuelReserveText') return original(w, this.f82Light);
        const ink = p.critical ? (this.f82Light === 'night' ? [255, 49, 49, 255] : [246, 42, 36, 255])
            : p.kind === 'closure' ? (this.f82Light === 'night' ? [229, 231, 219, 255] : [199, 205, 202, 255])
                : this.f82Light === 'night' ? w.nightColor : w.color;
        // No arbitrary full-texture cache: diff only when message or lighting changes.
        return textRaster.drawText(w.w, w.h, p.text, { font: w.font, color: ink, align: w.align, spacing: 0 });
    }

    _updateWarning(x, force) {
        const p = this.warningPresentation(), w = x.w;
        const visible = w.doorRole ? p.diagram : w.warningRole === 'fuelReserveIcon' ? p.pump
            : w.warningRole === 'fuelReserveText' && p.kind !== null;
        const key = w.doorRole ? doorArt.keyFor(p.doorState, this.f82Light, w.w, w.h)
            : w.warningRole === 'fuelReserveText' ? p.text + '|' + p.critical + '|' + p.kind + '|' + this.f82Light : this.f82Light;
        if (visible && (force || x.warningPaint !== key)) {
            this._blitDiff(x, this._warningPixels(w, p));
            x.warningPaint = key;
        }
        if (force || x.last !== visible) {
            x.last = visible;
            x.c.set(x.ref, { visible, opacity: 1 });
        }
    }

    _clientAt(i) {
        while (this.clients.length <= i) {
            const ci = this.clients.length;
            const c = new ClusterRender(ci ? this.ctx.spec.id + '_' + (ci + 1) : this.ctx.spec.id, this.socketPath);
            this.clients.push(c);
            this._wireClientEvents(c, ci);
            if (this.started) { this.log.info('connection ' + (ci + 1) + ' to cluster-render'); c.connect(); }
        }
        return this.clients[i];
    }

    _wireClientEvents(c, ci) {
        const tag = ci ? ' [connection ' + (ci + 1) + ']' : '';
        c.on('ready', () => { this.log.info('cluster-render ready' + tag + ' (backend=' + c.backend + ')'); if (ci === 0) { this._rebuild(); } else this._status(); });
        c.on('disconnected', () => {
            this.log.warn('cluster-render disconnected' + tag + ', client will retry');
            if (this.parkedTest && this.activeName && this.activeName !== 'off') this._parkedTestFallback('renderer disconnected');
            else this._status();
        });
        c.on('layer', (ref, state, reason) => {
            const key = ci + ':' + ref;
            const old = this.layerStates.get(key);
            this.layerStates.set(key, { state, reason });
            if (state === 'error' || ((state === 'waiting' || state === 'stalled') && (!old || old.state !== state))) {
                const w = this._widgetOf(ci, ref);
                this.log.warn('layer ' + ref + tag + (w ? ' (' + w + ')' : '') + ' ' + state + (reason ? ': ' + reason : ''));
            }
            this._statusSoon();
        });
        c.on('target', (name, state, holder, reason) => {
            if (name !== this.target) return;
            this.targetState = { state, holder, reason };
            this.log.info('target ' + name + tag + ' ' + state + (holder ? ' (holder ' + holder + ')' : '') + (reason ? ': ' + reason : ''));
            this._statusSoon();
        });
        c.on('refused', (op, ref, reason) => {
            const w = this._widgetOf(ci, ref);
            this.log.warn('refused ' + op + ' on ' + ref + tag + (w ? ' (' + w + ')' : '') + ': ' + reason);
            if (!this.refused) this.refused = (w || op) + ': ' + reason;   // the first one, until the next rebuild
            this._statusSoon();
        });
        c.on('drained', () => { if (ci === 0 && !this.stopped) this._queueF82(); });
        c.on('budget', (capKb, maxKb, reason) => this.log.info('budget' + tag + ' ' + capKb + '/' + maxKb + ' kb/s (' + reason + ')'));
        c.on('status', (text) => this.log.info('cluster-render status: ' + text));
    }

    start() {
        this.started = true;
        this.log.info('connecting to cluster-render at ' + this.socketPath);
        this.clients.forEach((client) => client.connect());
        this.tickTimer = setInterval(() => this._guard('tick', () => this._tick()), TICK_MS);
        this.statusTimer = setInterval(() => this._guard('status', () => this._status()), 5000);
        this._status();
        this._startFuelReader();
    }

    _startFuelReader() {
        let reader, busy = false, lastAsk = 0, misses = 0;
        try {
            const { Diag } = require('./kit/diag');
            const { DidReader } = require('./kit/dids');
            const link = new Diag(this.ctx.signals, this.log);
            link.quiet = true;
            Promise.resolve().then(() => link.init()).catch((error) => this.log.info('fuel diagnostic link unavailable: ' + error.message));
            reader = new DidReader(link, { ecu: 18 });
        } catch (error) {
            this.log.info('fuel diagnostic reader unavailable: ' + error.message);
            return;
        }
        this.fuelTimer = setInterval(() => {
            const now = Date.now();
            if (busy || !this.needsFuel || this.car.data().demo || now - lastAsk < (misses >= 3 ? FUEL_RETRY_MS : FUEL_EVERY_MS)) return;
            busy = true;
            lastAsk = now;
            reader.read(FUEL_OBD).then((value) => {
                if (isNum(value)) {
                    this.fuelObd = value;
                    this.fuelObdAt = Date.now();
                    misses = 0;
                } else misses++;
            }).catch((error) => {
                misses++;
                this.log.info('fuel diagnostic read unavailable: ' + error.message);
            }).then(() => { busy = false; });
        }, 400);
    }

    stop() {
        this.stopped = true;
        this.started = false;
        clearInterval(this.tickTimer);
        clearInterval(this.statusTimer);
        clearInterval(this.fuelTimer);
        clearTimeout(this.statusAskT);
        clearTimeout(this._statusT);
        clearTimeout(this.f82Timer);
        clearTimeout(this.f82LightTimer);
        this.f82Timer = null;
        this.f82LightTimer = null;
        this.f82PendingLight = null;
        this.f82Needles = [];
        this.f82Motion.clear();
        this.f82NextFrameAt = null;
        if (this.layouts.close) this.layouts.close();
        this.car.stop();
        if (this.carFormats) this.carFormats.stop();
        this.rpmLimit.stop();
        this.cruise.stop();
        if (this.gearRecommendation) this.gearRecommendation.stop();
        if (this.doors) this.doors.stop();
        this.clients.forEach((client) => client.close());
        this.atlases.clear();
    }

    _atlas(fontName, ci) {
        const key = ci + ':' + fontName;
        if (this.atlases.has(key)) return this.atlases.get(key);
        const font = textRaster.loadFont(fontName), glyphs = font.metrics.glyphs;
        const chars = Object.keys(glyphs).filter((ch) => ch.length === 1 && ch >= ' ' && ch <= '~').sort().slice(0, 64);
        if (!chars.length) throw new Error('font "' + fontName + '" has no printable glyphs for an atlas');
        const cellW = Math.max(1, Math.ceil(Math.max.apply(null, chars.map((ch) => glyphs[ch].advance)))) + 2;
        const cellH = font.metrics.cellHeight;
        const cols = Math.max(1, Math.min(16, Math.floor(2048 / cellW))), rows = Math.ceil(chars.length / cols);
        const w = cols * cellW, h = rows * cellH;
        const buf = Buffer.alloc(w * h, 0);
        chars.forEach((ch, i) => {
            const cell = textRaster.mask(cellW, cellH, ch, { font: fontName, align: 'center' });
            const cx = (i % cols) * cellW, cy = Math.floor(i / cols) * cellH;
            for (let y = 0; y < cellH; y++) cell.copy(buf, (cy + y) * w + cx, y * cellW, (y + 1) * cellW);
        });
        const c = this._clientAt(ci);
        const ref = c.asset({ target: this.target, format: 'r8', w, h, sampling: 'bilinear' });
        if (!ref) throw new Error('font "' + fontName + '": atlas asset refused (' + w + 'x' + h + ')');
        c.pixels(ref, null, buf);
        const a = { ref, c, ci, cols, rows, cellW, cellH, chars, bytes: w * h * 2 };
        this.atlases.set(key, a);
        this.log.info('glyph atlas "' + fontName + '"' + (ci ? ' on connection ' + (ci + 1) : '') + ': ' + chars.length + ' glyphs in ' +
            cellW + 'x' + cellH + ' cells, ' + w + 'x' + h + ' R8 asset, ' + mib(a.bytes) + ' of pixel memory');
        return a;
    }

    _atlasBytes() {
        let n = 0;
        this.atlases.forEach((a) => { n += a.bytes; });
        return n;
    }

    _atlasCodes(x, s) {
        const a = x.atlas, n = x.cells, text = String(s).slice(0, n);
        const pad = n - text.length, w = x.w;
        const lead = w.align === 'right' ? pad : w.align === 'center' ? Math.floor(pad / 2) : 0;
        const codes = [];
        for (let i = 0; i < 32; i++) {
            const j = i - lead;
            const ch = j >= 0 && j < text.length ? text[j] : null;
            const k = ch === null ? -1 : a.chars.indexOf(ch);
            codes.push(i < n && ch !== null ? (k < 0 ? a.chars.indexOf(' ') : k) : -1);
        }
        return codes;
    }

    _guard(what, fn) {
        try { fn(); } catch (e) { this.log.error('F8X ' + what + ': ' + (e && e.stack || e)); }
    }

    onStatus(fn) { this.statusListeners.push(fn); if (this.lastStatus) fn(this.lastStatus); }

    _layoutName() { return this.setting('hudLayout'); }

    _layoutLabel(name) {
        const lay = this.ctx.settings.item('hudLayout');
        const o = lay && (lay.options || []).find((x) => x[0] === name);
        return o ? o[1] : name;
    }

    _widgetOf(ci, ref) {
        let id = null, n = 0;
        this.widgets.forEach((x) => { if (x.ci === ci && x.ref === ref) { if (!id) id = x.w.id; n++; } });
        return n > 1 ? id + ' +' + (n - 1) : id;
    }

    _layerRefs() {
        const refs = [], seen = {};
        this.widgets.forEach((x) => {
            const key = x.ci + ':' + x.ref;
            if (!seen[key]) { seen[key] = true; refs.push({ c: x.c, ci: x.ci, ref: x.ref, key }); }
        });
        return refs;
    }

    _connOf(w) {
        const n = isNum(w.conn) ? Math.floor(w.conn) : 0;
        return Math.max(0, Math.min(MAX_CONN - 1, n));
    }

    _connCounts(plan) {
        const counts = [];
        plan.forEach((e) => { counts[e.conn] = (counts[e.conn] || 0) + 1; });
        for (let i = 0; i < counts.length; i++) counts[i] = counts[i] || 0;
        return counts;
    }

    _layerCount(n) { return n === 1 ? '1 layer' : n + ' layers'; }

    _statusSoon() {
        if (this._statusT) return;
        this._statusT = setTimeout(() => { this._statusT = null; this._guard('status', () => this._status()); }, 500);
    }

    _drawnNote() {
        const ts = this.targetState;
        if (ts && (ts.state === 'waiting' || ts.state === 'parked') && ts.holder) {
            return ts.holder === 'foreign' ? ', waiting: another app has this display' : ', waiting: BMW is using this display';
        }
        const refused = this.refused ? ', refused ' + this.refused : '';
        const refs = this._layerRefs();
        if (!refs.length) return refused;
        let shown = 0, why = null, whyN = 0;
        refs.forEach((r) => {
            const st = this.layerStates.get(r.key);
            if (st && st.state === 'shown') shown++;
            else if (st) { whyN++; if (!why) why = st.state + (st.reason ? ': ' + st.reason : ''); }
        });
        if (shown === refs.length || (!why && !shown)) return refused;
        return ', ' + shown + ' of ' + this._layerCount(refs.length) + ' drawn' + (why ? ' (' + whyN + ' ' + why + ')' : '') + refused;
    }

    statusText() {
        if (!this.client.ready) {
            return fs.existsSync(this.socketPath) ? this.label + ': connecting to cluster-render'
                : this.label + ' off: cluster-render is not installed or not running';
        }
        if (this.problem) return this.label + ': ' + this.problem;
        if (this.activeName === 'off') {
            return this.label + ' off' + (this.parkedTestNotice ? ': ' + this.parkedTestNotice + '.' : ':') + " BMW's own cluster shows";
        }
        return this.label + ' on: ' + this._layoutLabel(this.activeName) + ', ' + this._layerCount(this._layerRefs().length)
            + (this.pixelBytes ? ', ' + mib(this.pixelBytes) + ' of 16 MiB pixels' : '')
            + (this.car.data().demo ? ', demo data' : '') + this._drawnNote();
    }

    _status() {
        const text = this.statusText();
        if (text === this.lastStatus) return;
        this.lastStatus = text;
        this.statusListeners.forEach((listener) => {
            try { listener(text); } catch (error) { this.log.warn('status listener: ' + error.message); }
        });
    }

    testShift() {
        if (this.parkedTest) return false;
        const d = this.car.data(), sp = d.speed;
        if (isNum(sp) && sp > 3 && !d.demo) return false;
        if (!isNum(this._f82ShiftLimit(d.oil))) return false;
        this.testAt = Date.now();
        this.log.info('shift-light test');
        return true;
    }

    shiftTesting() { return this.testAt !== null; }

    _testRpm(now) {
        if (this.testAt === null) return null;
        const t = now - this.testAt;
        if (t > TEST_CLIMB_MS + TEST_HOLD_MS || t < 0) { this.testAt = null; return null; }
        const limit = this._f82ShiftLimit(this.car.data().oil);
        if (!isNum(limit)) { this.testAt = null; return null; }
        const top = (limit - this.setting('shiftBefore')) + 200;
        return TEST_FROM + (top - TEST_FROM) * Math.min(1, t / TEST_CLIMB_MS);
    }

    _f82ShiftLimit(oil) {
        if (process.env.M4_PREVIEW_ONLY === '1' && this.car.data().demo) {
            const nominal = this.previewF82Engine === 'diesel' ? 5000 : this.setting('f82Redline');
            return this.setting('coldGuard') ? f82Sprite.previewShiftLimit(nominal, oil) : nominal;
        }
        if (this.setting('f8xLimitSource') === 'manual') return this.setting('f82Redline');
        return this._liveRpmCheck().rpm;
    }

    _engineMetadata() {
        return this.doors && typeof this.doors.value === 'function' ? this.doors.value() : null;
    }

    _oilScaleInfo() {
        return engineProfile.resolveOilScale(this.setting('f8xOilScale'), this._engineMetadata(), '50-150');
    }

    oilScaleStatus() {
        const state = this._oilScaleInfo(), us = this._effectiveFormat('units') === 'us';
        const marks = state.scale === '50-150' ? us ? '122–302 °F' : '50–150 °C' : us ? '160–340 °F' : '70–170 °C';
        return state.source === 'manual' ? marks : state.automatic ? 'Auto ' + state.model + ': ' + marks : 'Fallback: ' + marks;
    }

    _liveRpmCheck() {
        return engineProfile.checkLiveRpm(this.rpmLimit ? this.rpmLimit.value() : null, this._engineMetadata());
    }

    rpmLimitStatus() {
        const preview = process.env.M4_PREVIEW_ONLY === '1';
        const limit = this._f82ShiftLimit(this.car.data().oil);
        const suffix = isNum(limit) ? Math.round(limit) + ' rpm' : 'unavailable, shift lights hidden';
        if (preview && this.car.data().demo) return 'SIM ONLY max RPM: ' + suffix;
        if (this.setting('f8xLimitSource') === 'manual') return 'Manual max RPM: ' + suffix;
        const checked = this._liveRpmCheck();
        if (checked.reason === 'incompatible-profile') return 'BMW RPM rejected: ' + checked.candidateRpm
            + ' exceeds ' + checked.profile.model + ' stock ' + checked.profile.nominalRpm + '; shift lights hidden';
        if (checked.reason === 'model-unavailable') return 'Auto RPM unavailable: vehicle profile unknown; shift lights hidden';
        return (preview ? 'SIM signal max RPM: ' : 'BMW RPM candidate (unverified): ') + suffix;
    }

    rpmLimitDetails() {
        const state = this.rpmLimit && this.rpmLimit.status ? this.rpmLimit.status() : {};
        const raw = isNum(state.raw) ? state.raw : 'unknown';
        const age = isNum(state.ageMs) ? ', ' + (state.ageMs / 1000).toFixed(1) + 's old' : '';
        const checked = this._liveRpmCheck();
        return (state.source || 'VehicleInformation.DataPowerTrain2CRC') + ', raw ' + raw
            + ', ' + (state.reason || 'waiting') + age
            + (checked.reason === 'incompatible-profile' ? ', incompatible with ' + checked.profile.model + ' stock profile'
                : checked.reason === 'model-unavailable' ? ', vehicle profile unavailable' : '');
    }

    _f82PedalPercent(data, now) {
        if (data.demo) return isNum(data.throttle) ? data.throttle * 100 : null;
        const age = now - this.f82PedalAt;
        return age >= 0 && age < F82_PEDAL_FRESH_MS ? this.f82Pedal : null;
    }

    _raw(name) {
        const demo = this.car.data().demo;
        if (name === 'fuel') {
            if (isNum(this.fuelObd) && Date.now() - this.fuelObdAt < FUEL_STALE_MS) return this.fuelObd / 100;
            const litres = this.infoData.value('fuelL');
            return isNum(litres) ? Math.min(1, litres / this._tankLitres()) : demo ? 0.62 : null;
        }
        if (name === 'range' || name === 'ambient') {
            const value = this.infoData.value(name === 'range' ? 'rangeKm' : 'ambientC');
            return isNum(value) ? value : demo ? (name === 'range' ? 368 : 24) : null;
        }
        const data = this.car.data();
        return Object.prototype.hasOwnProperty.call(data, name) ? data[name] : null;
    }

    _token(tok) {
        const us = this._effectiveFormat('units') === 'us';
        const fix = (value, decimals) => isNum(value) ? value.toFixed(decimals) : '--';
        switch (tok) {
            case 'f82Speed': {
                const v = this._raw('speed');
                return fix(isNum(v) && this._effectiveFormat('f82DistanceUnits') === 'us' ? v / 1.609344 : v, 0);
            }
            case 'f82SpeedUnit': return this._effectiveFormat('f82DistanceUnits') === 'us' ? 'mph' : 'km/h';
            case 'f82InfoAmbient': return this._f82Ambient();
            case 'f82InfoClock':
                return !this.setting('f82DigitalSpeed') || this._infoPage() === 'fuelConsumption' ? this._f82Clock() : '';
            case 'f82Info': {
                const page = this._infoPage();
                if (page === 'date') {
                    const date = this._now();
                    if (!date || !isNum(date.getFullYear())) return '\uE000 --';
                    const year = String(date.getFullYear());
                    const parts = { DD: pad2(date.getDate()), MM: pad2(date.getMonth() + 1), YYYY: year, YY: year.slice(-2) };
                    return '\uE000 ' + this._effectiveFormat('f82DateFormat').replace(/YYYY|YY|MM|DD/g, (part) => parts[part]);
                }
                if (page === 'outsideTemperature') return this._f82Ambient();
                if (page === 'time') return this._f82Clock();
                if (page === 'averageSpeed') {
                    const kmh = this.infoData.value('averageSpeedKmh');
                    return 'Ø ' + fix(isNum(kmh) && this._effectiveFormat('f82DistanceUnits') === 'us' ? kmh / 1.609344 : kmh, 1) + ' ' + this._token('f82SpeedUnit');
                }
                if (page === 'fuelConsumption') return '\uE001 ' + infoFormat.consumption(this.infoData.value('averageConsumption'), this.setting('consumptionUnits') === 'auto' ? this.carFormats.value().consumption : this.setting('consumptionUnits'));
                if (page === 'rangeRemaining') {
                    const km = this._raw('range'), miles = this._effectiveFormat('f82DistanceUnits') === 'us';
                    const value = isNum(km) ? fix(miles ? km / 1.609344 : km, 0) + (miles ? ' mi' : ' km') : '--';
                    return '\uE003\uE001 ' + value;
                }
                return '';
            }
            case 'f82FooterUnit': {
                if (!this._f82FooterVisible()) return '';
                return this._effectiveFormat('f82DistanceUnits') === 'us' ? 'mi' : 'km';
            }
            case 'f82FooterRule': return this._f82FooterVisible() ? '\uE002'.repeat(11) : '';
            case 'f82Odometer': case 'f82TripDistance': {
                if (!this._f82FooterVisible()) return '';
                const odo = tok === 'f82Odometer';
                // wayPassed is a journey-computer value, not a verified factory trip counter.
                // Only the explicitly labelled Mac fixture may populate the trip slot for now.
                const km = odo ? this.infoData.value('odometerKm') : process.env.M4_PREVIEW_ONLY === '1' ? this.previewTripKm : null;
                return infoFormat.distance(km, this._effectiveFormat('f82DistanceUnits'), odo);
            }
            case 'stage': return f82Sprite.gearReadout(this.car.data(), this.program, this.setting('f82ShowGearInD')).main;
            case 'gearInD': return f82Sprite.gearReadout(this.car.data(), this.program, this.setting('f82ShowGearInD')).small;
            case 'ambient': {
                const value = this._raw('ambient');
                if (!isNum(value)) return '--';
                return infoFormat.temperature(value, us);
            }
            case 'u:temp': return us ? '°F' : '°C';
            case 'ampmLc': return this._token('ampm').toLowerCase();
            case 'time': case 'ampm': {
                const now = this._now();
                if (!now) return tok === 'ampm' ? '' : '--';
                const hours = now.getHours(), minutes = now.getMinutes();
                if (tok === 'ampm') return this._effectiveFormat('clock') === '12h' ? (hours < 12 ? 'AM' : 'PM') : '';
                if (this._effectiveFormat('clock') === '24h') return pad2(hours) + ':' + pad2(minutes);
                return ((hours % 12) || 12) + ':' + pad2(minutes);
            }
            default: return '{{' + tok + '}}';
        }
    }

    _f82Ambient() {
        const value = this._token('ambient');
        return value === '--' ? value : value + ' ' + this._token('u:temp');
    }

    _f82Clock() {
        const period = this._token('ampmLc');
        return this._token('time') + (period ? ' ' + period : '');
    }

    _f82FooterVisible() {
        const mode = this.setting('f82Footer');
        return mode === 'show' || (mode === 'startup' && this.f82StartupUntil !== null && process.uptime() < this.f82StartupUntil);
    }

    _updateF82Startup(condition) {
        // Drive-ready persists through automatic engine stop/start. Use the vehicle state, not rpm.
        if (condition === 10) {
            if (!this.f82WasDriveReady) this.f82StartupUntil = process.uptime() + F82_STARTUP_SECONDS;
            this.f82WasDriveReady = true;
        } else if ([1, 2, 3, 5, 7, 12].indexOf(condition) >= 0) {
            this.f82WasDriveReady = false;
            this.f82StartupUntil = null;
        } else if (condition === undefined && this.f82Readouts && this.f82StartupUntil === null) {
            // When no vehicle state is available, start the window when the F8x layout first renders.
            this.f82StartupUntil = process.uptime() + F82_STARTUP_SECONDS;
        }
    }

    _tankLitres() {
        const s = this.ctx.settings.item('tankLitres') ? this.setting('tankLitres') : null;
        return isNum(s) && s > 0 ? s : (this.config.tankLitres || 65);
    }

    _effectiveFormat(key) {
        const selected = this.setting(key);
        if (selected !== 'auto') return selected;
        const fields = { units: ['temperature', 'metric'], f82DistanceUnits: ['distance', 'metric'],
            clock: ['clock', '24h'], f82DateFormat: ['dateFormat', 'DD.MM.YY'] };
        const field = fields[key];
        return field ? this.carFormats.value()[field[0]] || field[1] : selected;
    }

    _infoPage() {
        // BMW's range warning temporarily takes priority; retain the user's chosen page.
        return this.fuelWarningState().active === true ? 'rangeRemaining' : this.setting('f82InfoPage');
    }

    infoStatus() {
        const formats = this.carFormats.value();
        const missing = [['units', 'temperature'], ['f82DistanceUnits', 'distance'], ['clock', 'clock'], ['f82DateFormat', 'dateFormat']]
            .some((pair) => this.setting(pair[0]) === 'auto' && !formats[pair[1]]);
        return (missing ? 'Car format unavailable: metric / 24h / D.M.Y fallback where needed. ' : '')
            + (this.setting('clockSource') !== 'system' && !formats.time ? 'Car clock unavailable. ' : '')
            + (this.setting('f82DateFormat') === 'auto' && this.setting('f82InfoPage') === 'date' ? 'Auto date: car order, F8X two-digit year. ' : '')
            + (process.env.M4_PREVIEW_ONLY === '1' ? 'Mac trip is a fixture. BC button / factory trip: unverified.' : 'BC button and factory trip counter: unverified; trip shows --.');
    }

    _now() {
        if (this.setting('clockSource') !== 'system') {
            const value = this.carFormats.value(), time = value.time, date = value.components;
            if (!time) return null;
            return { getHours: () => time.hour, getMinutes: () => time.minute,
                getDate: () => date ? date.day : NaN, getMonth: () => date ? date.month - 1 : NaN,
                getFullYear: () => date ? date.year : NaN };
        }
        const tz = this.ctx.settings.item('timeZone') ? this.setting('timeZone') : TZ_AUTO;
        const off = isNum(tz) && tz !== TZ_AUTO ? tz : this.config.utcOffsetMinutes;
        if (!isNum(off)) return new Date();
        const d = new Date(Date.now() + off * 60000);
        return {
            getHours: () => d.getUTCHours(), getMinutes: () => d.getUTCMinutes(),
            getDate: () => d.getUTCDate(), getMonth: () => d.getUTCMonth(), getFullYear: () => d.getUTCFullYear(),
        };
    }

    _resolve(template) { return String(template).replace(/\{\{([a-zA-Z0-9:]+)\}\}/g, (_, t) => this._token(t)); }

    setPreviewF82Engine(engine) {
        if (process.env.M4_PREVIEW_ONLY !== '1' || this.previewF82Engine === engine) return;
        this.previewF82Engine = engine;
        if (this.f82Readouts) this._rebuild();
    }

    _rebuild() {
        this._guard('rebuild', () => {
            const name = this._layoutName();
            if (this.parkedTest && name !== 'off') {
                const problem = this._parkedTestSignalProblem();
                if (problem) { this._parkedTestFallback(problem); return; }
                this.parkedTestNotice = null;
            }
            this._rebuildInner(name);
        });
        this._status();
    }

    _parkedTestSignalProblem() {
        const missing = this.car.missingCriticalSignal(PARKED_TEST_SIGNAL_MAX_AGE_MS);
        if (missing === null) return null;
        return 'no fresh ' + (missing === 'rpm' ? 'RPM' : 'speed') + ' data';
    }

    _parkedTestFallback(reason) {
        this.parkedTestNotice = reason;
        this.log.warn('parked test: ' + reason + '; returning to BMW cluster');
        // The setting change drops the layers, including cached layers on a disconnected client.
        // It also requires the driver to select a theme again after the fault clears.
        this.ctx.settings.set('hudLayout', 'off');
    }

    _rebuildInner(name) {
        if (!this.client.ready && name !== 'off') return; // the 'ready' handler calls us again
        this._layerRefs().forEach((r) => r.c.drop(r.ref));
        this.widgets.clear();
        clearTimeout(this.f82Timer); this.f82Timer = null;
        this.f82Needles = [];
        this.f82SentAt = 0;
        this.f82Motion.clear();
        this.f82NextFrameAt = null;
        this.sheets = [];
        this.pixelBytes = 0;
        this.layerStates.clear();
        this.refused = null;
        clearTimeout(this.statusAskT); this.statusAskT = null;
        this.car.setRedline(this.setting('f82Redline'));
        this.activeName = name;
        this.f82Readouts = false;
        this.needsFuel = false;
        if (name === 'off') {
            this.problem = null;
            return;
        }
        let layout;
        try { layout = this.layouts.load(name); } catch (error) {
            this.problem = error.message;
            this.log.warn('layout "' + name + '" unusable (' + error.message + '); showing nothing');
            return;
        }
        this.problem = null;
        // BMW retains these telltales. Saved app widgets cannot reintroduce duplicates.
        let shown = layout.widgets.filter((w) => !w.indicator && w.icon !== 'turnLeft' && w.icon !== 'turnRight'
            && w.id !== 'f82_turn_left' && w.id !== 'f82_turn_right' && w.warning !== 'parkingBrake' && w.icon !== 'parkingBrake'
            && w.id !== 'f8x_parking_brake' && w.text !== 'BRAKE'
            && w.id !== 'f8x_cruise_symbol' && w.cruiseRole !== 'symbol' && w.icon !== 'cruise'
            && w.id !== 'f8x_attention_triangle' && w.warningRole !== 'attentionTriangle' && w.icon !== 'attentionTriangle'
            && !(w.toggle && !this._toggleOn(w.toggle)));
        if (this.previewF82Engine === 'diesel' && shown.some((w) => w.type === 'f82sprite' && w.shiftTrack)) {
            const diesel = this._f82Asset('rpm-face-diesel');
            shown = shown.map((w) => {
                if (w.type !== 'f82sprite') return w;
                if (w.shiftTrack) return Object.assign({}, w, { asset: 'rpm-face-diesel', nightAsset: 'rpm-face-diesel-night' });
                if (w.signal === 'rpm') return Object.assign({}, w, { curve: diesel.rpmCurve });
                return w;
            });
        }
        this.f82Readouts = shown.some((w) => w.type === 'f82sprite' && w.asset === 'speed-face');
        if (this.f82Readouts) {
            // Image layers begin transparent and their governed upload may wait
            // behind faces. This no-upload floor keeps stock gauges covered in
            // that interval; BMW's native telltales retain their own priority.
            shown.unshift(panelBacking.widget());
            this._updateF82Startup(this.car.data().condition);
            const mph = this._effectiveFormat('f82DistanceUnits') === 'us' ? this._f82Asset('speed-face-mph') : null;
            shown = shown.map((w) => {
                if (w.type !== 'f82sprite') return f82Sprite.gearWidget(w);
                if (mph && w.asset === 'speed-face') return Object.assign({}, w, { asset: 'speed-face-mph', nightAsset: 'speed-face-mph-night' });
                if (mph && w.signal === 'speed') return Object.assign({}, w, { curve: mph.speedCurve });
                return w;
            });
            shown = f82Sprite.oilScaleWidgets(shown, this._oilScaleInfo().scale,
                this._effectiveFormat('units') === 'us', (id) => this._f82Asset(id));
            if (this.setting('f82DigitalSpeed')) {
                shown = shown.concat(f82Sprite.digitalSpeedWidgets, Object.assign({}, f82Sprite.infoClock, { y: 562 }));
            } else shown.push(f82Sprite.infoAmbient, f82Sprite.infoClock);
            const cruise = cruiseArt.widgetsFor({ widgets: shown });
            const lowerArc = f82Sprite.lowerArcOf({ widgets: shown }, (id) => this._f82Asset(id));
            shown = shown.concat(f82Sprite.infoWidgets, cruise,
                gearRecommendationArt.widgetsFor({ widgets: shown }),
                lowerArc ? [lowerArc] : [], fuelWarningArt.widgetsFor({ widgets: shown }), doorArt.widgetsFor({ widgets: shown }));
        }
        // At the z level below the blades, stack the glass over the cast shadows.
        const sprites = shown.filter((w) => w.type === 'f82sprite');
        const tach = sprites.find((w) => w.signal === 'rpm');
        const track = tach && sprites.find((w) => w.shiftTrack);
        const layers = shown.concat(track ? [f82Sprite.shiftTrackOf(track, tach)] : [],
            sprites.filter((w) => w.shadow).map(f82Sprite.shadowOf),
            sprites.filter((w) => w.glass).map(f82Sprite.glassOf));
        this.needsFuel = shown.some((widget) => widget.signal === 'fuel');
        // plan the layers first (a sheet's size is only known once every member is placed), then make them
        // in that order: within a class and z, cluster-render puts the newer layer on top. Small sheets
        // first; a bigger limit only when the layer budget needs it (see the header).
        const area = this.size[0] * this.size[1];
        const layerBudget = 64;
        const over = (p) => this._connCounts(p).some((k) => k > layerBudget);
        // A widget joins a sheet only while its bounding box stays within
        // that many times its members' own area, so far-apart readouts don't share one mostly empty sheet (pixel
        // memory); relaxed along with the size limit when the layer budget needs it. Without it: the size limit only.
        let waste = isNum(layout.packWaste) ? layout.packWaste : Infinity;
        let maxPx = Math.floor(area / SHEET_AREA_FRAC), plan = this._plan(layers, maxPx, waste);
        while (over(plan) && (maxPx !== Infinity || waste !== Infinity)) {
            maxPx = maxPx * 2 >= area ? Infinity : maxPx * 2;
            waste = waste * 2 > 64 ? Infinity : waste * 2;
            plan = this._plan(layers, maxPx, waste);
        }
        let effects = 0, own = 0, sheets = 0, bytes = 0, px = 0;
        plan.forEach((e) => {
            if (e.kind === 'sheet') { sheets++; bytes += e.w * e.h * 4; px += e.w * e.h * 8; this._guard('sheet ' + e.members[0].id, () => this._createSheet(e)); }
            else {
                if (IMAGE_TYPES[e.w.type]) {
                    const sprite = e.w.type === 'f82sprite' ? this._f82Asset(e.w.asset) : null;
                    const payload = (sprite ? sprite.w * sprite.h : e.w.w * e.w.h) * 4;
                    own++; bytes += payload; px += payload * 2;
                } else effects++;
                this._guard('widget ' + e.w.id, () => this._create(e.w, null));
            }
        });
        const atlasBytes = this._atlasBytes();
        px += atlasBytes;
        this.pixelBytes = px;
        const n = this._layerRefs().length, counts = this._connCounts(plan);
        this.log.info('layout "' + layout.name + '": ' + shown.length + ' widgets, ' + this._layerCount(n) + ' (' + effects + ' effects, ' +
            sheets + ' image sheets' + (own ? ', ' + own + ' own image layers' : '') + ')' +
            (counts.length > 1 ? ' on ' + counts.length + ' connections (' + counts.join(' + ') + ')' : '') + ', sheet limit ' +
            (maxPx === Infinity ? 'unlimited' : maxPx + ' px') + ', initial image writes ' + bytes + ' bytes, pixel memory ' + mib(px) + ' of 16 MiB' +
            (atlasBytes ? ' (' + this.atlases.size + ' glyph atlas' + (this.atlases.size > 1 ? 'es' : '') + ' ' + mib(atlasBytes) + ')' : ''));
        counts.forEach((k, ci) => {
            if (k > layerBudget) this.log.warn('layout "' + layout.name + '" needs ' + k + ' layers on connection ' + (ci + 1) + ', layer budget ' + layerBudget);
        });
        if (px > PIXEL_BYTES) this.log.warn('layout "' + layout.name + '" needs ' + mib(px) + ' of pixel memory; cluster-render has 16 MiB for every app together (each image counts twice)');
        this.statusAskT = setTimeout(() => { this.statusAskT = null; this._guard('status request', () => this.client.status()); }, STATUS_ASK_MS);
    }

    _plan(widgets, maxPx, waste) {
        if (!isNum(waste)) waste = Infinity;
        const plan = [];
        const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        const union = (s, w) => {
            const x = Math.min(s.x, w.x), y = Math.min(s.y, w.y);
            return { x, y, w: Math.max(s.x + s.w, w.x + w.w) - x, h: Math.max(s.y + s.h, w.y + w.h) - y };
        };
        widgets.forEach((w) => {
            const klass = w.class || 'content', z = w.z || 0, conn = this._connOf(w);
            if (!IMAGE_TYPES[w.type] || w.own === true || w.type === 'f82sprite') { plan.push({ kind: 'layer', w, klass, z, conn }); return; }
            let after = -1;
            plan.forEach((e, i) => {
                if (e.klass !== klass || e.z !== z || e.conn !== conn) return;
                if (e.kind === 'layer' ? hit(e.w, w) : e.members.some((m) => hit(m, w))) after = i;
            });
            let sheet = null, box = null;
            for (let i = after + 1; i < plan.length && !sheet; i++) {
                const s = plan[i];
                if (s.kind !== 'sheet' || s.klass !== klass || s.z !== z || s.conn !== conn) continue;
                const u = union(s, w);
                const own = s.members.reduce((a, m) => a + m.w * m.h, 0) + w.w * w.h;
                if (u.w * u.h <= maxPx && u.w * u.h <= waste * own) { sheet = s; box = u; }
            }
            if (!sheet) { sheet = { kind: 'sheet', klass, z, conn, x: w.x, y: w.y, w: w.w, h: w.h, members: [], ref: 0, c: null, ci: conn, buf: null }; plan.push(sheet); }
            else { sheet.x = box.x; sheet.y = box.y; sheet.w = box.w; sheet.h = box.h; }
            sheet.members.push(w);
        });
        return plan;
    }

    _createSheet(s) {
        const c = this._clientAt(s.conn);
        const ref = c.image({ target: this.target, klass: s.klass, z: s.z, x: s.x, y: s.y, w: s.w, h: s.h, iw: s.w, ih: s.h });
        if (!ref) { this.log.warn('sheet ' + s.klass + '/' + s.z + ' at ' + s.x + ',' + s.y + ' ' + s.w + 'x' + s.h + ': layer refused'); return; }
        s.ref = ref; s.c = c; s.ci = s.conn;
        s.buf = Buffer.alloc(s.w * s.h * 4, 0);
        this.sheets.push(s);
        s.members.forEach((w) => this._guard('widget ' + w.id, () => this._create(w, s)));
        const buf = s.buf;
        s.buf = null;                    // from here on _blit sends dirty rects
        c.pixels(ref, null, buf);
    }

    _blit(x, rects, buf) {
        const w = x.w, s = x.sheet;
        if (!s) { x.c.pixels(x.ref, rects, buf); return; }
        const rs = rects && rects.length ? rects : [{ x: 0, y: 0, w: w.w, h: w.h }];
        const dx = w.x - s.x, dy = w.y - s.y;
        const moved = rs.map((r) => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }));
        if (!s.buf) { s.c.pixels(s.ref, moved, buf); return; }
        let off = 0;
        moved.forEach((r) => {
            for (let y = 0; y < r.h; y++) {
                buf.copy(s.buf, ((r.y + y) * s.w + r.x) * 4, off, off + r.w * 4);
                off += r.w * 4;
            }
        });
    }

    _blitDiff(x, buf) {
        const w = x.w, was = x.px;
        x.px = buf;
        if (!was || (x.sheet && x.sheet.buf)) { this._blit(x, null, buf); return; }
        const c = changes(was, buf, w.w, w.h);
        if (c) this._blit(x, [c.rect], c.px);
    }

    _toggleOn(t) {
        const not = t.charAt(0) === '!';
        const k = not ? t.slice(1) : t, eq = k.indexOf('=');
        const on = eq > 0 ? String(this.setting(k.slice(0, eq))) === k.slice(eq + 1) : this.setting(k) !== false;
        return not ? !on : on;
    }

    _f82Asset(id) {
        const image = bakedData.json('f82/' + id + '.json');
        if (!Number.isInteger(image.w) || !Number.isInteger(image.h) || typeof image.rgba !== 'string') {
            throw new Error('missing F82 image ' + id);
        }
        return image;
    }

    _paintF82(x, sprite) {
        const dayShadow = x.w.shadowOnly && x.w.shadow && x.w.shadow.dayAsset;
        let id = this.f82Light === 'day' && dayShadow ? dayShadow
            : this.f82Light === 'night' && x.w.nightAsset ? x.w.nightAsset : x.w.asset;
        if (f82Sprite.backlightAsset(id, 'amber') !== id) id = f82Sprite.backlightAsset(id, this.setting('f8xBacklightColour'));
        const image = id === x.w.asset ? sprite : this._f82Asset(id);
        const pixels = Buffer.from(image.rgba, 'base64');
        if (image.w !== sprite.w || image.h !== sprite.h || pixels.length !== image.w * image.h * 4) {
            throw new Error('bad F82 image size for ' + id);
        }
        x.c.pixels(x.ref, null, pixels);
    }

    _onF82Light(value) {
        if (this.stopped) return;
        const light = f82Sprite.lightOf(value);
        if (!light || light === this.f82PendingLight) return;
        clearTimeout(this.f82LightTimer); this.f82LightTimer = null;
        this.f82PendingLight = null;
        if (light === this.f82Light) return;
        this.f82PendingLight = light;
        this.f82LightTimer = setTimeout(() => {
            this.f82LightTimer = null;
            this.f82PendingLight = null;
            this.f82Light = light;
            // Replace the artwork in place. Needle angles and layer IDs stay live.
            const now = Date.now();
            this.widgets.forEach((x) => {
                if (x.w.warningRole || x.w.doorRole) {
                    this._updateWarning(x, false);
                    return;
                }
                if (x.w.type === 'f8xarc') this._update(x, now, true);
                if (x.w.type === 'atext' && x.w.nightColor) {
                    x.c.uniform(x.ref, 'u_color', rgba(color(this.theme, light === 'night' ? x.w.nightColor : x.w.color)));
                }
                if (x.w.type !== 'f82sprite') return;
                if (x.w.shadowOnly) this._guard('F82 lighting ' + x.w.id, () => {
                    this._paintF82(x, this._f82Asset(x.w.asset));
                    this._updateF82(x, now, true);
                });
                else if (x.w.nightAsset) this._guard('F82 lighting ' + x.w.id, () => this._paintF82(x, this._f82Asset(x.w.asset)));
            });
        }, 400);
    }

    _create(w, sheet) {
        let ref, c, sprite;
        if (sheet) { ref = sheet.ref; c = sheet.c; }
        else {
            c = this._clientAt(this._connOf(w));
            const base = { target: this.target, klass: w.class || 'content', z: w.z || 0, x: w.x, y: w.y, w: w.w, h: w.h };
            if (w.warning || w.cruiseRole || w.warningRole || w.doorRole || w.gearRecommendation) base.visible = false;
            if (w.type === 'f82sprite') {
                sprite = this._f82Asset(w.asset);
                base.sampling = 'bilinear';
                if (w.signal) {
                    base.previewPoseSmoothed = true;
                    base.px = w.pivot[0] * w.w / sprite.w;
                    base.py = w.pivot[1] * w.h / sprite.h;
                    base.visible = false;
                    if (w.shadowOnly || w.glassOnly) {
                        const needle = this.widgets.get(w.needleId);
                        if (needle && needle.c === c) {
                            if (w.shadowOnly) base.previewShadowOf = needle.ref;
                            else {
                                base.previewGlassOf = needle.ref;
                                base.previewGlassDirection = w.glass.outward;
                            }
                        }
                    } else base.previewNeedle = true;
                }
                ref = c.image(Object.assign({ iw: sprite.w, ih: sprite.h }, base));
            } else if (IMAGE_TYPES[w.type]) ref = c.image(Object.assign({ iw: w.w, ih: w.h }, base));
            else ref = c.effect(Object.assign({ fs: shaders[w.type] }, base));
            if (!ref) { this.log.warn('widget "' + w.id + '": layer refused'); return; }
        }
        const x = { w, ref, c, ci: sheet ? sheet.ci : this._connOf(w), sheet: sheet || null, last: null, lastPaint: 0, px: null };
        this.widgets.set(w.shadowOnly || w.glassOnly ? w : w.id, x);
        const t = this.theme;
        if (sprite) {
            this._paintF82(x, sprite);
            if (w.signal) this.f82Needles.push(x);
        } else if (w.type === 'f82shift') {
            const [width, height, cx, cy, radius] = w.shiftTrack;
            c.uniform(ref, 'u_size', [width, height]);
            c.uniform(ref, 'u_center', [cx, cy]);
            c.uniform(ref, 'u_radius', [radius]);
        } else if (w.type === 'f8xarc') {
            c.uniform(ref, 'u_size', [w.w, w.h]);
            c.uniform(ref, 'u_center', w.arcCenter);
            c.uniform(ref, 'u_radii', w.arcRadii);
            c.uniform(ref, 'u_halfAngle', [w.arcHalfAngle]);
            c.uniform(ref, 'u_thickness', [w.arcThickness]);
        } else if (w.type === 'atext') {
            const a = this._atlas(w.font, x.ci);
            x.atlas = a;
            x.cells = Math.max(1, Math.min(32, isNum(w.cells) ? Math.floor(w.cells) : Math.floor(w.w / a.cellW)));
            c.bind(ref, 'u_font', a.ref);
            c.uniform(ref, 'u_cells', [x.cells]);
            c.uniform(ref, 'u_grid', [a.cols, a.rows]);
            const ink = this.f82Light === 'night' && w.nightColor ? w.nightColor : w.color;
            c.uniform(ref, 'u_color', rgba(color(t, ink || 'fg')));
            c.uniform(ref, 'u_text', this._atlasCodes(x, ''), { type: 'vec4' });
            if (w.w !== x.cells * a.cellW || w.h !== a.cellH) {
                this.log.info('widget "' + w.id + '": ' + x.cells + ' cells of ' + (w.w / x.cells).toFixed(1) + 'x' + w.h +
                    ' px; the glyphs keep their shape at w ' + x.cells * a.cellW + ', h ' + a.cellH);
            }
        } else if (w.type === 'icon') {
            this._blit(x, null, w.warningRole || w.doorRole ? Buffer.alloc(w.w * w.h * 4)
                : w.cruiseRole ? cruiseArt.pixelsFor(w, 'active')
                : paintIcon(w.icon, w.w, w.h, color(t, w.color || 'fg')));
            if (w.cruiseRole) x.cruiseTint = 'active';
        }
        else if (w.type === 'text' && w.warningRole) this._blit(x, null, Buffer.alloc(w.w * w.h * 4));
        else if (w.type === 'text' && w.warning) this._blit(x, null, textRaster.drawText(w.w, w.h, w.text, {
            font: w.font, color: color(t, w.color || 'fg'), align: w.align, spacing: w.spacing,
        }));
        this._update(x, Date.now(), true);
    }

    _tick() {
        if (this.parkedTest && this.activeName && this.activeName !== 'off') {
            const problem = this._parkedTestSignalProblem();
            if (problem) { this._parkedTestFallback(problem); return; }
        }
        this._updateF82Startup(this.car.data().condition);
        const signature = this._effectiveFormat('units') + ':' + this._effectiveFormat('f82DistanceUnits')
            + ':' + this._oilScaleInfo().scale;
        if (signature !== this._formatSignature) {
            this._formatSignature = signature;
            if (this.activeName && this.activeName !== 'off') this._rebuild();
        }
        if (!this.client.ready) return;
        this._queueF82();
        const now = Date.now();
        this.widgets.forEach((widget) => {
            if (widget.w.type !== 'f82sprite') this._guard('widget ' + widget.w.id, () => this._update(widget, now, false));
        });
    }

    _queueF82() {
        if (this.stopped || this.f82Timer || !this.client.ready || !this.f82Needles.length) return;
        if (this.f82Needles.some((x) => x.c.blocked)) {
            // No intermediate poses accumulate while the socket is congested.
            // Resume at the latest real reading instead of replaying a stale glide.
            this.f82Motion.clear(); this.f82NextFrameAt = null;
            return;
        }
        const plan = framePlan(motionClockMs(), this.f82NextFrameAt);
        this.f82Timer = setTimeout(() => {
            this.f82Timer = null;
            if (this.stopped || !this.client.ready) return;
            if (this.f82Needles.some((x) => x.c.blocked)) {
                this.f82Motion.clear(); this.f82NextFrameAt = null; return;
            }
            const now = Date.now(), motionNow = motionClockMs();
            this.f82NextFrameAt = motionNow > plan.nextAt ? motionNow + plan.interval : plan.nextAt;
            this.f82Needles.forEach((x) => this._guard('widget ' + x.w.id, () => {
                if (this._updateF82(x, now, false, motionNow)) this.f82SentAt = now;
            }));
            if (Array.from(this.f82Motion.values()).some((motion) => motion.moving(motionNow))) this._queueF82();
        }, plan.delay);
    }

    _updateF82(x, now, force, motionNow = motionClockMs()) {
        const { signal, curve, shadowOnly, glassOnly } = x.w;
        if (!signal || x.c.blocked) return false;
        const slow = signal === 'fuel' || signal === 'oil';
        const auxShadow = shadowOnly && (signal === 'fuel' || signal === 'oil');
        const nightShadow = auxShadow && this.f82Light === 'night';
        let degrees = null, moving = false;
        if (!shadowOnly || this.f82Light === 'day' || nightShadow) {
            const test = signal === 'rpm' ? this._testRpm(now) : null;
            const raw = signal === 'rpm' ? (isNum(test) ? test : this.car.data().rpm) : this._raw(signal);
            const value = signal === 'rpm' ? f82Sprite.rpmAngle(curve, raw, this.car.data().condition === 10)
                : f82Sprite.angle(curve, raw);
            const id = x.w.needleId || x.w.id;
            // All companion layers sample one motion at the same clock time.
            if (!this.f82Motion) this.f82Motion = new Map();
            if (!this.f82Motion.has(id)) this.f82Motion.set(id, new NeedleMotion(slow
                ? { settleMs: 100, maxStepMs: 100 } : { settleMs: 36, maxStepMs: 36 }));
            const motion = this.f82Motion.get(id);
            const drawn = motion.sample(value, motionNow);
            moving = motion.moving(motionNow);
            if (drawn !== null) degrees = Math.round(drawn * 100) / 100;
        }
        if (!force && degrees === x.last) return false;
        if (!force && slow && degrees !== null && moving && Number.isFinite(x.poseAt)
            && motionNow >= x.poseAt && motionNow - x.poseAt < F82_AUX_POSE_MS) return false;
        x.last = degrees; x.poseAt = motionNow;
        // The sprite pixels remain resident. Only pose and visibility change.
        const pose = degrees === null ? { visible: false } : { visible: true, rotate: degrees };
        if (degrees !== null) {
            if (shadowOnly) {
                const [dx, dy] = f82Sprite.shadowOffset(x.w);
                // The light stays fixed in screen space while the blade rotates.
                // Its actual overlap with the blade hides an aligned Day shadow;
                // fading it by that same projection would suppress it twice.
                const opacity = nightShadow
                    ? f82Sprite.shadowOpacity(degrees, dx, dy) * F82_AUX_NIGHT_SHADOW_OPACITY
                    : F82_DAY_SHADOW_OPACITY;
                pose.opacity = Math.round(opacity * 100) / 100;
                // The main shafts need a little more separation from their
                // blades; the auxiliary pair retains its existing side offsets.
                // Reset from the saved position, never the previous pose.
                const distance = nightShadow ? F82_AUX_NIGHT_SHADOW_OFFSET
                    : auxShadow ? F82_AUX_DAY_SHADOW_OFFSET : F82_MAIN_DAY_SHADOW_OFFSET;
                pose.x = x.w.x + dx * (distance - 1);
                pose.y = x.w.y + dy * (distance - 1);
            } else if (glassOnly) Object.assign(pose, f82Sprite.glassPose(degrees, x.w.glass.outward));
        }
        x.c.set(x.ref, pose);
        return true;
    }

    _updateF82Shift(x, now, force) {
        const w = x.w, data = this.car.data(), limit = this._f82ShiftLimit(data.oil);
        if (!isNum(limit) || limit < 500) {
            if (force || x.last !== 'unavailable') {
                x.last = 'unavailable';
                x.shiftBand = null; x.shiftFlashAt = null; x.shiftBuildCount = 0; x.shiftBloom = 0;
                x.c.uniform(x.ref, 'u_build', [0]);
                x.c.uniform(x.ref, 'u_bloom', [0]);
                x.c.uniform(x.ref, 'u_edges', [0, 0, 0, 0]);
                x.c.uniform(x.ref, 'u_cells', [1, 1]);
                x.c.set(x.ref, { visible: false });
            }
            return;
        }
        const night = this.f82Light === 'night';
        const key = limit + '|' + night;
        if (force || key !== x.last) {
            x.last = key;
            x.shiftBand = f82Sprite.shiftBand(w.curve, limit, w.shiftTrack[5]);
            x.c.uniform(x.ref, 'u_edges', x.shiftBand.edges);
            x.c.uniform(x.ref, 'u_cells', x.shiftBand.counts);
            x.c.uniform(x.ref, 'u_night', [night ? 1 : 0]);
            x.c.set(x.ref, { visible: true });
        }
        const testRpm = this._testRpm(now), rpm = isNum(testRpm) ? testRpm : data.rpm;
        const warm = isNum(data.oil) && data.oil >= f82Sprite.SHIFT_OIL_WARM_C;
        const active = warm && (isNum(testRpm) || this._f82PedalPercent(data, now) === 100);
        const point = Math.max(f82Sprite.SHIFT_TRACK_START_RPM, limit - this.setting('shiftBefore'));
        const flash = active && isNum(rpm) && rpm >= point;
        if (!flash) x.shiftFlashAt = null;
        else if (!isNum(x.shiftFlashAt) || now < x.shiftFlashAt) x.shiftFlashAt = now;
        const dark = flash && Math.floor((now - x.shiftFlashAt) / F82_SHIFT_HALF_PERIOD_MS) % 2 === 1;
        const count = active && !dark ? f82Sprite.shiftBuildCount(w.curve, x.shiftBand, rpm, point) : 0;
        // Keep the fixed limiter lenses softly illuminated even without shift
        // assistance. Inactive buildup cells still have zero shader coverage.
        const bloom = active && !dark && count > 0 ? 1 : 0.6;
        if (force || x.shiftBloom !== bloom) {
            x.shiftBloom = bloom;
            x.c.uniform(x.ref, 'u_bloom', [bloom]);
        }
        if (force || x.shiftBuildCount !== count) {
            x.shiftBuildCount = count;
            x.c.uniform(x.ref, 'u_build', [count]);
        }
    }

    _updateCruise(x, force) {
        const reading = this.cruise.value();
        const state = reading && reading.state;
        const valid = state === 'active' || state === 'standby';
        const pose = valid && x.w.cruiseRole === 'marker' && cruiseArt.markerPose(x.w, reading);
        const key = pose ? state + '|' + JSON.stringify(pose) : 'hidden';
        if (!force && key === x.last) return;
        x.last = key;
        if (pose && x.cruiseTint !== state) {
            this._blit(x, null, cruiseArt.pixelsFor(x.w, state));
            x.cruiseTint = state;
        }
        x.c.set(x.ref, pose ? Object.assign({ opacity: 1 }, pose) : { visible: false });
    }

    _update(x, now, force) {
        const w = x.w;
        if (w.gearRecommendation) {
            const direction = this.gearRecommendation && this.gearRecommendation.value(this.car.data());
            const visible = direction === w.gearRecommendation;
            if (force || visible !== x.last) {
                x.last = visible;
                x.c.set(x.ref, { visible, opacity: 1 });
            }
        } else if (w.warningRole || w.doorRole) {
            this._updateWarning(x, force);
        } else if (w.cruiseRole) {
            this._updateCruise(x, force);
        } else if (w.type === 'f82sprite') {
            this._updateF82(x, now, force);
        } else if (w.type === 'f82shift') {
            this._updateF82Shift(x, now, force);
        } else if (w.type === 'f8xarc') {
            if (force || x.last !== this.f82Light) {
                x.last = this.f82Light;
                x.c.uniform(x.ref, 'u_color', rgba(this.f82Light === 'night' ? w.nightColor : w.color));
            }
        } else if (w.type === 'atext') {
            if (!force && now - x.lastPaint < (w.rate || TEXT_MS)) return;
            const s = this._resolve(w.text);
            if (!force && s === x.last) return;
            x.last = s; x.lastPaint = now;
            x.c.uniform(x.ref, 'u_text', this._atlasCodes(x, s), { type: 'vec4' });
        } else if (w.type === 'text') {
            if (!force && now - x.lastPaint < (w.rate || TEXT_MS)) return;
            const s = this._resolve(w.text);
            const role = (this.f82Light === 'night' && w.nightColor ? w.nightColor : w.color) || 'fg';
            const key = s + '|' + role;
            if (!force && key === x.last) return;
            x.last = key; x.lastPaint = now;
            const buf = textRaster.drawText(w.w, w.h, s, {
                font: w.font, color: color(this.theme, role), align: w.align, spacing: w.spacing,
                color2: w.color2 && role !== 'hot' ? color(this.theme, w.color2) : null,
                glow: w.glow ? this.theme.glow : 0,
            });
            this._blitDiff(x, buf);
        }
    }
}

module.exports = F8xRuntime;
