'use strict';

const { Transform } = require('stream');
const tokenRegex = /\/v4\/auth\/token {.*}/g;

module.exports = new Transform({
    transform(chunk, encoding, callback) {
        callback(null, chunk.toString().replace(tokenRegex, '/v4/auth/token {}'));
    }
});
