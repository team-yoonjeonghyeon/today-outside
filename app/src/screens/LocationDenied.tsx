import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertDialog, Asset, List, ListRow, Paragraph, Spacing, Text, TextButton } from "@toss/tds-mobile";
import { adaptive } from "@toss/tds-colors";
import { Accuracy, getCurrentLocation, share } from "@apps-in-toss/web-framework";
import { MINT } from "../constants/judge";
import {
  BASE_SAVED_REGIONS,
  SHARE_BONUS_REGIONS,
  useSavedRegions,
} from "../hooks/useSavedRegions";
import { coarseLocationLabel } from "../lib/regions";
import { useBackNavigation } from "../hooks/useBackNavigation";
import { useDisablePullToRefresh } from "../hooks/useDisablePullToRefresh";
import { ROUTES } from "../routes";

// 앱빌더 F6("지역선택화면") 목업 기준 — 지도 위에 핀이 있는 아이콘이에요. 디자인프레임 html은
// 이 자리를 간단히 📍로만 적어놨는데, 실제 앱빌더 에셋은 uE116(지도+핀)이라 이쪽을 따랐어요.
const MAP_PIN_ICON = "https://static.toss.im/2d-icons/emoji/png/4x/uE116.png";
// 지역 리스트 아이템 아이콘 — 193개 전 지역에 형평 있게, 건물 아이콘 하나로 통일해요
// (RegionSearch.tsx 검색 결과와 동일한 아이콘).
const REGION_ICON = "https://static.toss.im/2d-icons/emoji/png/4x/u1F3E2.png";
// 잠긴 슬롯(공유하면 열리는 칸)에 쓰는 자물쇠 아이콘.
const LOCK_ICON = "https://static.toss.im/2d-icons/emoji/png/4x/u1F512.png";
// 화면에 보여주는 총 저장 칸 수 = 기본 1칸 + 공유 보너스 1칸. 공유 전에는 보너스 칸이 잠겨 보여요.
const TOTAL_SLOTS = BASE_SAVED_REGIONS + SHARE_BONUS_REGIONS;

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

// F6 위치 권한 거부 · 지역 고르기. docs/오늘나가도되나_디자인프레임.html F6 참고.
// 정책: 권한을 안 줘도 나머지 기능이 100% 같아야 해요 — 저장한 지역(기본 1개·공유하면 2개) 목록이 그 대안이에요.
// 자체 뒤로가기·타이틀은 렌더링하지 않아요 — 내비게이션 바는 앱인토스가 제공해요 (CLAUDE.md 제약).
//
// 홈의 지역 바꾸기 바텀시트 "지역 설정 전체보기"에서도 이 화면을 재사용해요 — 그때는 위치 권한이
// 이미 있는 상태라서 { state: { permissionGranted: true } }로 넘어와요. 권한이 있으면
// "위치를 확인할 수 없어요" 문구·재요청 링크는 거짓이 되니 숨겨요 (정직성 원칙).
interface LocationDeniedNavState {
  permissionGranted?: boolean;
}

export default function LocationDenied() {
  useBackNavigation();
  useDisablePullToRefresh();

  const navigate = useNavigate();
  const location = useLocation();
  const { savedRegions, removeRegion, maxRegions, hasShareBonus, grantShareBonus } = useSavedRegions();
  const permissionGranted = Boolean((location.state as LocationDeniedNavState | null)?.permissionGranted);
  const [sharing, setSharing] = useState(false);
  const [bonusPopupOpen, setBonusPopupOpen] = useState(false);

  const handleFindOtherRegion = () => {
    navigate(ROUTES.regionSearch);
  };

  // 잠긴 칸을 누르면 친구에게 공유하고, 공유를 마치면 그 칸이 열려요. 공유를 취소·실패하거나
  // 브릿지가 없으면 잠긴 채로 둬요 (정직성 원칙 — 공유 안 했는데 열어주지 않아요).
  const handleShareForBonus = async () => {
    if (sharing || hasShareBonus) return;
    setSharing(true);
    const shared = await runShare();
    if (shared) {
      await grantShareBonus();
      setBonusPopupOpen(true);
    }
    setSharing(false);
  };

  const handleReRequestPermission = async () => {
    try {
      const status = await getCurrentLocation.openPermissionDialog();
      if (status !== "allowed") return; // 'denied' — 이미 이 화면(F6)에 있으니 추가 안내 없이 그대로 둬요.

      const { coords } = await getCurrentLocation({ accuracy: Accuracy.Balanced });
      const { nx, ny, label } = coarseLocationLabel(coords.latitude, coords.longitude);
      navigate(ROUTES.home, { state: { nx, ny, label, lat: coords.latitude, lon: coords.longitude } });
    } catch {
      // 다이얼로그 호출 실패·권한은 허용됐지만 위치 조회 자체가 실패한 경우 등 — 이 화면에 그대로 머물러요.
    }
  };

  return (
    <>
      <div style={{ padding: "36px 24px 0", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", margin: "0 auto 8px" }}>
          <Asset.Image
            frameShape={{ width: 100, height: 100 }}
            backgroundColor="transparent"
            src={MAP_PIN_ICON}
            aria-hidden={true}
            style={{ aspectRatio: "1/1" }}
          />
        </div>

        <Text color={adaptive.grey900} typography="t3" fontWeight="bold">
          지역을 고르면 바로 볼 수 있어요
        </Text>

        <Spacing size={11} />

        <Paragraph.Text color={adaptive.grey700} fontWeight="medium">
          기본 1곳을 저장할 수 있고, 친구에게 공유하면 1곳이 더 열려요.
        </Paragraph.Text>
      </div>

      <Spacing size={28} />

      <div style={{ padding: "0 24px" }}>
        <Paragraph.Text color={adaptive.grey500} fontWeight="bold">
          {savedRegions.length > 0 ? "저장한 지역" : "아직 저장한 지역이 없어요"}
        </Paragraph.Text>
      </div>

      {/* 저장 칸을 항상 TOTAL_SLOTS(2)개로 고정해서 보여줘요 — 채워진 칸 / 열린 빈 칸 / 잠긴 칸.
          공유 전에는 마지막 칸이 자물쇠로 잠겨 있고, 공유하면 그 칸이 "＋ 다른 지역 찾기"로 열려요. */}
      <List>
        {Array.from({ length: TOTAL_SLOTS }).map((_, i) => {
          const region = savedRegions[i];

          // 1) 채워진 칸 — 저장된 지역
          if (region) {
            return (
              <ListRow
                key={`filled-${region.name}`}
                left={
                  <ListRow.AssetImage
                    src={REGION_ICON}
                    shape="squircle"
                    backgroundColor={adaptive.greyOpacity100}
                    size="xsmall"
                  />
                }
                contents={
                  <ListRow.Texts type="1RowTypeA" top={region.name} topProps={{ color: adaptive.grey800 }} />
                }
                right={
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {region.levelLabel && (
                      <ListRow.Texts
                        type="Right1RowTypeA"
                        top={region.levelLabel}
                        topProps={{ color: region.levelColor, fontWeight: "bold" }}
                      />
                    )}
                    <button
                      type="button"
                      aria-label={`${region.name} 저장 해제`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeRegion(region.name);
                      }}
                      style={{
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        padding: 6,
                        fontSize: 15,
                        fontWeight: 700,
                        color: adaptive.grey400,
                        lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                }
                verticalPadding="large"
                onClick={() => {
                  navigate(ROUTES.home, {
                    state: { nx: region.nx, ny: region.ny, label: region.name },
                  });
                }}
              />
            );
          }

          // 2) 잠긴 칸 — 아직 공유 보너스를 못 받아 열리지 않은 칸. 누르면 공유 → 열림.
          if (i >= maxRegions) {
            return (
              <ListRow
                key={`locked-${i}`}
                left={
                  <ListRow.AssetImage
                    src={LOCK_ICON}
                    shape="squircle"
                    backgroundColor={adaptive.greyOpacity100}
                    size="xsmall"
                  />
                }
                contents={
                  <ListRow.Texts
                    type="2RowTypeA"
                    top={sharing ? "공유하는 중…" : "잠긴 칸"}
                    topProps={{ color: adaptive.grey500, fontWeight: "bold" }}
                    bottom="친구에게 공유하면 열려요"
                    bottomProps={{ color: adaptive.grey500 }}
                  />
                }
                right={
                  <span
                    style={{
                      display: "inline-block",
                      background: MINT[400],
                      color: MINT[900],
                      fontSize: 12,
                      fontWeight: 700,
                      padding: "7px 12px",
                      borderRadius: 10,
                      opacity: sharing ? 0.6 : 1,
                    }}
                  >
                    공유하고 열기
                  </span>
                }
                verticalPadding="large"
                onClick={() => void handleShareForBonus()}
              />
            );
          }

          // 3) 열린 빈 칸 — 다른 지역을 찾아 채울 수 있어요.
          return (
            <ListRow
              key={`empty-${i}`}
              contents={
                <Paragraph.Text color={MINT[700]} fontWeight="bold">
                  ＋ 다른 지역 찾기
                </Paragraph.Text>
              }
              verticalPadding="large"
              onClick={handleFindOtherRegion}
            />
          );
        })}
      </List>

      {!permissionGranted && (
        <>
          <Spacing size={28} />
          <div style={{ textAlign: "center" }}>
            <TextButton size="small" variant="underline" color={adaptive.grey500} onClick={handleReRequestPermission}>
              위치 권한 다시 확인하기
            </TextButton>
          </div>
        </>
      )}

      <Spacing size={16} />

      {/* 공유 성공 → 잠긴 칸이 열렸음을 알리는 축하 팝업. 확인을 누르면 닫혀요. */}
      <AlertDialog
        open={bonusPopupOpen}
        title={<AlertDialog.Title>{"공유해줘서 고마워요\n잠긴 칸이 열렸어요"}</AlertDialog.Title>}
        description={
          <AlertDialog.Description>
            이제 자주 가는 곳을 2곳까지 저장할 수 있어요.
          </AlertDialog.Description>
        }
        alertButton={
          <AlertDialog.AlertButton onClick={() => setBonusPopupOpen(false)}>
            좋아요
          </AlertDialog.AlertButton>
        }
        onClose={() => setBonusPopupOpen(false)}
      />
    </>
  );
}
