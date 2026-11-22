'use strict';
// A write is not a protocol message: one stream write may contain a whole frame.
const assert = require('assert').strict;
function frames(writes) {
    const bytes = Buffer.concat(writes), out = [];
    for (let offset = 0; offset < bytes.length;) {
        assert(bytes.length - offset >= 5, 'complete renderer protocol header');
        const length = bytes.readUInt32LE(offset) + 4;
        assert(length >= 5 && offset + length <= bytes.length, 'complete renderer protocol body');
        out.push(bytes.slice(offset, offset + length)); offset += length;
    }
    return out;
}
module.exports = { frames };
