import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import * as toast from './services/toast'
import { resetLocalTrimAck } from './utils/localTrimConsent'

// Toast auto-dismiss schedules real timers. Clear the store after every test so
// a pending toast (e.g. from a hook test that triggers setStatus) can't leak
// its timer into a later test and cause flakes.
afterEach(() => toast.clearAll())

// The local-trim acknowledgement is deliberately module state so it outlives
// the per-file overlay. That also means it outlives a test, so a test that
// accepts the prompt would suppress it for every test after it.
afterEach(() => resetLocalTrimAck())
