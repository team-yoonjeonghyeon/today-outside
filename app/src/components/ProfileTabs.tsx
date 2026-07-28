import { SegmentedControl } from "@toss/tds-mobile";
import { PROFILE_META, PROFILE_ORDER, type Profile } from "../constants/judge";

interface ProfileTabsProps {
  value: Profile;
  onChange: (profile: Profile) => void;
}

// F1/F2/F3/F7 공통 프로필 스위처. 디자인프레임 .tabbar 참고.
// 홈(F2·F3·F7)과 F1(진입) 모두 이 탭바를 얹은 같은 셸을 써요 — 화면 흐름도 참고.
export function ProfileTabs({ value, onChange }: ProfileTabsProps) {
  return (
    <SegmentedControl value={value} onChange={(v) => onChange(v as Profile)}>
      {PROFILE_ORDER.map((profile) => (
        <SegmentedControl.Item key={profile} value={profile}>
          {`${PROFILE_META[profile].emoji} ${PROFILE_META[profile].label}`}
        </SegmentedControl.Item>
      ))}
    </SegmentedControl>
  );
}
