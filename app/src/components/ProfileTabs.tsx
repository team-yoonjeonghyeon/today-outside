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
// "반려견 산책"이 기본 크기(17px)에서 좁은 화면이면 두 줄로 줄바꿈됐어요. 글자를 너무 줄이는
// 대신, 이 탭바를 감싸는 화면 쪽 좌우 패딩을 24px→8px로 줄여서 폭을 더 벌었어요(화면 쪽 padding
// 참고) — 그래도 여유가 부족할 수 있어 15px로 살짝만 줄여요(기본 17px보다는 크게 안 티나요).
//
// SegmentedControl.Item은 style prop을 받긴 하지만(InputHTMLAttributes 상속) 그건 숨겨진
// <input>에만 적용되고, 실제 보이는 글자는 내부의 .tds-mobile-paragraph__text 스팬이 그려요 —
// 그 스팬엔 prop으로 직접 손댈 방법이 없어서, 이 컴포넌트 안에서만 적용되는 스코프 CSS로 줄여요.
export function ProfileTabs({ value, onChange, disabled = false }: ProfileTabsProps) {
  return (
    <div
      className="profile-tabs"
      aria-disabled={disabled}
      style={disabled ? { opacity: 0.45, pointerEvents: "none" } : undefined}
    >
      <style>{`.profile-tabs .tds-mobile-paragraph__text { font-size: 15px; }`}</style>
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
