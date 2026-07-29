/**
 * data/regions.json(전국 시군구 격자 매핑, 팀원 작업)을 읽는 단일 창구.
 * 프론트 어디서도 지역명·nx/ny를 직접 하드코딩하지 말고 이 모듈을 통해서만 조회해요.
 */
import regionsData from "../../../data/regions.json";

export interface RegionEntry {
  sido: string;
  sigungu: string;
  lat: number;
  lon: number;
  nx: number;
  ny: number;
}

export const REGIONS: RegionEntry[] = regionsData;

const MAX_SEARCH_RESULTS = 20;

/**
 * 시/군/구 또는 시/도 이름에 검색어가 포함되는 지역을 찾아요.
 * "인천 서구"처럼 공백으로 여러 단어를 치면 각 단어를 따로 토큰화해서, 시/도·시/군/구
 * 어디에 흩어져 있든 전부 매칭돼요 (검색 결과 목록엔 "서구"만 나오고 sido는 "인천광역시"라서
 * 이렇게 안 하면 "인천 서구"를 통으로 검색했을 때 매칭이 안 됐어요).
 */
export function searchRegions(query: string): RegionEntry[] {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return REGIONS.filter((region) =>
    tokens.every((token) => region.sido.includes(token) || region.sigungu.includes(token)),
  ).slice(0, MAX_SEARCH_RESULTS);
}

/** 시/군/구 이름으로 정확히 한 지역을 찾아요. */
export function findRegionBySigungu(sigungu: string): RegionEntry | undefined {
  return REGIONS.find((region) => region.sigungu === sigungu);
}

/** 기본 저장 지역처럼, 반드시 존재해야 하는 지역을 찾을 때 써요. 없으면 개발 중 바로 드러나도록 던져요. */
export function requireRegionBySigungu(sigungu: string): RegionEntry {
  const region = findRegionBySigungu(sigungu);
  if (!region) throw new Error(`data/regions.json에서 "${sigungu}"를 찾을 수 없어요`);
  return region;
}

/**
 * GPS 좌표(lat/lon)와 가장 가까운 지역을 찾아요. "내 위치(${sigungu})"처럼
 * 위치 기반 라벨에 실제 지역명을 붙일 때 써요 — 위경도 단순 유클리드 거리라 정밀하진 않지만,
 * 화면에 보여줄 인근 시/군/구 이름을 고르는 용도로는 충분해요.
 */
export function findNearestRegion(lat: number, lon: number): RegionEntry {
  let nearest = REGIONS[0];
  let nearestDistSq = Infinity;
  for (const region of REGIONS) {
    const dLat = region.lat - lat;
    const dLon = region.lon - lon;
    const distSq = dLat * dLat + dLon * dLon;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearest = region;
    }
  }
  return nearest;
}
