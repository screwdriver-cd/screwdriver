'use strict';

const good = require('good');
const suppressAPITokens = require('./tokens/filter');

module.exports = {
    register: good,
    options: {
        ops: {
            interval: 1000
        },
        reporters: {
            console: [{
                module: 'good-squeeze',
                name: 'Squeeze',
                args: [{ error: '*', log: '*', response: '*', request: '*' }]
            }, {
                module: 'good-console'
            }, suppressAPITokens, 'stdout']
        }
    }
};
