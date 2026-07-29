import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { partner, tdsEvent } from "@apps-in-toss/web-framework";
import { ROUTES } from "../routes";

const ACCESSORY_ID = "settings";

/**
 * 내비게이션 바 더보기 버튼 왼쪽의 액세서리 아이콘(⚙ 설정) — 화면별로 붙였다 뗄 수 있어요.
 * 액세서리 버튼은 한 번에 1개만 노출 가능해서(NavigationBar.md), 기획서 화면흐름도가
 * "⚙ 설정" 진입을 명시한 F1(Onboarding)·F2·F3·F7(Home)에서만 이 훅을 써요.
 * F4~F9 등 다른 화면에서는 쓰지 않아 자동으로 사라져요.
 */
export function useSettingsAccessoryButton() {
  const navigate = useNavigate();

  useEffect(() => {
    // 토스 앱 브릿지가 없는 환경(브라우저 프리뷰 등)에서는 이 호출들이 동기적으로 throw해요 —
    // getCurrentLocation과 달리 await 밖에서 즉시 던지므로 try/catch로 감싸지 않으면
    // 렌더링 중 예외로 화면 전체가 하얗게 꺼져요.
    let removeListener: (() => void) | undefined;

    try {
      partner.addAccessoryButton({
        id: ACCESSORY_ID,
        title: "설정",
        icon: { name: "icon-setting-mono" },
      });
    } catch {
      // 브릿지 없음 — 조용히 무시해요.
    }

    try {
      removeListener = tdsEvent.addEventListener("navigationAccessoryEvent", {
        onEvent: ({ id }) => {
          if (id === ACCESSORY_ID) navigate(ROUTES.settings);
        },
      });
    } catch {
      // 브릿지 없음 — 조용히 무시해요.
    }

    return () => {
      try {
        removeListener?.();
      } catch {
        // no-op
      }
      try {
        partner.removeAccessoryButton();
      } catch {
        // no-op
      }
    };
  }, [navigate]);
}
