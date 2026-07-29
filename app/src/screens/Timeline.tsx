import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { List, ListRow, Paragraph, Result, Skeleton, Spacing, Text } from "@toss/tds-mobile";
import { adaptive } from "@toss/tds-colors";
import {
  LEVEL_COLORS,
  LEVEL_LABELS,
  MINT,
  PROFILE_META,
  type Profile,
} from "../constants/judge";
import { fetchJudge, JudgeApiError, type HourSlot, type JudgeResponse } from "../lib/judgeApi";
import { useBackNavigation } from "../hooks/useBackNavigation";

// F4 시간창 — 오늘 언제 나가나. docs/오늘나가도되나_디자인프레임.html F4 참고.
// 18칸 스트립(06~23시). '보통 이하'가 이어지는 구간을 bestWindow로 서버가 골라줘요.
// 자체 뒤로가기·타이틀은 렌더링하지 않아요 — 내비게이션 바는 앱인토스가 제공해요 (CLAUDE.md 제약).
//
// TODO: F13(이번 주 리포트 보기 · 리워드 광고 게이트)로 가는 카드는 화면이 아직 없어서 생략했어요.
interface TimelineNavState {
  nx: number;
  ny: number;
  profile: Profile;
  label: string;
}

function parseKstHour(iso: string): number | null {
  const match = iso.match(/T(\d{2}):/);
  return match ? Number(match[1]) : null;
}

// 시간대별 판정(level 1~5)만 실제 데이터예요 — 막대 높이는 그 값을 20~100% 구간으로 매핑한
// 시각화일 뿐, 별도 수치를 지어낸 게 아니에요.
function barHeightPercent(level: number): number {
  return 20 + (level - 1) * 20;
}

export default function Timeline() {
  useBackNavigation();

  const location = useLocation();
  const state = location.state as TimelineNavState | null;

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
        <Result title="시간창을 찾을 수 없어요" description="홈에서 다음 행동 카드를 눌러 들어와 주세요" />
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div style={{ padding: "16px 24px", overflow: "hidden" }}>
        <Skeleton pattern="listOnly" repeatLastItemCount={6} />
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

  const { profile, label } = state;
  const { hourly, bestWindow } = data;
  const nowHour = parseKstHour(data.observedAt);
  const firstHour = hourly[0]?.hour ?? 6;
  const lastHour = hourly[hourly.length - 1]?.hour ?? 23;
  // 6시부터 마지막 슬롯까지 4칸 간격으로 눈금을 뽑아요 — 목업의 '24시'는 실제 응답에 없는
  // 시각이라 마지막 실제 슬롯(23시)으로 대체해요.
  const axisTicks = hourly.filter((_, i) => i % 4 === 0 || i === hourly.length - 1);

  return (
    <>
      <div style={{ padding: "14px 24px 0" }}>
        <Paragraph.Text color={adaptive.grey500} fontWeight="bold">
          {`${PROFILE_META[profile].emoji} ${PROFILE_META[profile].label} · ${label}`}
        </Paragraph.Text>

        <Spacing size={7} />

        <Text color={adaptive.grey900} typography="t3" fontWeight="bold">
          {bestWindow ? "오늘 나가기 좋은 시간이 있어요" : "오늘은 특별히 더 좋은 시간대가 없어요"}
        </Text>
      </div>

      <Spacing size={20} />

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
          {hourly.map((slot) => (
            <div
              key={slot.hour}
              style={{
                flex: 1,
                height: `${barHeightPercent(slot.level)}%`,
                background: LEVEL_COLORS[slot.level],
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

        <Spacing size={14} />

        <div style={{ background: MINT[50], border: `1px solid ${MINT.border}`, borderRadius: 12, padding: "12px 14px" }}>
          <Paragraph.Text color={MINT[900]} fontWeight="bold">
            {bestWindow ? bestWindow.label : "오늘은 조건에 맞는 좋은 시간이 없어요"}
          </Paragraph.Text>
        </div>
      </div>

      <Spacing size={22} />

      <div style={{ padding: "0 24px" }}>
        <Paragraph.Text color={adaptive.grey500} fontWeight="bold">
          시간별로 보기
        </Paragraph.Text>
      </div>

      <List>
        {hourly.map((slot) => (
          <HourRow key={slot.hour} slot={slot} profile={profile} isNow={slot.hour === nowHour} />
        ))}
      </List>

      <Spacing size={12} />

      <div style={{ padding: "0 24px" }}>
        <Paragraph.Text color={adaptive.grey500}>3시간마다 새로 계산해요</Paragraph.Text>
      </div>

      <Spacing size={16} />
    </>
  );
}

function HourRow({ slot, profile, isNow }: { slot: HourSlot; profile: Profile; isNow: boolean }) {
  // 반려견은 노면, 러너·야외 작업은 체감온도가 그 시간대를 가장 잘 설명해요 (Home과 동일한 기준).
  const value = profile === "dog" ? `${slot.roadTemp}℃` : `${slot.feelsLike}℃`;

  return (
    <ListRow
      left={
        <ListRow.LeftText color={isNow ? MINT[700] : adaptive.grey700}>{`${slot.hour}시`}</ListRow.LeftText>
      }
      contents={<ListRow.Texts type="1RowTypeA" top="" />}
      right={
        <ListRow.Texts
          type="Right1RowTypeB"
          top={
            <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
              <span>{value}</span>
              <span style={{ color: isNow ? MINT[700] : LEVEL_COLORS[slot.level], fontWeight: 700 }}>
                {isNow ? "지금" : LEVEL_LABELS[slot.level]}
              </span>
            </span>
          }
        />
      }
      verticalPadding="medium"
    />
  );
}
