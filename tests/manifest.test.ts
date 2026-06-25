import { Manifest } from '../src/adapters/adapter.interface'

/**
 * Extract the conflict detection logic from SyncService for testability.
 * These mirror the checks in upload() and checkAndPull().
 */

interface ConflictCheckInput {
  remoteManifest: Manifest | null
  lastSyncRevision: number
  localDeviceId: string
}

type ConflictResult = 'proceed' | 'adopt' | 'conflict'

function checkPushConflict(input: ConflictCheckInput): ConflictResult {
  const { remoteManifest, lastSyncRevision, localDeviceId } = input
  if (!remoteManifest || remoteManifest.revision <= lastSyncRevision) {
    return 'proceed'
  }
  if (remoteManifest.deviceId === localDeviceId) {
    return 'adopt' // stale cursor from same device, safe to proceed after adopting revision
  }
  return 'conflict'
}

function shouldAutoPull(input: ConflictCheckInput): boolean {
  const { remoteManifest, lastSyncRevision, localDeviceId } = input
  if (!remoteManifest) return false
  return remoteManifest.revision > lastSyncRevision && remoteManifest.deviceId !== localDeviceId
}

describe('manifest conflict logic', () => {
  const makeManifest = (revision: number, deviceId: string): Manifest => ({
    version: 1,
    revision,
    encrypted: true,
    deviceId,
    updatedAt: Date.now(),
    categories: {},
  })

  describe('checkPushConflict', () => {
    it('proceeds when no remote manifest', () => {
      expect(checkPushConflict({
        remoteManifest: null,
        lastSyncRevision: 0,
        localDeviceId: 'aaa',
      })).toBe('proceed')
    })

    it('proceeds when remote revision <= lastSyncRevision', () => {
      expect(checkPushConflict({
        remoteManifest: makeManifest(5, 'bbb'),
        lastSyncRevision: 5,
        localDeviceId: 'aaa',
      })).toBe('proceed')
    })

    it('adopts when remote is ahead but from same device', () => {
      expect(checkPushConflict({
        remoteManifest: makeManifest(10, 'aaa'),
        lastSyncRevision: 5,
        localDeviceId: 'aaa',
      })).toBe('adopt')
    })

    it('conflicts when remote is ahead from different device', () => {
      expect(checkPushConflict({
        remoteManifest: makeManifest(10, 'bbb'),
        lastSyncRevision: 5,
        localDeviceId: 'aaa',
      })).toBe('conflict')
    })

    it('proceeds when remote revision is lower (edge case: reset)', () => {
      expect(checkPushConflict({
        remoteManifest: makeManifest(3, 'bbb'),
        lastSyncRevision: 5,
        localDeviceId: 'aaa',
      })).toBe('proceed')
    })
  })

  describe('shouldAutoPull', () => {
    it('returns false when no remote manifest', () => {
      expect(shouldAutoPull({
        remoteManifest: null,
        lastSyncRevision: 0,
        localDeviceId: 'aaa',
      })).toBe(false)
    })

    it('returns false when remote is from same device', () => {
      expect(shouldAutoPull({
        remoteManifest: makeManifest(10, 'aaa'),
        lastSyncRevision: 5,
        localDeviceId: 'aaa',
      })).toBe(false)
    })

    it('returns true when remote is newer from different device', () => {
      expect(shouldAutoPull({
        remoteManifest: makeManifest(10, 'bbb'),
        lastSyncRevision: 5,
        localDeviceId: 'aaa',
      })).toBe(true)
    })

    it('returns false when already up to date', () => {
      expect(shouldAutoPull({
        remoteManifest: makeManifest(5, 'bbb'),
        lastSyncRevision: 5,
        localDeviceId: 'aaa',
      })).toBe(false)
    })
  })
})
