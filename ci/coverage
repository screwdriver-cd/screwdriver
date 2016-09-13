#!/bin/bash -e

echo Upload coverage to Coveralls
export CI_PULL_REQUEST=${SD_PULL_REQUEST}
export COVERALLS_SERVICE_NAME=screwdriver
cat ./artifacts/coverage/lcov.info | ./node_modules/.bin/coveralls
