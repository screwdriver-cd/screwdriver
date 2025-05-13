'use strict';

const chai = require('chai');
const { assert } = chai;
const rewire = require('rewire');

const RewiredUpdateBuildHelper = rewire('../../plugins/builds/helper/updateBuild.js');

describe('deriveEventStatusFromBuildStatuses function', () => {
    const deriveEventStatusFromBuildStatuses = RewiredUpdateBuildHelper.__get__('deriveEventStatusFromBuildStatuses');

    const BUILD_ABORTED = { status: 'ABORTED' };
    const BUILD_CREATED = { status: 'CREATED' };
    const BUILD_FAILURE = { status: 'FAILURE' };
    const BUILD_QUEUED = { status: 'QUEUED' };
    const BUILD_RUNNING = { status: 'RUNNING' };
    const BUILD_SUCCESS = { status: 'SUCCESS' };
    const BUILD_BLOCKED = { status: 'BLOCKED' };
    const BUILD_UNSTABLE = { status: 'UNSTABLE' };
    const BUILD_COLLAPSED = { status: 'COLLAPSED' };
    const BUILD_FROZEN = { status: 'FROZEN' };

    describe('all builds completed', () => {
        it('should return event status as SUCCESS when builds are not ABORTED/FAILURE', () => {
            const expectedStatus = 'SUCCESS';

            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_SUCCESS]), expectedStatus);
            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_SUCCESS, BUILD_COLLAPSED]), expectedStatus);
            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_SUCCESS, BUILD_UNSTABLE]), expectedStatus);
            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_SUCCESS, BUILD_CREATED]), expectedStatus);
        });

        it('should return event status as ABORTED when at least one build is ABORTED', () => {
            const expectedStatus = 'ABORTED';

            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_ABORTED]), expectedStatus);
            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_ABORTED, BUILD_FAILURE]), expectedStatus);
            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_ABORTED, BUILD_SUCCESS]), expectedStatus);
            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_ABORTED, BUILD_COLLAPSED]), expectedStatus);
            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_ABORTED, BUILD_UNSTABLE]), expectedStatus);
            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_ABORTED, BUILD_CREATED]), expectedStatus);
        });

        it('should return event status as FAILURE when at least one build is FAILURE and none ABORTED', () => {
            const expectedStatus = 'FAILURE';

            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_FAILURE]), expectedStatus);
            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_FAILURE, BUILD_SUCCESS]), expectedStatus);
            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_FAILURE, BUILD_COLLAPSED]), expectedStatus);
            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_FAILURE, BUILD_UNSTABLE]), expectedStatus);
            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_FAILURE, BUILD_CREATED]), expectedStatus);
        });
    });

    describe('one or more incomplete builds', () => {
        it('should return event status as null when all the builds are CREATED/COLLAPSED', () => {
            const expectedStatus = null;

            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_CREATED]), expectedStatus);
            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_COLLAPSED]), expectedStatus);
            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_CREATED, BUILD_COLLAPSED]), expectedStatus);
        });

        it('should return event status as IN_PROGRESS when one or more incomplete builds exists', () => {
            const expectedStatus = 'IN_PROGRESS';

            assert.equal(
                deriveEventStatusFromBuildStatuses([BUILD_QUEUED, BUILD_FROZEN, BUILD_RUNNING, BUILD_BLOCKED]),
                expectedStatus
            );

            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_QUEUED]), expectedStatus);
            assert.equal(
                deriveEventStatusFromBuildStatuses([
                    BUILD_QUEUED,
                    BUILD_ABORTED,
                    BUILD_CREATED,
                    BUILD_FAILURE,
                    BUILD_SUCCESS,
                    BUILD_COLLAPSED,
                    BUILD_UNSTABLE
                ]),
                expectedStatus
            );

            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_FROZEN]), expectedStatus);
            assert.equal(
                deriveEventStatusFromBuildStatuses([
                    BUILD_FROZEN,
                    BUILD_ABORTED,
                    BUILD_CREATED,
                    BUILD_FAILURE,
                    BUILD_SUCCESS,
                    BUILD_COLLAPSED,
                    BUILD_UNSTABLE
                ]),
                expectedStatus
            );

            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_RUNNING]), expectedStatus);
            assert.equal(
                deriveEventStatusFromBuildStatuses([
                    BUILD_RUNNING,
                    BUILD_ABORTED,
                    BUILD_CREATED,
                    BUILD_FAILURE,
                    BUILD_SUCCESS,
                    BUILD_COLLAPSED,
                    BUILD_UNSTABLE
                ]),
                expectedStatus
            );

            assert.equal(deriveEventStatusFromBuildStatuses([BUILD_BLOCKED]), expectedStatus);
            assert.equal(
                deriveEventStatusFromBuildStatuses([
                    BUILD_BLOCKED,
                    BUILD_ABORTED,
                    BUILD_CREATED,
                    BUILD_FAILURE,
                    BUILD_SUCCESS,
                    BUILD_COLLAPSED,
                    BUILD_UNSTABLE
                ]),
                expectedStatus
            );
        });
    });
});
