import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Asset,
  Top,
  List,
  ListRow,
  Loader,
  Paragraph,
  Button,
  Spacing,
} from "@toss/tds-mobile";
import { adaptive } from "@toss/tds-colors";
import { Accuracy, getCurrentLocation } from "@apps-in-toss/web-framework";
import { ProfileTabs } from "../components/ProfileTabs";
import { PRIMARY_BUTTON_STYLE, GHOST_BUTTON_STYLE } from "../constants/theme";
import { coarseLocationLabel, placeNameFromLabel } from "../lib/regions";
import { useLastProfile } from "../hooks/useLastProfile";
import { useSavedRegions } from "../hooks/useSavedRegions";
import { useSettingsAccessoryButton } from "../hooks/useSettingsAccessoryButton";
import { ROUTES } from "../routes";

// 위치를 아직 몰라서 값이 없는 미리보기 3종 — Home의 지표 카드(노면온도·체감온도·자외선)와
// 순서·구성을 맞춰요. 배열 하나로 관리해서 세 행이 아이콘 크기·줄 구성에서 서로 어긋나지
// 않게 해요 (전엔 행마다 따로 적어서 노면온도만 3줄, 체감온도는 2줄로 어긋났던 적이 있어요).
const PREVIEW_METRICS: { key: string; icon: string; label: string }[] = [
  { key: "road", icon: "https://static.toss.im/2d-icons/emoji/png/4x/u1F6E4.png", label: "노면 온도" },
  { key: "feelsLike", icon: "https://static.toss.im/2d-icons/emoji/png/4x/u1F321.png", label: "체감온도" },
  { key: "uv", icon: "https://static.toss.im/2d-icons/emoji/png/4x/u2600.png", label: "자외선" },
];

// F1 최초 진입 · 위치 확인. docs/오늘나가도되나_디자인프레임.html F1 참고.
// 프로필별 배타적 선택 화면은 없앴어요 — 홈과 같은 탭바 셸을 쓰고, 판정 카드 자리에 위치 권한 카드가 와요.
// 자체 뒤로가기·설정 버튼은 화면 안에 만들지 않아요 — 내비게이션 바는 앱인토스가 제공해요 (기획서 §7-2).
// ⚙ 설정 진입은 내비게이션 바 액세서리 아이콘(useSettingsAccessoryButton)으로 처리해요 —
// 화면흐름도가 F1·F2·F3·F7에서만 "⚙ 설정 → F8"을 명시해서, 그 화면들에서만 이 훅을 써요.
export default function Onboarding() {
  useSettingsAccessoryButton();

  const [profile, setProfile] = useLastProfile();
  const [locating, setLocating] = useState(false);
  const { primaryRegion, addRegion, loaded } = useSavedRegions();
  const navigate = useNavigate();

  // 내 장소가 정해져 있으면 GPS를 다시 잡지 않고 곧장 그 지역의 홈으로 이어요.
  //
  // 예전엔 진입할 때마다 GPS를 새로 찍어서 홈을 열었는데, 그러면 알림이 겨냥할 기준점이 매번
  // 흔들려요(아침엔 집, 출근 후엔 회사, 여행 중엔 여행지). 아침 브리핑처럼 "매일 같은 곳"을
  // 전제로 하는 알림에는 고정된 한 곳이 필요해서, GPS 재측정은 자동이 아니라 홈의 ↻ 버튼으로
  // 사용자가 원할 때만 하도록 옮겼어요.
  //
  // loaded 전에는 아직 Storage를 읽는 중이라 "내 장소 없음"으로 단정하면 안 돼요 —
  // 그동안엔 아래 로더만 보여줘요(안 그러면 이미 쓰던 사람에게 F1이 잠깐 번쩍여요).
  useEffect(() => {
    if (!loaded || !primaryRegion) return;
    navigate(ROUTES.home, {
      state: { nx: primaryRegion.nx, ny: primaryRegion.ny, label: primaryRegion.name },
      replace: true,
    });
  }, [loaded, primaryRegion, navigate]);

  const handleUseLocation = async () => {
    setLocating(true);
    try {
      const { coords } = await getCurrentLocation({ accuracy: Accuracy.Balanced });
      // nx/ny·구 단위 라벨은 네트워크 없이 즉시 계산해요 — 동 단위 정밀 라벨은 Home이
      // 백그라운드에서 따로 조회해서 갈아끼워요(카카오 역지오코딩 응답을 기다리느라
      // 진입이 늦어지지 않게 하려는 용도).
      const { nx, ny, label } = coarseLocationLabel(coords.latitude, coords.longitude);
      // 첫 내 장소예요 — 여기서만 확인 없이 바로 정해요. 아직 기준이 없는 상태라
      // 덮어쓸 게 없고, 사용자가 방금 "내 위치로 시작하기"를 직접 눌렀으니까요.
      await addRegion({ name: placeNameFromLabel(label), nx, ny });
      navigate(ROUTES.home, { state: { nx, ny, label, lat: coords.latitude, lon: coords.longitude } });
    } catch {
      // 권한 거부·미결정·조회 실패 — 어떤 이유든 지역 직접 선택으로 안내해요.
      // (제약: 위치 권한을 거부해도 전 기능이 동작해야 함)
      navigate(ROUTES.locationDenied);
    }
  };

  const handlePickRegion = () => {
    navigate(ROUTES.locationDenied);
  };

  // 아직 내 장소를 읽는 중이거나, 이미 있어서 위 이펙트가 홈으로 넘기는 중이에요.
  if (!loaded || primaryRegion) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "64px 24px" }}>
        <Loader size="medium" />
      </div>
    );
  }

  return (
    <>
      <div style={{ padding: "6px 24px 0" }}>
        <ProfileTabs value={profile} onChange={setProfile} disabled />
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

      {/* 위치를 아직 몰라서 값이 없는 미리보기 — 권한을 주면 뭘 얻는지 결과를 먼저 예고해요.
          List 자체엔 좌우 패딩이 없어서, 화면의 다른 요소(제목·버튼·탭바)랑 같은 24px을
          여기서 직접 줘요 — 안 그러면 이 목록만 화면 끝까지 꽉 차서 더 넓어 보였어요. */}
      <div style={{ opacity: 0.45, padding: "0 24px" }}>
        <List>
          {PREVIEW_METRICS.map((metric) => (
            <ListRow
              key={metric.key}
              left={
                <ListRow.AssetImage
                  src={metric.icon}
                  shape="squircle"
                  backgroundColor={adaptive.greyOpacity100}
                  size="small"
                />
              }
              contents={
                <ListRow.Texts
                  type="3RowTypeD"
                  top={metric.label}
                  topProps={{ color: adaptive.grey600 }}
                  middle={<Paragraph.Text>--</Paragraph.Text>}
                  middleProps={{ color: adaptive.grey800, fontWeight: "bold" }}
                  bottom="위치를 확인하면 보여드려요"
                  bottomProps={{ color: adaptive.grey600 }}
                />
              }
              verticalPadding="large"
            />
          ))}
        </List>
      </div>
    </>
  );
}
