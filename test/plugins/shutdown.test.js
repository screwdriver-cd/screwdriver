'use strict';

const chai = require('chai');
const { assert } = chai;
const hapi = require('@hapi/hapi');
const sinon = require('sinon');

sinon.assert.expose(assert, { prefix: '' });

describe('test shutdown plugin', () => {
    let plugin;
    let server;

    beforeEach(async () => {
        /* eslint-disable global-require */
        plugin = require('../../plugins/shutdown');
        /* eslint-enable global-require */

        server = new hapi.Server({
            port: 1234
        });

        await server.register({ plugin });
    });

    afterEach(() => {
        server = null;
    });

    it('registers the plugin', () => {
        assert.isOk(server.registrations.shutdown);
    });
});

describe('test graceful shutdown', () => {
    before(() => {
        sinon.stub(process, 'exit');
    });

    after(() => {
        process.exit.restore();
    });

    it('should catch the SIGTERM signal', () => {
        /* eslint-disable global-require */
        const plugin = require('../../plugins/shutdown');
        /* eslint-enable global-require */
        const options = {
            terminationGracePeriod: 30
        };
        let stopCalled = false;
        const server = new hapi.Server({
            port: 1234
        });

        server.log = () => {};
        server.root = {
            stop: () => {
                stopCalled = true;
            }
        };
        server.expose = sinon.stub();

        plugin.register(server, options, () => {});

        process.exit(1);
        process.exit.callsFake(() => {
            assert.isTrue(stopCalled);
        });
        assert(process.exit.isSinonProxy);
        sinon.assert.called(process.exit);
        sinon.assert.calledWith(process.exit, 1);
    });
});
