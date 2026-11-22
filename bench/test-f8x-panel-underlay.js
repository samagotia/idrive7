'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const backing = require('../shared/f8x_panel_backing');
const shaders = require('../shared/f8x_shaders');
const { ClusterRender } = require('../shared/cluster_render_client');
const root = path.resolve(__dirname, '..');
const moduleStub = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_runtime.js'), 'utf8'), {
    module: moduleStub, Buffer, Date,
    require(name) { return name === './f8x_shaders' ? shaders : {}; },
});
const wire = [];
const client = new ClusterRender('panel-underlay-test', '/tmp/no-car');
client.connected = client.ready = true;
client.sock = { write(bytes) { wire.push(Buffer.from(bytes)); return true; } };
const runtime = Object.assign(Object.create(moduleStub.exports.prototype), {
    widgets: new Map(), theme: {}, target: 'panel', _connOf: () => 0, _clientAt: () => client,
    _update() {}, log: { warn(message) { throw new Error(message); } },
});
const widget = backing.widget();
runtime._create(widget, null);
assert.equal(wire.length, 1, 'underlay is a single command, without image or uniform upload');
assert.equal(wire[0][4], 0x4a);
const message = JSON.parse(wire[0].subarray(5));
assert.equal(message.op, 'layer'); assert.equal(message.kind, 'effect');
assert.equal(message.target, 'panel');
assert.deepEqual([message.x, message.y, message.w, message.h], [0, 0, 1920, 720]);
assert.equal(message.class, 'ambient'); assert.equal(message.z, -1);
assert.equal(message.exclusive, undefined);
assert.equal(message.time, undefined, 'the floor needs no animation clock');
assert.equal(message.fs, backing.FS);
assert.equal(client.layers.get(message.ref).image, undefined, 'no initially transparent image buffer');
assert.equal(runtime.widgets.size, 1, 'the floor participates in normal widget cleanup');
client.drop(message.ref);
assert.equal(client.layers.size, 0);
assert.equal(JSON.parse(wire[1].subarray(5)).op, 'drop');
console.log('F8X panel underlay: actual runtime/client create a full-panel ambient effect without pixels, exclusivity or animation; normal layer cleanup releases it.');
