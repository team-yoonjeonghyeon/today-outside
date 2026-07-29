import { useCallback, useEffect, useState } from "react";
import { DEFAULT_PROFILE, type Profile } from "../constants/judge";
import { getStoredJSON, setStoredJSON, STORAGE_KEYS } from "../lib/storage";

/**
 * 마지막으로 본 프로필 탭 — Onboarding(F1)·Home(F2·F3·F7)이 재방문 시 이 값으로 시작해요.
 * Storage에 없으면 DEFAULT_PROFILE("dog")로 시작해요.
 */
export function useLastProfile() {
  const [profile, setProfileState] = useState<Profile>(DEFAULT_PROFILE);

  useEffect(() => {
    let cancelled = false;
    getStoredJSON(STORAGE_KEYS.lastProfile, DEFAULT_PROFILE).then((stored) => {
      if (!cancelled) setProfileState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setProfile = useCallback((next: Profile) => {
    setProfileState(next);
    void setStoredJSON(STORAGE_KEYS.lastProfile, next);
  }, []);

  return [profile, setProfile] as const;
}
