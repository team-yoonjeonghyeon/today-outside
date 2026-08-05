import { useCallback, useSyncExternalStore } from "react";
import { placeNameFromLabel } from "../lib/regions";
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

// 저장 장소는 기본 1개만 열려 있어요. 친구에게 공유하면(share 성공) 보너스로 1개가 더 열려서
// 최대 2개까지 저장할 수 있어요. 최대치는 더 이상 상수가 아니라 "보너스를 받았는가"에 따라
// 달라지므로, 화면은 이 훅이 돌려주는 maxRegions를 봐야 해요.
export const BASE_SAVED_REGIONS = 1;
export const SHARE_BONUS_REGIONS = 1;

// 화면마다 useState로 각자 따로 들고 있으면, 한 화면에서 저장한 직후 다른 화면으로 이동해도
// 그 화면은 자기 state를 모르고 Storage에서 다시 읽어와야 했어요 — 그 read가 방금 끝난 write보다
// 먼저 끝나버리는 레이스 때문에 "추가했는데 안 보인다"는 버그가 났어요. 그래서 모듈 레벨에
// 딱 하나의 진짜 상태를 두고, 모든 화면이 이 값을 구독(useSyncExternalStore)하게 바꿨어요.
// Storage는 이제 "새로고침해도 남아있게" 하는 영속화 용도로만 쓰고, 화면 간 동기화는
// 이 모듈이 메모리에서 즉시 처리해요.
let savedRegions: StoredRegion[] = [];
// 공유 보너스를 이미 받았는지. 받았으면 저장 한도가 1 → 2로 늘어요.
let shareBonusClaimed = false;
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

function getBonusSnapshot() {
  return shareBonusClaimed;
}

function getLoadedSnapshot() {
  return loaded;
}

// 지금 이 순간의 저장 한도예요. addRegion에서 잘라낼 때 항상 최신 보너스 상태를 반영하려고
// 상수 대신 함수로 계산해요.
function currentMax() {
  return BASE_SAVED_REGIONS + (shareBonusClaimed ? SHARE_BONUS_REGIONS : 0);
}

let hydrationStarted = false;
function ensureHydrated() {
  if (hydrationStarted) return;
  hydrationStarted = true;
  void Promise.all([
    getStoredJSON<StoredRegion[]>(STORAGE_KEYS.savedRegions, []),
    getStoredJSON<boolean>(STORAGE_KEYS.shareBonus, false),
    // lastRegion은 화면용 모양이라 이름 필드가 name이 아니라 label이에요(Home이 저장해요).
    getStoredJSON<{ nx: number; ny: number; label: string } | null>(STORAGE_KEYS.lastRegion, null),
  ]).then(([regions, bonus, last]) => {
    // 이 목록의 [0]번이 곧 내 장소(알림 기준)가 되기 전까지는, GPS로만 쓰던 사용자의 목록이
    // 계속 비어 있었어요(지역을 저장하는 경로가 F9 검색뿐이었거든요). 그 사용자들이 갑자기
    // 내 장소 없는 상태가 되지 않도록, 목록이 비어 있으면 마지막으로 보던 지역을 첫 장소로
    // 옮겨와요. 한 번 옮겨오면 아래 저장으로 영속화돼서 다시 탈 일이 없어요.
    if (regions.length === 0 && last) {
      savedRegions = [{ name: placeNameFromLabel(last.label), nx: last.nx, ny: last.ny }];
      void setStoredJSON(STORAGE_KEYS.savedRegions, savedRegions);
    } else {
      // 예전엔 중복을 이름으로만 걸러서, 같은 격자가 두 이름("서대문구"·"공덕동")으로 두 칸을
      // 차지한 채로 저장된 기기가 있어요. 읽어올 때 좌표 기준으로 한 번 정리해요(앞쪽 유지).
      const seen = new Set<string>();
      const deduped = regions.filter((r) => {
        const key = `${r.nx},${r.ny}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      savedRegions = deduped;
      if (deduped.length !== regions.length) {
        void setStoredJSON(STORAGE_KEYS.savedRegions, deduped);
      }
    }
    shareBonusClaimed = bonus;
    loaded = true;
    notify();
  });
}

/**
 * 저장된 지역(기본 1개, 공유하면 2개) — 홈의 지역 전환 드롭다운(F2·F3·F7)·F6(위치 권한 거부)·
 * F8(설정)이 이 훅 하나(정확히는 위 모듈 상태 하나)를 공유해요. 사용자가 실제로 저장한 지역만
 * 떠야 해서 기본값은 빈 배열이에요 — 예전엔 고양시·강남구·해운대구를 하드코딩된 "기본 3개"로
 * 보여줬는데, 아무것도 저장 안 해도 항상 같은 지역이 뜨는 게 하드코딩처럼 보인다는 피드백을
 * 받아서 없앴어요.
 *
 * **목록의 [0]번이 곧 "내 장소"예요** — 앱을 열면 여기서 시작하고, 아침 브리핑 같은 알림도
 * 이 한 곳을 기준으로 와요(primaryRegion). 한때 내 장소를 별도 Storage 값으로 따로 뒀었는데,
 * 화면에 "저장한 지역"과 "내 장소"라는 개념이 둘로 보여서 하나로 합쳤어요. 대신 내 장소가
 * 조용히 바뀌면 안 되니, addRegion을 부르기 전에 화면에서 확인을 받아요(Home의 ↻ · F9 검색).
 */
export function useSavedRegions() {
  ensureHydrated();

  const regions = useSyncExternalStore(subscribe, getSnapshot);
  const isLoaded = useSyncExternalStore(subscribe, getLoadedSnapshot);
  const hasShareBonus = useSyncExternalStore(subscribe, getBonusSnapshot);
  const maxRegions = BASE_SAVED_REGIONS + (hasShareBonus ? SHARE_BONUS_REGIONS : 0);

  /**
   * 지역을 저장해요.
   *
   * `asPrimary`가 true면 맨 앞에 넣어요 — 즉 그 곳이 내 장소가 돼요. false면 뒤에 붙여서
   * 내 장소는 건드리지 않아요(공유로 열린 두 번째 칸에 넣을 때 써요). 현재 한도를 넘으면
   * 가장 오래된 것부터 잘라요.
   */
  const addRegion = useCallback((region: StoredRegion, { asPrimary = true } = {}) => {
    // 중복 판정은 이름이 아니라 격자 좌표로 해요. 같은 자리인데 이름만 다르게 들어오는 경우가
    // 실제로 있어요 — GPS 즉시 라벨은 중심점 최근접이라 공덕동을 "서대문구"로 잡는데, 카카오
    // 역지오코딩은 같은 좌표를 "공덕동"으로 주거든요. 이름으로 거르면 이 둘이 서로 다른
    // 지역으로 남아서 한 자리를 두 칸이 차지해버려요.
    const rest = savedRegions.filter((r) => !(r.nx === region.nx && r.ny === region.ny));
    const next = (asPrimary ? [region, ...rest] : [...rest, region]).slice(0, currentMax());
    savedRegions = next;
    notify();
    return setStoredJSON(STORAGE_KEYS.savedRegions, next);
  }, []);

  /**
   * 이미 저장된 지역 중 하나를 내 장소로 지정해요(맨 앞으로 옮겨요).
   *
   * 자리가 2개일 땐 어느 쪽이 알림 기준인지 사용자가 직접 고를 수 있어야 해요 — 즐겨찾기에서
   * 별을 옮겨 다는 것처럼요. 목록을 재배열만 하니 저장된 지역이 사라지지 않아요.
   */
  const setPrimaryRegion = useCallback((target: { nx: number; ny: number }) => {
    const index = savedRegions.findIndex((r) => r.nx === target.nx && r.ny === target.ny);
    if (index <= 0) return Promise.resolve(); // 목록에 없거나 이미 내 장소예요.
    const next = [savedRegions[index], ...savedRegions.filter((_, i) => i !== index)];
    savedRegions = next;
    notify();
    return setStoredJSON(STORAGE_KEYS.savedRegions, next);
  }, []);

  // 한도가 다 찬 상태에서 다른 지역을 추가하려면 먼저 하나를 지울 수 있어야 해요.
  const removeRegion = useCallback((name: string) => {
    const next = savedRegions.filter((r) => r.name !== name);
    savedRegions = next;
    notify();
    return setStoredJSON(STORAGE_KEYS.savedRegions, next);
  }, []);

  // 공유가 성공하면 호출해서 보너스 장소 1개를 영구히 열어줘요. 이미 받았으면 아무 것도 안 해요.
  const grantShareBonus = useCallback(() => {
    if (shareBonusClaimed) return Promise.resolve();
    shareBonusClaimed = true;
    notify();
    return setStoredJSON(STORAGE_KEYS.shareBonus, true);
  }, []);

  return {
    savedRegions: regions,
    // 내 장소 — 목록의 첫 칸이에요. 아직 아무것도 저장 안 했으면 null.
    primaryRegion: regions[0] ?? null,
    addRegion,
    setPrimaryRegion,
    removeRegion,
    loaded: isLoaded,
    maxRegions,
    hasShareBonus,
    grantShareBonus,
  };
}
