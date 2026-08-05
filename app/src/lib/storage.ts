/**
 * 앱인토스 Storage(기기 저장소, localStorage 격) 접근 단일 창구.
 * 문자열만 저장 가능해서 JSON.stringify/parse로 감싸요. 브릿지가 없는 환경(브라우저 프리뷰 등)이나
 * 저장소 접근 자체가 실패하는 경우 모두 조용히 폴백하도록 try/catch로 방어해요 —
 * useSettingsAccessoryButton에서 겪었듯 이 SDK 호출들은 동기적으로 throw할 수 있어요.
 */
import { Storage } from "@apps-in-toss/web-framework";

export async function getStoredJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await Storage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function setStoredJSON<T>(key: string, value: T): Promise<void> {
  try {
    await Storage.setItem(key, JSON.stringify(value));
  } catch {
    // 브릿지 없음·저장 실패 — 조용히 무시해요. 이번 세션 동안은 메모리 상태로만 동작해요.
  }
}

export const STORAGE_KEYS = {
  savedRegions: "todayoutside:savedRegions",
  recentSearch: "todayoutside:recentSearch",
  lastProfile: "todayoutside:lastProfile",
  notificationPrefs: "todayoutside:notificationPrefs",
  // 새로고침·미니앱 재실행 시 F1(위치 권한 안내)로 돌아가지 않고 마지막으로 보던 지역의
  // 홈으로 바로 이어지게 하는 용도예요. MemoryRouter라 라우팅 자체는 항상 F1부터 다시
  // 시작하는데, Onboarding이 이 값을 읽어서 있으면 곧장 Home으로 넘겨요.
  lastRegion: "todayoutside:lastRegion",
  // 아래 세 개는 useReviewPrompt 전용이에요 — 몇 번째 홈 방문인지, 시간창(F4)·지표 상세(F5)
  // 같은 기능을 실제로 써봤는지, 리뷰를 이미 요청한 적 있는지(평생 한 번만).
  homeVisitCount: "todayoutside:homeVisitCount",
  usedDetailFeature: "todayoutside:usedDetailFeature",
  reviewRequested: "todayoutside:reviewRequested",
  // 친구에게 한 번이라도 공유하면 저장 장소가 1개(기본) → 2개로 늘어나요. 그 "한 번 공유했음"을
  // 영구히 기억하는 값이에요 (평생 한 번만 열리는 보너스라 boolean 하나면 충분해요).
  shareBonus: "todayoutside:shareBonus",
} as const;
