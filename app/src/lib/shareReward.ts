/**
 * 앱인토스 공유 리워드(contactsViral) 연동. 잠긴 저장 칸을 여는 "공유하고 열기"에서 써요.
 *
 * 단순 share()와 다른 점: 친구에게 실제로 공유가 완료됐을 때만(sendViral 이벤트) 보상을 줘요.
 * moduleId는 콘솔 > 미니앱 > 공유 리워드에 등록된 리워드 ID예요("친구에게 공유하면 저장
 * 장소가 1칸 열려요"). 우리 보상은 칸 1개뿐이라 몇 명에게 공유했든 한 번 성공하면 충분해요.
 */
import { contactsViral, type ContactsViralEvent } from "@apps-in-toss/web-framework";

// 콘솔에 등록된 공유 리워드 ID. 리워드를 새로 만들면 이 값만 바꾸면 돼요.
export const SHARE_REWARD_MODULE_ID = "48799171-985e-43df-827d-1bc99907d1e2";

/**
 * 연락처 공유 모듈을 띄우고, 친구에게 한 번이라도 공유가 성공하면 true로 resolve해요.
 * 모듈이 닫힐 때(close) 그때까지의 성공 여부로 확정해요. 브릿지 없음·에러는 false —
 * 이 경우 호출한 쪽이 칸을 열지 않아요(정직성 원칙: 공유 안 했는데 열어주지 않아요).
 */
export function openShareReward(): Promise<boolean> {
  return new Promise((resolve) => {
    let cleanup: (() => void) | undefined;
    let sent = false;
    let settled = false;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        cleanup?.();
      } catch {
        // cleanup 실패는 무시해요 — 이미 결과는 확정됐어요.
      }
      resolve(ok);
    };

    try {
      cleanup = contactsViral({
        options: { moduleId: SHARE_REWARD_MODULE_ID },
        onEvent: (event: ContactsViralEvent) => {
          if (event.type === "sendViral") {
            sent = true;
          } else if (event.type === "close") {
            finish(sent);
          }
        },
        onError: () => finish(false),
      });
    } catch {
      // 브릿지가 없는 환경(브라우저 프리뷰 등)에서는 동기적으로 throw할 수 있어요.
      finish(false);
    }
  });
}
