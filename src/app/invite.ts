/**
 * Image mode is open by invitation while it is being built. This is a soft gate,
 * not security: the key lives in the bundle, and unlocking is remembered in this browser.
 */

const STORE = 'isometrictown:image-invite';
const KEY = '8753';

/** Whether this browser has been let into image mode. */
export function imageUnlocked(): boolean {
  try {
    return localStorage.getItem(STORE) === '1';
  } catch {
    return false;
  }
}

/** Checks an invite key and, if it is right, remembers the unlock. */
export function unlockImage(key: string): boolean {
  if (key.trim() !== KEY) return false;
  try {
    localStorage.setItem(STORE, '1');
  } catch {
    /* storage can be unavailable: the unlock then lasts this visit */
  }
  return true;
}
