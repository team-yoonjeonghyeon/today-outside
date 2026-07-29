import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Chip, ChipItem, List, ListRow, Menu, Post, Spacing, Switch } from "@toss/tds-mobile";
import { adaptive } from "@toss/tds-colors";
import { PROFILE_META, PROFILE_ORDER } from "../constants/judge";
import { useLastProfile } from "../hooks/useLastProfile";
import { useSavedRegions, MAX_SAVED_REGIONS } from "../hooks/useSavedRegions";
import { useBackNavigation } from "../hooks/useBackNavigation";
import { getStoredJSON, setStoredJSON, STORAGE_KEYS } from "../lib/storage";
import { ROUTES } from "../routes";

// F8 설정. 앱빌더에서 파트너가 준 화면 코드를 기준으로 만들었어요(docs 목업 대신).
// 자체 뒤로가기·타이틀은 렌더링하지 않아요 — 내비게이션 바는 앱인토스가 제공해요 (CLAUDE.md 제약).

interface NotificationPrefs {
  morningBriefing: boolean;
  dangerAlert: boolean;
  walkTimeAlert: boolean;
}

// 실제로 알림을 보내는 백엔드(예약 발송)가 아직 없어서 전부 꺼진 상태로 시작해요 — 마치 이미
// 구독 중인 것처럼 기본값을 켜두면 실제로는 아무것도 오지 않는데 왔다고 오해할 수 있어요
// (정직성 원칙). 토글은 지금은 "받고 싶어요"라는 선호만 저장해요.
const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  morningBriefing: false,
  dangerAlert: false,
  walkTimeAlert: false,
};

export default function Settings() {
  useBackNavigation();

  const navigate = useNavigate();
  const [profile, setProfile] = useLastProfile();
  const { savedRegions, removeRegion } = useSavedRegions();
  const [startTabSheetOpen, setStartTabSheetOpen] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);

  useEffect(() => {
    let cancelled = false;
    getStoredJSON(STORAGE_KEYS.notificationPrefs, DEFAULT_NOTIFICATION_PREFS).then((stored) => {
      if (!cancelled) setPrefs(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const togglePref = (key: keyof NotificationPrefs) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      void setStoredJSON(STORAGE_KEYS.notificationPrefs, next);
      return next;
    });
  };

  const canAddRegion = savedRegions.length < MAX_SAVED_REGIONS;

  return (
    <>
      <Spacing size={16} />

      <div style={{ padding: "0 24px" }}>
        <Post.Paragraph paddingBottom={8} color={adaptive.grey500} typography="st9" fontWeight="bold">
          시작 탭
        </Post.Paragraph>
      </div>

      <List>
        <Menu.Trigger
          open={startTabSheetOpen}
          onOpen={() => setStartTabSheetOpen(true)}
          onClose={() => setStartTabSheetOpen(false)}
          placement="bottom"
          dropdown={
            <Menu.Dropdown header={<Menu.Header>시작 탭 고르기</Menu.Header>}>
              {PROFILE_ORDER.map((p) => (
                <Menu.DropdownCheckItem
                  key={p}
                  left={
                    <img
                      src={PROFILE_META[p].icon}
                      alt=""
                      width={20}
                      height={20}
                      style={{ borderRadius: 6, display: "block" }}
                    />
                  }
                  checked={profile === p}
                  onCheckedChange={(checked) => {
                    if (checked) setProfile(p);
                    setStartTabSheetOpen(false);
                  }}
                >
                  {PROFILE_META[p].label}
                </Menu.DropdownCheckItem>
              ))}
            </Menu.Dropdown>
          }
        >
          {/* Menu.Trigger가 자식을 내용 크기만큼만 감싸서(inline-block 계열), ListRow를 바로
              넣으면 화면 전체 너비를 못 채워 화살표(>)가 오른쪽 끝이 아니라 글자 바로 뒤에
              붙어 보였어요. width:100%로 강제해서 다른 행들과 같은 폭이 되게 해요. */}
          <div style={{ width: "100%" }}>
            <ListRow
              left={
                <ListRow.AssetImage
                  src={PROFILE_META[profile].icon}
                  shape="squircle"
                  backgroundColor={adaptive.greyOpacity100}
                  size="xsmall"
                />
              }
              contents={
                <ListRow.Texts
                  type="2RowTypeA"
                  top={PROFILE_META[profile].label}
                  topProps={{ color: adaptive.grey800, fontWeight: "bold" }}
                  bottom="앱을 열면 이 탭부터 보여줘요"
                  bottomProps={{ color: adaptive.grey600 }}
                />
              }
              withArrow
              verticalPadding="large"
              onClick={() => setStartTabSheetOpen(true)}
            />
          </div>
        </Menu.Trigger>
      </List>

      <Spacing size={20} />

      <div style={{ padding: "0 24px" }}>
        <Post.Paragraph paddingBottom={8} color={adaptive.grey500} typography="st9" fontWeight="bold">
          {`지역 · 최대 ${MAX_SAVED_REGIONS}개`}
        </Post.Paragraph>
      </div>

      <div style={{ padding: "0 16px" }}>
        <Chip kind="action" margin="small" wrap>
          {savedRegions.map((region) => (
            <ChipItem
              key={region.name}
              right={
                <span
                  role="button"
                  aria-label={`${region.name} 저장 해제`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeRegion(region.name);
                  }}
                  style={{ fontWeight: 700, color: adaptive.grey400 }}
                >
                  ✕
                </span>
              }
            >
              {region.name}
            </ChipItem>
          ))}
          <ChipItem
            disabled={!canAddRegion}
            onClick={() => {
              if (canAddRegion) navigate(ROUTES.regionSearch);
            }}
          >
            ＋ 추가
          </ChipItem>
        </Chip>
      </div>

      <Spacing size={20} />

      <div style={{ padding: "0 24px" }}>
        <Post.Paragraph paddingBottom={8} color={adaptive.grey500} typography="st9" fontWeight="bold">
          알림
        </Post.Paragraph>
      </div>

      <List>
        <ListRow
          left={
            <ListRow.AssetImage
              src="https://static.toss.im/2d-icons/emoji/png/4x/u1F304.png"
              shape="squircle"
              backgroundColor={adaptive.greyOpacity100}
              size="xsmall"
            />
          }
          contents={
            <ListRow.Texts
              type="2RowTypeA"
              top="아침 브리핑"
              topProps={{ color: adaptive.grey800, fontWeight: "bold" }}
              bottom="매일 오전 8:00 · 오늘 요약"
              bottomProps={{ color: adaptive.grey600 }}
            />
          }
          right={
            <Switch checked={prefs.morningBriefing} onChange={() => togglePref("morningBriefing")} />
          }
          verticalPadding="large"
        />
        <ListRow
          left={
            <ListRow.AssetImage
              src="https://static.toss.im/2d-icons/emoji/png/4x/u1F6A8.png"
              shape="squircle"
              backgroundColor={adaptive.greyOpacity100}
              size="xsmall"
            />
          }
          contents={
            <ListRow.Texts
              type="2RowTypeA"
              top="위험 시간대 알림"
              topProps={{ color: adaptive.grey800, fontWeight: "bold" }}
              bottom="체감온도가 위험 단계일 때"
              bottomProps={{ color: adaptive.grey600 }}
            />
          }
          right={<Switch checked={prefs.dangerAlert} onChange={() => togglePref("dangerAlert")} />}
          verticalPadding="large"
        />
        <ListRow
          left={
            <ListRow.AssetImage
              src="https://static.toss.im/2d-icons/emoji/png/4x/u1F43E.png"
              shape="squircle"
              backgroundColor={adaptive.greyOpacity100}
              size="xsmall"
            />
          }
          contents={
            <ListRow.Texts
              type="2RowTypeA"
              top="산책 추천 시간 알림"
              topProps={{ color: adaptive.grey800, fontWeight: "bold" }}
              bottom="반려견 산책 좋은 시간대만"
              bottomProps={{ color: adaptive.grey600 }}
            />
          }
          right={<Switch checked={prefs.walkTimeAlert} onChange={() => togglePref("walkTimeAlert")} />}
          verticalPadding="large"
        />
      </List>

      <Spacing size={20} />

      <div style={{ padding: "0 24px" }}>
        <Post.Paragraph paddingBottom={8} color={adaptive.grey500} typography="st9" fontWeight="bold">
          기타
        </Post.Paragraph>
      </div>

      <List>
        <ListRow
          left={
            <ListRow.AssetImage
              src="https://static.toss.im/2d-icons/emoji/png/4x/u1F4F6.png"
              shape="squircle"
              backgroundColor={adaptive.greyOpacity100}
              size="xsmall"
            />
          }
          contents={
            <ListRow.Texts
              type="2RowTypeA"
              top="데이터 출처"
              topProps={{ color: adaptive.grey800, fontWeight: "bold" }}
              bottom="기상청 공공데이터"
              bottomProps={{ color: adaptive.grey600 }}
            />
          }
          withArrow
          verticalPadding="large"
          onClick={() => navigate(ROUTES.dataSource)}
        />
        <ListRow
          left={
            <ListRow.AssetImage
              src="https://static.toss.im/2d-icons/emoji/png/4x/u2139.png"
              shape="squircle"
              backgroundColor={adaptive.greyOpacity100}
              size="xsmall"
            />
          }
          contents={
            <ListRow.Texts type="1RowTypeA" top="버전 정보" topProps={{ color: adaptive.grey800 }} />
          }
          right={
            <ListRow.Texts type="Right1RowTypeA" top="0.1.0" topProps={{ color: adaptive.grey600 }} />
          }
          verticalPadding="large"
        />
      </List>

      <Spacing size={16} />
    </>
  );
}
