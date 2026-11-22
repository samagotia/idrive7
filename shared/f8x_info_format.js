'use strict';
// SPDX-License-Identifier: MIT
// Presentation of canonical, validated readings. UK and US gallons stay distinct.
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const labels = { 'l/100km': 'l/100km', mpg_uk: 'mpg', mpg_us: 'mpg', 'km/l': 'km/l' };
function consumption(sample, requested) {
    if (!sample || !finite(sample.value) || sample.value < 0 || !labels[sample.unit]) return '--';
    const unit = labels[requested] ? requested : sample.unit;
    let value = sample.value;
    if (unit !== sample.unit) {
        // Reciprocal economies at zero cannot be converted to a finite reading.
        if (value === 0) return '--';
        const litres = sample.unit === 'l/100km' ? value : sample.unit === 'km/l' ? 100 / value
            : (sample.unit === 'mpg_uk' ? 282.480936 : 235.214583) / value;
        value = unit === 'l/100km' ? litres : unit === 'km/l' ? 100 / litres
            : (unit === 'mpg_uk' ? 282.480936 : 235.214583) / litres;
    }
    return finite(value) ? value.toFixed(1) + ' ' + labels[unit] : '--';
}
function distance(km, units, odometer) {
    if (!finite(km) || km < 0) return '--';
    const value = (units === 'us' ? km / 1.609344 : km).toFixed(odometer ? 0 : 1);
    return value.padStart(5, '0');
}
function temperature(celsius, fahrenheit) {
    if (!finite(celsius)) return '--';
    const value = fahrenheit ? Math.round(celsius * 9 / 5 + 32) : Math.round(celsius * 2) / 2;
    return (value > 0 ? '+' : '') + value;
}
module.exports = { consumption, distance, temperature };
