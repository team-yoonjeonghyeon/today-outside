import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Loader, Paragraph, Result, Spacing, Text } from "@toss/tds-mobile";
import { adaptive } from "@toss/tds-colors";
import { LEVEL_COLORS, METRIC_LABELS, MINT, type MetricKey, type Profile } from "../constants/judge";
import { fetchJudge, JudgeApiError, type JudgeResponse, type Metrics } from "../lib/judgeApi";
import { useBackNavigation } from "../hooks/useBackNavigation";
import { ESTIMATED_BADGE_STYLE } from "../constants/theme";
import { UV_ADVICE, uvTips, type UvLabel } from "../constants/uvAdvice";
import { FEELS_ADVICE, feelsTips, feelsLikeBand } from "../constants/feelsLikeAdvice";

// F5 지표 상세 — 왜 이 판정인가. docs/오늘나가도되나_디자인프레임.html F5 참고.
// 이 화면의 스타일(.sect-h/.calc/.calcrow/.surf/.notice/.badge)은 그 파일 <style> 블록의
// 값(폰트 크기·색·radius·padding)을 그대로 옮겼어요 — TDS 프리셋 컴포넌트로는 이 수치들이
// 정확히 안 나와서 div에 직접 입혔어요.
//
// "추정 모델을 숨기지 않고 전부 공개해요" — 서버가 준 실측·근거 문자열만 쓰고, 서버가 안 주는
// 수치(지표별 세부 보정값 등)는 지어내지 않아요 (정직성 원칙). 그래서 목업의 "햇빛 세기 +19.4℃"
// 같은 개별 보정값 대신, 서버가 실제로 주는 airTemp/windSpeed/humidity와 roadBasis 문장만 써요.
//
// 자체 뒤로가기·타이틀은 렌더링하지 않아요 — 내비게이션 바는 앱인토스가 제공해요 (CLAUDE.md 제약).
//
// 홈(F2·F3·F7)의 지표 카드 3종(체감·자외선·노면)이 모두 이 화면을 공유해요 — 어떤 카드였는지는
// metricKey로 구분해요. 디자인프레임에는 노면온도 예시만 있어서, 나머지 두 지표는 같은 시각 언어
// (섹션 헤더 → 계산 상자 → 출처)를 지키되 실제로 있는 데이터만으로 채웠어요.
interface DetailsNavState {
  nx: number;
  ny: number;
  profile: Profile;
  metricKey: MetricKey;
  label: string;
}

interface CalcRow {
  label: string;
  value: string;
}

function bigValue(metricKey: MetricKey, metrics: Metrics): string {
  if (metricKey === "feelsLike") return `${metrics.feelsLike}℃`;
  if (metricKey === "uv") return `${metrics.uvi}`;
  return `${metrics.roadTemp}℃`;
}

function subCopy(metricKey: MetricKey, profile: Profile, metrics: Metrics): string {
  if (metricKey === "feelsLike") {
    return profile === "dog" ? "몸높이를 반영한 체감온도예요" : "기온·습도·바람을 반영했어요";
  }
  if (metricKey === "uv") return `${metrics.uviLabel} 단계예요`;
  return "아스팔트 기준이에요";
}

// 체감·자외선 상세의 "이렇게 해요" 조언. 규칙 기반 문구(constants).
// 노면(road)은 표면 비교·손등7초 등 자체 상세가 있어 조언 섹션을 두지 않아요.
function metricAdvice(
  metricKey: MetricKey,
  profile: Profile,
  metrics: Metrics,
): { headline: string; tips: string[] } | null {
  if (metricKey === "uv") {
    const label = metrics.uviLabel as UvLabel;
    const a = UV_ADVICE[label];
    if (!a) return null;
    return { headline: a.headline, tips: uvTips(label, profile) };
  }
  if (metricKey === "feelsLike") {
    const band = feelsLikeBand(metrics.feelsLike);
    return { headline: FEELS_ADVICE[band].headline, tips: feelsTips(band, profile) };
  }
  return null;
}

function calcRows(metricKey: MetricKey, metrics: Metrics): CalcRow[] {
  if (metricKey === "feelsLike") {
    return [
      { label: "지금 기온", value: `${metrics.airTemp}℃` },
      { label: "습도", value: `${metrics.humidity}%` },
      { label: "바람", value: `${metrics.windSpeed}m/s` },
    ];
  }
  if (metricKey === "uv") return [];
  return [
    { label: "지금 기온", value: `${metrics.airTemp}℃` },
    { label: "바람", value: `${metrics.windSpeed}m/s` },
  ];
}

// docs/judge-api-spec.md의 roadBySurface(아스팔트·보도블록·잔디·흙길) 4종만 실제 응답에 있어요 —
// 디자인프레임 F5 목업의 '우레탄'은 서버가 안 주는 값이라 넣지 않아요.
function surfaceRows(metrics: Metrics) {
  return [
    { label: "아스팔트", value: metrics.roadBySurface.asphalt },
    { label: "보도블록", value: metrics.roadBySurface.pavement },
    { label: "잔디", value: metrics.roadBySurface.grass },
    { label: "흙길", value: metrics.roadBySurface.soil },
  ];
}

function SectionHeader({ children }: { children: string }) {
  // .sect-h{font-size:13px;font-weight:700;color:var(--g500);margin:22px 0 10px}
  return (
    <>
      <Spacing size={22} />
      <div style={{ padding: "0 24px" }}>
        <Paragraph.Text color={adaptive.grey500} fontWeight="bold" typography="t7">
          {children}
        </Paragraph.Text>
      </div>
      <Spacing size={10} />
    </>
  );
}

export default function Details() {
  useBackNavigation();

  const location = useLocation();
  const state = location.state as DetailsNavState | null;

  const [data, setData] = useState<JudgeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);

    fetchJudge({ nx: state.nx, ny: state.ny, profile: state.profile })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (cancelled) return;
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
  }, [state]);

  // 홈을 거치지 않고 직접 들어온 경우(예: 새로고침) — 판정 카드를 누른 맥락이 없으면 보여줄 게 없어요.
  if (!state) {
    return (
      <div style={{ padding: "24px" }}>
        <Result title="지표를 찾을 수 없어요" description="홈에서 지표 카드를 눌러 들어와 주세요" />
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "64px 24px" }}>
        <Loader size="medium" />
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: "24px" }}>
        <Result
          title="지금 정보를 불러올 수 없어요"
          description={errorMessage ?? "잠시 후 다시 시도해주세요"}
        />
      </div>
    );
  }

  const { metricKey, profile } = state;
  const { metrics } = data;
  const levelColor = LEVEL_COLORS[data.now.level];
  const isRoad = metricKey === "road";
  const rows = calcRows(metricKey, metrics);
  const totalLabel = isRoad ? "아스팔트 표면" : METRIC_LABELS[metricKey];
  const surfaceMax = Math.max(...surfaceRows(metrics).map((r) => r.value));
  const advice = metricAdvice(metricKey, profile, metrics);

  return (
    <>
      <div style={{ padding: "16px 24px 0" }}>
        <Paragraph.Text color={adaptive.grey500} fontWeight="bold" typography="t7">
          {METRIC_LABELS[metricKey]}
        </Paragraph.Text>

        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
          <Text
            color={levelColor}
            fontWeight="bold"
            style={{ fontSize: 42, letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums" }}
          >
            {bigValue(metricKey, metrics)}
          </Text>
          {isRoad && <span style={ESTIMATED_BADGE_STYLE}>추정</span>}
        </div>

        <div style={{ marginTop: 7 }}>
          <Paragraph.Text color={adaptive.grey700} fontWeight="medium">
            {subCopy(metricKey, profile, metrics)}
          </Paragraph.Text>
        </div>
      </div>

      <SectionHeader>이렇게 계산했어요</SectionHeader>

      {isRoad && (
        <div style={{ padding: "0 24px 10px" }}>
          <Paragraph.Text color={adaptive.grey700}>{metrics.roadBasis}</Paragraph.Text>
        </div>
      )}

      <div style={{ margin: "0 24px" }}>
        <div style={{ background: adaptive.grey50, border: `1px solid ${adaptive.grey200}`, borderRadius: 16, padding: 16 }}>
          {rows.map((row) => (
            <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
              <Paragraph.Text color={adaptive.grey700} typography="t7">
                {row.label}
              </Paragraph.Text>
              <Text color={adaptive.grey900} fontWeight="bold" typography="t7" style={{ fontVariantNumeric: "tabular-nums" }}>
                {row.value}
              </Text>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              borderTop: rows.length > 0 ? `1px solid ${adaptive.grey200}` : undefined,
              marginTop: rows.length > 0 ? 6 : 0,
              paddingTop: rows.length > 0 ? 12 : 0,
            }}
          >
            <Paragraph.Text color={adaptive.grey700}>{totalLabel}</Paragraph.Text>
            <Text color={levelColor} fontWeight="bold" style={{ fontSize: 19, fontVariantNumeric: "tabular-nums" }}>
              {bigValue(metricKey, metrics)}
            </Text>
          </div>
        </div>
      </div>

      {advice && (
        <>
          <SectionHeader>이렇게 해요</SectionHeader>
          <div style={{ padding: "0 24px" }}>
            <Paragraph.Text color={adaptive.grey800} fontWeight="bold">
              {advice.headline}
            </Paragraph.Text>
            <Spacing size={8} />
            {advice.tips.map((tip) => (
              <div key={tip} style={{ display: "flex", gap: 8, padding: "5px 0" }}>
                <Text color={levelColor} fontWeight="bold" typography="t7" style={{ lineHeight: 1.5 }}>
                  •
                </Text>
                <Paragraph.Text color={adaptive.grey700} typography="t7">
                  {tip}
                </Paragraph.Text>
              </div>
            ))}
          </div>
        </>
      )}

      {isRoad && (
        <>
          <SectionHeader>바닥 재질에 따라 달라져요</SectionHeader>

          <div style={{ padding: "0 24px" }}>
            {surfaceRows(metrics).map((row) => (
              <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0" }}>
                <Text color={adaptive.grey700} fontWeight="semibold" typography="t7" style={{ width: 76 }}>
                  {row.label}
                </Text>
                <span style={{ flex: 1, height: 22, background: adaptive.grey100, borderRadius: 6, overflow: "hidden" }}>
                  <span
                    style={{
                      display: "block",
                      height: "100%",
                      borderRadius: 6,
                      width: `${Math.max(6, (row.value / surfaceMax) * 100)}%`,
                      background: levelColor,
                    }}
                  />
                </span>
                <Text
                  color={adaptive.grey900}
                  fontWeight="bold"
                  typography="t7"
                  style={{ width: 46, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                >
                  {`${row.value}℃`}
                </Text>
              </div>
            ))}
          </div>

          {profile === "dog" && (
            <div style={{ margin: "16px 24px 0" }}>
              <div style={{ background: MINT[50], border: `1px solid ${MINT.border}`, borderRadius: 12, padding: 14 }}>
                <Paragraph.Text color={MINT[900]} fontWeight="bold" typography="t7">
                  직접 한 번 확인해요
                </Paragraph.Text>
                <Spacing size={2} />
                <Paragraph.Text color={MINT[900]} typography="t7">
                  손등을 바닥에 7초 대보고 뜨거우면 강아지 발에도 뜨거워요. 그때는 흙길이나 잔디로 돌아가요.
                </Paragraph.Text>
              </div>
            </div>
          )}
        </>
      )}

      <div style={{ padding: "0 24px", marginTop: 14 }}>
        <Paragraph.Text color={adaptive.grey500} typography="t7">
          {isRoad
            ? "노면 온도는 기온·햇빛·바람으로 계산한 추정값이라 실제와 다를 수 있어요."
            : "참고용 기상정보 안내예요. 안전 진단이나 의학적 판단을 대신하지 않아요."}
        </Paragraph.Text>
      </div>

      <Spacing size={20} />
    </>
  );
}
