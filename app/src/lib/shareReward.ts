/**
 * 앱인토스 공유 리워드(contactsViral) 연동. 잠긴 저장 칸을 여는 "공유하고 열기"에서 써요.
 *
 * 단순 share()와 다른 점: 친구에게 실제로 공유가 완료됐을 때만(sendViral 이벤트) 보상을 줘요.
 * moduleId는 콘솔 > 미니앱 > 공유 리워드에 등록된 리워드 ID예요("친구에게 공유하면 저장
 * 장소가 1칸 열려요"). 우리 보상은 칸 1개뿐이라 몇 명에게 공유했든 한 번 성공하면 충분해요.
 */
import {
  contactsViral,
  getTossShareLink,
  share,
  type ContactsViralEvent,
} from "@apps-in-toss/web-framework";

// 콘솔에 등록된 공유 리워드 ID. 리워드를 새로 만들면 이 값만 바꾸면 돼요.
export const SHARE_REWARD_MODULE_ID = "48799171-985e-43df-827d-1bc99907d1e2";

// 카톡·문자·어디로든 보낼 때 실리는 문구.
//
// 카톡은 긴 문단을 접어버려서 짧은 두 줄로 끊어요. 무엇을 보고 판단하는지(더위·자외선·
// 아스팔트 온도)를 적어야 받은 사람이 한 줄에 쓸모를 알 수 있어요 — 예전엔 "등급으로
// 알려줘요"라고만 해서 무엇의 등급인지가 빠져 있었어요.
const SHARE_MESSAGE =
  "오늘 나가도 되나\n더위·자외선·아스팔트 온도를 보고 지금 나가도 될지 알려줘요.";

// getTossShareLink의 첫 인자는 화면 경로가 아니라 `intoss://`로 시작하는 딥링크예요.
// granite.config.ts의 appName("today-outside")이 그대로 스킴 뒤에 와요. 예전엔 "/"를 넘겨서
// 호출이 실패했고, 실패를 조용히 삼키느라 링크 없이 문구만 나갔어요.
const SHARE_DEEP_LINK = "intoss://today-outside";
// 공유 미리보기(OG)에 쓰는 이미지. https 절대 경로여야 해요.
//
// 미니앱 로고를 써요 — granite.config.ts의 brand.icon과 같은 값이에요(콘솔에 등록된 그
// 로고). 예전엔 노면온도 카드의 도로 이모지를 넣었는데, 카톡 썸네일로 보면 무슨 앱인지
// 알 수 없어서 로고로 바꿨어요. brand.icon을 바꾸면 여기도 같이 맞춰야 해요 — 설정
// 파일이라 런타임에서 불러오면 빌드 설정까지 번들에 끌려와서 값만 복사해 뒀어요.
const SHARE_OG_IMAGE =
  "https://static.toss.im/appsintoss/53451/0d4c2328-5d7d-43ea-80cd-1ff0d00de016.png";

/**
 * 네이티브 공유 시트(카톡·메시지·문자 등)를 띄우고, 공유를 마치면 true를 돌려줘요.
 * contactsViral과 달리 토스 친구가 아니어도 어디로든 공유할 수 있어요 — 대신 앱인토스
 * 콘솔의 공유 리워드는 집계되지 않아요(칸은 우리 앱이 자체적으로 열어줘요).
 * 브릿지가 없는 환경(브라우저 프리뷰 등)에서는 동기적으로 throw할 수 있어서 감싸요.
 *
 * share()는 message 문자열 하나만 받아서 링크를 넣을 자리가 따로 없어요 — 본문 끝에 직접
 * 붙여요. 링크가 없으면 받은 사람이 미니앱을 찾아 들어갈 방법이 없거든요.
 *
 * ⚠️ getTossShareLink는 **미니앱이 정식 출시된 뒤에만** 동작해요(공식 문서 명시). 출시 전
 * 테스트에서는 이 호출이 실패해서 링크 없이 문구만 나가요 — 버그가 아니라 제약이에요.
 * 그때도 공유 자체는 되게 두고, 실패 원인은 콘솔에 남겨서 확인할 수 있게 해요.
 */
export async function shareNative(): Promise<boolean> {
  let link = "";
  try {
    link = await getTossShareLink(SHARE_DEEP_LINK, SHARE_OG_IMAGE);
  } catch (e) {
    // 출시 전이거나 브릿지가 없으면 여기로 와요. 조용히 삼키면 "왜 링크가 없지"를
    // 추적할 수 없어서 로그는 남겨요.
    console.warn("[share] 공유 링크를 만들지 못했어요 (정식 출시 전이면 정상이에요)", e);
  }

  try {
    await share({ message: link ? `${SHARE_MESSAGE}\n\n${link}` : SHARE_MESSAGE });
    return true;
  } catch {
    return false;
  }
}

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
