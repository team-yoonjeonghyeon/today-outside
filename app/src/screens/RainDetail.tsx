import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { List, ListRow, Loader, Paragraph, Result, Spacing, Text } from "@toss/tds-mobile";
import { adaptive } from "@toss/tds-colors";
import { MINT, type Profile } from "../constants/judge";
import { isWet, nextWetHour, parsePcpMm, precipitationLabel, RAIN_ICON } from "../constants/rain";
import { fetchJudge, JudgeApiError, type HourSlot, type JudgeResponse } from "../lib/judgeApi";
import { useBackNavigation } from "../hooks/useBackNavigation";
import { useDisablePullToRefresh } from "../hooks/useDisablePullToRefresh";

// 비 상세 — 홈의 비 안내 배너를 눌러 들어와요. docs/오늘나가도되나_디자인프레임.html의 F1~F16
// 화면 흐름도에는 없는 화면이에요(강수 필드가 그 문서보다 나중에 생겼어요, judgeApi.ts 참고).
// 그래서 새 시각 언어를 만들지 않고 Timeline(F4)의 패턴 — 헤드라인 → 막대그래프 → 시간별
// 리스트 —을 그대로 가져와요. 막대 높이는 온도 화면의 등급(level)처럼 강수량(mm)이 기준이에요.
// 자체 뒤로가기·타이틀은 렌더링하지 않아요 — 내비게이션 바는 앱인토스가 제공해요 (CLAUDE.md 제약).
interface RainDetailNavState {
  nx: number;
  ny: number;
  profile: Profile;
  label: string;
}

function parseKstHour(iso: string): number | null {
  const match = iso.match(/T(\d{2}):/);
  return match ? Number(match[1]) : null;
}

// 오늘 안에서 가장 많이 온 시간을 100%로 두고 상대적으로 그려요. mm 자체는 기상청도 구간으로만
// 주는 값이라(parsePcpMm 참고), 절대 눈금보다는 "그 시간이 오늘 중 어느 정도인지"가 더 정직해요.
function barHeightPercent(mm: number, maxMm: number): number {
  if (mm <= 0) return 3; // 완전히 0%면 막대가 사라져서 "데이터 없음"처럼 보여요 — 얇은 기준선만 남겨요.
  return 20 + (mm / maxMm) * 80;
}

export default function RainDetail() {
  useBackNavigation();
  useDisablePullToRefresh();

  const location = useLocation();
  const state = location.state as RainDetailNavState | null;

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

  if (!state) {
    return (
      <div style={{ padding: "24px" }}>
        <Result title="비 정보를 찾을 수 없어요" description="홈에서 비 안내를 눌러 들어와 주세요" />
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

  const { label } = state;
  const { metrics, hourly: rawHourly } = data;
  // Timeline과 같은 이유로 observedAt이 아니라 generatedAt을 써요 — 실제 현재 시각과 같아요.
  const nowHour = parseKstHour(data.generatedAt);
  const nowLabel = precipitationLabel(metrics.pty);

  // hourly[]의 pty·pcp는 몇 시간 전에 나온 예보예요. metrics.pty·rain은 방금 관측된 실황이라
  // 더 정확해요 — 둘이 갈리면(예보엔 없던 비가 실제로 내리기 시작하는 경우 등) 헤드라인은
  // "지금 비가 와요"인데 그래프의 지금 시각 막대는 비어 있는 모순이 생겨요. 그래서 지금 시각
  // 칸만 실황값으로 덮어써서 헤드라인과 그래프가 같은 이야기를 하게 맞춰요.
  const hourly =
    metrics.pty === undefined
      ? rawHourly
      : rawHourly.map((slot) =>
          slot.hour === nowHour
            ? {
                ...slot,
                pty: metrics.pty,
                // 예보 구간 문자열과 달리 실황은 정확한 mm을 알아서, 구간인 척하지 않고 그대로 써요.
                pcp: metrics.rain && metrics.rain > 0 ? `${metrics.rain}mm` : undefined,
              }
            : slot,
        );

  const upcoming = nowLabel ? null : nextWetHour(hourly, nowHour ?? hourly[0]?.hour ?? 6);
  const wetHours = hourly.filter((slot) => isWet(slot.pty));

  const headline = nowLabel
    ? metrics.rain && metrics.rain > 0
      ? `지금 ${nowLabel}가 와요 · 1시간 ${metrics.rain}mm`
      : `지금 ${nowLabel}가 와요`
    : upcoming
      ? `${upcoming.hour}시부터 ${upcoming.label} 소식이 있어요`
      : "오늘은 비 소식이 없어요";

  const amounts = hourly.map((slot) => parsePcpMm(slot.pcp));
  const maxMm = Math.max(1, ...amounts);
  const firstHour = hourly[0]?.hour ?? 6;
  const lastHour = hourly[hourly.length - 1]?.hour ?? 23;
  const axisTicks = hourly.filter((_, i) => i % 4 === 0 || i === hourly.length - 1);

  return (
    <>
      <div style={{ padding: "16px 24px 0" }}>
        <Paragraph.Text color={adaptive.grey500} fontWeight="bold" typography="t7">
          {label}
        </Paragraph.Text>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <img src={RAIN_ICON} alt="" width={28} height={28} style={{ display: "block" }} />
          <Text color={adaptive.grey900} typography="t3" fontWeight="bold">
            {headline}
          </Text>
        </div>
      </div>

      <Spacing size={20} />

      {wetHours.length > 0 && (
        <>
          <div style={{ padding: "0 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <Paragraph.Text color={adaptive.grey500} fontWeight="bold">
                {`${firstHour}시 → ${lastHour}시`}
              </Paragraph.Text>
              {nowHour !== null && (
                <Paragraph.Text color={adaptive.grey500} fontWeight="bold">
                  {`지금 ${nowHour}시`}
                </Paragraph.Text>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 88 }}>
              {hourly.map((slot, i) => (
                <div
                  key={slot.hour}
                  style={{
                    flex: 1,
                    height: `${barHeightPercent(amounts[i], maxMm)}%`,
                    background: amounts[i] > 0 ? "#3A7BD5" : adaptive.grey100,
                    borderRadius: 3,
                    outline: slot.hour === nowHour ? `2px solid ${adaptive.grey900}` : undefined,
                    outlineOffset: 1,
                  }}
                />
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              {axisTicks.map((slot) => (
                <Paragraph.Text key={slot.hour} color={adaptive.grey500} typography="t7">
                  {`${slot.hour}시`}
                </Paragraph.Text>
              ))}
            </div>
          </div>

          <Spacing size={22} />
        </>
      )}

      <div style={{ padding: "0 24px" }}>
        <Paragraph.Text color={adaptive.grey500} fontWeight="bold" typography="t7">
          시간별로 보기
        </Paragraph.Text>
      </div>

      <Spacing size={10} />

      {wetHours.length === 0 ? (
        <div style={{ margin: "0 24px" }}>
          <div
            style={{
              background: adaptive.grey50,
              border: `1px solid ${adaptive.grey200}`,
              borderRadius: 16,
              padding: 16,
            }}
          >
            <Paragraph.Text color={adaptive.grey700}>
              {`${firstHour}시~${lastHour}시 사이엔 비 소식이 없어요`}
            </Paragraph.Text>
          </div>
        </div>
      ) : (
        <List>
          {wetHours.map((slot) => (
            <RainHourRow key={slot.hour} slot={slot} isNow={slot.hour === nowHour} />
          ))}
        </List>
      )}

      <Spacing size={12} />

      <div style={{ padding: "0 24px" }}>
        <Paragraph.Text color={adaptive.grey500}>3시간마다 새로 계산해요</Paragraph.Text>
      </div>

      <Spacing size={16} />
    </>
  );
}

function RainHourRow({ slot, isNow }: { slot: HourSlot; isNow: boolean }) {
  const typeLabel = precipitationLabel(slot.pty);
  // pcp는 기상청 원문 구간이라 그대로 보여줘요("1.0~4.9mm") — 대표값(mm)은 막대 높이에만 써요.
  const rightText = slot.pcp ? `${typeLabel} · ${slot.pcp}` : (typeLabel ?? "");

  const row = (
    <ListRow
      left={
        <ListRow.LeftText color={isNow ? MINT[700] : adaptive.grey700}>{`${slot.hour}시`}</ListRow.LeftText>
      }
      contents={<ListRow.Texts type="1RowTypeA" top="" />}
      right={<ListRow.Texts type="Right1RowTypeA" top={rightText} />}
      verticalPadding="medium"
      border={isNow ? "none" : "indented"}
    />
  );

  if (!isNow) return row;
  return <div style={{ background: MINT[50] }}>{row}</div>;
}
