import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import * as toast from './services/toast'

// Toast auto-dismiss schedules real timers. Clear the store after every test so
// a pending toast (e.g. from a hook test that triggers setStatus) can't leak
// its timer into a later test and cause flakes.
afterEach(() => toast.clearAll())
