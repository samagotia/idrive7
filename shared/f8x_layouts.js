'use strict';
// SPDX-License-Identifier: MIT
// Adapted from Cluster Themes, Copyright (c) 2026 bimmer-lab. See LICENSE and NOTICE.
const fs = require('fs');
const path = require('path');
const data = require('./f8x_data');
const sprites = require('./f82_sprite');

const REQUIRED = { f82sprite: ['asset'], atext: ['font', 'text'] };
const CLASSES = ['ambient', 'content', 'overlay', 'alert'];

class F8xLayouts {
    constructor(dataDir, log, size) {
        this.dir = path.join(dataDir, 'layouts');
        this.log = log;
        this.size = size || [1920, 720];
        this.listeners = [];
        this.watcher = null;
        this.timer = null;
        try {
            if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir);
            this.watcher = fs.watch(this.dir, { persistent: false }, () => {
                clearTimeout(this.timer);
                this.timer = setTimeout(() => this.listeners.forEach((fn) => fn()), 300);
            });
        } catch (error) {
            log.warn('Layout edits will take effect after restart: ' + error.message);
        }
    }

    load(name) {
        if (!/^[a-z0-9_-]+$/i.test(String(name))) throw new Error('Invalid layout name');
        const file = path.join(this.dir, name + '.json');
        const layout = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8'))
            : data.json('layouts/' + name + '.json');
        this._validate(layout, name);
        return layout;
    }

    _validate(layout, name) {
        const fail = (message) => { throw new Error('Layout "' + name + '": ' + message); };
        if (!layout || layout.schemaVersion !== 2 || !Array.isArray(layout.widgets)) fail('invalid schema');
        const ids = new Set();
        layout.widgets.forEach((widget) => {
            if (!widget.id || ids.has(widget.id)) fail('widget IDs must be unique');
            ids.add(widget.id);
            const fields = REQUIRED[widget.type];
            if (!fields) fail('unsupported widget ' + widget.type);
            fields.forEach((field) => { if (widget[field] === undefined) fail(widget.id + ' needs ' + field); });
            ['x', 'y', 'w', 'h'].forEach((key) => {
                if (!Number.isFinite(widget[key]) || widget[key] < 0) fail(widget.id + ' has invalid ' + key);
            });
            if (!widget.w || !widget.h || widget.x + widget.w > this.size[0] || widget.y + widget.h > this.size[1]) {
                fail(widget.id + ' extends beyond the panel');
            }
            if (widget.class && CLASSES.indexOf(widget.class) < 0) fail('invalid layer class');
            if (widget.exclusive) fail('exclusive layers hide other display content');
            if (widget.conn !== undefined && (!Number.isInteger(widget.conn) || widget.conn < 0 || widget.conn > 3)) {
                fail('invalid renderer connection');
            }
            if (widget.type === 'f82sprite') sprites.validate(widget);
        });
    }

    onChange(fn) { this.listeners.push(fn); }
    close() {
        clearTimeout(this.timer);
        if (this.watcher) this.watcher.close();
        this.watcher = null;
        this.listeners = [];
    }
}

module.exports = F8xLayouts;
