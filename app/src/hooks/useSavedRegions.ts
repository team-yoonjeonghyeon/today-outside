import { useCallback, useSyncExternalStore } from "react";
import { getStoredJSON, setStoredJSON, STORAGE_KEYS } from "../lib/storage";

export interface StoredRegion {
  name: string;
  nx: number;
  ny: number;
  // 실제 판정 API를 호출해야 채워지는 값이라 지금은 옵션이에요 — 지금은 어디서도 이 값을
  // 채우지 않아서 항상 undefined예요. 등급을 지어내서 보여주지 않아요 (정직성 원칙).
  levelLabel?: string;
  levelColor?: string;
}

export const MAX_SAVED_REGIONS = 3;

// 화면마다 useState로 각자 따로 들고 있으면, 한 화면에서 저장한 직후 다른 화면으로 이동해도
// 그 화면은 자기 state를 모르고 Storage에서 다시 읽어와야 했어요 — 그 read가 방금 끝난 write보다
// 먼저 끝나버리는 레이스 때문에 "추가했는데 안 보인다"는 버그가 났어요. 그래서 모듈 레벨에
// 딱 하나의 진짜 상태를 두고, 모든 화면이 이 값을 구독(useSyncExternalStore)하게 바꿨어요.
// Storage는 이제 "새로고침해도 남아있게" 하는 영속화 용도로만 쓰고, 화면 간 동기화는
// 이 모듈이 메모리에서 즉시 처리해요.
let savedRegions: StoredRegion[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return savedRegions;
}

function getLoadedSnapshot() {
  return loaded;
}

let hydrationStarted = false;
function ensureHydrated() {
  if (hydrationStarted) return;
  hydrationStarted = true;
  void getStoredJSON<StoredRegion[]>(STORAGE_KEYS.savedRegions, []).then((regions) => {
    savedRegions = regions;
    loaded = true;
    notify();
  });
}

/**
 * 저장된 지역(최대 3개) — 홈의 지역 전환 드롭다운(F2·F3·F7)·F6(위치 권한 거부)·F8(설정)이
 * 이 훅 하나(정확히는 위 모듈 상태 하나)를 공유해요. 사용자가 실제로 저장한 지역만 떠야 해서
 * 기본값은 빈 배열이에요 — 예전엔 고양시·강남구·해운대구를 하드코딩된 "기본 3개"로 보여줬는데,
 * 아무것도 저장 안 해도 항상 같은 지역이 뜨는 게 하드코딩처럼 보인다는 피드백을 받아서 없앴어요.
 */
export function useSavedRegions() {
  ensureHydrated();

  const regions = useSyncExternalStore(subscribe, getSnapshot);
  const isLoaded = useSyncExternalStore(subscribe, getLoadedSnapshot);

  const addRegion = useCallback((region: StoredRegion) => {
    // TODO: 이미 3개 저장돼 있으면 "가장 오래된 지역과 바꿀까요?" 확인 문구 (디자인프레임 F9 메모).
    // 지금은 확인 없이 최신순으로 앞에 넣고 3개를 넘으면 가장 오래된 것부터 잘라요.
    const next = [region, ...savedRegions.filter((r) => r.name !== region.name)].slice(
      0,
      MAX_SAVED_REGIONS,
    );
    savedRegions = next;
    notify();
    return setStoredJSON(STORAGE_KEYS.savedRegions, next);
  }, []);

  return { savedRegions: regions, addRegion, loaded: isLoaded };
}
