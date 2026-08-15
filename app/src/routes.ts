/**
 * 화면 경로 상수.
 * docs/오늘나가도되나_디자인프레임.html "어느 버튼이 어디로 가는지" 화면 흐름도 기준(F1~F16).
 * MemoryRouter를 쓰므로 실제 주소창에는 노출되지 않아요.
 *
 * F10(알림 동의)·F11(로딩 스켈레톤)·F12(오프라인 폴백)·F15(겨울 모드)는
 * 별도 경로가 아니라 다른 화면 안에서 상태로 처리돼요 — 화면 흐름도의 "같은 화면"/"시스템" 표시 참고.
 */
export const ROUTES = {
  onboarding: "/", // F1 최초 진입 · 위치 확인 (홈과 같은 셸, 판정 카드 자리에 권한 카드)
  home: "/home", // F2·F3·F7 홈 — 탭으로 묶인 허브 (반려견/야외작업/러너)
  timeline: "/timeline", // F4 시간창
  details: "/details", // F5 지표 상세
  rainDetail: "/rain-detail", // 비 상세 — F1~F16 화면 흐름도엔 없음. 강수 필드가 디자인프레임보다 나중에 생겼어요.
  locationDenied: "/location-denied", // F6 위치 권한 거부
  settings: "/settings", // F8 설정
  regionSearch: "/region-search", // F9 지역 검색·추가
  rewardGate: "/reward-gate", // F13 리워드 광고 게이트
  share: "/share", // F14 공유하기
  dataSource: "/data-source", // F16 데이터 출처 안내
} as const;
