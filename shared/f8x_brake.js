'use strict';

// CDS mapping from cauliflowermossgrape/idrive7-apps live_data (MIT).
// Availability of this field on a particular car still requires a parked check.
const INTERFACE = 'de.bmw.infotainment.vehicle.CDS';
const FIELD = 'statusHandBrake';
const MAX_AGE_MS = 2500;
const clock = () => process.uptime() * 1000;

function decode(sample) {
    const value = sample && sample.statusContactHandBrake;
    if (value === 2 || value === 'HANDBREMSE_ANGEZOGEN') return 'applied';
    if (value === 1 || value === 'HANDBREMSE_GELOEST') return 'released';
    return 'unknown';
}

class ParkingBrake {
    constructor(ctx) {
        this.state = 'unknown';
        this.at = null;
        this.sub = null;
        this.stopped = false;
        ctx.signals.watch(INTERFACE, '1', {
            [FIELD]: (sample) => {
                if (this.stopped) return;
                this.state = decode(sample);
                this.at = clock();
            },
        }, ctx.log, { pollMs: 1000, pollFields: [FIELD], readTimeoutMs: 700 }).then((sub) => {
            if (this.stopped) { if (sub.shutdown) sub.shutdown(); return; }
            this.sub = sub;
            if (sub.onAvailability) sub.onAvailability((available) => {
                if (!available) { this.at = null; this.state = 'unknown'; }
            });
        }).catch((error) => ctx.log.info('parking brake unavailable: ' + error.message));
    }

    value() {
        if (this.sub && !this.sub.available) { this.at = null; this.state = 'unknown'; }
        return !this.stopped && this.sub && this.sub.available && this.at !== null
            && clock() - this.at <= MAX_AGE_MS ? this.state : 'unknown';
    }

    stop() {
        this.stopped = true;
        this.state = 'unknown';
        if (this.sub && this.sub.shutdown) this.sub.shutdown();
    }
}

module.exports = { ParkingBrake, decode, INTERFACE, FIELD, MAX_AGE_MS };
