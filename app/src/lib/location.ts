import { toGrid } from "./geo";
import { fetchRegion } from "./judgeApi";
import { findNearestRegion } from "./regions";

export interface MyLocation {
  nx: number;
  ny: number;
  /**
   * 장소 이름 — "공덕동".
   *
   * 화면 표시와 저장에 같은 값을 써요. 예전엔 화면엔 "내 위치(공덕동)", 저장은 "공덕동"으로
   * 달랐는데, 그러면 같은 곳이 들어온 경로에 따라 다르게 보여요 — 앱을 열면 "공덕동"인데
   * ↻를 누르면 갑자기 "내 위치(공덕동)"로 바뀌어서, 장소가 바뀐 것처럼 보였어요.
   */
  name: string;
}

/**
 * GPS 좌표 → 지금 내 위치(격자 + 이름).
 *
 * 예전엔 두 단계로 보여줬어요: 진입을 막지 않으려고 중심점 최근접으로 구 단위 이름을 즉시
 * 띄우고(네트워크 없이), 카카오 역지오코딩이 끝나면 동 단위 이름으로 갈아끼웠어요. 그런데
 * 중심점 최근접은 동 경계에서 자주 틀려서 — 공덕동인데 "서대문구" — 사용자가 잠깐이지만
 * **틀린 동네 이름**을 보게 됐어요. 이름이 눈앞에서 바뀌는 것도 어수선했고요.
 *
 * 그래서 이름은 한 번만, 정확한 값으로 정해요. 이 조회를 기다리는 건 사용자가 "내 위치로
 * 시작하기"·↻·"현재 위치로 찾기"를 직접 눌렀을 때뿐이고, 그 화면들엔 이미 로딩 표시가
 * 있어서 기다림이 드러나요.
 *
 * 격자(nx/ny)는 좌표만 있으면 되는 순수 계산이라 조회와 무관하게 항상 정확해요 — 역지오코딩이
 * 실패해도 판정 데이터는 제 위치로 나와요. 이름만 구 단위로 폴백해요.
 */
export async function resolveMyLocation(lat: number, lon: number): Promise<MyLocation> {
  const { nx, ny } = toGrid(lat, lon);
  try {
    const precise = await fetchRegion(lat, lon);
    return { nx, ny, name: precise.label };
  } catch {
    // 카카오 키 미설정·장애·미매칭 — 이름 없이 두는 것보단 구 단위라도 보여줘요.
    const nearest = findNearestRegion(lat, lon);
    return { nx, ny, name: nearest.sigungu };
  }
}
