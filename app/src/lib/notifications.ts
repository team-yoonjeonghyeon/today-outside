import { getAnonymousKey, requestNotificationAgreement } from "@apps-in-toss/web-framework";
import type { Profile } from "../constants/judge";
import { subscribeNotification, type NotificationRegion, type NotificationType } from "./judgeApi";

/**
 * 알림 동의·구독 관련 로직 모음. 원래 Settings(F8) 화면 안에 있었는데, 내 장소가 바뀔 때
 * (홈의 ↻ GPS 다시 찍기 · F9에서 지역 저장) 설정 화면을 거치지 않고도 서버 구독을 갱신해야
 * 해서 화면 밖으로 꺼냈어요.
 */

// 세 종류 모두 켜짐/꺼짐만 있어서 판정 타입(NotificationType)을 그대로 키로 써요.
export type NotificationPrefs = Record<NotificationType, boolean>;

// 실제로 알림을 예약 발송하는 서버 스케줄러(워커 쪽 크론 + 스마트 발송 API 호출)는 아직 없어요.
// 그래서 토글을 켜도 지금은 "동의는 받았지만 아직 아무것도 오지 않는" 상태예요 — 다만 그 동의
// 자체는 requestNotificationAgreement로 실제 동의 UI를 띄워서 진짜로 받아요(정직성 원칙:
// 동의 UI도 안 띄우면서 켜진 것처럼 보이면 안 돼요). 기본값은 전부 꺼진 상태로 시작해요.
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  morningBriefing: false,
  dangerAlert: false,
  walkTimeAlert: false,
};

// 앱인토스 콘솔 > 스마트 발송 > 알림 동의문에 등록해 둔 발송 코드예요.
const NOTIFICATION_TEMPLATE_CODES: Record<NotificationType, string> = {
  morningBriefing: "today-outside-morning-brief",
  dangerAlert: "today-outside-danger-alert",
  walkTimeAlert: "today-outside-walk-time",
};

/**
 * 알림 동의 UI를 띄우고, 사용자가 실제로 동의했을 때만 true를 돌려줘요.
 * 브릿지가 없는 환경(브라우저 프리뷰 등)에서는 동기적으로 throw할 수 있어서 try/catch로 감싸요.
 */
export function requestAgreement(type: NotificationType): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const cleanup = requestNotificationAgreement({
        options: { templateCode: NOTIFICATION_TEMPLATE_CODES[type] },
        onEvent: ({ type: eventType }) => {
          cleanup();
          resolve(eventType !== "agreementRejected");
        },
        onError: () => {
          cleanup();
          resolve(false);
        },
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * 서버가 "누가 동의했는지" 알아야 나중에 보낼 수 있어서, 동의/해제 시점마다 식별키를 새로
 * 받아요. 식별키를 못 받으면(브릿지 없음·비게임 미니앱 아님·구버전 등) null — 이때는 서버
 * 저장을 건너뛰고 로컬 토글만 반영해요.
 */
export async function getAnonKey(): Promise<string | null> {
  try {
    const result = await getAnonymousKey();
    if (result && typeof result === "object" && result.type === "HASH") return result.hash;
    return null;
  } catch {
    return null;
  }
}

/**
 * 켜져 있는 알림들의 기준 지역을 서버에 다시 올려요.
 *
 * 예전엔 토글을 켜는 그 순간에만 지역을 보냈어요. 그래서 그 뒤에 내 장소를 바꿔도 서버 구독은
 * 옛 지역 그대로였고, 이사를 가든 GPS를 다시 찍든 알림은 전 동네 기준으로 계속 왔어요.
 * 내 장소가 바뀌는 지점마다 이 함수를 불러서 그 간극을 없애요.
 *
 * best-effort예요 — 실패해도 화면엔 아무 영향이 없어요(다음에 내 장소를 바꿀 때 다시 시도돼요).
 */
export async function syncSubscriptions(params: {
  profile: Profile;
  region: NotificationRegion;
  prefs: NotificationPrefs;
}): Promise<void> {
  const { profile, region, prefs } = params;
  const enabled = (Object.keys(prefs) as NotificationType[]).filter((type) => prefs[type]);
  if (enabled.length === 0) return;

  const anonKey = await getAnonKey();
  if (!anonKey) return;

  await Promise.all(
    enabled.map((type) => subscribeNotification({ anonKey, type, profile, regions: [region] })),
  );
}
