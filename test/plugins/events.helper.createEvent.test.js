'use strict';

const chai = require('chai');
const { assert } = chai;
const sinon = require('sinon');
const rewire = require('rewire');

const RewiredCreateEventHelper = rewire('../../plugins/events/helper/createEvent.js');
const createEvent = RewiredCreateEventHelper.__get__('createEvent');

describe('createEvent function', () => {
    let eventFactoryMock;
    let jobFactoryMock;

    beforeEach(() => {
        jobFactoryMock = {
            list: sinon.stub().resolves([])
        };
        eventFactoryMock = {
            create: sinon.stub()
        };
    });

    afterEach(() => {
        sinon.restore();
    });

    it('should mark the event as ABORTED when the event factory resolved null builds', async () => {
        const eventMock = {
            id: 124,
            status: 'CREATED',
            builds: null,
            update: sinon.stub().resolves({})
        };

        eventFactoryMock.create.resolves(eventMock);

        const result = await createEvent(
            { username: 'user', scmContext: 'github:github.com' },
            {
                app: {
                    eventFactory: eventFactoryMock,
                    jobFactory: jobFactoryMock
                }
            }
        );

        assert.equal(result.status, 'ABORTED');
        sinon.assert.calledOnce(eventMock.update);
    });

    it('should not touch the event status when builds were created', async () => {
        const buildMock = {
            id: 1,
            jobId: 10,
            status: 'CREATED'
        };
        const eventMock = {
            id: 125,
            status: 'CREATED',
            builds: [buildMock],
            workflowGraph: { nodes: [] },
            update: sinon.stub().resolves({})
        };

        eventFactoryMock.create.resolves(eventMock);

        const result = await createEvent(
            { username: 'user', scmContext: 'github:github.com' },
            {
                app: {
                    eventFactory: eventFactoryMock,
                    jobFactory: jobFactoryMock
                }
            }
        );

        assert.equal(result.status, 'CREATED');
        sinon.assert.notCalled(eventMock.update);
    });
});
