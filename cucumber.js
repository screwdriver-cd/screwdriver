'use strict';

const common = {
    paths: ['features'],
    retry: 2,
    failFast: true,
    forceExit: true,
    format: ['progress'],
    dryRun: true
};

const parallel = {
    ...common,
    parallel: 4
};

module.exports = {
    default: common,
    banner: {
        ...common,
        tags: '(not @ignore) and (not @prod) and @banner'
    },
    prod: {
        ...common,
        tags: '(not @ignore) and @prod'
    },
    beta: {
        ...common,
        tags: '(not @ignore) and (not @prod) and (not @x1) and (not @parallel)'
    },
    'beta-parallel': {
        ...parallel,
        tags: '(not @ignore) and (not @prod) and (not @x1) and @parallel'
    },
    'beta-x1-parallel': {
        ...parallel,
        tags: '(not @ignore) and (not @prod) and @x1 and @parallel'
    },
    dev: {
        ...common,
        tags: '(not @ignore) and (not @prod)'
    }
};
