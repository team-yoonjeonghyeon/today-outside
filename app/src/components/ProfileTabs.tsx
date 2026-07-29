import { SegmentedControl } from "@toss/tds-mobile";
import { PROFILE_META, PROFILE_ORDER, type Profile } from "../constants/judge";

interface ProfileTabsProps {
  value: Profile;
  onChange: (profile: Profile) => void;
  // F1(위치 확인 전)처럼 프로필별로 보여줄 데이터가 아직 없을 때 탭 전환을 막아요.
  // TDS SegmentedControl은 disabled를 지원하지 않아서 클릭을 막고 톤을 낮추는 방식으로 흉내내요.
  disabled?: boolean;
}

// F1/F2/F3/F7 공통 프로필 스위처. 디자인프레임 .tabbar 참고.
// 홈(F2·F3·F7)과 F1(진입) 모두 이 탭바를 얹은 같은 셸을 써요 — 화면 흐름도 참고.
// 라벨은 이모지 없이 텍스트만 써요 — 이모지를 붙이면 좁은 화면에서 두 줄로 줄바꿈됐어요.
//
// "반려견 산책"이 기본 크기(17px)에서 좁은 화면이면 두 줄로 줄바꿈됐어요. 15px로 살짝만
// 줄여요(기본 17px보다는 크게 안 티나요). SegmentedControl.Item의 style prop은 숨겨진
// <input>에만 적용되고 실제 보이는 글자는 내부 .tds-mobile-paragraph__text 스팬이 그려서,
// 이 컴포넌트 스코프 CSS로 폰트를 줄여요.
//
// 이 탭바를 감싸는 화면 쪽 div는 항상 24px 좌우 패딩을 줘요 — 화면의 다른 제목·버튼·카드가
// 전부 24px 패딩을 쓰는 것과 맞추기 위해서예요 (Home.tsx·Onboarding.tsx 둘 다 동일).
// 근데 SegmentedControl 자체도 바로 안쪽에 24px 좌우 패딩을 자체적으로 갖고 있어서, 화면 쪽
// 24px + 이 내부 24px이 겹쳐 이중으로 좁아졌어요(총 48px 인셋). 내부 쪽을 0으로 없애서
// 실제 폭이 화면 쪽 24px 딱 하나만큼만 좁아지게 맞춰요.
export function ProfileTabs({ value, onChange, disabled = false }: ProfileTabsProps) {
  return (
    <div
      className="profile-tabs"
      aria-disabled={disabled}
      style={disabled ? { opacity: 0.45, pointerEvents: "none" } : undefined}
    >
      <style>{`
        .profile-tabs .tds-mobile-paragraph__text { font-size: 15px; }
        .profile-tabs > div { padding-left: 0 !important; padding-right: 0 !important; }
      `}</style>
      <SegmentedControl value={value} onChange={(v) => onChange(v as Profile)}>
        {PROFILE_ORDER.map((profile) => (
          <SegmentedControl.Item key={profile} value={profile}>
            {PROFILE_META[profile].label}
          </SegmentedControl.Item>
        ))}
      </SegmentedControl>
    </div>
  );
}
