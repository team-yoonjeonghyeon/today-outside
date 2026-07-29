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
export function ProfileTabs({ value, onChange, disabled = false }: ProfileTabsProps) {
  return (
    <div
      aria-disabled={disabled}
      style={disabled ? { opacity: 0.45, pointerEvents: "none" } : undefined}
    >
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
