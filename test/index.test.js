/* eslint-disable global-require */
'use strict';
const chai = require('chai');
const Assert = chai.assert;
const mockery = require('mockery');
const sinon = require('sinon');

sinon.assert.expose(chai.assert, { prefix: '' });
describe('Index Unit Test Case', () => {
    let main;
    let mocks;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(() => {
        mocks = {
            listener: sinon.stub(),
            server: sinon.stub()
        };
        mockery.registerMock('./lib/server', mocks.server);

        main = require('../index');
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    it('optionally accepts no additional plugins', (done) => {
        mocks.server.yieldsAsync(null);
        mocks.server.returns(mocks.listener);

        const result = main((err) => {
            Assert.isNull(err);
            Assert.calledWith(mocks.server, []);
            Assert.deepEqual(result, mocks.listener);
            done();
        });
    });

    it('calls the server with the appropriate args', (done) => {
        mocks.server.yieldsAsync(null);
        mocks.server.returns(mocks.listener);

        const result = main(['abc'], (err) => {
            Assert.isNull(err);
            Assert.calledWith(mocks.server, ['abc']);
            Assert.deepEqual(result, mocks.listener);
            done();
        });
    });

    it('returns an error when starting the server', (done) => {
        mocks.server.yieldsAsync(new Error('someErrorMessage'));

        main([], (err) => {
            Assert.strictEqual(err.message, 'someErrorMessage');
            done();
        });
    });
});
