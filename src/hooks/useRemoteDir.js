import { useSyncExternalStore } from 'react'
import * as remoteFS from '../services/remoteFS'

export function useRemoteDir(connId, path) {
  return useSyncExternalStore(
    remoteFS.subscribe,
    () => remoteFS.getSnapshot(connId, path),
  )
}
