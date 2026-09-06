import { describe, expect, it } from 'vitest'
import { setPlatformForTests, type Platform } from '@/platform'
import { DEFAULT_SETTINGS, externalByDefault, type Settings } from './session'

const fake = (kind: Platform['kind'], hasExternal: boolean) =>
  setPlatformForTests({ kind, externalPlayer: hasExternal ? {} : null } as unknown as Platform)

describe('externalByDefault', () => {
  it('defaults to another app on Android when one can be launched', () => {
    fake('tauri-android', true)
    expect(externalByDefault(DEFAULT_SETTINGS)).toBe(true)
    fake('tauri-android', false)
    expect(externalByDefault(DEFAULT_SETTINGS)).toBe(false)
  })
  it('keeps the built-in player as default elsewhere', () => {
    fake('tauri-linux', true)
    expect(externalByDefault(DEFAULT_SETTINGS)).toBe(false)
    fake('web', false)
    expect(externalByDefault(DEFAULT_SETTINGS)).toBe(false)
  })
  it('lets an explicit choice or the legacy flag win', () => {
    fake('tauri-android', true)
    expect(externalByDefault({ ...DEFAULT_SETTINGS, player: 'app' })).toBe(false)
    fake('tauri-linux', true)
    expect(externalByDefault({ ...DEFAULT_SETTINGS, player: 'external' })).toBe(true)
    const legacy = { ...DEFAULT_SETTINGS, externalPlayer: true } as Settings
    expect(externalByDefault(legacy)).toBe(true)
  })
})
