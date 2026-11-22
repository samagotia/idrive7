'use strict';
// SPDX-License-Identifier: MIT
/*
 * Read-only closure contacts and vehicle metadata, not lock/unlock commands.
 * Exact fields/enums: public BMW M8 i-Level20-07-510 SOME/IP catalog:
 * https://github.com/user-attachments/files/34052657/someip-interfaces.json
 * SHA256 25d91c40bfa6eae0f415caf5b4be2d3a8099db19f1ff927b2b0317dc1a166887
 * Source usage: cauliflowermossgrape/idrive7-apps ambient_config/main.js.
 * Closure fields are notification-only. No getter or periodic heartbeat is
 * defined, so no invented polling or short TTL is applied to unchanged doors.
 * Values belong to one availability session; reconnect waits for new samples.
 * Status2, once meaningfully observed, owns the complete snapshot for that session. Legacy
 * packets cannot fill gaps or revive stale contacts from another wrapper.
 * G82 delivery/cadence and driver/passenger mapping remain untested on-car.
 *
 * new Doors(ctx[, {now}]); value({layout:'auto'|'two'|'four',
 * steering:'auto'|'lhd'|'rhd'}), status(), stop(). States are open/closed/unknown.
 * Physical left/right is unknown until steering side is known or overridden.
 * Body/model to two/four is artwork policy, NOT a wire-provided door count.
 */
const INTERFACE = 'de.bmw.body.DoorsWindowsRoofMirrors';
const FIELDS = ['CentralLockingSystemAndPanelStatus', 'CentralLockingSystemAndPanelStatus2'];
const METADATA_INTERFACE = 'de.bmw.infotainment.vehicle.Vehicle2';
const METADATA_FIELD = 'statusVehiclePartType';
const METADATA_MAX_AGE_MS = 60000;
const clock = () => process.uptime() * 1000;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const KEYS = ['driverFront', 'passengerFront', 'driverRear', 'passengerRear', 'bonnet', 'boot', 'boot2'];
const CONTACTS = {
    driverFront: ['statusDoorSwitchDRD', 'FAT_IST_GESCHLOSSEN', 'FAT_IST_OFFEN'],
    passengerFront: ['statusDoorSwitchPSD', 'BEIFAHRERTUER_IST_GESCHLOSSEN', 'BEIFAHRERTUER_IST_OFFEN'],
    driverRear: ['statusDoorSwitchDRDR', 'FATH_IST_GESCHLOSSEN', 'FATH_IST_OFFEN'],
    passengerRear: ['statusDoorSwitchPSDR', 'BFTH_IST_GESCHLOSSEN', 'BFTH_IST_OFFEN'],
    bonnet: ['statusContactBonnet', 'MOTORHAUBE_GESCHLOSSEN', 'MOTORHAUBE_OFFEN'],
    boot: ['statusContactBootLid', 'HK_IST_GESCHLOSSEN', 'HK_IST_OFFEN'],
    boot2: ['statusContactBootLid2', 'KLAPPE_2_GESCHLOSSEN', 'KLAPPE_2_OFFEN'],
};
const MODELS = { F80: 57, F82: 58, F83: 59, G05: 83, G80: 121, G82: 122, G83: 123 };
const MODEL_LAYOUT = { F80: 'four', F82: 'two', F83: 'two', G05: 'four', G80: 'four', G82: 'two', G83: 'two' };
const BODY = {
    LIMOUSINE: 1, COUPE: 2, TOURING: 3, CABRIO: 4, ROADSTER: 5,
    _4_X_4_SINGLE_PIECE_TAILGATE: 10, _4_X_4_TWO_PIECE_TAILGATE: 11,
    SPORTS_ACTIVITY_VEHICLE: 33, SPORTS_ACTIVITY_COUPE: 34,
    SPORTS_MINUS_ACTIVITY_TOURER: 35, HATCH_COUPE: 50,
};
const BODY_NAME = { 1: 'sedan', 2: 'coupe', 3: 'touring', 4: 'convertible', 5: 'roadster',
    10: 'suv', 11: 'suv', 33: 'suv', 34: 'suv', 35: 'touring', 50: 'hatchback' };
// Conservative generic artwork policy. HATCH_COUPE does not establish a count.
const BODY_LAYOUT = { 1: 'four', 2: 'two', 3: 'four', 4: 'two', 5: 'two',
    10: 'four', 11: 'four', 33: 'four', 34: 'four', 35: 'four' };
const STEERING = { LINKSLENKER: 1, RECHTSLENKER: 2 };
function enumOf(value, names) {
    return typeof value === 'string' && own(names, value) ? names[value] : value;
}
function unknownContacts() {
    const result = {};
    KEYS.forEach((key) => { result[key] = 'unknown'; });
    return result;
}
function decodeContact(raw, closed, open) {
    return raw === 0 || raw === closed ? 'closed' : raw === 1 || raw === open ? 'open' : 'unknown';
}
function decodeContacts(sample, extended) {
    const v = sample && typeof sample === 'object' && !Array.isArray(sample) ? sample : {};
    const result = unknownContacts();
    KEYS.forEach((key) => {
        if (key === 'boot2' && !extended) return;
        const f = CONTACTS[key];
        result[key] = decodeContact(v[f[0]], f[1], f[2]);
    });
    return result;
}
function decodeMetadata(sample) {
    const v = sample && typeof sample === 'object' && !Array.isArray(sample) ? sample : {};
    const modelRaw = enumOf(v.typeVehicle, MODELS), bodyRaw = enumOf(v.typeBody, BODY);
    const steeringRaw = enumOf(v.typeSteering, STEERING);
    const model = Number.isInteger(modelRaw) ? Object.keys(MODELS).find((name) => MODELS[name] === modelRaw) || null : null;
    const validBody = Number.isInteger(bodyRaw) && own(BODY_NAME, bodyRaw) ? bodyRaw : null;
    return { model, body: validBody === null ? null : BODY_NAME[validBody],
        bodyCode: validBody, steering: steeringRaw === 1 ? 'lhd' : steeringRaw === 2 ? 'rhd' : null,
        layout: model ? MODEL_LAYOUT[model] : validBody === null ? null : BODY_LAYOUT[validBody] || null,
        splitBoot: validBody === 11 };
}
function emptyMetadata() { return decodeMetadata(null); }
function shutdown(sub) {
    if (sub && sub.shutdown) Promise.resolve().then(() => sub.shutdown()).catch(() => {});
}
class Doors {
    constructor(ctx, options) {
        this.now = options && options.now || clock;
        this.stopped = false;
        this.sub = null;
        this.metaSub = null;
        this.contacts = unknownContacts();
        this.metadata = emptyMetadata();
        this.at = null;
        this.metaAt = null;
        this.source = null;
        this.reason = 'waiting';
        this.metaReason = 'waiting';
        this.preferExtended = false;
        this.wasAvailable = false;
        this.metaWasAvailable = false;
        this.timer = setInterval(() => this._availability(), 100);
        if (this.timer.unref) this.timer.unref();
        const handlers = {};
        FIELDS.forEach((field, index) => { handlers[field] = (sample) => this._receive(sample, field, index === 1); });
        // Neither contact field has a getter: the fourth argument is only log,
        // and no polling options are supplied to this notification-only watch.
        Promise.resolve().then(() => ctx.signals.watch(INTERFACE, '1', handlers, ctx.log)).then((sub) => {
            if (this.stopped) { shutdown(sub); return; }
            this.sub = sub;
            if (sub.onAvailability) sub.onAvailability(() => this._availability());
            this._availability();
        }).catch((error) => {
            if (this.stopped) return;
            this._clear('error');
            if (ctx.log && ctx.log.info) ctx.log.info('closure contacts unavailable: ' + error.message);
        });
        const metaHandlers = {};
        metaHandlers[METADATA_FIELD] = (sample) => {
            if (this.stopped) return;
            this._availability();
            if (this.metaSub && !this.metaSub.available) { this._clearMetadata('unavailable'); return; }
            this.metadata = decodeMetadata(sample);
            this.metaAt = this.now();
            this.metaReason = this.metadata.model || this.metadata.body || this.metadata.steering ? 'live' : 'invalid';
        };
        Promise.resolve().then(() => ctx.signals.watch(METADATA_INTERFACE, '1', metaHandlers, ctx.log,
            { pollMs: 10000, pollFields: [METADATA_FIELD], readTimeoutMs: 1000 })).then((sub) => {
            if (this.stopped) { shutdown(sub); return; }
            this.metaSub = sub;
            if (sub.onAvailability) sub.onAvailability(() => this._availability());
            this._availability();
        }).catch((error) => {
            if (this.stopped) return;
            this._clearMetadata('error');
            if (ctx.log && ctx.log.info) ctx.log.info('vehicle layout unavailable: ' + error.message);
        });
    }
    _clear(reason) {
        this.contacts = unknownContacts(); this.at = null; this.source = null;
        this.preferExtended = false; this.reason = reason;
    }
    _clearMetadata(reason) { this.metadata = emptyMetadata(); this.metaAt = null; this.metaReason = reason; }
    _receive(sample, field, extended) {
        if (this.stopped) return;
        this._availability();
        if (this.sub && !this.sub.available) { this._clear('unavailable'); return; }
        if (this.preferExtended && !extended) return;
        const decoded = decodeContacts(sample, extended);
        const hasContact = KEYS.some((key) => decoded[key] !== 'unknown');
        // An unsupported extended field may emit only its invalid defaults.
        // It must not hijack an already meaningful legacy stream. After one
        // real extended contact, invalid snapshots still clear that stream.
        if (extended && !this.preferExtended && !hasContact) {
            if (this.source === null) this.reason = 'invalid';
            return;
        }
        if (extended) this.preferExtended = true;
        this.contacts = decoded;
        this.source = field;
        this.at = this.now();
        this.reason = KEYS.some((key) => this.contacts[key] !== 'unknown') ? 'live' : 'invalid';
    }
    _availability() {
        if (this.stopped) return;
        if (this.sub) {
            const available = !!this.sub.available;
            if (!available) this._clear('unavailable');
            else if (!this.wasAvailable && this.reason === 'unavailable') this.reason = 'waiting';
            this.wasAvailable = available;
        }
        if (this.metaSub) {
            const available = !!this.metaSub.available;
            if (!available) this._clearMetadata('unavailable');
            else if (!this.metaWasAvailable && this.metaReason === 'unavailable') this.metaReason = 'waiting';
            this.metaWasAvailable = available;
        }
    }
    status() {
        this._availability();
        const available = !this.stopped && !!(this.sub && this.sub.available);
        const metadataAvailable = !this.stopped && !!(this.metaSub && this.metaSub.available);
        const elapsed = this.at === null ? null : this.now() - this.at;
        const ageMs = elapsed !== null && Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
        let metadataAgeMs = this.metaAt === null ? null : this.now() - this.metaAt;
        if (metadataAgeMs !== null && (!Number.isFinite(metadataAgeMs) || metadataAgeMs < 0 || metadataAgeMs > METADATA_MAX_AGE_MS)) {
            this._clearMetadata('stale'); metadataAgeMs = null;
        }
        return { available, observed: available && this.at !== null, source: this.source,
            ageMs, reason: this.stopped ? 'stopped' : this.reason,
            cadenceVerified: false, closureExpiry: 'provider-session',
            metadata: { available: metadataAvailable, fresh: metadataAvailable && this.metaAt !== null && this.metaReason === 'live',
                ageMs: metadataAgeMs, reason: this.stopped ? 'stopped' : this.metaReason } };
    }
    value(options) {
        const status = this.status(), opts = options || {};
        const closures = status.observed ? Object.assign({}, this.contacts) : unknownContacts();
        const metadata = status.metadata.fresh ? this.metadata : emptyMetadata();
        const layout = opts.layout === 'two' || opts.layout === 'four' ? opts.layout : metadata.layout;
        const steering = opts.steering === 'lhd' || opts.steering === 'rhd' ? opts.steering : metadata.steering;
        const physical = { frontLeft: 'unknown', frontRight: 'unknown', rearLeft: 'unknown', rearRight: 'unknown',
            bonnet: closures.bonnet, boot: closures.boot, boot2: closures.boot2 };
        if (steering) {
            const driverLeft = steering === 'lhd';
            physical.frontLeft = closures[driverLeft ? 'driverFront' : 'passengerFront'];
            physical.frontRight = closures[driverLeft ? 'passengerFront' : 'driverFront'];
            physical.rearLeft = closures[driverLeft ? 'driverRear' : 'passengerRear'];
            physical.rearRight = closures[driverLeft ? 'passengerRear' : 'driverRear'];
        }
        const required = ['driverFront', 'passengerFront', 'bonnet', 'boot'];
        if (layout === 'four') required.push('driverRear', 'passengerRear');
        if (metadata.splitBoot) required.push('boot2');
        const anyOpen = KEYS.some((key) => closures[key] === 'open');
        return { closures, physical, layout, steering, model: metadata.model, body: metadata.body,
            anyOpen, allClosed: !anyOpen && layout !== null && required.every((key) => closures[key] === 'closed'),
            source: status.source };
    }
    stop() {
        if (this.stopped) return;
        this.stopped = true; clearInterval(this.timer); this.timer = null;
        this._clear('stopped'); this._clearMetadata('stopped');
        shutdown(this.sub); shutdown(this.metaSub);
    }
}
module.exports = { Doors, decodeContact, decodeContacts, decodeMetadata, INTERFACE, FIELDS,
    METADATA_INTERFACE, METADATA_FIELD, METADATA_MAX_AGE_MS, CONTACTS, MODELS, BODY };
