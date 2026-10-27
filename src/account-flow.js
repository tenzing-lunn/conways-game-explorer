import { safeStorage } from './local-database.js';

const PENDING_ACTION_KEY = 'life-lab-pending-action-v1';

export function validateAccountFields({ mode, name = '', email = '', password = '', recoveryKey = '', confirmation = '' }) {
  const issues = {};
  const cleanEmail = String(email).trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) issues.email = 'Enter a valid email address.';
  if (mode === 'sign-up' && !String(name).trim()) issues.name = 'Enter a display name.';
  if (password.length < 12 || password.length > 128) issues.password = 'Use a password between 12 and 128 characters.';
  if (mode === 'recover' && !String(recoveryKey).trim()) issues.recoveryKey = 'Enter your recovery key.';
  if (mode === 'delete' && confirmation !== 'DELETE') issues.confirmation = 'Type DELETE to confirm account deletion.';
  return { valid: Object.keys(issues).length === 0, issues, email: cleanEmail };
}

export function createPendingActionStore(storage = safeStorage('sessionStorage')) {
  const read = () => {
    try { return JSON.parse(storage?.getItem(PENDING_ACTION_KEY) || 'null'); } catch { return null; }
  };
  return {
    get: read,
    set(action) {
      const pending = {
        ...action,
        token: action.token || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        returnRoute: action.returnRoute || globalThis.location?.pathname || '/',
        attempted: false,
      };
      storage?.setItem(PENDING_ACTION_KEY, JSON.stringify(pending));
      return pending;
    },
    markAttempted(token) {
      const pending = read();
      if (!pending || pending.token !== token || pending.attempted) return null;
      const claimed = { ...pending, attempted: true };
      storage?.setItem(PENDING_ACTION_KEY, JSON.stringify(claimed));
      return claimed;
    },
    clear(token) {
      const pending = read();
      if (!pending || (token && pending.token !== token)) return false;
      storage?.removeItem(PENDING_ACTION_KEY);
      return true;
    },
    retry(token) {
      const pending = read();
      if (!pending || pending.token !== token) return null;
      const retryable = { ...pending, attempted: false };
      storage?.setItem(PENDING_ACTION_KEY, JSON.stringify(retryable));
      return retryable;
    },
  };
}

export { PENDING_ACTION_KEY };
