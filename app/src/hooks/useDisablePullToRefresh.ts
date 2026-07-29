import { useEffect } from "react";

/**
 * pull-to-refresh(위에서 당겨 새로고침) 제스처를 이 화면에 있는 동안만 비활성화해요.
 *
 * MemoryRouter를 쓰는 우리 앱에서 P2R로 리로드가 일어나면 라우팅 스택이 초기화되고
 * `location.state`로 넘긴 진입 맥락이 소실돼서 F1 온보딩으로 튕겨나요.
 * F4 시간창·F5 지표 상세·F6 위치 권한 거부·F9 지역 검색처럼 state에 의존하는 화면에서만
 * 이 훅을 호출해서 사고를 막아요.
 *
 * 스크롤 끝에서 살짝 튕기는 감각(rubber-band)은 그대로 유지돼요 — `overscroll-behavior-y: contain`은
 * 스크롤 체인만 끊고 페이지 이동/새로고침만 막아요.
 *
 * 언마운트 시 이전 값으로 복원해서 다른 화면에는 영향을 주지 않아요.
 */
export function useDisablePullToRefresh() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    const prevHtml = html.style.overscrollBehaviorY;
    const prevBody = body.style.overscrollBehaviorY;

    html.style.overscrollBehaviorY = "contain";
    body.style.overscrollBehaviorY = "contain";

    return () => {
      html.style.overscrollBehaviorY = prevHtml;
      body.style.overscrollBehaviorY = prevBody;
    };
  }, []);
}
