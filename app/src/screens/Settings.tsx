import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Chip, ChipItem, List, ListRow, Menu, Post, Spacing, Switch } from "@toss/tds-mobile";
import { adaptive } from "@toss/tds-colors";
import { share } from "@apps-in-toss/web-framework";
import { MINT, PROFILE_META, PROFILE_ORDER } from "../constants/judge";
import { useLastProfile } from "../hooks/useLastProfile";
import { useNotificationPrefs } from "../hooks/useNotificationPrefs";
import { useSavedRegions } from "../hooks/useSavedRegions";
import { useBackNavigation } from "../hooks/useBackNavigation";
import { getAnonKey, requestAgreement } from "../lib/notifications";
import { subscribeNotification, unsubscribeNotification, type NotificationType } from "../lib/judgeApi";
import { ROUTES } from "../routes";

// F8 설정. 앱빌더에서 파트너가 준 화면 코드를 기준으로 만들었어요(docs 목업 대신).
// 자체 뒤로가기·타이틀은 렌더링하지 않아요 — 내비게이션 바는 앱인토스가 제공해요 (CLAUDE.md 제약).

// 저장 장소는 기본 1개예요. 친구에게 한 번 공유하면(공유 시트에서 실제로 공유를 마치면)
// 보너스로 1개가 더 열려서 총 2개까지 저장할 수 있어요.
const SHARE_MESSAGE =
  "오늘 나가도 되나 — 지금 우리 동네 나가도 되는지 등급으로 알려줘요. 같이 써요!";

// 네이티브 공유 시트를 띄우고, 사용자가 공유를 마치면(Promise resolve) true를 돌려줘요.
// 브릿지가 없는 환경(브라우저 프리뷰 등)에서는 동기적으로 throw할 수 있어서 try/catch로 감싸요.
async function runShare(): Promise<boolean> {
  try {
    await share({ message: SHARE_MESSAGE });
    return true;
  } catch {
    return false;
  }
}

export default function Settings() {
  useBackNavigation();

  const navigate = useNavigate();
  const [profile, setProfile] = useLastProfile();
  const { savedRegions, primaryRegion, removeRegion, maxRegions, hasShareBonus, grantShareBonus } =
    useSavedRegions();
  const { prefs, setPrefs } = useNotificationPrefs();
  const [startTabSheetOpen, setStartTabSheetOpen] = useState(false);
  const [sharing, setSharing] = useState(false);

  const togglePref = async (key: NotificationType) => {
    const turningOn = !prefs[key];

    // 끄는 건 로컬 선호를 바로 끄면 되지만, 켜는 건 실제 동의 UI를 띄우고 사용자가 동의해야만
    // 켜져요. 거부하거나 동의 UI 자체를 못 띄우면(브릿지 없음 등) 켜지지 않아요.
    if (turningOn) {
      const agreed = await requestAgreement(key);
      if (!agreed) return;
    }

    void setPrefs({ ...prefs, [key]: turningOn });

    // 동의는 이미 받았으니(또는 끄는 거니) 토글은 반영하고, 서버 구독 저장/해제는
    // best-effort로 뒤에서 처리해요 — 실패해도 화면엔 영향 없어요.
    const anonKey = await getAnonKey();
    if (!anonKey) return;
    if (turningOn) {
      // 알림 기준은 내 장소 한 곳이에요 — 저장한 지역 전부가 아니라요. 예전엔 savedRegions를
      // 통째로 보냈는데, GPS로만 쓰던 사용자는 그 목록이 비어 있어서 보낼 대상이 없는 구독이
      // 만들어졌어요. 내 장소는 Onboarding·↻·F9에서 항상 확정되니 그 구멍이 없어요.
      if (!primaryRegion) return;
      void subscribeNotification({
        anonKey,
        type: key,
        profile,
        regions: [primaryRegion],
      });
    } else {
      void unsubscribeNotification(anonKey, key);
    }
  };

  const canAddRegion = savedRegions.length < maxRegions;

  // 친구에게 공유하고, 공유를 마치면 저장 장소 1개를 더 열어줘요. 공유 시트를 못 띄우거나
  // 사용자가 공유를 취소·실패하면 아무 것도 열리지 않아요(정직성 원칙 — 공유 안 했는데
  // 열어주지 않아요). 이미 보너스를 받았으면 이 버튼 자체가 사라져서 여기 오지 않아요.
  const handleShareForBonus = async () => {
    if (sharing || hasShareBonus) return;
    setSharing(true);
    const shared = await runShare();
    if (shared) await grantShareBonus();
    setSharing(false);
  };

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
          // Menu.Trigger의 루트 엘리먼트가 inline-block이라 내용 크기만큼만 차지해서, 화살표(>)가
          // 데이터 출처 같은 일반 ListRow보다 왼쪽에 붙어 보였어요. `> div` 셀렉터로 override하는
          // 대신(라이브러리 내부 DOM 구조·클래스가 버전마다 바뀌면 깨져요) style prop을 직접 넘겨요 —
          // MenuTriggerProps가 ComponentPropsWithoutRef<'div'>를 확장해서 인라인 스타일로 전달되고,
          // 인라인 스타일은 라이브러리 내부 클래스 우선순위와 무관하게 항상 이겨요.
          style={{ display: "block", width: "100%" }}
          open={startTabSheetOpen}
          onOpen={() => setStartTabSheetOpen(true)}
          onClose={() => setStartTabSheetOpen(false)}
          placement="bottom-start"
          dropdown={
            // placement="bottom-start"는 Trigger(행 전체)의 왼쪽 끝, 즉 화면 벽에 드롭다운을
            // 붙여요. 그래서 드롭다운 쪽에 라벨 텍스트가 시작하는 지점(아이콘 폭 + 여백)만큼
            // 왼쪽 여백을 줘서, 화면 벽이 아니라 "반려견 산책" 글자 아래에서 뜨는 것처럼 보이게 해요.
            <div style={{ marginLeft: 44 }}>
              <Menu.Dropdown header={<Menu.Header>시작 탭 고르기</Menu.Header>}>
                {PROFILE_ORDER.map((p) => {
                  const isSelected = profile === p;
                  return (
                    // Menu.DropdownCheckItem(checked/onCheckedChange)은 클릭해도 선택이 안 바뀌는
                    // 버그가 있어서, Home.tsx 지역 드롭다운이랑 같은 방식(DropdownItem + onClick)으로
                    // 바꿨어요 — 선택 표시는 체크박스 대신 텍스트 색으로만 줘요.
                    <Menu.DropdownItem
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
                      onClick={() => {
                        setProfile(p);
                        setStartTabSheetOpen(false);
                      }}
                    >
                      <span style={{ color: isSelected ? MINT[700] : undefined, fontWeight: isSelected ? 700 : undefined }}>
                        {PROFILE_META[p].label}
                      </span>
                    </Menu.DropdownItem>
                  );
                })}
              </Menu.Dropdown>
            </div>
          }
        >
          {/* Menu.Trigger가 이 자식을 cloneElement로 감싸 id·aria-* props를 얹기 때문에, ListRow에
              직접 얹기보다 div로 한 번 더 감싸서 받아요 — width:100%도 여기서 함께 보장돼요. */}
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
          {`지역 · 최대 ${maxRegions}개`}
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
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 18,
                    height: 18,
                    marginLeft: 8,
                    marginRight: 8,
                    borderRadius: "50%",
                    background: adaptive.grey200,
                    color: adaptive.grey600,
                    fontSize: 11,
                    fontWeight: 700,
                    lineHeight: 1,
                    cursor: "pointer",
                  }}
                >
                  ✕
                </span>
              }
            >
              {/* 목록의 첫 칸이 곧 내 장소(알림 기준)예요. 자리가 2개일 땐 어느 쪽이 기준인지
                  글자만 봐선 알 수 없어서 배지를 붙여요. 1개뿐이면 물어볼 것도 없어서 생략해요. */}
              {region.name === primaryRegion?.name && maxRegions > 1 ? (
                <>
                  {region.name}
                  <span
                    style={{
                      marginLeft: 6,
                      padding: "2px 6px",
                      borderRadius: 6,
                      background: MINT[50],
                      color: MINT[700],
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    내 장소
                  </span>
                </>
              ) : (
                region.name
              )}
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

      {/* 아직 공유 보너스를 안 받았으면, 공유하고 장소 1개를 더 열 수 있게 안내해요.
          한 번 받고 나면(hasShareBonus) 이 영역은 사라지고 최대치가 2개로 늘어나요. */}
      {!hasShareBonus && (
        <>
          <Spacing size={10} />
          <div style={{ padding: "0 24px" }}>
            <button
              type="button"
              onClick={() => void handleShareForBonus()}
              disabled={sharing}
              style={{
                width: "100%",
                border: "none",
                borderRadius: 14,
                padding: "13px 16px",
                background: MINT[400],
                color: MINT[900],
                fontSize: 15,
                fontWeight: 700,
                cursor: sharing ? "default" : "pointer",
                opacity: sharing ? 0.6 : 1,
              }}
            >
              {sharing ? "공유 중…" : "🎁 친구에게 공유하고 장소 1개 더 받기"}
            </button>
            <Post.Paragraph paddingBottom={0} color={adaptive.grey500} typography="st12">
              친구에게 한 번 공유하면 저장 장소가 2개로 늘어나요.
            </Post.Paragraph>
          </div>
        </>
      )}

      <Spacing size={20} />

      <div style={{ padding: "0 24px" }}>
        <Post.Paragraph paddingBottom={2} color={adaptive.grey500} typography="st9" fontWeight="bold">
          알림
        </Post.Paragraph>
        {/* 알림이 어디 기준으로 오는지 안 보이면 사용자는 알 방법이 없어요 (정직성 원칙).
            내 장소는 홈의 ↻ 또는 지역 검색에서 바꿀 수 있다는 것도 같이 적어줘요. */}
        <Post.Paragraph paddingBottom={8} color={adaptive.grey500} typography="st12">
          {primaryRegion
            ? `${primaryRegion.name} 기준이에요 · 홈의 ↻로 바꿀 수 있어요`
            : "내 장소를 먼저 정하면 알림을 받을 수 있어요"}
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
            <Switch checked={prefs.morningBriefing} onChange={() => void togglePref("morningBriefing")} />
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
          right={<Switch checked={prefs.dangerAlert} onChange={() => void togglePref("dangerAlert")} />}
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
          right={<Switch checked={prefs.walkTimeAlert} onChange={() => void togglePref("walkTimeAlert")} />}
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
