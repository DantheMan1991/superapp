# Postgres 18 with a clock the Date bombs guard can move.
#
# The guard (.github/workflows/date-bombs.yml, scripts/date-bombs.ts) runs the
# suite with the clock on the dates the tests write. Moving only the tests'
# clock is not enough: Postgres stamps rows with its own now(), and a test that
# compares such a row with JS time fails for no reason once the two disagree
# (12 did in #705's sweep). libfaketime moves this server's clock by the offset
# in /etc/faketime/offset, the same string the tests get as FAKE_NOW, so the
# two clocks move together.
#
# Postgres 18, as the suite's own CI job runs it, because Neon reports 18.4.
FROM postgres:18

RUN apt-get update \
 && apt-get install -y --no-install-recommends libfaketime \
 && rm -rf /var/lib/apt/lists/* \
 && ln -s "$(dpkg -L libfaketime | grep '/libfaketime\.so\.1$')" /usr/local/lib/libfaketime.so.1 \
 && test -e /usr/local/lib/libfaketime.so.1

# Every process in the container reads the offset: initdb, the server, and each
# backend it forks. No file means the real time.
#
#   FAKETIME_CACHE_DURATION=1       re-read the file within a second of a
#                                   change (the default is 10), so the guard
#                                   moves the clock between runs with no restart
#   FAKETIME_DONT_FAKE_MONOTONIC=1  only the wall clock moves; timeouts and
#                                   EXPLAIN timings keep the real monotonic one
#   FAKETIME_DISABLE_SHM=1          WITHOUT IT THE CONTAINER NEVER STARTS. By
#                                   default libfaketime shares a semaphore from
#                                   the first process down to its children,
#                                   named by its pid. The entrypoint runs as
#                                   root in pid 1, then gosu execs it again as
#                                   postgres in the same pid 1, which waits on
#                                   root's semaphore forever: a futex wait,
#                                   before bash even starts, and not a line of
#                                   log. A relative offset read from one file
#                                   needs nothing shared.
ENV LD_PRELOAD=/usr/local/lib/libfaketime.so.1 \
    FAKETIME_TIMESTAMP_FILE=/etc/faketime/offset \
    FAKETIME_CACHE_DURATION=1 \
    FAKETIME_DONT_FAKE_MONOTONIC=1 \
    FAKETIME_DISABLE_SHM=1
