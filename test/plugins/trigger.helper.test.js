'use strict';

const chai = require('chai');
const { assert } = chai;
const sinon = require('sinon');
const rewire = require('rewire');
const logger = require('screwdriver-logger');
const { Status, BUILD_STATUS_MESSAGES } = require('../../plugins/builds/triggers/helpers');

const RewiredTriggerHelper = rewire('../../plugins/builds/triggers/helpers.js');

describe('createJoinObject function', () => {
    const createJoinObject = RewiredTriggerHelper.__get__('createJoinObject');
    let eventFactoryMock;

    beforeEach(() => {
        eventFactoryMock = {
            get: sinon.stub()
        };
    });

    afterEach(() => {
        sinon.restore();
    });

    it('should create join object for internal jobs', async () => {
        const nextJobNames = ['jobC'];
        const current = {
            build: { id: 1 },
            event: {
                workflowGraph: {
                    nodes: [
                        { name: '~commit' },
                        { name: 'jobA', id: 11 },
                        { name: 'jobB', id: 12 },
                        { name: 'jobC', id: 13 }
                    ],
                    edges: [
                        { src: '~commit', dest: 'jobA' },
                        { src: '~commit', dest: 'jobB' },
                        { src: 'jobA', dest: 'jobC', join: true },
                        { src: 'jobB', dest: 'jobC', join: true }
                    ]
                }
            },
            pipeline: { id: 1 }
        };

        const result = await createJoinObject(nextJobNames, current, eventFactoryMock);

        const expected = {
            1: {
                jobs: {
                    jobC: {
                        id: 13,
                        join: [
                            { id: 11, name: 'jobA' },
                            { id: 12, name: 'jobB' }
                        ],
                        isExternal: false
                    }
                }
            }
        };

        assert.deepEqual(result, expected);
    });

    it('should create join object for external jobs', async () => {
        const nextJobNames = ['sd@1:jobD'];
        const current = {
            pipeline: { id: 2 },
            build: {
                parentBuilds: {
                    1: { eventId: 101, jobs: { jobA: 10001 } },
                    2: { eventId: 202, jobs: { jobB: 20002 } }
                }
            },
            event: {
                workflowGraph: {
                    nodes: [
                        { name: 'jobB', id: 22 },
                        { name: 'jobC', id: 23 },
                        { name: 'sd@1:jobD', id: 14 }
                    ],
                    edges: [
                        { src: 'jobB', dest: 'sd@1:jobD', join: true },
                        { src: 'jobC', dest: 'sd@1:jobD', join: true }
                    ]
                }
            }
        };
        const workflowGraph = {
            nodes: [
                { name: 'jobA', id: 11 },
                { name: 'sd@2:jobB', id: 22 },
                { name: 'sd@2:jobC', id: 23 },
                { name: 'jobD', id: 14 }
            ],
            edges: [
                { src: 'jobA', dest: 'sd@2:jobB' },
                { src: 'jobA', dest: 'sd@2:jobC' },
                { src: 'sd@2:jobB', dest: 'jobD', join: true },
                { src: 'sd@2:jobC', dest: 'jobD', join: true }
            ]
        };

        eventFactoryMock.get.withArgs(101).resolves({
            workflowGraph
        });
        const result = await createJoinObject(nextJobNames, current, eventFactoryMock);

        const expected = {
            1: {
                event: {
                    workflowGraph
                },
                jobs: {
                    jobD: {
                        id: 14,
                        join: [
                            { id: 22, name: 'sd@2:jobB' },
                            { id: 23, name: 'sd@2:jobC' }
                        ],
                        isExternal: true
                    }
                }
            }
        };

        assert.deepEqual(result, expected);
    });

    it('should handle jobs with no join conditions', async () => {
        const nextJobNames = ['jobB', 'jobC'];
        const current = {
            pipeline: { id: 1 },
            build: { id: 10001 },
            event: {
                workflowGraph: {
                    nodes: [
                        { name: '~commit' },
                        { name: 'jobA', id: 11 },
                        { name: 'jobB', id: 12 },
                        { name: 'jobC', id: 13 }
                    ],
                    edges: [
                        { src: '~commit', dest: 'jobA' },
                        { src: 'jobA', dest: 'jobB' },
                        { src: 'jobA', dest: 'jobC' }
                    ]
                }
            }
        };

        const result = await createJoinObject(nextJobNames, current, eventFactoryMock);

        const expected = {
            1: {
                jobs: {
                    jobB: { id: 12, join: [], isExternal: false },
                    jobC: { id: 13, join: [], isExternal: false }
                }
            }
        };

        assert.deepEqual(result, expected);
    });

    it('should create join object for a stage job', async () => {
        const nextJobNames = ['jobC'];
        const current = {
            build: { id: 1 },
            event: {
                workflowGraph: {
                    nodes: [
                        { name: '~commit' },
                        { name: 'jobA', id: 11 },
                        { name: 'jobB', id: 12 },
                        { name: 'jobC', id: 13, virtual: true, stageName: 'red' }
                    ],
                    edges: [
                        { src: '~commit', dest: 'jobA' },
                        { src: '~commit', dest: 'jobB' },
                        { src: 'jobA', dest: 'jobC', join: true },
                        { src: 'jobB', dest: 'jobC', join: true }
                    ]
                }
            },
            pipeline: { id: 1 }
        };

        const result = await createJoinObject(nextJobNames, current, eventFactoryMock);

        const expected = {
            1: {
                jobs: {
                    jobC: {
                        id: 13,
                        join: [
                            { id: 11, name: 'jobA' },
                            { id: 12, name: 'jobB' }
                        ],
                        isExternal: false
                    }
                }
            }
        };

        assert.deepEqual(result, expected);
    });
});

describe('trimJobName function', () => {
    const trimJobName = RewiredTriggerHelper.__get__('trimJobName');
    const jobName = 'jobA';

    it('should handle commit job', () => {
        assert.equal(trimJobName(jobName), jobName);
    });

    it('should handle pr job', () => {
        const prJobName = 'PR-1:jobA';

        assert.equal(trimJobName(prJobName), jobName);
    });
});

describe('extractCurrentPipelineJoinData function', () => {
    const extractCurrentPipelineJoinData = RewiredTriggerHelper.__get__('extractCurrentPipelineJoinData');

    const currentPipelineId = 1;

    it('should return an empty object if there is no data for the current pipeline', () => {
        const joinedPipelines = {
            2: {
                jobs: {
                    jobA: { id: 21, isExternal: false },
                    jobB: { id: 22, isExternal: true }
                }
            }
        };
        const result = extractCurrentPipelineJoinData(joinedPipelines, currentPipelineId);

        assert.deepEqual(result, {});
    });

    it('should return only non-external jobs for the current pipeline', () => {
        const joinedPipelines = {
            1: {
                jobs: {
                    jobA: { id: 11, isExternal: false },
                    jobB: { id: 12, isExternal: true },
                    jobC: { id: 13, isExternal: false }
                }
            },
            2: {
                jobs: {
                    jobD: { id: 21, isExternal: false }
                }
            }
        };
        const result = extractCurrentPipelineJoinData(joinedPipelines, currentPipelineId);

        const expected = {
            jobA: { id: 11, isExternal: false },
            jobC: { id: 13, isExternal: false }
        };

        assert.deepEqual(result, expected);
    });

    it('should return an empty object if all jobs are external for the current pipeline', () => {
        const joinedPipelines = {
            1: {
                jobs: {
                    jobA: { id: 11, isExternal: true },
                    jobB: { id: 12, isExternal: true }
                }
            }
        };
        const result = extractCurrentPipelineJoinData(joinedPipelines, currentPipelineId);

        assert.deepEqual(result, {});
    });

    it('should handle mixed pipelines correctly', () => {
        const joinedPipelines = {
            1: {
                jobs: {
                    jobA: { id: 11, isExternal: false },
                    jobB: { id: 12, isExternal: true }
                }
            },
            2: {
                jobs: {
                    jobC: { id: 21, isExternal: false },
                    jobD: { id: 22, isExternal: true }
                }
            }
        };
        const result = extractCurrentPipelineJoinData(joinedPipelines, currentPipelineId);

        const expected = {
            jobA: { id: 11, isExternal: false }
        };

        assert.deepEqual(result, expected);
    });

    it('should handle empty join data', () => {
        const joinedPipelines = {
            1: {
                jobs: {}
            }
        };
        const result = extractCurrentPipelineJoinData(joinedPipelines, currentPipelineId);

        assert.deepEqual(result, {});
    });
});

describe('parseJobInfo function', () => {
    const parseJobInfo = RewiredTriggerHelper.__get__('parseJobInfo');

    const currentPipeline = { id: 1 };

    it('should return correct parentBuilds and joinListNames for basic case', () => {
        const joinObj = { jobE: { join: [{ name: 'jobC' }, { name: 'jobD' }] } };
        const currentBuild = {
            id: 10003,
            eventId: 101,
            parentBuilds: { 1: { eventId: 101, jobs: { jobA: 10001, jobB: 10002 } } }
        };
        const currentJob = { name: 'jobC' };
        const nextJobName = 'jobE';

        const result = parseJobInfo({ joinObj, currentBuild, currentPipeline, currentJob, nextJobName });

        const expected = {
            parentBuilds: {
                1: {
                    eventId: 101,
                    jobs: { jobA: 10001, jobB: 10002, jobC: 10003, jobD: null }
                }
            },
            joinListNames: ['jobC', 'jobD']
        };

        assert.deepEqual(result, expected);
    });

    it('should handle empty joinObj', () => {
        const joinObj = {};
        const currentBuild = {
            id: 10003,
            eventId: 101,
            parentBuilds: { 1: { eventId: 1, jobs: { jobA: 10001, jobB: 10002 } } }
        };
        const currentJob = { name: 'jobC' };
        const nextJobName = 'jobD';

        const result = parseJobInfo({ joinObj, currentBuild, currentPipeline, currentJob, nextJobName });

        const expected = {
            parentBuilds: {
                1: {
                    eventId: 101,
                    jobs: { jobA: 10001, jobB: 10002, jobC: 10003 }
                }
            },
            joinListNames: []
        };

        assert.deepEqual(result, expected);
    });

    it('should handle empty joinObj and empty nextJobName', () => {
        const currentBuild = {
            id: 10003,
            eventId: 101,
            parentBuilds: { 1: { eventId: 1, jobs: { jobA: 10001, jobB: 10002 } } }
        };
        const currentJob = { name: 'jobC' };

        const result = parseJobInfo({ currentBuild, currentPipeline, currentJob });

        const expected = {
            parentBuilds: {
                1: {
                    eventId: 101,
                    jobs: { jobA: 10001, jobB: 10002, jobC: 10003 }
                }
            },
            joinListNames: []
        };

        assert.deepEqual(result, expected);
    });

    it('should return correct parentBuilds and joinListNames for triggering a exeternal pipeline', () => {
        const joinObj = { jobE: { join: [{ name: 'jobC' }, { name: 'jobD' }] } };
        const currentBuild = {
            id: 10003,
            eventId: 101,
            parentBuilds: { 1: { eventId: 101, jobs: { jobA: 10001, jobB: 10002 } } }
        };
        const currentJob = { name: 'jobC' };
        const nextJobName = 'jobE';
        const nextPipelineId = '2';

        const result = parseJobInfo({
            joinObj,
            currentBuild,
            currentPipeline,
            currentJob,
            nextJobName,
            nextPipelineId
        });

        const expected = {
            parentBuilds: {
                1: {
                    eventId: 101,
                    jobs: { jobA: 10001, jobB: 10002, jobC: 10003 }
                },
                2: {
                    eventId: null,
                    jobs: { jobC: null, jobD: null }
                }
            },
            joinListNames: ['jobC', 'jobD']
        };

        assert.deepEqual(result, expected);
    });
});

describe('isOrTrigger function', () => {
    const isOrTrigger = RewiredTriggerHelper.__get__('isOrTrigger');

    const workflowGraph = {
        edges: [
            { src: 'jobA', dest: 'jobB' },
            { src: 'jobA', dest: 'jobC' },
            { src: 'jobB', dest: 'jobD', join: true },
            { src: 'jobC', dest: 'jobD', join: true },
            { src: 'jobD', dest: 'jobG', join: true },
            { src: 'jobE', dest: 'jobG', join: true },
            { src: 'jobF', dest: 'jobG' }
        ]
    };

    it('should return true for a simple `OR` trigger', () => {
        const currentJobName = 'jobA';
        const nextJobName = 'jobB';

        assert.equal(isOrTrigger(workflowGraph, currentJobName, nextJobName), true);
    });

    it('should return false for a simple `AND` trigger', () => {
        const currentJobName = 'jobB';
        const nextJobName = 'jobD';

        assert.equal(isOrTrigger(workflowGraph, currentJobName, nextJobName), false);
    });

    it('should return true for `AND` trigger including `OR` trigger in dest job', () => {
        const currentJobName = 'jobD';
        const nextJobName = 'jobG';

        assert.equal(isOrTrigger(workflowGraph, currentJobName, nextJobName), false);
    });

    it('should return false for `OR` trigger including `AND` trigger in dest job', () => {
        const currentJobName = 'jobF';
        const nextJobName = 'jobG';

        assert.equal(isOrTrigger(workflowGraph, currentJobName, nextJobName), true);
    });
});

describe('getBuildsForGroupEvent function', () => {
    let buildFactoryMock;

    const getBuildsForGroupEvent = RewiredTriggerHelper.__get__('getBuildsForGroupEvent');

    beforeEach(() => {
        buildFactoryMock = {
            getLatestBuilds: sinon.stub()
        };
    });

    it('should parse build data correctly', async () => {
        const groupEventId = 101;

        buildFactoryMock.getLatestBuilds.resolves([
            {
                id: 10002,
                environment: { foo: 'bar' },
                parentBuilds: [{ 1: { eventId: '101', jobs: { jobA: '10001', jobB: '10002' } } }],
                stats: { hostname: 'example.com' },
                meta: { baz: 'foo' },
                parentBuildId: [10001, 10002]
            },
            {
                id: 10003,
                environment: '{ "foo": "bar" }',
                parentBuilds: '[{ "1": { "eventId": "101", "jobs": { "jobA": "10001", "jobB": "10002" } } }]',
                stats: '{ "hostname": "example.com" }',
                meta: '{ "baz": "foo" }',
                parentBuildId: [10001, 10002]
            },
            {
                id: 10004,
                environment: {},
                parentBuilds: [],
                stats: {},
                meta: {},
                parentBuildId: 10001
            },
            {
                id: 10005,
                environment: {},
                parentBuilds: [],
                stats: {},
                meta: {},
                parentBuildId: '10001'
            }
        ]);

        const result = await getBuildsForGroupEvent(groupEventId, buildFactoryMock);

        const expected = [
            {
                id: 10002,
                environment: { foo: 'bar' },
                parentBuilds: [{ 1: { eventId: '101', jobs: { jobA: '10001', jobB: '10002' } } }],
                stats: { hostname: 'example.com' },
                meta: { baz: 'foo' },
                parentBuildId: [10001, 10002]
            },
            {
                id: 10003,
                environment: { foo: 'bar' },
                parentBuilds: [{ 1: { eventId: '101', jobs: { jobA: '10001', jobB: '10002' } } }],
                stats: { hostname: 'example.com' },
                meta: { baz: 'foo' },
                parentBuildId: [10001, 10002]
            },
            {
                id: 10004,
                environment: {},
                parentBuilds: [],
                stats: {},
                meta: {},
                parentBuildId: [10001]
            },
            {
                id: 10005,
                environment: {},
                parentBuilds: [],
                stats: {},
                meta: {},
                parentBuildId: [10001]
            }
        ];

        assert.deepEqual(result, expected);
    });
});

describe('getParallelBuilds function', () => {
    let eventFactoryMock;

    const getParallelBuilds = RewiredTriggerHelper.__get__('getParallelBuilds');

    beforeEach(() => {
        eventFactoryMock = {
            list: sinon.stub()
        };
    });

    it('should get parallel builds correctly', async () => {
        const parentEventId = 101;
        const pipelineId = 1;

        const parallelEvent1 = {
            pipelineId: 1, // This one should be filtered out
            getBuilds: sinon.stub().resolves([{ id: 1 }, { id: 2 }])
        };
        const parallelEvent2 = {
            pipelineId: 2,
            getBuilds: sinon.stub().resolves([{ id: 3 }, { id: 4 }])
        };
        const parallelEvent3 = {
            pipelineId: 3,
            getBuilds: sinon.stub().resolves([{ id: 5 }])
        };

        eventFactoryMock.list.resolves([parallelEvent1, parallelEvent2, parallelEvent3]);

        const result = await getParallelBuilds({ eventFactory: eventFactoryMock, parentEventId, pipelineId });

        const expected = [{ id: 3 }, { id: 4 }, { id: 5 }];

        assert.deepEqual(result, expected);
    });
});

describe('getSameParentEvents function', () => {
    let eventFactoryMock;

    const getSameParentEvents = RewiredTriggerHelper.__get__('getSameParentEvents');

    beforeEach(() => {
        eventFactoryMock = {
            list: sinon.stub()
        };
    });

    it('should get same parent events correctly', async () => {
        const parentEventId = 101;
        const pipelineId = 1;

        const sameParentEvent1 = {
            pipelineId: 1,
            parentEventId: 101
        };
        const sameParentEvent2 = {
            pipelineId: 2,
            parentEventId: 101
        };

        eventFactoryMock.list.resolves([sameParentEvent1, sameParentEvent2]);

        const result = await getSameParentEvents({ eventFactory: eventFactoryMock, parentEventId, pipelineId });

        const expected = [{ pipelineId: 1, parentEventId: 101 }];

        assert.deepEqual(result, expected);
    });
});

describe('mergeParentBuilds function', () => {
    let loggerWarnStub;

    beforeEach(() => {
        loggerWarnStub = sinon.stub(logger, 'warn');
    });

    afterEach(() => {
        sinon.restore();
    });

    const mergeParentBuilds = RewiredTriggerHelper.__get__('mergeParentBuilds');

    it('should merge parent builds correctly when builds are present', () => {
        const parentBuilds = {
            1: {
                jobs: {
                    jobA: 1001,
                    jobB: null
                },
                eventId: 101
            }
        };
        const relatedBuilds = [{ id: 2001, jobId: 11, eventId: 202 }];
        const currentEvent = {
            id: 1,
            pipelineId: 1,
            workflowGraph: {
                nodes: [
                    { name: 'jobA', id: 10 },
                    { name: 'jobB', id: 11 }
                ]
            }
        };
        const nextEvent = null;

        const result = mergeParentBuilds(parentBuilds, relatedBuilds, currentEvent, nextEvent);

        const expected = {
            1: {
                jobs: {
                    jobA: 1001,
                    jobB: 2001
                },
                eventId: 202
            }
        };

        assert.deepEqual(result, expected);
    });

    it('should handle external pipeline builds correctly', () => {
        const parentBuilds = {
            1: {
                jobs: {
                    'sd@1:jobC': null
                },
                eventId: 102
            }
        };
        const relatedBuilds = [{ id: 3001, jobId: 21, eventId: 203 }];
        const currentEvent = {
            id: 2,
            pipelineId: 2,
            workflowGraph: {
                nodes: [{ name: '~commit' }, { name: 'jobA', id: 10 }],
                edges: [
                    { src: '~commit', dest: 'jobA' },
                    { src: 'jobA', dest: 'sd@1:jobC' }
                ]
            },
            startFrom: '~commit'
        };
        const nextEvent = {
            id: 3,
            pipelineId: 1,
            workflowGraph: {
                nodes: [{ name: 'sd@1:jobC', id: 21 }],
                edges: [{ src: 'sd@2:jobA', dest: 'sd@1:jobC' }]
            },
            startFrom: '~sd@2:jobA'
        };

        const result = mergeParentBuilds(parentBuilds, relatedBuilds, currentEvent, nextEvent);

        const expected = {
            1: {
                jobs: {
                    'sd@1:jobC': 3001
                },
                eventId: 203
            }
        };

        assert.deepEqual(result, expected);
    });

    it('should log a warning if job is not found in workflowGraph', () => {
        const parentBuilds = {
            1: {
                jobs: {
                    jobA: null
                },
                eventId: 101
            }
        };
        const relatedBuilds = [];
        const currentEvent = {
            id: 1,
            pipelineId: 1,
            workflowGraph: {
                nodes: []
            }
        };
        const nextEvent = null;

        const result = mergeParentBuilds(parentBuilds, relatedBuilds, currentEvent, nextEvent);

        const expected = {
            1: {
                jobs: {
                    jobA: null
                },
                eventId: 101
            }
        };

        assert.deepEqual(result, expected);
        sinon.assert.calledOnceWithMatch(loggerWarnStub, 'Job jobA:1 not found in workflowGraph for event 1');
    });

    it('should log a warning if job is not found in builds', () => {
        const parentBuilds = {
            1: {
                jobs: {
                    jobA: null
                },
                eventId: 101
            }
        };
        const relatedBuilds = [{ id: 2001, jobId: 11, eventId: 202 }];
        const currentEvent = {
            id: 1,
            pipelineId: 1,
            workflowGraph: {
                nodes: [{ name: 'jobA', id: 10 }]
            }
        };
        const nextEvent = null;

        const expected = {
            1: {
                jobs: {
                    jobA: null
                },
                eventId: 101
            }
        };

        assert.deepEqual(mergeParentBuilds(parentBuilds, relatedBuilds, currentEvent, nextEvent), expected);
        sinon.assert.calledOnceWithMatch(loggerWarnStub, 'Job jobA:1 not found in builds');
    });
});

describe('createInternalBuild function', () => {
    let jobFactoryMock;
    let buildFactoryMock;

    const createInternalBuild = RewiredTriggerHelper.__get__('createInternalBuild');

    beforeEach(() => {
        jobFactoryMock = {
            get: sinon.stub()
        };
        buildFactoryMock = {
            create: sinon.stub()
        };
    });

    afterEach(() => {
        sinon.restore();
    });

    it('should create a build when job is enabled', async () => {
        const config = {
            jobFactory: jobFactoryMock,
            buildFactory: buildFactoryMock,
            pipelineId: 1,
            jobName: 'main',
            username: 'user1',
            scmContext: 'github:github.com',
            event: {
                id: 1,
                sha: 'abc123',
                configPipelineSha: 'def456',
                pr: {}
            },
            parentBuilds: {},
            start: true,
            baseBranch: 'master',
            parentBuildId: 100,
            jobId: 1
        };

        const job = {
            id: 1,
            state: Status.ENABLED,
            parsePRJobName: sinon.stub().returns('main')
        };

        jobFactoryMock.get.resolves(job);
        buildFactoryMock.create.resolves({ id: 200 });

        const result = await createInternalBuild(config);

        assert.deepEqual(result, { id: 200 });
        sinon.assert.calledOnce(buildFactoryMock.create);
        sinon.assert.calledWith(buildFactoryMock.create, {
            jobId: 1,
            sha: 'abc123',
            parentBuildId: 100,
            parentBuilds: {},
            eventId: 1,
            username: 'user1',
            configPipelineSha: 'def456',
            scmContext: 'github:github.com',
            prRef: '',
            prSource: '',
            prInfo: '',
            start: true,
            baseBranch: 'master',
            causeMessage: undefined
        });
    });

    it('should not create a build when job is disabled', async () => {
        const job = {
            id: 1,
            state: Status.DISABLED,
            parsePRJobName: sinon.stub().returns('main')
        };

        jobFactoryMock.get.resolves(job);

        const config = {
            jobFactory: jobFactoryMock,
            buildFactory: buildFactoryMock,
            pipelineId: 1,
            jobName: 'main',
            username: 'user1',
            scmContext: 'github:github.com',
            event: {
                id: 1,
                sha: 'abc123',
                configPipelineSha: 'def456',
                pr: {}
            },
            parentBuilds: {},
            start: true,
            baseBranch: 'master',
            parentBuildId: 100,
            jobId: 1
        };

        const result = await createInternalBuild(config);

        assert.isNull(result);
        sinon.assert.notCalled(buildFactoryMock.create);
    });

    it('should handle PR jobs correctly', async () => {
        const job = {
            id: 1,
            state: Status.ENABLED,
            parsePRJobName: sinon.stub().returns('main')
        };

        const originalJob = {
            id: 2,
            state: Status.ENABLED
        };

        jobFactoryMock.get.withArgs(1).resolves(job);
        jobFactoryMock.get.withArgs({ name: 'main', pipelineId: 1 }).resolves(originalJob);
        buildFactoryMock.create.resolves({ id: 200 });

        const prConfig = {
            jobFactory: jobFactoryMock,
            buildFactory: buildFactoryMock,
            pipelineId: 1,
            jobName: 'PR-1:main',
            username: 'user1',
            scmContext: 'github:github.com',
            event: {
                id: 1,
                sha: 'abc123',
                configPipelineSha: 'def456',
                pr: {
                    ref: 'refs/pull/1/head',
                    prSource: 'fork',
                    prBranchName: 'feature-branch',
                    url: 'https://github.com/repo/pull/1'
                }
            },
            parentBuilds: {},
            start: true,
            baseBranch: 'master',
            parentBuildId: 100,
            jobId: 1
        };

        const result = await createInternalBuild(prConfig);

        assert.deepEqual(result, { id: 200 });
        sinon.assert.calledOnce(buildFactoryMock.create);
        sinon.assert.calledWith(buildFactoryMock.create, {
            jobId: 1,
            sha: 'abc123',
            parentBuildId: 100,
            parentBuilds: {},
            eventId: 1,
            username: 'user1',
            configPipelineSha: 'def456',
            scmContext: 'github:github.com',
            prRef: 'refs/pull/1/head',
            prSource: 'fork',
            prInfo: {
                url: 'https://github.com/repo/pull/1',
                prBranchName: 'feature-branch'
            },
            start: true,
            baseBranch: 'master',
            causeMessage: undefined
        });
    });
});

describe('updateParentBuilds function', () => {
    let nextBuildMock;

    const updateParentBuilds = RewiredTriggerHelper.__get__('updateParentBuilds');

    beforeEach(() => {
        nextBuildMock = {
            update: sinon.stub().resolvesThis()
        };
    });

    afterEach(() => {
        sinon.restore();
    });

    it('should update parent builds and return updated next build', async () => {
        const joinParentBuilds = {
            1: {
                eventId: 101,
                jobs: {
                    jobA: 1001
                }
            }
        };
        const nextBuild = {
            parentBuilds: {
                2: {
                    eventId: 102,
                    jobs: {
                        jobB: 1002
                    }
                }
            },
            parentBuildId: [2001],
            update: nextBuildMock.update
        };
        const build = {
            id: 3001
        };

        const expectedParentBuilds = {
            1: {
                eventId: 101,
                jobs: {
                    jobA: 1001
                }
            },
            2: {
                eventId: 102,
                jobs: {
                    jobB: 1002
                }
            }
        };

        const result = await updateParentBuilds({ joinParentBuilds, nextBuild, build });

        assert.deepEqual(result.parentBuilds, expectedParentBuilds);
        sinon.assert.calledOnce(nextBuildMock.update);
    });
});

describe('getParentBuildStatus function', () => {
    const getParentBuildStatus = RewiredTriggerHelper.__get__('getParentBuildStatus');

    it('should return done and no failure when all parent builds are successful', async () => {
        const joinListNames = ['jobA', 'jobB'];
        const joinBuilds = {
            jobA: { status: Status.SUCCESS },
            jobB: { status: Status.SUCCESS }
        };

        const result = await getParentBuildStatus({
            joinListNames,
            joinBuilds
        });

        assert.deepEqual(result, { hasFailure: false, done: true });
    });

    it('should return not done and no failure when some parent builds are not executed', async () => {
        const joinListNames = ['jobA', 'jobB'];
        const joinBuilds = {
            jobA: { status: Status.SUCCESS }
        };

        const result = await getParentBuildStatus({
            joinListNames,
            joinBuilds
        });

        assert.deepEqual(result, { hasFailure: false, done: false });
    });

    it('should return done and has failure when any parent build has failed', async () => {
        const joinListNames = ['jobA', 'jobB'];
        const joinBuilds = {
            jobA: { status: Status.SUCCESS },
            jobB: { status: Status.FAILURE }
        };

        const result = await getParentBuildStatus({
            joinListNames,
            joinBuilds
        });

        assert.deepEqual(result, { hasFailure: true, done: true });
    });

    it('should handle external triggers correctly', async () => {
        const joinListNames = ['jobA', 'sd@2:jobB'];
        const joinBuilds = {
            jobA: { status: Status.SUCCESS },
            'sd@2:jobB': { status: Status.SUCCESS }
        };

        const result = await getParentBuildStatus({
            joinListNames,
            joinBuilds
        });

        assert.deepEqual(result, { hasFailure: false, done: true });
    });

    it('should return not done and no failure when some parent builds are in progress', async () => {
        const joinListNames = ['jobA', 'jobB'];
        const joinBuilds = {
            jobA: { status: Status.SUCCESS },
            jobB: { status: Status.IN_PROGRESS }
        };

        const result = await getParentBuildStatus({
            joinListNames,
            joinBuilds
        });

        assert.deepEqual(result, { hasFailure: false, done: false });
    });
});

describe('handleNewBuild function', () => {
    const handleNewBuild = RewiredTriggerHelper.__get__('handleNewBuild');
    const joinListNames = ['a'];

    let newBuildMock;
    let jobMock;
    let eventMock;
    let buildFactoryMock;

    beforeEach(() => {
        newBuildMock = {
            id: 123,
            status: Status.CREATED,
            eventId: 456,
            parentBuilds: { 123: { jobs: { a: 1 } } },
            update: sinon.stub().resolves(),
            start: sinon.stub().resolvesThis(),
            remove: sinon.stub().resolves()
        };

        jobMock = {
            id: 23,
            name: 'main',
            permutations: [{}]
        };

        eventMock = {};

        buildFactoryMock = {
            get: sinon.stub().resolves({ status: Status.SUCCESS })
        };

        sinon.stub(logger, 'info');
    });

    afterEach(() => {
        sinon.restore();
    });

    it('should return null if not done', async () => {
        buildFactoryMock.get.resolves({ status: Status.RUNNING });

        const result = await handleNewBuild({
            joinListNames,
            newBuild: newBuildMock,
            job: jobMock,
            pipelineId: 123,
            event: eventMock,
            buildFactory: buildFactoryMock
        });

        assert.isNull(result);
        sinon.assert.notCalled(newBuildMock.update);
        sinon.assert.notCalled(newBuildMock.start);
        sinon.assert.notCalled(newBuildMock.remove);
    });

    it('should return null if new build is already started', async () => {
        newBuildMock.status = Status.RUNNING;

        const result = await handleNewBuild({
            joinListNames,
            newBuild: newBuildMock,
            job: jobMock,
            pipelineId: 123,
            event: eventMock,
            buildFactory: buildFactoryMock
        });

        assert.isNull(result);
        assert.strictEqual(newBuildMock.status, Status.RUNNING);
        sinon.assert.notCalled(newBuildMock.update);
        sinon.assert.notCalled(newBuildMock.start);
        sinon.assert.notCalled(newBuildMock.remove);
    });

    it('should remove new build if there is a failure and it is not a stage teardown job', async () => {
        buildFactoryMock.get.resolves({ status: Status.FAILURE });

        const result = await handleNewBuild({
            joinListNames,
            newBuild: newBuildMock,
            job: jobMock,
            pipelineId: 123,
            stage: { name: 'deploy' },
            event: eventMock,
            buildFactory: buildFactoryMock
        });

        assert.isNull(result);
        sinon.assert.calledOnce(newBuildMock.remove);
        sinon.assert.notCalled(newBuildMock.update);
        sinon.assert.notCalled(newBuildMock.start);
        sinon.assert.calledOnce(logger.info);
    });

    it('should not remove new build if there is a failure and it is a stage teardown job', async () => {
        jobMock.name = 'stage@deploy:teardown';
        buildFactoryMock.get.resolves({ status: Status.FAILURE });

        const result = await handleNewBuild({
            joinListNames,
            newBuild: newBuildMock,
            job: jobMock,
            pipelineId: 123,
            stageName: 'deploy',
            event: eventMock,
            buildFactory: buildFactoryMock
        });

        assert.isNull(result);
        sinon.assert.notCalled(newBuildMock.remove);
        sinon.assert.notCalled(newBuildMock.update);
        sinon.assert.notCalled(newBuildMock.start);
        sinon.assert.notCalled(logger.info);
    });

    it('should start new build if all join builds finished successfully', async () => {
        const result = await handleNewBuild({
            joinListNames,
            newBuild: newBuildMock,
            job: jobMock,
            pipelineId: 123,
            event: eventMock,
            buildFactory: buildFactoryMock
        });

        assert.strictEqual(result.status, Status.QUEUED);
        sinon.assert.calledOnce(newBuildMock.update);
        sinon.assert.calledOnce(newBuildMock.start);
    });

    it('should skip the execution of virtual job and mark the build as successful', async () => {
        await handleNewBuild({
            joinListNames,
            newBuild: newBuildMock,
            job: jobMock,
            pipelineId: 123,
            isVirtualJob: true,
            event: eventMock,
            buildFactory: buildFactoryMock
        });

        assert.strictEqual(newBuildMock.status, Status.SUCCESS);
        assert.strictEqual(newBuildMock.statusMessage, BUILD_STATUS_MESSAGES.SKIP_VIRTUAL_JOB.statusMessage);
        assert.strictEqual(newBuildMock.statusMessageType, BUILD_STATUS_MESSAGES.SKIP_VIRTUAL_JOB.statusMessageType);
        sinon.assert.calledOnce(newBuildMock.update);
        sinon.assert.notCalled(newBuildMock.start);
    });

    it('should skip the execution of virtual job when freeze windows is empty', async () => {
        jobMock.permutations[0].freezeWindows = [];

        await handleNewBuild({
            joinListNames,
            newBuild: newBuildMock,
            job: jobMock,
            pipelineId: 123,
            isVirtualJob: true,
            event: eventMock,
            buildFactory: buildFactoryMock
        });

        assert.strictEqual(newBuildMock.status, Status.SUCCESS);
        sinon.assert.calledOnce(newBuildMock.update);
        sinon.assert.notCalled(newBuildMock.start);
    });

    it('should add virtual job to the execution queue when the job has freeze windows', async () => {
        jobMock.permutations[0].freezeWindows = ['* 10-21 ? * *'];

        await handleNewBuild({
            joinListNames,
            newBuild: newBuildMock,
            job: jobMock,
            pipelineId: 123,
            isVirtualJob: true,
            event: eventMock,
            buildFactory: buildFactoryMock
        });

        assert.strictEqual(newBuildMock.status, Status.QUEUED);
        sinon.assert.calledOnce(newBuildMock.update);
        sinon.assert.calledOnce(newBuildMock.start);
    });
});

describe('extractExternalJoinData function', () => {
    const extractExternalJoinData = RewiredTriggerHelper.__get__('extractExternalJoinData');

    it('should extract external join data for mixed pipelines', () => {
        const joinedPipelines = {
            1: {
                jobs: {
                    jobA: { id: 11, isExternal: false },
                    jobB: { id: 12, isExternal: true },
                    jobC: { id: 13, isExternal: false }
                },
                event: { id: 101 }
            },
            2: {
                jobs: {
                    jobD: { id: 21, isExternal: true }
                },
                event: { id: 102 }
            },
            3: {
                jobs: {
                    jobE: { id: 31, isExternal: true },
                    jobF: { id: 32, isExternal: true }
                },
                event: { id: 103 }
            }
        };
        const currentPipelineId = 1;

        const expected = {
            1: {
                jobs: {
                    jobB: { id: 12, isExternal: true }
                },
                event: { id: 101 }
            },
            2: {
                jobs: {
                    jobD: { id: 21, isExternal: true }
                },
                event: { id: 102 }
            },
            3: {
                jobs: {
                    jobE: { id: 31, isExternal: true },
                    jobF: { id: 32, isExternal: true }
                },
                event: { id: 103 }
            }
        };

        const result = extractExternalJoinData(joinedPipelines, currentPipelineId);

        assert.deepEqual(result, expected);
    });

    it('should return an empty object if there are no external jobs', () => {
        const joinedPipelines = {
            1: {
                jobs: {
                    jobA: { id: 11, isExternal: false },
                    jobB: { id: 12, isExternal: false }
                },
                event: { id: 101 }
            }
        };
        const currentPipelineId = 1;

        const expected = {};

        const result = extractExternalJoinData(joinedPipelines, currentPipelineId);

        assert.deepEqual(result, expected);
    });
});

describe('strToInt function', () => {
    const strToInt = RewiredTriggerHelper.__get__('strToInt');

    it('should convert a valid integer string to an integer', () => {
        const result = strToInt('123');

        assert.strictEqual(result, 123);
    });

    it('should convert a valid negative integer string to an integer', () => {
        const result = strToInt('-123');

        assert.strictEqual(result, -123);
    });

    it('should throw an error for a non-numeric string', () => {
        assert.throws(() => strToInt('abc'), Error, "Failed to cast 'abc' to integer");
    });

    it('should throw an error for an empty string', () => {
        assert.throws(() => strToInt(''), Error, "Failed to cast '' to integer");
    });

    it('should throw an error for a string with only spaces', () => {
        assert.throws(() => strToInt('   '), Error, "Failed to cast '   ' to integer");
    });
});

describe('buildsToRestartFilter function', () => {
    const buildsToRestartFilter = RewiredTriggerHelper.__get__('buildsToRestartFilter');

    it('should filter out builds that are in CREATED status', () => {
        const joinPipeline = {
            jobs: {
                jobA: { id: 1 }
            }
        };
        const groupEventBuilds = [{ jobId: 1, status: Status.CREATED, parentBuildId: [], eventId: 100 }];
        const currentEvent = { parentEventId: 99 };
        const currentBuild = { id: 3 };

        const result = buildsToRestartFilter(joinPipeline, groupEventBuilds, currentEvent, currentBuild);

        assert.deepEqual(result, []);
    });

    it('should filter out builds that have the current build as a parent', () => {
        const joinPipeline = {
            jobs: {
                jobA: { id: 1 }
            }
        };
        const groupEventBuilds = [{ jobId: 1, status: Status.SUCCESS, parentBuildId: [3], eventId: 100 }];
        const currentEvent = { parentEventId: 99 };
        const currentBuild = { id: 3 };

        const result = buildsToRestartFilter(joinPipeline, groupEventBuilds, currentEvent, currentBuild);

        assert.deepEqual(result, []);
    });

    it('should filter out builds that are triggered from the parent event', () => {
        const joinPipeline = {
            jobs: {
                jobA: { id: 1 },
                jobB: { id: 2 }
            }
        };
        const groupEventBuilds = [
            { jobId: 1, status: Status.SUCCESS, parentBuildId: [], eventId: 100 },
            { jobId: 2, status: Status.SUCCESS, parentBuildId: [], eventId: 99 }
        ];
        const currentEvent = { parentEventId: 99 };
        const currentBuild = { id: 3 };

        const result = buildsToRestartFilter(joinPipeline, groupEventBuilds, currentEvent, currentBuild);

        assert.deepEqual(result, [{ jobId: 1, status: Status.SUCCESS, parentBuildId: [], eventId: 100 }]);
    });

    it('should return builds that need to be restarted', () => {
        const joinPipeline = {
            jobs: {
                jobA: { id: 1 },
                jobB: { id: 2 }
            }
        };
        const groupEventBuilds = [
            { jobId: 1, status: Status.SUCCESS, parentBuildId: [], eventId: 100 },
            { jobId: 2, status: Status.SUCCESS, parentBuildId: [], eventId: 100 }
        ];
        const currentEvent = { parentEventId: 99 };
        const currentBuild = { id: 3 };

        const result = buildsToRestartFilter(joinPipeline, groupEventBuilds, currentEvent, currentBuild);

        assert.deepEqual(result, [
            { jobId: 1, status: Status.SUCCESS, parentBuildId: [], eventId: 100 },
            { jobId: 2, status: Status.SUCCESS, parentBuildId: [], eventId: 100 }
        ]);
    });

    it('should handle no existing builds', () => {
        const joinPipeline = {
            jobs: {
                jobA: { id: 1 },
                jobB: { id: 2 }
            }
        };
        const groupEventBuilds = [];
        const currentEvent = { parentEventId: 99 };
        const currentBuild = { id: 3 };

        const result = buildsToRestartFilter(joinPipeline, groupEventBuilds, currentEvent, currentBuild);

        assert.deepEqual(result, []);
    });
});

describe('createEvent function', () => {
    const createEvent = RewiredTriggerHelper.__get__('createEvent');

    let pipelineFactoryMock;
    let eventFactoryMock;
    let scmMock;

    beforeEach(() => {
        scmMock = {
            getCommitSha: sinon.stub().resolves('commitSha123')
        };

        pipelineFactoryMock = {
            get: sinon.stub()
        };

        eventFactoryMock = {
            create: sinon.stub().resolves({ id: 123 }),
            scm: scmMock
        };
    });

    afterEach(() => {
        sinon.restore();
    });

    it('should create a new event with the correct payload', async () => {
        const pipelineMock = {
            id: 1,
            admin: {
                username: 'adminUser',
                unsealToken: sinon.stub().resolves('adminToken')
            },
            scmContext: 'github:github.com',
            scmUri: 'github.com:12345:master',
            configPipelineId: null
        };

        pipelineFactoryMock.get.resolves(pipelineMock);

        const config = {
            pipelineFactory: pipelineFactoryMock,
            eventFactory: eventFactoryMock,
            pipelineId: 1,
            startFrom: '~commit',
            causeMessage: 'triggered by 1234(buildId)',
            parentBuildId: 'build1234',
            parentBuilds: { 1: { eventId: 101, jobs: { jobA: 1001 } } },
            parentEventId: 101,
            groupEventId: 201
        };

        const expectedPayload = {
            pipelineId: 1,
            startFrom: '~commit',
            type: 'pipeline',
            causeMessage: 'triggered by 1234(buildId)',
            parentBuildId: 'build1234',
            scmContext: 'github:github.com',
            username: 'adminUser',
            sha: 'commitSha123',
            skipMessage: undefined,
            parentEventId: 101,
            parentBuilds: { 1: { eventId: 101, jobs: { jobA: 1001 } } },
            groupEventId: 201
        };

        await createEvent(config);

        sinon.assert.calledOnce(eventFactoryMock.create);
        sinon.assert.calledWith(eventFactoryMock.create, expectedPayload);
    });

    it('should create a new event with configPipelineSha if configPipelineId is set', async () => {
        const pipelineMock = {
            id: 1,
            admin: {
                username: 'adminUser',
                unsealToken: sinon.stub().resolves('adminToken')
            },
            scmContext: 'github:github.com',
            scmUri: 'github.com:12345:master',
            configPipelineId: 2
        };

        const configPipelineMock = {
            id: 2,
            admin: {
                username: 'configAdminUser',
                unsealToken: sinon.stub().resolves('configAdminToken')
            },
            scmContext: 'github:github.com',
            scmUri: 'github.com:67890:master'
        };

        pipelineFactoryMock.get.withArgs(1).resolves(pipelineMock);
        pipelineFactoryMock.get.withArgs(2).resolves(configPipelineMock);

        const config = {
            pipelineFactory: pipelineFactoryMock,
            eventFactory: eventFactoryMock,
            pipelineId: 1,
            startFrom: '~commit',
            causeMessage: 'triggered by 1234(buildId)',
            parentBuildId: 'build1234',
            parentBuilds: { 1: { eventId: 101, jobs: { jobA: 1001 } } },
            parentEventId: 101,
            groupEventId: 201
        };

        const expectedPayload = {
            pipelineId: 1,
            startFrom: '~commit',
            type: 'pipeline',
            causeMessage: 'triggered by 1234(buildId)',
            parentBuildId: 'build1234',
            scmContext: 'github:github.com',
            username: 'adminUser',
            sha: 'commitSha123',
            skipMessage: undefined,
            parentEventId: 101,
            parentBuilds: { 1: { eventId: 101, jobs: { jobA: 1001 } } },
            groupEventId: 201,
            configPipelineSha: 'commitSha123'
        };

        await createEvent(config);

        sinon.assert.calledOnce(eventFactoryMock.create);
        sinon.assert.calledWith(eventFactoryMock.create, expectedPayload);
    });

    it('should handle errors when creating a new event', async () => {
        const pipelineMock = {
            id: 1,
            admin: {
                username: 'adminUser',
                unsealToken: sinon.stub().resolves('adminToken')
            },
            scmContext: 'github:github.com',
            scmUri: 'github.com:12345:master',
            configPipelineId: null
        };

        pipelineFactoryMock.get.resolves(pipelineMock);
        eventFactoryMock.create.rejects(new Error('Failed to create event'));

        const config = {
            pipelineFactory: pipelineFactoryMock,
            eventFactory: eventFactoryMock,
            pipelineId: 1,
            startFrom: '~commit',
            causeMessage: 'triggered by 1234(buildId)',
            parentBuildId: 'build1234',
            parentBuilds: { 1: { eventId: 101, jobs: { jobA: 1001 } } },
            parentEventId: 101,
            groupEventId: 201
        };

        try {
            await createEvent(config);
            assert.fail('Expected error to be thrown');
        } catch (err) {
            assert.strictEqual(err.message, 'Failed to create event');
        }
    });
});

describe('createExternalEvent function', () => {
    const createExternalEvent = RewiredTriggerHelper.__get__('createExternalEvent');
    const createEvent = RewiredTriggerHelper.__get__('createEvent');
    let scmMock;
    let pipelineFactoryMock;
    let eventFactoryMock;

    const pipelineMock = {
        id: 1,
        admin: {
            username: 'adminUser',
            unsealToken: sinon.stub().resolves('adminToken')
        },
        scmContext: 'github:github.com',
        scmUri: 'github.com:12345:master',
        configPipelineId: null
    };

    beforeEach(() => {
        scmMock = {
            getCommitSha: sinon.stub().resolves('commitSha123')
        };

        pipelineFactoryMock = {
            get: sinon.stub()
        };

        pipelineFactoryMock.get.resolves(pipelineMock);

        eventFactoryMock = {
            create: sinon.stub().resolves({ id: 123, builds: [] }),
            scm: scmMock
        };

        sinon.stub(RewiredTriggerHelper, '__get__').withArgs('createEvent').returns(createEvent);
    });

    afterEach(() => {
        sinon.restore();
    });

    it('should create an external event with the correct payload', async () => {
        const config = {
            pipelineFactory: pipelineFactoryMock,
            eventFactory: eventFactoryMock,
            externalPipelineId: 1,
            startFrom: '~commit',
            skipMessage: 'skip this build',
            parentBuildId: 1234,
            parentBuilds: { 1: { eventId: 101, jobs: { jobA: 1001 } } },
            causeMessage: 'triggered by 1234(buildId)',
            parentEventId: 101,
            groupEventId: 201
        };

        const result = await createExternalEvent(config);

        const expectedPayload = {
            pipelineId: 1,
            scmContext: 'github:github.com',
            sha: 'commitSha123',
            type: 'pipeline',
            username: 'adminUser',
            startFrom: '~commit',
            skipMessage: 'skip this build',
            parentBuildId: 1234,
            causeMessage: 'triggered by 1234(buildId)',
            parentBuilds: { 1: { eventId: 101, jobs: { jobA: 1001 } } },
            parentEventId: 101,
            groupEventId: 201
        };

        assert.deepEqual(result, { id: 123, builds: [] });
        assert.isTrue(eventFactoryMock.create.calledOnce);
        assert.deepEqual(eventFactoryMock.create.firstCall.args[0], expectedPayload);
    });

    it('should create an external event without optional fields', async () => {
        const config = {
            pipelineFactory: pipelineFactoryMock,
            eventFactory: eventFactoryMock,
            externalPipelineId: 1,
            startFrom: '~commit',
            parentBuildId: 1234,
            parentBuilds: { 1: { eventId: 101, jobs: { jobA: 1001 } } },
            causeMessage: 'triggered by 1234(buildId)'
        };

        const result = await createExternalEvent(config);

        const expectedPayload = {
            pipelineId: 1,
            scmContext: 'github:github.com',
            sha: 'commitSha123',
            type: 'pipeline',
            username: 'adminUser',
            startFrom: '~commit',
            skipMessage: undefined,
            parentBuildId: 1234,
            causeMessage: 'triggered by 1234(buildId)',
            parentBuilds: { 1: { eventId: 101, jobs: { jobA: 1001 } } }
        };

        assert.deepEqual(result, { id: 123, builds: [] });
        assert.isTrue(eventFactoryMock.create.calledOnce);
        assert.deepEqual(eventFactoryMock.create.firstCall.args[0], expectedPayload);
    });

    it('should handle errors when creating an external event', async () => {
        eventFactoryMock.create.rejects(new Error('Failed to create event'));

        const config = {
            pipelineFactory: pipelineFactoryMock,
            eventFactory: eventFactoryMock,
            externalPipelineId: 1,
            startFrom: '~commit',
            parentBuildId: 1234,
            parentBuilds: { 1: { eventId: 101, jobs: { jobA: 1001 } } },
            causeMessage: 'triggered by 1234(buildId)'
        };

        try {
            await createExternalEvent(config);
            assert.fail('Expected error to be thrown');
        } catch (err) {
            assert.strictEqual(err.message, 'Failed to create event');
        }
    });
});

describe('getJoinBuilds', () => {
    const getJoinBuilds = RewiredTriggerHelper.__get__('getJoinBuilds');

    let buildFactoryMock;

    beforeEach(() => {
        buildFactoryMock = {
            get: sinon.stub(),
            remove: sinon.stub().resolves()
        };
    });

    afterEach(() => {
        sinon.restore();
    });

    it('should get existing builds in join lisnt', async () => {
        const build = {
            parentBuilds: {
                123: {
                    jobs: {
                        a: 1,
                        b: 2,
                        d: 4
                    }
                },
                456: {
                    jobs: {
                        e: 5
                    }
                }
            }
        };

        buildFactoryMock.get.withArgs(1).resolves({ id: 1, endTime: '2025-03-17T04:47:03.207Z' });
        buildFactoryMock.get.withArgs(2).resolves({ id: 2, endTime: '2025-03-18T04:47:03.207Z' });
        buildFactoryMock.get.withArgs(5).resolves({ id: 5, endTime: '2025-03-19T04:47:03.207Z' });

        const result = await getJoinBuilds({
            newBuild: build,
            joinListNames: ['a', 'b', 'c', 'sd@456:e'],
            pipelineId: 123,
            buildFactory: buildFactoryMock
        });

        assert.deepEqual(result, {
            a: { id: 1, endTime: new Date('2025-03-17T04:47:03.207Z') },
            b: { id: 2, endTime: new Date('2025-03-18T04:47:03.207Z') },
            'sd@456:e': { id: 5, endTime: new Date('2025-03-19T04:47:03.207Z') }
        });
    });
});

describe('deleteBuild function', () => {
    const deleteBuild = RewiredTriggerHelper.__get__('deleteBuild');
    const buildConfig = { id: 1 };

    let buildFactoryMock;

    beforeEach(() => {
        buildFactoryMock = {
            get: sinon.stub(),
            remove: sinon.stub().resolves()
        };
    });

    afterEach(() => {
        sinon.restore();
    });

    it('should delete the build if it is in CREATED status', async () => {
        const buildToDelete = {
            status: Status.CREATED,
            remove: sinon.stub().resolves()
        };

        buildFactoryMock.get.resolves(buildToDelete);

        await deleteBuild(buildConfig, buildFactoryMock);

        sinon.assert.calledOnceWithMatch(buildFactoryMock.get, buildConfig);
        sinon.assert.calledOnce(buildToDelete.remove);
    });

    it('should not delete the build if it is not in CREATED status', async () => {
        const buildToDelete = {
            status: Status.SUCCESS, // Not in CREATED status
            remove: sinon.stub()
        };

        buildFactoryMock.get.resolves(buildToDelete);

        await deleteBuild(buildConfig, buildFactoryMock);

        sinon.assert.calledOnceWithMatch(buildFactoryMock.get, buildConfig);
        sinon.assert.notCalled(buildToDelete.remove);
    });

    it('should return null if the build does not exist', async () => {
        buildFactoryMock.get.resolves(null); // Build does not exist

        await deleteBuild(buildConfig, buildFactoryMock);

        sinon.assert.calledOnceWithMatch(buildFactoryMock.get, buildConfig);
    });
});
