import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from "../lib/notifications";
import { getStoredJSON, setStoredJSON, STORAGE_KEYS } from "../lib/storage";

/**
 * 알림 토글 상태(아침 브리핑·위험 시간대·산책 시간).
 *
 * 원래 Settings(F8)의 useState였는데, 홈에서 내 장소를 바꿀 때 "지금 켜져 있는 알림이 뭔지"를
 * 알아야 서버 구독을 갱신할 수 있어서 모듈 상태로 올렸어요 — useSavedRegions·usePrimaryRegion과
 * 같은 패턴이에요.
 */
let prefs: NotificationPrefs = DEFAULT_NOTIFICATION_PREFS;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return prefs;
}

let hydrationStarted = false;
function ensureHydrated() {
  if (hydrationStarted) return;
  hydrationStarted = true;
  void getStoredJSON<NotificationPrefs>(STORAGE_KEYS.notificationPrefs, DEFAULT_NOTIFICATION_PREFS).then(
    (stored) => {
      prefs = stored;
      notify();
    },
  );
}

export function useNotificationPrefs() {
  ensureHydrated();

  const value = useSyncExternalStore(subscribe, getSnapshot);

  const setPrefs = useCallback((next: NotificationPrefs) => {
    prefs = next;
    notify();
    return setStoredJSON(STORAGE_KEYS.notificationPrefs, next);
  }, []);

  return { prefs: value, setPrefs };
}
