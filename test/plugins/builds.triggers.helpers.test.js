const { assert } = require('chai');
const { getSubsequentJobs } = require('../../plugins/builds/triggers/helpers');

('use strict');

describe('getSubsequentJobs', () => {
    it('should return an empty array if startNode is not provided', () => {
        const workflowGraph = {
            nodes: [{ name: 'job1' }, { name: 'job2' }],
            edges: [{ src: 'job1', dest: 'job2' }]
        };

        const result = getSubsequentJobs(workflowGraph);

        assert.deepEqual(result, []);
    });

    it('should return an empty array if nodes are empty', () => {
        const workflowGraph = {
            nodes: [],
            edges: [{ src: 'job1', dest: 'job2' }]
        };

        const result = getSubsequentJobs(workflowGraph, 'job1');

        assert.deepEqual(result, []);
    });

    it('should return subsequent jobs correctly', () => {
        const workflowGraph = {
            nodes: [{ name: 'job1' }, { name: 'job2' }, { name: 'job3' }],
            edges: [
                { src: 'job1', dest: 'job2' },
                { src: 'job2', dest: 'job3' }
            ]
        };

        const result = getSubsequentJobs(workflowGraph, 'job1');

        assert.deepEqual(result, ['job2', 'job3']);
    });

    it('should handle circular dependencies gracefully', () => {
        const workflowGraph = {
            nodes: [{ name: 'job1' }, { name: 'job2' }, { name: 'job3' }],
            edges: [
                { src: 'job1', dest: 'job2' },
                { src: 'job2', dest: 'job3' },
                { src: 'job3', dest: 'job1' }
            ]
        };

        const result = getSubsequentJobs(workflowGraph, 'job1');

        assert.deepEqual(result, ['job2', 'job3']);
    });

    it('should handle jobs with tildes correctly', () => {
        const workflowGraph = {
            nodes: [{ name: '~job1' }, { name: 'job2' }, { name: 'job3' }],
            edges: [
                { src: '~job1', dest: 'job2' },
                { src: 'job2', dest: 'job3' }
            ]
        };

        const result = getSubsequentJobs(workflowGraph, '~job1');

        assert.deepEqual(result, ['job2', 'job3']);
    });

    it('should handle jobs with different start tildes correctly', () => {
        const workflowGraph = {
            nodes: [{ name: 'job1' }, { name: '~job2' }, { name: 'job3' }],
            edges: [
                { src: 'job1', dest: '~job2' },
                { src: '~job2', dest: 'job3' }
            ]
        };

        const result = getSubsequentJobs(workflowGraph, 'job1');

        assert.deepEqual(result, ['~job2', 'job3']);
    });
});
