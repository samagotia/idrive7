# Critical-input delivery review

The RPM reader already requests only `statusEngineSpeed2` every 10 ms, with at most one outstanding getter and a 500 ms read timeout. Notifications deliver directly to the car state; they do not wait for a separate 50 ms input timer. Speed backup reads now run every 50 ms instead of 500 ms, in addition to notifications. Only the essential speed field is polled at this cadence; noncritical fields retain their existing schedules. These intervals do not establish the provider's real update rate or the instrument display's frame rate.

## Changes

The speed getter backup now checks at 20 requests per second when responses are prompt, bounded to one outstanding request. This reduces the configured wait to the next backup opportunity from at most 500 ms to at most 50 ms; it does not shorten the getter's network round trip or increase the provider's own sampling rate. The request timeout remains 500 ms.

An unchanged decoded critical value no longer copies and emits the entire vehicle sample merely to wake the needle renderer again. Actual RPM/speed changes still emit synchronously when the provider response or notification arrives. The renderer's own motion loop continues any motion already in progress.

Every valid response still updates critical freshness and `lastCar`, including stationary zeros. Invalid samples, missing providers, the 1500 ms dropout rule, one-pending-getter limit and newer-notification precedence are unchanged.

## Local evidence

`bench/test-f8x-rpm-acquisition.js` uses the real signal helper and vehicle class, with a simulated clock/provider. It checks getter-only speed changes at the next 50 ms opportunity, exactly 20 speed reads over a one-second interval, immediate changed-notification delivery for both fields, ignored duplicate render wakeups, stationary freshness across 180 fast RPM polls and 36 speed reads, one pending getter per field, stale/invalid recovery and late response/notification shutdown. `bench/test-f8x-signal-lifecycle.js` also passes.

This reduces redundant app work when getters repeatedly return the same value. It is not a measured improvement in G82 input latency or instrument FPS. The speed backup now has a shorter configured discovery interval, but no connected-car measurement establishes the delivered signal cadence, network latency or GPU frame rate.
