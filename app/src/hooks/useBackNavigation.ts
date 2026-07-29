import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { graniteEvent } from "@apps-in-toss/web-framework";

/**
 * MemoryRouter를 써서 주소창이 없다 보니, 토스 상단바의 네이티브 뒤로가기가 우리 앱의
 * 라우팅 스택을 몰라서 기본 동작(미니앱 종료)으로 빠져요. 그래서 홈에서 들어온 화면
 * (F4 시간창·F5 지표 상세·F6 위치 권한 거부·F9 지역 검색)에서는 이 훅으로 네이티브 뒤로가기를
 * 가로채 앱 내부 이전 화면으로 보내요.
 *
 * 반대로 F1(Onboarding)·F2·F3·F7(Home)처럼 화면 흐름도가 "뒤로가기 → 미니앱 종료"를
 * 명시한 화면에서는 이 훅을 쓰지 않아요 — 기본 동작이 이미 맞는 동작이라서요.
 */
export function useBackNavigation() {
  const navigate = useNavigate();

  useEffect(() => {
    // 브릿지가 없는 환경(브라우저 프리뷰 등)에서는 addEventListener 호출 자체가
    // 동기적으로 throw할 수 있어요 — useSettingsAccessoryButton에서 겪었던 것과 같은 패턴.
    let unsubscribe: (() => void) | undefined;

    try {
      unsubscribe = graniteEvent.addEventListener("backEvent", {
        onEvent: () => {
          navigate(-1);
        },
        onError: () => {
          // 이벤트 구독 자체의 에러 — 조용히 무시하고 네이티브 기본 동작에 맡겨요.
        },
      });
    } catch {
      // 브릿지 없음 — 조용히 무시해요.
    }

    return () => {
      try {
        unsubscribe?.();
      } catch {
        // no-op
      }
    };
  }, [navigate]);
}
