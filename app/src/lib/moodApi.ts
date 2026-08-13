/**
 * 동네 기분 투표 API 클라이언트.
 *
 * 서버 구현은 worker/src/lambda.ts의 "동네 기분 투표" 구역이에요. 집계는 서버가 전부 하고,
 * 여기서는 호출·타입과 "이 화면은 어느 방(시군구)에 속하는지"를 정하는 일만 해요.
 */
import type { Mood } from "../constants/mood";
import { API_BASE_URL } from "./judgeApi";
import { findRegionByLabel } from "./regions";
import { getStoredJSON, setStoredJSON, STORAGE_KEYS } from "./storage";

export interface MoodMessage {
  /** 프리셋 id. 문장은 앱이 들고 있어요 (constants/mood.ts) — 서버엔 id만 오가요. */
  id: string;
  /** 남긴 사람의 동네. 구까지만 있는 지역에서 남겼으면 빈 문자열이에요. */
  dong: string;
}

export interface MoodSummary {
  /** 집계 기준 날짜 (KST, YYYYMMDD) */
  date: string;
  /** 방 이름 = 시군구 (예: "서울특별시 마포구") */
  region: string;
  counts: Record<Mood, number>;
  total: number;
  /** 내 동네 참여자 수. 인원이 적어(dongMinParticipants 미만) 가려졌거나 동을 모르면 null. */
  dong: { name: string; count: number } | null;
  /** 이 기기가 오늘 남긴 표. 아직 안 했으면 null. */
  my: Mood | null;
  dongMinParticipants: number;
  /** 최근 한마디 (최신순). 칸이 꽉 차면 가장 오래된 것부터 밀려나요. */
  messages: MoodMessage[];
  /** 오늘 이 지역의 한마디 총 개수. messages보다 클 수 있어요. */
  messageTotal: number;
  /** 이 기기가 오늘 남긴 한마디의 프리셋 id. 아직이면 null. */
  myMessage: string | null;
}

export interface MoodPlace {
  /** 집계 단위 = 시군구. 동으로 묶으면 대부분 텅 비고, 시도로 묶으면 남 얘기가 돼요. */
  region: string;
  /** 화면에 곁들일 내 동네. 라벨에서 못 찾으면 빈 문자열이에요. */
  dong: string;
}

/** 마지막 토큰이 이걸로 끝나면 동네 이름으로 봐요. "일산동구"는 '구'로 끝나서 안 걸려요. */
const DONG_SUFFIX = /(동|읍|면|리|가)$/;

/**
 * 화면이 보고 있는 지역(라벨 + 격자)을 투표 방으로 바꿔요.
 *
 * 라벨 형태가 경로마다 달라요 — GPS·검색은 "마포구 공덕동"(카카오 역지오코딩), 저장 지역
 * 목록은 "경기도 고양시 일산동구"처럼 시군구까지만인 경우가 있어요. 그래서 시군구는
 * findRegionByLabel에 맡기고(이름이 겹치는 "서구"·"중구"는 격자로 가려내요), 동은 라벨의
 * 마지막 토큰이 동네 이름 꼴일 때만 뽑아요.
 */
export function resolveMoodPlace(label: string, nx: number, ny: number): MoodPlace {
  const entry = findRegionByLabel(label, nx, ny);
  const tokens = label.trim().split(/\s+/).filter(Boolean);
  const last = tokens[tokens.length - 1] ?? "";
  const dong = last !== entry.sigungu && last.length >= 2 && DONG_SUFFIX.test(last) ? last : "";

  return { region: `${entry.sido} ${entry.sigungu}`, dong };
}

/**
 * 이 기기의 익명 ID. 하루 한 표를 지키고 "내가 뭘 골랐는지"를 다시 보여주는 데만 써요 —
 * 계정·전화번호와 무관한 무작위 UUID라 사람을 식별하지 않아요.
 *
 * Storage가 없는 환경(브라우저 프리뷰 등)에서는 저장이 조용히 실패해요. 그때도 이번 세션
 * 동안은 같은 값을 쓰도록 메모리에도 들고 있어요.
 */
let cachedDeviceId: string | null = null;

export async function getMoodDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  const stored = await getStoredJSON<string | null>(STORAGE_KEYS.moodDeviceId, null);
  if (typeof stored === "string" && stored.length > 0) {
    cachedDeviceId = stored;
    return stored;
  }

  const created = randomId();
  cachedDeviceId = created;
  await setStoredJSON(STORAGE_KEYS.moodDeviceId, created);
  return created;
}

/** crypto.randomUUID는 구형 WebView에 없을 수 있어서 getRandomValues 폴백을 둬요. */
function randomId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();

  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  // 서버가 UUID 꼴(16진수와 하이픈)만 받아서 형식을 맞춰줘요.
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function readSummary(res: Response): Promise<MoodSummary> {
  if (!res.ok) throw new Error(`mood ${res.status}`);
  return (await res.json()) as MoodSummary;
}

export async function fetchMood(place: MoodPlace, deviceId: string): Promise<MoodSummary> {
  if (isPreview()) return previewSummary(place, {});

  const query = new URLSearchParams({ region: place.region, deviceId });
  if (place.dong) query.set("dong", place.dong);
  return readSummary(await fetch(`${API_BASE_URL}/mood?${query.toString()}`));
}

/** 표·한마디 중 원하는 것만 보내요. 둘 다 보내도 되고요. */
export interface MoodAction {
  mood?: Mood;
  /** 프리셋 id (constants/mood.ts). 자유 텍스트는 보낼 수 없어요. */
  message?: string;
}

export async function submitMood(
  place: MoodPlace,
  deviceId: string,
  action: MoodAction,
): Promise<MoodSummary> {
  if (isPreview()) return previewSummary(place, action);

  const res = await fetch(`${API_BASE_URL}/mood`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ region: place.region, dong: place.dong, deviceId, ...action }),
  });
  return readSummary(res);
}

/**
 * 개발 중에만 도는 미리보기. 주소에 `?mood=1`을 붙이면 서버 없이 카드가 그려져요.
 *
 * `/mood`는 Lambda에 막 넣은 거라 배포된 서버는 아직 이 경로를 몰라요. 그렇다고 배포할
 * 때까지 화면을 못 보는 것도 곤란해서, judgeApi의 `?rain=1`과 같은 방식으로 확인용
 * 스위치를 뒀어요. 투표를 누르면 집계도 같이 움직여서 선택 상태까지 확인할 수 있어요.
 *
 * `import.meta.env.DEV`는 프로덕션 빌드에서 false로 상수 폴딩돼서 이 블록 전체가 번들에서
 * 사라져요 — 출시본에는 들어가지 않아요.
 */
function isPreview(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("mood") === "1";
}

/** 미리보기용 가짜 집계. 내 표·한마디는 그때그때 더해서 화면이 실제로 움직이게 해요. */
const PREVIEW_BASE: Record<Mood, number> = { good: 17, soso: 4, bad: 1 };

const PREVIEW_MESSAGES: MoodMessage[] = [
  { id: "windy_strong", dong: "연남동" },
  { id: "hot", dong: "상암동" },
  { id: "bring_umbrella", dong: "망원동" },
  { id: "cooler_than_looks", dong: "합정동" },
];

/** 미리보기는 새로고침 전까지 선택을 기억해요 — 눌렀다 뗐을 때 상태가 사라지면 확인이 안 돼요. */
const previewState: MoodAction = {};

function previewSummary(place: MoodPlace, action: MoodAction): MoodSummary {
  if (action.mood) previewState.mood = action.mood;
  if (action.message) previewState.message = action.message;

  const counts = { ...PREVIEW_BASE };
  if (previewState.mood) counts[previewState.mood] += 1;

  // 내가 남긴 건 맨 위에 붙여서, 눌렀을 때 목록에 바로 올라오는 걸 볼 수 있게 해요.
  const messages = previewState.message
    ? [{ id: previewState.message, dong: place.dong }, ...PREVIEW_MESSAGES]
    : PREVIEW_MESSAGES;

  return {
    date: "preview",
    region: place.region,
    counts,
    total: counts.good + counts.soso + counts.bad,
    dong: place.dong ? { name: place.dong, count: 4 } : null,
    my: previewState.mood ?? null,
    dongMinParticipants: 3,
    messages,
    // 목록보다 크게 잡아서 "외 N명이 더 남겼어요" 줄까지 확인할 수 있게 해요.
    messageTotal: messages.length + 25,
    myMessage: previewState.message ?? null,
  };
}
