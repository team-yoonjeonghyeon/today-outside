import { useCallback, useEffect, useState } from "react";
import { LEVEL_COLORS } from "../constants/judge";
import { requireRegionBySigungu } from "../lib/regions";
import { getStoredJSON, setStoredJSON, STORAGE_KEYS } from "../lib/storage";

export interface StoredRegion {
  name: string;
  nx: number;
  ny: number;
  // 실제 판정 API를 호출해야 채워지는 값이라 지금은 옵션이에요 — 처음 3개 기본 지역만
  // 표시용 목업으로 갖고 있고, 검색해서 새로 추가한 지역은 이 값이 없어서 배지를 안 그려요
  // (모르는 값을 "보통"으로 지어내지 않아요 — 정직성 원칙).
  levelLabel?: string;
  levelColor?: string;
}

const MAX_SAVED_REGIONS = 3;

// 최초 진입 시 보여줄 기본 3개 — data/regions.json 기준이라 nx/ny가 정확해요.
// 아이콘은 지역마다 다르게 주지 않아요 — 193개 전 지역에 "특색 있는" 아이콘을 억지로
// 매칭하면 나머지 지역과 형평이 안 맞아서, 모든 지역이 화면(LocationDenied·RegionSearch)의
// 공용 건물 아이콘 하나로 통일돼요. 사용자가 지역을 저장하기 시작하면 Storage 값이
// 이 기본값을 덮어써요.
const DEFAULT_SAVED_REGIONS: StoredRegion[] = [
  {
    name: "고양시 일산동구",
    ...requireRegionBySigungu("고양시 일산동구"),
    levelLabel: "좋음",
    levelColor: LEVEL_COLORS[1],
  },
  {
    name: "서울 강남구",
    ...requireRegionBySigungu("강남구"),
    levelLabel: "주의",
    levelColor: LEVEL_COLORS[3],
  },
  {
    name: "부산 해운대구",
    ...requireRegionBySigungu("해운대구"),
    levelLabel: "보통",
    levelColor: "#8B95A1",
  },
];

/**
 * 저장된 지역(최대 3개) — 홈의 지역 전환 드롭다운(F2·F3·F7)과 F6(위치 권한 거부) 화면이
 * 이 훅 하나를 공유해요. Storage에 아무것도 없으면 DEFAULT_SAVED_REGIONS로 시작해요.
 */
export function useSavedRegions() {
  const [savedRegions, setSavedRegions] = useState<StoredRegion[]>(DEFAULT_SAVED_REGIONS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getStoredJSON(STORAGE_KEYS.savedRegions, DEFAULT_SAVED_REGIONS).then((regions) => {
      if (!cancelled) {
        setSavedRegions(regions);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const addRegion = useCallback((region: StoredRegion) => {
    setSavedRegions((prev) => {
      // TODO: 이미 3개 저장돼 있으면 "가장 오래된 지역과 바꿀까요?" 확인 문구 (디자인프레임 F9 메모).
      // 지금은 확인 없이 최신순으로 앞에 넣고 3개를 넘으면 가장 오래된 것부터 잘라요.
      const next = [region, ...prev.filter((r) => r.name !== region.name)].slice(
        0,
        MAX_SAVED_REGIONS,
      );
      void setStoredJSON(STORAGE_KEYS.savedRegions, next);
      return next;
    });
  }, []);

  return { savedRegions, addRegion, loaded };
}
