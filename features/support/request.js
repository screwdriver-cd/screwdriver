'use strict';

const request = require('request').defaults({ jar: true });

module.exports = options => new Promise((resolve, reject) => {
    request(options, (err, response) => {
        if (err) {
            return reject(err);
        }

        return resolve(response);
    });
});
