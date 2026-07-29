import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Asset,
  Top,
  List,
  ListRow,
  Paragraph,
  Button,
  Spacing,
} from "@toss/tds-mobile";
import { adaptive } from "@toss/tds-colors";
import { Accuracy, getCurrentLocation } from "@apps-in-toss/web-framework";
import { ProfileTabs } from "../components/ProfileTabs";
import { DEFAULT_PROFILE, type Profile } from "../constants/judge";
import { PRIMARY_BUTTON_STYLE, GHOST_BUTTON_STYLE } from "../constants/theme";
import { toGrid } from "../lib/geo";
import { ROUTES } from "../routes";

// F1 최초 진입 · 위치 확인. docs/오늘나가도되나_디자인프레임.html F1 참고.
// 프로필별 배타적 선택 화면은 없앴어요 — 홈과 같은 탭바 셸을 쓰고, 판정 카드 자리에 위치 권한 카드가 와요.
// 자체 뒤로가기·설정 버튼은 만들지 않아요 — 내비게이션 바는 앱인토스가 제공해요 (기획서 §7-2).
export default function Onboarding() {
  // TODO: Storage에서 마지막으로 본 탭을 읽어와 초기값으로 사용 (재방문 시)
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [locating, setLocating] = useState(false);
  const navigate = useNavigate();

  const handleUseLocation = async () => {
    setLocating(true);
    try {
      const { coords } = await getCurrentLocation({ accuracy: Accuracy.Balanced });
      const { nx, ny } = toGrid(coords.latitude, coords.longitude);
      navigate(ROUTES.home, { state: { nx, ny, label: "내 위치" } });
    } catch {
      // 권한 거부·미결정·조회 실패 — 어떤 이유든 지역 직접 선택으로 안내해요.
      // (제약: 위치 권한을 거부해도 전 기능이 동작해야 함)
      navigate(ROUTES.locationDenied);
    }
  };

  const handlePickRegion = () => {
    navigate(ROUTES.locationDenied);
  };

  return (
    <>
      <div style={{ padding: "6px 24px 0" }}>
        <ProfileTabs value={profile} onChange={setProfile} />
      </div>

      {/* 판정 카드 자리에 오는 위치 권한 설명. 카드 배경 없이 아이콘·제목·본문만 */}
      <Top
        title={
          <Top.TitleParagraph size={22} color={adaptive.grey900}>
            위치를 알려주면 우리 동네 값으로 보여드려요
          </Top.TitleParagraph>
        }
        subtitleBottom={
          <Top.SubtitleParagraph>
            동네마다 햇빛과 바람이 달라서, 위치를 알면 노면온도까지 정확해져요.
          </Top.SubtitleParagraph>
        }
        upper={
          <Top.UpperAssetContent
            content={
              <Asset.Image
                frameShape={Asset.frameShape.CleanW60}
                backgroundColor="transparent"
                src="https://static.toss.im/2d-icons/emoji/png/4x/u1F4CD.png"
                aria-hidden={true}
                style={{ aspectRatio: "1/1" }}
              />
            }
          />
        }
      />

      <Spacing size={12} />

      <div style={{ padding: "0 24px", display: "flex", flexDirection: "column", gap: 8 }}>
        <Button
          display="block"
          style={PRIMARY_BUTTON_STYLE}
          loading={locating}
          disabled={locating}
          onClick={handleUseLocation}
        >
          내 위치로 시작하기
        </Button>
        <Button
          variant="weak"
          display="block"
          style={GHOST_BUTTON_STYLE}
          disabled={locating}
          onClick={handlePickRegion}
        >
          지역 직접 고르기
        </Button>
      </div>

      <Spacing size={22} />

      <div style={{ padding: "0 24px" }}>
        <Paragraph.Text color={adaptive.grey600} fontWeight="bold">
          지금 바깥 상태
        </Paragraph.Text>
      </div>

      {/* 위치를 아직 몰라서 값이 없는 미리보기 — 권한을 주면 뭘 얻는지 결과를 먼저 예고해요 */}
      <div style={{ opacity: 0.45 }}>
        <List>
          <ListRow
            left={
              <ListRow.AssetImage
                src="https://static.toss.im/2d-icons/emoji/png/4x/u1F6E4.png"
                shape="squircle"
                backgroundColor={adaptive.greyOpacity100}
                size="small"
              />
            }
            contents={
              <ListRow.Texts
                type="3RowTypeD"
                top="노면 온도"
                topProps={{ color: adaptive.grey600 }}
                middle={<Paragraph.Text>-- ℃</Paragraph.Text>}
                middleProps={{ color: adaptive.grey800, fontWeight: "bold" }}
                bottom="위치를 확인하면 보여드려요"
                bottomProps={{ color: adaptive.grey600 }}
              />
            }
            verticalPadding="large"
          />
          <ListRow
            left={
              <ListRow.AssetImage
                src="https://static.toss.im/2d-icons/emoji/png/4x/u1F321.png"
                shape="squircle"
                backgroundColor={adaptive.greyOpacity100}
                size="xsmall"
              />
            }
            contents={
              <ListRow.Texts
                type="2RowTypeA"
                top="체감온도"
                topProps={{ color: adaptive.grey600 }}
                bottom={<Paragraph.Text>-- ℃</Paragraph.Text>}
                bottomProps={{ color: adaptive.grey800, fontWeight: "bold" }}
              />
            }
            verticalPadding="large"
          />
        </List>
      </div>
    </>
  );
}
