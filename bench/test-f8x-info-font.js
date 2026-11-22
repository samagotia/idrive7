'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const infoFormat = require('../shared/f8x_info_format');
const root = path.resolve(__dirname, '..');
const font = JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster/fonts/f82_info.json'), 'utf8'));
const alpha = Buffer.from(font.alpha, 'base64');
const textModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_text.js'), 'utf8'), {
    module: textModule, Buffer, console,
    require: (name) => {
        assert.strictEqual(name, './f8x_data');
        return { json: (asset) => { assert.strictEqual(asset, 'fonts/f82_info.json'); return font; } };
    }
});
const raster = textModule.exports;
assert.strictEqual(alpha.length, font.width * font.height);
assert.strictEqual(font.baseline, 25); assert.strictEqual(font.cellHeight, 30);
// New glyphs are appended. Existing atlas positions/metrics must not shift.
const characters = Array.from('+- 0123456789°CF./:apmiglk\uE000\uE001\uE002\uE003uersvØh');
characters.forEach((character, index) => {
    const glyph = font.glyphs[character];
    assert.ok(glyph, 'missing glyph ' + character);
    assert.strictEqual(glyph.x, index * 30); assert.strictEqual(glyph.y, 0);
    assert.strictEqual(glyph.w, 30); assert.strictEqual(glyph.h, 30);
    assert.strictEqual(glyph.ox, -1); assert.ok(glyph.advance > 0 && glyph.advance <= 30);
    if (character !== ' ') {
        let ink = 0;
        for (let y = 0; y < glyph.h; y++) {
            for (let x = 0; x < glyph.w; x++) ink += alpha[(glyph.y + y) * font.width + glyph.x + x];
        }
        assert.ok(ink > 0, 'glyph has no actual ink: ' + character);
    }
});
const strings = ['Ø 84.2 km/h', 'Ø 52.3 mph', 'Ø 659.0 km/h', 'Ø 409.4 mph',
    'Ø -- km/h', 'Ø -- mph', '\uE000 29.02.24', '\uE000 2024-12-31', '\uE000 12/31/2024',
    '\uE001 28.2 mpg', '\uE001 10.0 km/l', '\uE001 10.0 l/100km',
    '\uE003\uE001 4094 km', '\uE003\uE001 2544 mi', '+86.5 °C', '-40 °C', '+188 °F', '11:59 pm', '23:59'];
// Extremes of each accepted raw economy unit, converted to every supported
// preference, are longer than typical readings and must still fit the widget.
['l/100km', 'mpg_uk', 'mpg_us', 'km/l'].forEach((source) => {
    [0.1, 409.4].forEach((value) => {
        ['l/100km', 'mpg_uk', 'mpg_us', 'km/l'].forEach((unit) => {
            strings.push('\uE001 ' + infoFormat.consumption({ value, unit: source }, unit));
        });
    });
});
let widest = { text: '', width: 0 };
const inkTotal = (mask) => { let total = 0; for (const value of mask) total += value; return total; };
strings.forEach((text) => {
    for (const character of text) assert.ok(font.glyphs[character], 'display string has missing glyph: ' + text);
    const width = raster.measure(text, 'f82_info', 0);
    assert.ok(width <= 250, 'info string exceeds250px: ' + text + ' (' + width + ')');
    if (width > widest.width) widest = { text, width };
    const displayed = raster.mask(250, 30, text, { font: 'f82_info', align: 'center' });
    const roomy = raster.mask(1000, 30, text, { font: 'f82_info', align: 'center' });
    assert.ok(inkTotal(displayed) > 0);
    assert.strictEqual(inkTotal(displayed), inkTotal(roomy), 'actual glyph ink clipped: ' + text);
});
console.log('F8X info font: all glyphs have ink and stable metrics; ' + strings.length +
    ' real display/extreme-conversion strings fit250px without clipping. Widest: ' + widest.text + ' (' + widest.width + 'px).');
