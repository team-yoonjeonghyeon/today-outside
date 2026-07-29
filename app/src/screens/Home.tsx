import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ListRow, Loader, Menu, Paragraph, Result, Spacing, Text } from "@toss/tds-mobile";
import { adaptive } from "@toss/tds-colors";
import { ProfileTabs } from "../components/ProfileTabs";
import {
  HERO_TINTS,
  LEVEL_COLORS,
  METRIC_EMOJI,
  MINT,
  PROFILE_META,
  type MetricKey,
  type Profile,
} from "../constants/judge";
import {
  fetchJudge,
  JudgeApiError,
  type HourSlot,
  type JudgeResponse,
  type Metrics,
} from "../lib/judgeApi";
import { ESTIMATED_BADGE_STYLE } from "../constants/theme";
import { useLastProfile } from "../hooks/useLastProfile";
import { useSavedRegions } from "../hooks/useSavedRegions";
import { useSettingsAccessoryButton } from "../hooks/useSettingsAccessoryButton";
import { requireRegionBySigungu } from "../lib/regions";
import { setStoredJSON, STORAGE_KEYS } from "../lib/storage";
import { ROUTES } from "../routes";

// F2·F3·F7 홈 — 탭으로 묶인 허브. 프로필만 바꿔도 위계와 문장이 달라져요.
// docs/오늘나가도되나_디자인프레임.html F2(반려견)·F3(야외 작업)·F7(러너) 참고.
// ⚙ 설정 진입은 내비게이션 바 액세서리 아이콘(useSettingsAccessoryButton)으로 처리해요 —
// F4~F9 등 다른 화면에는 안 쓰여서 그 화면들에선 자동으로 사라져요.

// 히어로가 아닐 때 지표 아이콘 배경. 디자인프레임 F2·F3·F7의 지표별 고정 톤 —
// 히어로로 뽑히면 HERO_TINTS(판정 등급색)로 덮어써요.
const METRIC_ICON_TINTS: Record<MetricKey, string> = {
  feelsLike: "#FFE9E9",
  uv: "#FFF1D6",
  road: adaptive.greyOpacity100,
};

// wcta(다음 행동) 카드의 프로필별 아이콘·보조 문구. 구체적인 수치는 API 응답(bestWindow)에서만 가져오고,
// 여기 문구는 수치를 포함하지 않는 일반 안내로만 둬요 (정직성 원칙 — 근거 없는 수치를 지어내지 않아요).
// icon은 유니코드 이모지 대신 실제 토스 2d-icons PNG예요 — 유니코드로 두면 기기 기본 이모지 폰트로
// 렌더링돼서(예: 아이폰 이모지) 앱 다른 곳의 토스 아이콘 스타일이랑 안 맞았어요.
const WCTA_COPY: Record<Profile, { icon: string; caption: string }> = {
  runner: { icon: PROFILE_META.runner.icon, caption: "무리하지 않는 선에서 움직여요" },
  dog: {
    icon: "https://static.toss.im/2d-icons/emoji/png/4x/u1F31B.png",
    caption: "그늘 위주로 코스를 잡아요",
  },
  worker: {
    icon: "https://static.toss.im/2d-icons/emoji/png/4x/u23F3.png",
    caption: "그늘이나 냉방 공간에서 잠깐 쉬어요",
  },
};

interface MetricCard {
  key: MetricKey;
  emojiSrc: string;
  label: string;
  value: string;
  sub: string;
  hero?: boolean;
  // 실측이 아닌 추정값 카드에 "추정" 배지를 붙여요 (CLAUDE.md 제약: 노면온도는 항상 추정 배지).
  estimated?: boolean;
}

// observedAt(관측 시각)을 다시 기준으로 써요 — 기상청 실황은 매시 40분에 발표돼서
// 지금 시각보다 최대 1시간 가까이 뒤처질 수 있는데, 그게 정상이에요(docs/judge-api-spec.md
// 참고). 대신 "(측정)"을 붙여서 이게 지금 시각이 아니라 값을 측정한 시각이라는 걸 명확히 해요.
function formatKstTime(iso: string): string {
  const match = iso.match(/T(\d{2}):(\d{2})/);
  if (!match) return "";
  const hour = Number(match[1]);
  const period = hour < 12 ? "오전" : "오후";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${period} ${hour12}시(측정)`;
}

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

// 러너·야외 작업 프로필의 노면 온도 보조 문구 — 오늘 최고치 대비 지금이 얼마나 내려왔는지 보여줘요.
// 차이가 크지 않을 땐(한낮에 가까울 땐) 대신 서버가 계산한 근거 문구(roadBasis)를 보여줘요.
function buildRoadSub(profile: Profile, metrics: Metrics, hourly: HourSlot[]): string {
  if (profile === "dog") {
    return `잔디 ${metrics.roadBySurface.grass}℃ · 흙길 ${metrics.roadBySurface.soil}℃`;
  }
  const peak = Math.max(metrics.roadTemp, ...hourly.map((slot) => slot.roadTemp));
  const diff = Math.round(peak - metrics.roadTemp);
  return diff >= 3 ? `한낮보다 ${diff}℃ 낮아요` : metrics.roadBasis;
}

function buildMetricCards(profile: Profile, data: JudgeResponse): MetricCard[] {
  const { metrics, hourly } = data;

  const feelsLikeCard: MetricCard = {
    key: "feelsLike",
    emojiSrc: METRIC_EMOJI.feelsLike,
    label: profile === "dog" ? "체감온도 · 몸높이 보정" : "체감온도",
    value: `${metrics.feelsLike}℃`,
    sub:
      profile === "worker"
        ? `기온 ${metrics.airTemp}℃ · 습도 ${metrics.humidity}% · 바람 ${metrics.windSpeed}m/s`
        : `기온 ${metrics.airTemp}℃ · 습도 ${metrics.humidity}%`,
    // 체감온도도 기온·습도·바람으로부터 서버가 계산한 값이라 '추정' 배지를 붙여요.
    estimated: true,
  };

  const uvCard: MetricCard = {
    key: "uv",
    emojiSrc: METRIC_EMOJI.uv,
    label: "자외선",
    value: `${metrics.uvi} ${metrics.uviLabel}`,
    sub: "자외선지수",
  };

  const roadCard: MetricCard = {
    key: "road",
    emojiSrc: METRIC_EMOJI.road,
    label: "노면 온도",
    value: `${metrics.roadTemp}℃`,
    sub: buildRoadSub(profile, metrics, hourly),
    estimated: true,
  };

  // 반려견은 노면이 히어로, 러너·야외 작업은 체감온도가 히어로예요 (기획서 §5-2 [F3]).
  const ordered = profile === "dog" ? [roadCard, feelsLikeCard, uvCard] : [feelsLikeCard, uvCard, roadCard];
  ordered[0].hero = true;
  return ordered;
}

interface RegionNavState {
  nx: number;
  ny: number;
  label: string;
}

// 홈은 항상 Onboarding·F6에서 nx/ny/label을 state로 들고 진입해서 실제로는 안 쓰이지만,
// 새로고침 등으로 state 없이 곧장 들어오는 경우를 대비한 타입 안전용 기본값이에요.
// savedRegions(사용자가 저장한 지역)에 기대지 않아요 — 그건 비어 있을 수 있어서요.
const FALLBACK_REGION = requireRegionBySigungu("고양시 일산동구");

export default function Home() {
  useSettingsAccessoryButton();

  const navigate = useNavigate();
  const location = useLocation();
  const [profile, setProfile] = useLastProfile();
  const { savedRegions } = useSavedRegions();
  const [data, setData] = useState<JudgeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [regionSheetOpen, setRegionSheetOpen] = useState(false);
  // F6(지역 설정 전체보기)에서 지역을 고르고 돌아오면 router state로 넘어와요.
  // state가 없을 때만 FALLBACK_REGION을 써요 (정상 흐름에서는 항상 state가 있어요).
  const [region, setRegion] = useState<RegionNavState>(
    (location.state as RegionNavState | null) ?? {
      nx: FALLBACK_REGION.nx,
      ny: FALLBACK_REGION.ny,
      label: `${FALLBACK_REGION.sido} ${FALLBACK_REGION.sigungu}`,
    },
  );

  // 마지막으로 보던 지역을 저장해요 — 새로고침·미니앱 재실행 시 Onboarding이 이 값을 읽어서
  // F1(위치 권한 안내)를 건너뛰고 곧장 이 지역의 홈으로 돌아올 수 있게 해요.
  useEffect(() => {
    void setStoredJSON(STORAGE_KEYS.lastRegion, region);
  }, [region]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);

    fetchJudge({ nx: region.nx, ny: region.ny, profile })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (cancelled) return;
        // 기획서 리스크 대응: API 장애 시에도 빈 화면 금지 — 마지막 응답은 그대로 두고 안내만 띄워요.
        setErrorMessage(
          err instanceof JudgeApiError
            ? "잠시 후 다시 시도해주세요"
            : "지금 정보를 불러올 수 없어요. 잠시 후 다시 시도해주세요",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [profile, region.nx, region.ny]);

  // 프로필 전환 중에는 이전 프로필의 데이터가 남아있을 수 있어 화면이 잠깐 어긋나 보일 수 있어요 — 그 값은 쓰지 않아요.
  const showData = data && data.profile === profile ? data : null;
  const levelColor = showData ? LEVEL_COLORS[showData.now.level] : adaptive.grey900;
  const metricCards = showData ? buildMetricCards(profile, showData) : [];

  return (
    <>
      <div style={{ padding: "6px 24px 0" }}>
        <ProfileTabs value={profile} onChange={setProfile} />
      </div>

      {showData?.stale && (
        <div style={{ margin: "12px 24px 0" }}>
          <div
            style={{
              background: "#FFF8EC",
              border: "1px solid #FCE3B4",
              borderRadius: 12,
              padding: "12px 14px",
            }}
          >
            <Paragraph.Text color="#8A5A0B" fontWeight="bold">
              {`${minutesAgo(showData.observedAt)}분 전 값이에요, 지금 값을 다시 불러올게요`}
            </Paragraph.Text>
          </div>
        </div>
      )}

      {loading && !showData && (
        // TDS Skeleton은 내부 컨테이너가 부모 너비를 무시하고 100vw로 렌더링되는 버그가 있어서
        // 화면 폭에 따라 계속 삐뚤어 보였어요. 카드 모양을 흉내내는 대신 화면 중앙에 작은
        // 로더 하나만 보여줘요 — 좌우 비대칭이 생길 여지 자체가 없어요.
        <div style={{ display: "flex", justifyContent: "center", padding: "64px 24px" }}>
          <Loader size="medium" />
        </div>
      )}

      {!loading && errorMessage && !showData && (
        <div style={{ padding: "24px" }}>
          <Result title="지금 정보를 불러올 수 없어요" description={errorMessage} />
        </div>
      )}

      {showData && (
        <>
          <div style={{ padding: "10px 24px 20px" }}>
            {/* 저장한 지역(최대 3개)을 바로 바꿀 수 있는 작은 드롭다운 — 설정까지 안 가도 되게 */}
            <Menu.Trigger
              open={regionSheetOpen}
              onOpen={() => setRegionSheetOpen(true)}
              onClose={() => setRegionSheetOpen(false)}
              placement="bottom-start"
              dropdown={
                <Menu.Dropdown header={<Menu.Header>지역 바꾸기</Menu.Header>}>
                  {savedRegions.map((saved) => {
                    const isSelected = saved.nx === region.nx && saved.ny === region.ny;
                    return (
                      <Menu.DropdownItem
                        key={saved.name}
                        right={
                          saved.levelLabel ? (
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: isSelected ? MINT[700] : saved.levelColor,
                              }}
                            >
                              {saved.levelLabel}
                            </span>
                          ) : undefined
                        }
                        onClick={() => {
                          setRegion({ nx: saved.nx, ny: saved.ny, label: saved.name });
                          setRegionSheetOpen(false);
                        }}
                      >
                        {/* 체크 표시(✓) 대신 색으로만 선택 상태를 구분해요 — 이모지 느낌이 안 나게. */}
                        <span style={{ color: isSelected ? MINT[700] : undefined, fontWeight: isSelected ? 700 : undefined }}>
                          {saved.name}
                        </span>
                      </Menu.DropdownItem>
                    );
                  })}
                  <Menu.DropdownItem
                    onClick={() => {
                      setRegionSheetOpen(false);
                      navigate(ROUTES.regionSearch);
                    }}
                  >
                    ＋ 다른 지역 찾기
                  </Menu.DropdownItem>
                  <Menu.DropdownItem
                    onClick={() => {
                      setRegionSheetOpen(false);
                      navigate(ROUTES.locationDenied, { state: { permissionGranted: true } });
                    }}
                  >
                    지역 설정 전체보기
                  </Menu.DropdownItem>
                </Menu.Dropdown>
              }
            >
              <button
                type="button"
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", outline: "none" }}
              >
                <Paragraph.Text color={adaptive.grey500} fontWeight="bold">
                  {`${formatKstTime(showData.observedAt)} · ${region.label} ▾`}
                </Paragraph.Text>
              </button>
            </Menu.Trigger>

            <Spacing size={6} />

            <Text color={levelColor} typography="t1" fontWeight="bold">
              {showData.now.headline}
            </Text>

            <Spacing size={12} />

            <Paragraph.Text color={adaptive.grey700} fontWeight="medium">
              {showData.now.reason}
            </Paragraph.Text>
          </div>

          {showData.alert && (
            <div style={{ margin: "0 24px 16px" }}>
              <div
                style={{
                  background: "#FDECEC",
                  border: "1px solid #F5C2C2",
                  borderRadius: 12,
                  padding: "12px 14px",
                }}
              >
                {/* 서버가 "A. B" 형태(마침표+공백으로 두 문장 이어붙임)로 내려주는데,
                    한 줄에 다 넣는 대신 문장별로 줄을 나누고 마침표는 빼서 보여줘요.
                    Paragraph.Text는 인라인이라 그냥 나열하면 줄바꿈이 안 돼서 div로 감싸요. */}
                {showData.alert.text.split(". ").map((line, i) => (
                  <div key={i}>
                    <Paragraph.Text color={LEVEL_COLORS[5]} fontWeight="bold">
                      {line.replace(/\.$/, "")}
                    </Paragraph.Text>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 다음 행동 카드 — 최적 시간창(bestWindow)이 있으면 강조, 없으면 담백하게 안내 (기획서 §3-7) */}
          {showData.bestWindow ? (
            <div style={{ margin: "0 24px 16px", background: MINT[50], borderRadius: 16 }}>
              <ListRow
                left={
                  <ListRow.AssetImage
                    src={WCTA_COPY[profile].icon}
                    shape="squircle"
                    size="small"
                    backgroundColor={MINT[400]}
                  />
                }
                contents={
                  <ListRow.Texts
                    type="2RowTypeA"
                    top={showData.bestWindow.label}
                    topProps={{ color: MINT[900], fontWeight: "bold" }}
                    bottom={WCTA_COPY[profile].caption}
                    bottomProps={{ color: MINT[700] }}
                  />
                }
                withArrow
                verticalPadding="large"
                onClick={() =>
                  navigate(ROUTES.timeline, {
                    state: { nx: region.nx, ny: region.ny, profile, label: region.label },
                  })
                }
              />
            </div>
          ) : (
            <div style={{ margin: "0 24px 16px", background: adaptive.grey100, borderRadius: 16, padding: "16px" }}>
              <Paragraph.Text color={adaptive.grey700} fontWeight="medium">
                오늘은 특별히 더 좋은 시간대가 없어요
              </Paragraph.Text>
            </div>
          )}

          <div style={{ padding: "0 24px" }}>
            <Paragraph.Text color={adaptive.grey500} fontWeight="bold">
              지금 바깥 상태
            </Paragraph.Text>
          </div>

          <Spacing size={10} />

          <div style={{ padding: "0 24px" }}>
            {metricCards.map((card) => {
              const tint = card.hero ? HERO_TINTS[showData.now.level] : null;
              return (
                <div
                  key={card.key}
                  style={{
                    background: tint?.background ?? adaptive.grey50,
                    border: `1px solid ${tint?.border ?? adaptive.grey200}`,
                    borderRadius: 16,
                    padding: card.hero ? "6px 4px" : "2px 4px",
                    marginBottom: 8,
                  }}
                >
                  <ListRow
                    left={
                      <ListRow.AssetImage
                        src={card.emojiSrc}
                        shape="squircle"
                        backgroundColor={tint?.iconBackground ?? METRIC_ICON_TINTS[card.key]}
                        size={card.hero ? "small" : "xsmall"}
                      />
                    }
                    contents={
                      <ListRow.Texts
                        type="3RowTypeD"
                        top={
                          card.estimated ? (
                            <span style={{ color: adaptive.grey600 }}>
                              {card.label}
                              <span style={ESTIMATED_BADGE_STYLE}>추정</span>
                            </span>
                          ) : (
                            card.label
                          )
                        }
                        topProps={card.estimated ? undefined : { color: adaptive.grey600 }}
                        middle={card.value}
                        middleProps={{
                          color: card.hero ? levelColor : adaptive.grey800,
                          fontWeight: "bold",
                        }}
                        bottom={card.sub}
                        bottomProps={{ color: adaptive.grey600 }}
                      />
                    }
                    withArrow
                    verticalPadding={card.hero ? "xlarge" : "large"}
                    onClick={() =>
                      navigate(ROUTES.details, {
                        state: { nx: region.nx, ny: region.ny, profile, metricKey: card.key, label: region.label },
                      })
                    }
                  />
                </div>
              );
            })}
          </div>

          <Spacing size={8} />

          {/* 출처(기상청)는 F8 설정 > 데이터 출처 안내(F16)로 옮길 예정이라 홈에서는 면책 문구만 보여줘요. */}
          <div style={{ padding: "0 24px" }}>
            <Paragraph.Text color={adaptive.grey500}>
              참고용 기상정보 안내예요. 안전 진단이나 의학적 판단을 대신하지 않아요.
            </Paragraph.Text>
          </div>

          <Spacing size={16} />

          {errorMessage && (
            <div style={{ padding: "0 24px 16px" }}>
              <Paragraph.Text color={adaptive.grey500}>{errorMessage}</Paragraph.Text>
            </div>
          )}
        </>
      )}
    </>
  );
}
