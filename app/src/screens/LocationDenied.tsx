import { useLocation, useNavigate } from "react-router-dom";
import { Asset, List, ListRow, Paragraph, Spacing, Text, TextButton } from "@toss/tds-mobile";
import { adaptive } from "@toss/tds-colors";
import { MINT, SAVED_REGIONS } from "../constants/judge";
import { ROUTES } from "../routes";

// F6 위치 권한 거부 · 지역 고르기. docs/오늘나가도되나_디자인프레임.html F6 참고.
// 정책: 권한을 안 줘도 나머지 기능이 100% 같아야 해요 — 저장한 지역(최대 3개) 목록이 그 대안이에요.
// 자체 뒤로가기·타이틀은 렌더링하지 않아요 — 내비게이션 바는 앱인토스가 제공해요 (CLAUDE.md 제약).
//
// 홈의 지역 바꾸기 바텀시트 "지역 설정 전체보기"에서도 이 화면을 재사용해요 — 그때는 위치 권한이
// 이미 있는 상태라서 { state: { permissionGranted: true } }로 넘어와요. 권한이 있으면
// "위치를 확인할 수 없어요" 문구·재요청 링크는 거짓이 되니 숨겨요 (정직성 원칙).
interface LocationDeniedNavState {
  permissionGranted?: boolean;
}

export default function LocationDenied() {
  const navigate = useNavigate();
  const location = useLocation();
  const permissionGranted = Boolean((location.state as LocationDeniedNavState | null)?.permissionGranted);

  const handleFindOtherRegion = () => {
    navigate(ROUTES.regionSearch);
  };

  const handleReRequestPermission = () => {
    // TODO: getCurrentLocation.openPermissionDialog() 연동 — 사용자가 이 링크를 눌렀을 때만 재요청해요 (디자인프레임 F6 SDK 메모).
  };

  return (
    <>
      <div style={{ padding: "52px 24px 0", textAlign: "center" }}>
        <div
          aria-hidden={true}
          style={{
            width: 74,
            height: 74,
            borderRadius: 22,
            background: MINT[50],
            display: "grid",
            placeItems: "center",
            margin: "0 auto 22px",
          }}
        >
          <Asset.Image
            frameShape={{ width: 32, height: 32 }}
            backgroundColor="transparent"
            src="https://static.toss.im/2d-icons/emoji/png/4x/u1F4CD.png"
            aria-hidden={true}
            style={{ aspectRatio: "1/1" }}
          />
        </div>

        <Text color={adaptive.grey900} typography="t3" fontWeight="bold">
          지역을 고르면 바로 볼 수 있어요
        </Text>

        <Spacing size={11} />

        <Paragraph.Text color={adaptive.grey700} fontWeight="medium">
          {permissionGranted
            ? "자주 가는 곳을 3개까지 저장해 둘 수 있어요."
            : "지금 위치를 확인할 수 없어요. 자주 가는 곳을 3개까지 저장해 둘 수 있어요."}
        </Paragraph.Text>
      </div>

      <Spacing size={28} />

      <div style={{ padding: "0 24px" }}>
        <Paragraph.Text color={adaptive.grey500} fontWeight="bold">
          최근에 본 지역
        </Paragraph.Text>
      </div>

      <List>
        {SAVED_REGIONS.map((region) => (
          <ListRow
            key={region.name}
            left={
              <ListRow.AssetImage
                src={region.emojiSrc}
                shape="squircle"
                backgroundColor={adaptive.greyOpacity100}
                size="xsmall"
              />
            }
            contents={
              <ListRow.Texts type="1RowTypeA" top={region.name} topProps={{ color: adaptive.grey800 }} />
            }
            right={
              <ListRow.Texts
                type="Right1RowTypeA"
                top={region.levelLabel}
                topProps={{ color: region.levelColor, fontWeight: "bold" }}
              />
            }
            verticalPadding="large"
            onClick={() => {
              navigate(ROUTES.home, {
                state: { nx: region.nx, ny: region.ny, label: region.name },
              });
            }}
          />
        ))}
        <ListRow
          contents={
            <Paragraph.Text color={MINT[700]} fontWeight="bold">
              ＋ 다른 지역 찾기
            </Paragraph.Text>
          }
          verticalPadding="large"
          onClick={handleFindOtherRegion}
        />
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
    </>
  );
}
