import type { Env } from './kma';

/**
 * 카카오 로컬 API 역지오코딩 (좌표 → 행정구역).
 * 중심점 최근접(regions.json)은 경계를 못 지켜 가장자리 동네를 이웃 구로 잘못 잡아요
 * (예: 공덕동 → 서대문구). 카카오는 경계 기반이라 정확히 마포구로 나와요.
 * 키는 서버 시크릿(KAKAO_REST_KEY)으로만 두고, 실패하면 null → 프론트가 기존 방식으로 폴백.
 */

const COORD2REGION = 'https://dapi.kakao.com/v2/local/geo/coord2regioncode.json';

export interface Region {
  sido: string;
  sigungu: string;
  dong: string;
}

interface KakaoDoc {
  region_type?: string; // 'H' 행정동 / 'B' 법정동
  region_1depth_name?: string;
  region_2depth_name?: string;
  region_3depth_name?: string;
}

/**
 * 카카오 응답 documents에서 행정구역을 골라요.
 * 행정동(H)을 우선하고, 없으면 법정동(B), 그것도 없으면 첫 항목.
 * region_2depth(시군구)가 비면(세종 등) region_1depth로 대체.
 */
export function pickRegion(documents: KakaoDoc[]): Region | null {
  if (!Array.isArray(documents) || documents.length === 0) return null;
  const doc = documents.find((d) => d.region_type === 'H') ?? documents[0];
  const sido = String(doc.region_1depth_name ?? '').trim();
  const sigungu = String(doc.region_2depth_name ?? '').trim();
  const dong = String(doc.region_3depth_name ?? '').trim();
  if (!sido) return null;
  return { sido, sigungu: sigungu || sido, dong };
}

/** 좌표 → 행정구역. 키 없음·에러·미매칭이면 null (프론트가 중심점 방식으로 폴백). */
export async function fetchRegion(env: Env, lat: number, lon: number): Promise<Region | null> {
  if (!env.KAKAO_REST_KEY) return null;
  const url = `${COORD2REGION}?x=${lon}&y=${lat}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${env.KAKAO_REST_KEY}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { documents?: KakaoDoc[] };
    return pickRegion(json.documents ?? []);
  } catch {
    return null;
  }
}
