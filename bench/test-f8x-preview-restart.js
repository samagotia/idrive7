'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const vm = require('vm');
const EventEmitter = require('events');
const source = fs.readFileSync(require('path').join(__dirname, 'server.js'), 'utf8');
const handler = source.slice(source.indexOf('function restartApp(why)'), source.indexOf('[APP_DIR,', source.indexOf('function restartApp(why)')));
const timers = new Map();
let nextTimer = 1, starts = 0;
const apps = [];
const scope = { child: null, stopping: false, restarting: false, restartPending: false, restartTimer: null,
    log() {}, clearTimeout(id) { timers.delete(id); },
    setTimeout(fn, ms) { const id = nextTimer++; timers.set(id, {fn, ms}); return id; },
    startApp() {
        const app = new EventEmitter(); app.alive = true;
        app.kill = () => true;
        app.once('exit', () => { app.alive = false; });
        scope.child = app; apps.push(app); starts++;
    },
};
vm.createContext(scope); vm.runInContext(handler, scope);
scope.startApp();
const first = scope.child;
scope.restartApp('watcher');
for (let i = 0; i < 10; i++) scope.restartApp('button');
assert.equal(starts, 1, 'no second app before the old one exits');
first.emit('exit');
assert.equal(starts, 2);
assert.equal(apps.filter(a => a.alive).length, 1);
const queued = Array.from(timers.entries()).filter(([,t]) => t.ms === 300);
assert.equal(queued.length, 1, 'overlapping requests collapse to one queued restart');
const second = scope.child;
queued[0][1].fn();
assert.equal(starts, 2);
second.emit('exit');
assert.equal(starts, 3);
assert.equal(apps.filter(a => a.alive).length, 1, 'only one renderer client remains');
assert.equal(scope.restarting, false);
console.log('F8X preview restart: overlapping watcher/button requests never create duplicate app instances.');
