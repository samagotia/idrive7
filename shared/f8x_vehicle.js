'use strict';

// Adapted from cauliflowermossgrape's MGU App Kit car.js (MIT).
// Retained copyright and licence terms are in LICENSE and NOTICE.
// F8X uses confirmed vehicle fields. The Mac bench can inject a simulator in preview mode.

const SCALE = {
    rpm: { factor: 0.25, offset: 0, invalid: 65535 },
    speed: { factor: 0.015625, offset: 0, invalid: 65535 },
    temp: { factor: 1, offset: -48, invalid: 255 },
};
const GEARS = { G1: 1, G2: 2, G3: 3, G4: 4, G5: 5, G6: 6, G7: 7, G8: 8, G9: 9, G10: 10, R: -1, N_OR_P: 0 };
const STAGES = { P: 'P', R: 'R', N: 'N', D: 'D', 1: 'P', 2: 'R', 3: 'N', 4: 'D' };
const CONDITIONS = {
    PARKEN_BN_NIO: 1, PARKEN_BN_IO: 2, STANDFUNKTIONEN_KUNDE_NICHT_IM_FZG: 3, WOHNEN: 5,
    PRUEFEN_ANALYSE_DIAGNOSE: 7, FAHRBEREITSCHAFT_HERSTELLEN: 8, FAHREN: 10, FAHRBEREITSCHAFT_BEENDEN: 12,
};
const SIGNALS = {
    rpm: ['de.bmw.infotainment.vehicle.CDS', 'statusEngineSpeed2'],
    temps: ['de.bmw.infotainment.vehicle.CDS', 'statusEngineTemperature'],
    speed: ['de.bmw.infotainment.vehicle.Vehicle2', 'statusCarSpeed2'],
    gear: ['de.bmw.infrastructure.VehicleInformation', 'statusGearboxDrive', 'DataPowerTrain2'],
    condition: ['de.bmw.infrastructure.VehicleCondition', 'VehicleCondition'],
};
const CRITICAL = ['speed', 'rpm'];
const liveClockMs = () => process.uptime() * 1000;

function gearOf(raw) {
    if (typeof raw !== 'number') return GEARS[raw];
    if (raw >= 3 && raw <= 12) return raw - 2;
    if (raw === 1) return -1;
    if (raw === 2) return 0;
    return undefined;
}

function programOf(value) {
    for (const key of Object.keys(value || {})) {
        if (key === 'statusActualGearDrive' || /StageDrive/.test(key)
            || !/select|lever|position|program|mode|range|manual|sport|tip/i.test(key)) continue;
        const raw = value[key];
        if (raw === true || raw === 1) {
            if (/manual|tip/i.test(key)) return 'M';
            if (/sport/i.test(key)) return 'S';
            continue;
        }
        const name = String(raw).toUpperCase();
        if (/NOT|INACTIVE|INVALID|SIGNAL|UNKNOWN|OFF|NO_/.test(name)) continue;
        if (/MANU|TIPP|^M$|^M_|_M$|^M\d/.test(name)) return 'M';
        if (/SPORT|^S$|_S$|^DS$/.test(name)) return 'S';
    }
    return 'D';
}

function conditionOf(raw) {
    const value = typeof raw === 'number' ? raw : CONDITIONS[raw];
    return value >= 1 && value <= 12 ? value : undefined;
}

function selectionOf(raw) {
    const named = { N: 1, R: 2, P: 3, NP: 4 };
    const value = typeof raw === 'number' ? raw : named[raw]
        || (/^_\d$/.test(String(raw)) ? 4 + Number(String(raw).slice(1)) : undefined);
    if (value === 1) return { stage: 'N', gear: 0 };
    if (value === 2) return { stage: 'R', gear: -1 };
    if (value === 3) return { stage: 'P', gear: 0 };
    if (value === 4) return { stage: undefined, gear: 0 };
    if (value >= 5 && value <= 13) return { stage: 'D', gear: value - 4 };
    return undefined;
}

class Car {
    constructor(ctx, groups, extra, parkedTest = false) {
        this.ctx = ctx;
        this.log = ctx.log;
        this.S = Object.assign({}, SCALE, (ctx.spec.config && ctx.spec.config.scaling) || {});
        this.live = {};
        this.lastCar = 0;
        this.listeners = [];
        this.subs = [];
        this.criticalAt = parkedTest ? {} : null;
        this.demoActive = false;
        this.preview = process.env.M4_PREVIEW_ONLY === '1';
        this.t0 = Date.now();
        this.sim = null;
        this.simData = {};
        this.redline = 7000;
        this.stopped = false;

        const scaled = (key, raw) => {
            const scale = this.S[key];
            if (!scale || !Number.isFinite(raw) || raw === scale.invalid
                || (scale.invalidFrom !== undefined && raw >= scale.invalidFrom)) return null;
            return raw * scale.factor + (scale.offset || 0);
        };
        const put = (key, value, tick) => {
            if (this.stopped || value === null || value === undefined
                || (typeof value === 'number' && !Number.isFinite(value))) return;
            this.live[key] = value;
            this.lastCar = Date.now();
            if (tick && !this.demoActive) this._emit(this.live, this.lastCar);
        };
        const watches = {};
        const add = (iface, field, callback) => {
            if (!watches[iface]) watches[iface] = {};
            watches[iface][field] = callback;
        };
        const critical = (key, member) => {
            const [iface, field] = SIGNALS[key];
            add(iface, field, (sample) => {
                if (this.stopped) return;
                const raw = sample && sample[member];
                const value = scaled(key, raw);
                if (this.criticalAt) {
                    const valid = Number.isInteger(raw) && raw >= 0 && raw < 65535
                        && Number.isFinite(value) && value >= 0;
                    this.criticalAt[key] = valid ? liveClockMs() : null;
                    if (!valid) return;
                }
                put(key, value, true);
            });
        };
        if (groups.includes('rpm')) critical('rpm', 'actualValueRPMEngineCrankshaft');
        if (groups.includes('speed')) critical('speed', 'speedVehicleCentreOfGravity');
        if (groups.includes('temps')) add(SIGNALS.temps[0], SIGNALS.temps[1], (sample) => {
            put('coolant', scaled('temp', sample && sample.temperatureEngineDrive));
            put('oil', scaled('temp', sample && sample.temperatureEngineOilDrive));
        });
        if (groups.includes('gear')) {
            add(SIGNALS.gear[0], SIGNALS.gear[1], (sample) => {
                const stage = sample && STAGES[sample.statusActualStageDrive];
                if (stage !== undefined) put('stage', stage);
                put('program', programOf(sample));
                put('gear', gearOf(sample && sample.statusActualGearDrive));
            });
            add(SIGNALS.gear[0], SIGNALS.gear[2], (sample) => {
                const selection = selectionOf(sample && sample.statusGearSelectionDrive);
                if (!selection) return;
                if (selection.stage !== undefined) put('stage', selection.stage);
                else if (this.live.stage === 'D' || this.live.stage === 'R') delete this.live.stage;
                put('gear', selection.gear);
            });
        }
        if (groups.includes('condition')) add(SIGNALS.condition[0], SIGNALS.condition[1],
            (sample) => put('condition', conditionOf(sample && sample.statusConditionVehicle)));

        const pollMs = {}, availabilityHooks = {};
        Object.keys(extra || {}).forEach((iface) => Object.keys(extra[iface]).forEach((field) => {
            if (field === '$pollMs') pollMs[iface] = extra[iface][field];
            else if (field === '$onAvailability') availabilityHooks[iface] = extra[iface][field];
            else add(iface, field, extra[iface][field]);
        }));
        Object.keys(watches).forEach((iface) => {
            const essential = parkedTest && CRITICAL.find((key) => SIGNALS[key][0] === iface);
            // Successful getters confirm quiet, valid stationary zeros as fresh readings.
            const options = essential ? { pollMs: 500, pollFields: [SIGNALS[essential][1]], readTimeoutMs: 500 }
                : pollMs[iface] ? { pollMs: pollMs[iface] } : undefined;
            ctx.signals.watch(iface, '1', watches[iface], this.log, options).then((sub) => {
                if (this.stopped) {
                    sub.available = false;
                    if (sub.shutdown) sub.shutdown();
                    return;
                }
                this.subs.push(sub);
                const hook = availabilityHooks[iface];
                if (typeof hook === 'function') {
                    if (sub.onAvailability) sub.onAvailability((available) => { if (!this.stopped) hook(!!available); });
                    hook(!!sub.available);
                }
                this.log.info('signal ' + iface.split('.').pop() + (sub.error ? ' error: ' + sub.error : ' subscribed'));
            }).catch((error) => {
                if (!this.stopped && typeof availabilityHooks[iface] === 'function') availabilityHooks[iface](false);
                this.log.warn('signal ' + iface + ': ' + error);
            });
        });
        if (this.preview && !parkedTest && ctx.simulator) this._startPreview();
    }

    _startPreview() {
        let sampleAt = Date.now();
        this.simTimer = setInterval(() => {
            const now = Date.now();
            const demo = this._wantDemo();
            if (demo !== this.demoActive) {
                this.demoActive = demo;
                this.log.info(demo ? 'demo data on' : 'live car data');
                this.listeners.forEach((listener) => listener.reset && listener.reset());
            }
            if (!demo) { sampleAt = now; return; }
            if (!this.sim) {
                this.sim = this.ctx.simulator;
                this.sim.setRedline(this.redline);
                sampleAt = now - 50;
            }
            if (now - sampleAt > 3000) sampleAt = now - 3000;
            while (sampleAt + 50 <= now) {
                sampleAt += 50;
                this.simData = this.sim.sample(sampleAt);
                this._emit(this.simData, sampleAt);
            }
        }, 50);
    }

    carPresent() { return this.lastCar > 0 || this.subs.some((sub) => sub.available); }

    _wantDemo() {
        if (!this.preview || !this.ctx.simulator || this.criticalAt) return false;
        const mode = this.ctx.settings.get('demo');
        return mode === 'on' || (mode !== 'off' && !this.carPresent() && Date.now() - this.t0 > 5000);
    }

    missingCriticalSignal(maxAgeMs) {
        if (!this.criticalAt) return null;
        const now = liveClockMs();
        return CRITICAL.find((key) => {
            const sub = this.subs.find((item) => item.iface === SIGNALS[key][0]);
            if (!sub || !sub.available) this.criticalAt[key] = null;
            const at = this.criticalAt[key];
            return !Number.isFinite(at) || now - at >= maxAgeMs;
        }) || null;
    }

    data() { return Object.assign({}, this.demoActive ? this.simData : this.live, { demo: this.demoActive }); }
    onSample(fn, reset) { this.listeners.push({ fn, reset }); }
    setRedline(rpm) { this.redline = rpm; if (this.sim) this.sim.setRedline(rpm); }

    _emit(data, at) {
        const sample = Object.assign({}, data, { demo: this.demoActive });
        this.listeners.forEach((listener) => {
            try { listener.fn(sample, at); } catch (error) { this.log.warn('sample: ' + error); }
        });
    }

    stop() {
        this.stopped = true;
        clearInterval(this.simTimer);
        this.listeners = [];
        this.subs.forEach((sub) => {
            sub.available = false;
            if (sub.shutdown) sub.shutdown();
        });
    }
}

Car.SIGNALS = SIGNALS;
Car.SCALE = SCALE;
Car.selectionOf = selectionOf;
Car.conditionOf = conditionOf;
Car.programOf = programOf;
module.exports = Car;
