'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const EventEmitter = require('events');
const sockets = [], timers = new Map();
let nextTimer = 1;
class Socket extends EventEmitter {
    constructor() { super(); this.accept = true; this.writes = []; }
    write(bytes) { this.writes.push(Buffer.from(bytes)); return this.accept; }
    destroy() { this.emit('close'); }
}
const moduleStub = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../shared/cluster_render_client.js'), 'utf8'), {
    module: moduleStub, Buffer, process: { env: {} },
    require(name) {
        if (name === 'net') return { connect() { const socket = new Socket(); sockets.push(socket); return socket; } };
        if (name === 'events') return EventEmitter;
        throw new Error(name);
    },
    setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout: (id) => timers.delete(id),
}, { filename: 'cluster_render_client.js' });
const { ClusterRender } = moduleStub.exports;
const client = new ClusterRender('pose-pressure-test', '/tmp/no-car');
const first = client.image({ target: 'panel', x: 0, y: 0, w: 2, h: 2, iw: 2, ih: 2 });
const second = client.image({ target: 'panel', x: 10, y: 0, w: 2, h: 2, iw: 2, ih: 2 });
const video = client.video({ target: 'panel', x: 20, y: 0, w: 2, h: 2, vw: 2, vh: 2 });
const json = (socket) => socket.writes.filter((b) => b[4] === 0x4a).map((b) => JSON.parse(b.subarray(5)));
function connect() {
    const socket = sockets.at(-1);
    socket.emit('connect'); client._event({ ev: 'hello', backend: 'test' });
    return socket;
}
client.connect();
let socket = connect();
socket.writes.length = 0; socket.accept = false;
client.set(first, { rotate: 1 });
assert.equal(socket.writes.length, 1, 'the first blocked write is accepted into the socket buffer');
for (let i = 2; i <= 1000; i++) client.set(first, { rotate: i });
client.set(first, { opacity: 0.24 });
client.set(second, { rotate: 10, visible: true });
client.set(second, { rotate: 20 });
assert.equal(socket.writes.length, 1, 'blocked pose updates never append a stale command backlog');
assert.equal(client.pendingSets.size, 2, 'at most one merged pose is retained per layer');
assert.equal(client.layers.get(first).opts.rotate, 1000, 'reconnect cache always keeps the latest target');
client.pixels(first, null, Buffer.alloc(16, 31));
client.frame(video, Buffer.alloc(6, 71), 1);
socket.accept = true; socket.emit('drain');
const resumed = json(socket).filter((m) => m.op === 'set');
assert.deepEqual(resumed, [
    { op: 'set', ref: first, rotate: 1 },
    { op: 'set', ref: first, rotate: 1000, opacity: 0.24 },
    { op: 'set', ref: second, rotate: 20, visible: 1 },
]);
assert.equal(client.pendingSets.size, 0);
const frames = socket.writes.filter((b) => b[4] === 0x46);
assert.deepEqual(frames.map((b) => b.readUInt32LE(5)), [first, video], 'image-before-video frame order remains intact');

socket.writes.length = 0; socket.accept = false;
client.set(first, { rotate: 1001 });
client.set(first, { rotate: 1100 });
client.drop(first);
assert.equal(client.pendingSets.has(first), false, 'drop removes a queued pose');
socket.accept = true; socket.emit('drain');
assert.equal(json(socket).filter((m) => m.op === 'set').length, 1, 'drain never revives the dropped layer');

socket.accept = false;
client.set(second, { rotate: 30 });
client.set(second, { rotate: 99, opacity: 0.7 });
assert.equal(client.pendingSets.size, 1);
socket.emit('close');
assert.equal(client.pendingSets.size, 0, 'disconnect discards pending pose messages');
assert.equal(client.pendingFrames.size, 0);
const retry = [...timers.values()][0]; timers.clear(); retry();
socket = connect();
const replay = json(socket).find((m) => m.op === 'layer' && m.ref === second);
assert.equal(replay.rotate, 99, 'reconnect replays the latest cached pose, not intermediate targets');
assert.equal(replay.opacity, 0.7);
assert.equal(json(socket).some((m) => m.op === 'set'), false, 'stale pending poses do not follow reconnect replay');

socket.accept = false;
client.set(second, { rotate: 100 }); client.set(second, { rotate: 200 });
assert.equal(client.pendingSets.size, 1);
client.close();
assert.equal(client.pendingSets.size, 0, 'explicit close clears the coalescer');
assert.equal(client.connected, false);
assert.equal(timers.size, 0);
console.log('F8X client backpressure: latest merged poses, bounded queue, drain, frame ordering, drop, close and reconnect replay passed.');
