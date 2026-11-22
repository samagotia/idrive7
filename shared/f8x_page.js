'use strict';
// SPDX-License-Identifier: MIT
// Adapted from bimmer-lab's Cluster Themes settings page, Copyright (c) 2026 bimmer-lab.
// The original copyright and licences are retained in LICENSE and NOTICE.
const G = require('./kit/gauges');
const themes = require('./kit/themes');
const { listSheet } = require('./kit/sheet');
const f82Sprite = require('./f82_sprite');

const WIDTH = 1600, HEIGHT = 520;
const CONTENT_X = 300, CONTENT_WIDTH = 1284;
const COLOURS = {
    background: '#05070a', text: '#eef2f8', muted: '#8a96a8', line: '#ffffff12',
    blue: '#2b7fff', blueLight: '#5aa2ff', card: '#ffffff08',
};
const TABS = [['designs', 'Designs'], ['readouts', 'Readouts'], ['settings', 'Settings'], ['vehicle', 'Vehicle']];
const GENERAL_SETTINGS = ['units', 'f8xBacklightColour', 'f8xBrakeStyle', 'consumptionUnits', 'clockSource', 'clock', 'timeZone', 'tankLitres', 'f8xLimitSource', 'f82Redline', 'shiftBefore'];

Object.assign(themes.THEMES.m_tricolour, {
    sel: COLOURS.blue, selText: '#ffffff', accent2: COLOURS.blueLight, bg: COLOURS.background,
});

class F8xPage {
    constructor(ctx, runtime) {
        this.ctx = ctx;
        this.runtime = runtime;
        this.tab = 'designs';
        this.loop = null;
    }

    start() {
        this.loop = this.ctx.loop('MAIN', 10, () => this.render());
        this.ctx.settings.onChange(() => this.kick());
        this.ctx.onLayout(() => this.kick());
        this.runtime.onStatus(() => this.kick());
        this.render();
    }

    kick() { if (this.loop && this.loop.kick) this.loop.kick(); }
    get(key) { return this.runtime.setting(key); }
    item(key) { return this.ctx.settings.item(key); }
    set(key, value) {
        if (this.ctx.settings.get(key) !== value) this.ctx.settings.set(key, value);
        this.kick();
    }

    valueText(key, value) {
        if (value === undefined) value = this.get(key);
        const item = this.item(key);
        if (!item) return '';
        if (item.type === 'bool') return value ? 'On' : 'Off';
        if (key === 'timeZone') return timeZoneText(value);
        if (item.type === 'number') return String(value) + (item.unit ? ' ' + item.unit : '');
        const option = (item.options || []).find((entry) => entry[0] === value);
        return option ? option[1] : String(value);
    }

    openSetting(key) {
        const original = this.item(key);
        if (!original) return;
        if (original.type === 'bool') {
            this.set(key, !this.get(key));
            return;
        }
        const item = Object.assign({}, original);
        if (key === 'f82InfoPage') {
            item.options = f82Sprite.infoPageOptions(item.options, this.get('f82DigitalSpeed'));
        }
        if (key === 'timeZone') {
            item.labels = {};
            item.steps.forEach((value) => { item.labels[String(value)] = timeZoneText(value); });
        }
        const settings = {
            schema: [item],
            get: (name) => this.get(name),
            set: (name, value) => this.set(name, value),
            display: (name) => this.valueText(name),
            cycle: (name) => this.ctx.settings.cycle(name),
        };
        const sheet = listSheet(settings, item.label);
        sheet.open = item;
        const values = item.type === 'choice' ? item.options.map((option) => option[0]) : item.steps;
        sheet.sub = Math.max(0, values.indexOf(this.get(key)));
        const choose = sheet.choose.bind(sheet);
        sheet.choose = () => { choose(); return 'close'; };
        sheet.back = () => 'close';
        sheet.onClose = () => this.kick();
        this.ctx.sheet(sheet);
    }

    render() {
        const cv = this.ctx.canvas(WIDTH, HEIGHT);
        const bottom = G.pageBottom(cv);
        cv.clear(COLOURS.background);
        const active = this.runtime.activeName && this.runtime.activeName !== 'off';
        G.frame(cv, this.ctx.theme(), [], -1, [
            { text: active ? 'F8X ON' : 'BMW CLUSTER', color: active ? '#7fd3a0' : COLOURS.muted },
        ]);
        this.drawTabs(cv, bottom);
        if (this.tab === 'designs') this.drawDesigns(cv);
        if (this.tab === 'readouts') this.drawReadouts(cv);
        if (this.tab === 'settings') this.drawSettings(cv);
        if (this.tab === 'vehicle') this.drawVehicle(cv);
        if (this.tab !== 'readouts') cv.text(this.runtime.rpmLimitStatus(), CONTENT_X, bottom - 36, 18,
            COLOURS.muted, { literal: true });
        if (this.tab === 'settings') cv.text(this.runtime.rpmLimitDetails(), CONTENT_X, bottom - 62, 15,
            COLOURS.muted, { literal: true });
        cv.text(fitText(cv, this.runtime.lastStatus || '', CONTENT_WIDTH, 15),
            CONTENT_X, bottom - 6, 15, COLOURS.muted, { literal: true });
        return this.ctx.ui.image('MAIN_GFX', cv);
    }

    drawTabs(cv, bottom) {
        cv.fillRect(283, 50, 1, bottom - 56, COLOURS.line);
        TABS.forEach(([id, title], index) => {
            const x = 16, y = 54 + index * 74, width = 252, height = 66;
            const selected = this.tab === id;
            cv.roundRect(x, y, width, height, 12, selected ? '#163a70' : COLOURS.card);
            cv.text(title, x + 22, y + 40, 23, selected ? '#ffffff' : COLOURS.text,
                { font: 'bold', literal: true });
            cv.target(x, y, width, height, () => { this.tab = id; this.kick(); }, 'tab:' + id, 12);
        });
    }

    drawDesigns(cv) {
        cv.text('Cluster design', CONTENT_X, 74, 26, COLOURS.text, { font: 'bold', literal: true });
        const options = this.item('hudLayout').options;
        const gap = 20, width = (CONTENT_WIDTH - gap) / 2;
        options.forEach(([value, label], index) => {
            const x = CONTENT_X + index * (width + gap), y = 100, height = 180;
            const selected = this.get('hudLayout') === value;
            cv.roundRect(x, y, width, height, 16, selected ? '#102d52' : COLOURS.card);
            cv.strokeRoundRect(x, y, width, height, 16, selected ? 2 : 1,
                selected ? COLOURS.blueLight : COLOURS.line);
            const title = value === 'off' ? 'BMW cluster' : label;
            cv.text(title, x + 26, y + 76, 36, COLOURS.text, { font: 'bold', literal: true });
            cv.text(selected ? 'Selected' : 'Select', x + 26, y + 120, 21,
                selected ? COLOURS.blueLight : COLOURS.muted, { literal: true });
            cv.target(x, y, width, height, () => this.set('hudLayout', value), 'design:' + value, 16);
        });
    }

    drawReadouts(cv) {
        cv.text('F8X readouts', CONTENT_X, 74, 26, COLOURS.text, { font: 'bold', literal: true });
        const keys = ['f82DistanceUnits', 'f82DigitalSpeed', 'f82ShowGearInD', 'f82InfoPage', 'f82Footer'];
        if (this.get('f82InfoPage') === 'date') keys.push('f82DateFormat');
        keys.forEach((key, index) => this.drawSetting(cv, key, CONTENT_X, 92 + index * 58, CONTENT_WIDTH));
        cv.text(fitText(cv, this.runtime.infoStatus(), CONTENT_WIDTH, 15), CONTENT_X, 460, 15, COLOURS.muted, { literal: true });
    }

    drawVehicle(cv) {
        cv.text('Vehicle diagram', CONTENT_X, 74, 26, COLOURS.text, { font: 'bold', literal: true });
        ['f8xVehicleLayout', 'f8xSteeringSide'].forEach((key, index) => this.drawSetting(cv, key, CONTENT_X, 92 + index * 66, CONTENT_WIDTH));
        cv.text(this.runtime.doorStatusText(), CONTENT_X, 265, 20, COLOURS.muted, { literal: true });
        cv.text('Automatic uses the car model and steering position. Override only if needed.', CONTENT_X, 310, 19, COLOURS.muted, { literal: true });
        cv.text('BMW warning popups keep priority over this display.', CONTENT_X, 345, 19, COLOURS.muted, { literal: true });
    }

    drawSettings(cv) {
        cv.text('Settings', CONTENT_X, 74, 26, COLOURS.text, { font: 'bold', literal: true });
        const gap = 24, width = (CONTENT_WIDTH - gap) / 2;
        GENERAL_SETTINGS.filter((key) => (key !== 'f82Redline' || this.get('f8xLimitSource') === 'manual')
            && (key !== 'timeZone' || this.get('clockSource') === 'system'))
            .forEach((key, index) => this.drawSetting(cv, key,
            CONTENT_X + (index % 2) * (width + gap), 92 + Math.floor(index / 2) * 58, width));
    }

    drawSetting(cv, key, x, y, width) {
        const item = this.item(key);
        if (!item || item.hidden) return;
        const height = 54;
        cv.roundRect(x, y, width, height, 12, COLOURS.card);
        cv.text(item.label, x + 18, y + 34, 19, COLOURS.text, { literal: true });
        cv.text(this.valueText(key), x + width - 22, y + 34, 19, COLOURS.blueLight,
            { align: 'right', font: 'bold', literal: true });
        cv.target(x, y, width, height, () => this.openSetting(key), 'setting:' + key, 12);
    }
}

function timeZoneText(value) {
    if (value === -9999 || typeof value !== 'number') return 'Automatic';
    if (value === 0) return 'UTC';
    const absolute = Math.abs(value), hours = Math.floor(absolute / 60), minutes = absolute % 60;
    return 'UTC' + (value < 0 ? '-' : '+') + hours + (minutes ? ':' + (minutes < 10 ? '0' : '') + minutes : '');
}

function fitText(cv, text, width, size) {
    text = String(text);
    if (cv.textWidth(text, size) <= width) return text;
    while (text.length > 1 && cv.textWidth(text + '...', size) > width) text = text.slice(0, -1);
    return text + '...';
}

module.exports = F8xPage;
