import { useEffect, useRef } from "react";
import { requestReview } from "@apps-in-toss/web-framework";
import { getStoredJSON, setStoredJSON, STORAGE_KEYS } from "../lib/storage";

// 몇 번째 홈 방문부터 리뷰를 요청할지. 1번째(첫 방문)는 절대 포함하지 않아요 — 다크패턴
// 방지 정책상 진입 직후에는 아무것도 유도하면 안 돼요.
const VISIT_THRESHOLD = 3;

/**
 * 판정 등급이 좋을 때(1~2)로 조건을 걸지 않았어요 — 여름철엔 위험을 미리 알려주는 것도
 * 사용자에게 도움이 되는 경험이라, "좋은 판정"만 골라서 물어보는 건 오히려 이 앱의 목적과
 * 안 맞아요. 대신 아래 두 조건을 같이 봐요.
 * - 몇 번 써본 뒤(VISIT_THRESHOLD번째 홈 방문)부터만 — 첫인상에 안 물어봐요.
 * - 시간창(F4)·지표 상세(F5) 중 하나라도 실제로 열어본 사용자에게만 — 홈만 스치듯 보고
 *   끝난 사람 말고, 기능을 충분히 활용한 사람에게 물어봐요.
 * 평생 딱 한 번만 시도해요(reviewRequested). OS/토스 쪽에서도 자체적으로 노출 빈도를
 * 제한하지만, 그거랑 별개로 우리가 반복해서 부르지 않아요.
 *
 * ready가 true로 바뀌는 첫 순간(=이번 Home 마운트에서 판정 데이터를 처음 성공적으로 보여준
 * 순간)에만 "방문 1회"로 세요 — 프로필 탭을 왔다갔다 하면서 ready가 여러 번 true가 돼도
 * 중복으로 세지 않아요.
 */
export function useReviewPrompt(ready: boolean) {
  const countedRef = useRef(false);

  useEffect(() => {
    if (!ready || countedRef.current) return;
    countedRef.current = true;

    let cancelled = false;

    async function maybePrompt() {
      const alreadyRequested = await getStoredJSON(STORAGE_KEYS.reviewRequested, false);
      if (alreadyRequested || cancelled) return;

      const visitCount = (await getStoredJSON(STORAGE_KEYS.homeVisitCount, 0)) + 1;
      await setStoredJSON(STORAGE_KEYS.homeVisitCount, visitCount);
      if (cancelled) return;

      const usedDetailFeature = await getStoredJSON(STORAGE_KEYS.usedDetailFeature, false);
      if (visitCount < VISIT_THRESHOLD || !usedDetailFeature) return;

      // 브릿지 없는 환경(브라우저 프리뷰 등)에서는 isSupported()도 동기적으로 throw할 수
      // 있어요 — 그럴 땐 reviewRequested를 건드리지 않고 다음 방문에서 다시 시도해요.
      try {
        if (!requestReview.isSupported()) return;
        await requestReview();
      } catch {
        return;
      }

      // 다이얼로그가 실제로 떴는지는 알 수 없지만, 시도 자체는 평생 한 번으로 충분해요.
      if (!cancelled) void setStoredJSON(STORAGE_KEYS.reviewRequested, true);
    }

    void maybePrompt();
    return () => {
      cancelled = true;
    };
  }, [ready]);
}
