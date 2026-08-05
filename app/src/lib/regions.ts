/**
 * data/regions.json(전국 시군구 격자 매핑, 팀원 작업)을 읽는 단일 창구.
 * 프론트 어디서도 지역명·nx/ny를 직접 하드코딩하지 말고 이 모듈을 통해서만 조회해요.
 */
import regionsData from "../../../data/regions.json";
import { toGrid } from "./geo";

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

export interface MyLocationResult {
  nx: number;
  ny: number;
  label: string;
}

/**
 * GPS 좌표로 "내 위치(...)" 결과를 네트워크 없이 즉시 만들어요. nx/ny는 좌표만 있으면 되는
 * 순수 계산(toGrid)이라 서버가 /region에서 계산하는 값과 완전히 같아요 — 판정에 쓰는
 * 데이터의 정확도엔 전혀 영향 없어요.
 *
 * 라벨은 구 단위(findNearestRegion, 중심점 최근접)라 동 경계 근처에서는 부정확할 수 있어요
 * (예: 공덕동인데 서대문구로 뜨는 식). 정확한 동 단위 라벨(카카오 역지오코딩 /region)은
 * 화면 진입을 막지 않도록 Home이 백그라운드에서 따로 조회해서 나중에 갈아끼워요
 * (Home.tsx의 지역 라벨 정밀화 로직 참고) — 이 함수는 그 전까지 보여줄 즉시 라벨을 줘요.
 */
export function coarseLocationLabel(lat: number, lon: number): MyLocationResult {
  const { nx, ny } = toGrid(lat, lon);
  const nearest = findNearestRegion(lat, lon);
  return { nx, ny, label: `내 위치(${nearest.sigungu})` };
}

/**
 * 화면용 라벨("내 위치(공덕동)")에서 장소 이름만 뽑아요("공덕동").
 * 내 장소는 한번 정하면 계속 그 자리에 머무는 값이라, "내 위치"라는 말이 붙어 있으면
 * 나중에 다른 동네에서 앱을 열었을 때 거짓말이 돼요. 저장할 땐 지역명만 남겨요.
 */
export function placeNameFromLabel(label: string): string {
  return label.match(/^내 위치\((.+)\)$/)?.[1] ?? label;
}
