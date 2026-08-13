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

/**
 * 격자(nx/ny)와 가장 가까운 시/군/구를 찾아요.
 *
 * findNearestRegion과 같은 최근접 방식이라 경계 동네는 이웃 구로 잡힐 수 있어요. 날씨
 * 라벨에는 이 오차가 문제였지만(그래서 lib/location.ts는 카카오 역지오코딩을 써요),
 * 아래 findRegionByLabel의 폴백처럼 대략의 소속만 필요할 땐 충분해요.
 */
export function findRegionByGrid(nx: number, ny: number): RegionEntry {
  let nearest = REGIONS[0];
  let nearestDistSq = Infinity;
  for (const region of REGIONS) {
    const dx = region.nx - nx;
    const dy = region.ny - ny;
    const distSq = dx * dx + dy * dy;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearest = region;
    }
  }
  return nearest;
}

/**
 * 화면 라벨("마포구 공덕동", "경기도 고양시 일산동구")이 어느 시/군/구인지 찾아요.
 *
 * 이름만으로는 못 정해요 — "서구"는 인천·대구·광주·대전에 다 있고 "중구"는 더 많아요.
 * 그래서 라벨 토큰으로 후보를 먼저 좁히고, 그중 격자가 가장 가까운 곳을 골라요.
 * 라벨에서 아무것도 못 찾으면 격자만으로 폴백해요.
 */
export function findRegionByLabel(label: string, nx: number, ny: number): RegionEntry {
  const tokens = label.trim().split(/\s+/).filter(Boolean);
  const candidates = REGIONS.filter((region) => tokens.includes(region.sigungu));
  if (candidates.length === 0) return findRegionByGrid(nx, ny);

  let best = candidates[0];
  let bestDistSq = Infinity;
  for (const region of candidates) {
    const dx = region.nx - nx;
    const dy = region.ny - ny;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = region;
    }
  }
  return best;
}

/**
 * 화면용 라벨("내 위치(공덕동)")에서 장소 이름만 뽑아요("공덕동").
 * 내 장소는 한번 정하면 계속 그 자리에 머무는 값이라, "내 위치"라는 말이 붙어 있으면
 * 나중에 다른 동네에서 앱을 열었을 때 거짓말이 돼요. 저장할 땐 지역명만 남겨요.
 */
export function placeNameFromLabel(label: string): string {
  return label.match(/^내 위치\((.+)\)$/)?.[1] ?? label;
}
