/**
 * 기상청 격자(nx, ny) <-> 위경도 변환 + 태양고도 계산
 * Lambert Conformal Conic. 기상청 공개 알고리즘 그대로.
 */

const RE = 6371.00877; // 지구 반경 (km)
const GRID = 5.0; // 격자 간격 (km)
const SLAT1 = 30.0;
const SLAT2 = 60.0;
const OLON = 126.0;
const OLAT = 38.0;
const XO = 43;
const YO = 136;

const DEG = Math.PI / 180.0;

function lccParams() {
  const re = RE / GRID;
  const slat1 = SLAT1 * DEG;
  const slat2 = SLAT2 * DEG;
  const olon = OLON * DEG;
  const olat = OLAT * DEG;

  let sn =
    Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  return { re, sn, sf, ro, olon };
}

/** 위경도 -> 격자 */
export function toGrid(lat: number, lon: number): { nx: number; ny: number } {
  const { re, sn, sf, ro, olon } = lccParams();
  let ra = Math.tan(Math.PI * 0.25 + lat * DEG * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * DEG - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;
  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

/** 격자 -> 위경도 (태양고도 계산에 필요) */
export function toLatLon(nx: number, ny: number): { lat: number; lon: number } {
  const { re, sn, sf, ro, olon } = lccParams();
  const xn = nx - XO;
  const yn = ro - ny + YO;
  let ra = Math.sqrt(xn * xn + yn * yn);
  if (sn < 0) ra = -ra;
  let alat = Math.pow((re * sf) / ra, 1.0 / sn);
  alat = 2.0 * Math.atan(alat) - Math.PI * 0.5;

  let theta = 0.0;
  if (Math.abs(xn) > 0) {
    if (Math.abs(yn) <= 0) {
      theta = Math.PI * 0.5;
      if (xn < 0) theta = -theta;
    } else {
      theta = Math.atan2(xn, yn);
    }
  }
  const alon = theta / sn + olon;

  return { lat: alat / DEG, lon: alon / DEG };
}

/**
 * 태양고도(도). 일사량 추정에 사용.
 * 균시차는 생략 — ±15분 오차는 ΔT 추정에 무의미한 수준.
 */
export function solarAltitude(
  year: number,
  month: number,
  day: number,
  hourKst: number,
  lat: number,
  lon: number
): number {
  const start = Date.UTC(year, 0, 0);
  const n = Math.floor((Date.UTC(year, month - 1, day) - start) / 86400000);

  // 태양 적위
  const decl = 23.45 * Math.sin(((360 * (284 + n)) / 365) * DEG);

  // 진태양시 (KST 기준 자오선 135°E)
  const solarTime = hourKst + (lon - 135) / 15;
  const H = 15 * (solarTime - 12);

  const sinAlt =
    Math.sin(lat * DEG) * Math.sin(decl * DEG) +
    Math.cos(lat * DEG) * Math.cos(decl * DEG) * Math.cos(H * DEG);

  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG;
}

/** 현재 KST 시각 */
export function nowKst(): Date {
  return new Date(Date.now() + 9 * 3600 * 1000);
}

export function kstParts(d: Date) {
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

export function yyyymmdd(d: Date): string {
  const p = kstParts(d);
  return `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
}
