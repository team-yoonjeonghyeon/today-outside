import { useEffect } from "react";

/**
 * pull-to-refresh(위에서 당겨 새로고침) 제스처를 이 화면에 있는 동안만 비활성화해요.
 *
 * MemoryRouter를 쓰는 우리 앱에서 P2R로 리로드가 일어나면 라우팅 스택이 초기화되고
 * `location.state`로 넘긴 진입 맥락이 소실돼서 F1 온보딩으로 튕겨나요.
 * F4 시간창·F5 지표 상세·F6 위치 권한 거부·F9 지역 검색처럼 state에 의존하는 화면에서만
 * 이 훅을 호출해서 사고를 막아요.
 *
 * 두 겹으로 막아요.
 * 1) `overscroll-behavior-y: contain` — Android WebView와 최신 iOS 사파리에서 P2R을 차단
 * 2) 페이지 최상단에서 아래로 당기는 touchmove만 preventDefault — iOS WKWebView가 위 CSS를
 *    무시하는 경우(사파리 16 이하, 앱인토스 WKWebView 실측 확인)의 확실한 폴백
 *
 * 일반적인 세로 스크롤·바운스 감각은 유지돼요 — `scrollTop <= 0`이고 손가락이 아래로 움직일
 * 때만 preventDefault를 걸어서 P2R 진입 순간만 정확히 차단해요.
 *
 * 언마운트 시 CSS 값을 복원하고 이벤트 리스너를 제거해서 다른 화면에는 영향을 주지 않아요.
 */
export function useDisablePullToRefresh() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    /* ── CSS 1차 방어선 ── */
    const prevHtml = html.style.overscrollBehaviorY;
    const prevBody = body.style.overscrollBehaviorY;
    html.style.overscrollBehaviorY = "contain";
    body.style.overscrollBehaviorY = "contain";

    /* ── JS 폴백 (iOS WKWebView 대응) ── */
    let startY = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        startY = e.touches[0].clientY;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;

      const currentY = e.touches[0].clientY;
      const isPullingDown = currentY > startY;

      // 페이지 최상단 판별 — 브라우저마다 참조 위치가 달라서 세 값 중 하나라도 0 이하면 최상단
      const scrollTop =
        window.scrollY ||
        html.scrollTop ||
        body.scrollTop ||
        0;

      // 최상단에서 아래로 당기는 순간만 차단. 일반 스크롤·위로 스와이프는 그대로 통과.
      if (isPullingDown && scrollTop <= 0) {
        e.preventDefault();
      }
    };

    // touchmove는 반드시 { passive: false } — 아니면 preventDefault가 무시돼요.
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      html.style.overscrollBehaviorY = prevHtml;
      body.style.overscrollBehaviorY = prevBody;
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, []);
}
