import { useEffect, useState } from "react";
import { Paragraph } from "@toss/tds-mobile";
import { adaptive } from "@toss/tds-colors";
import { MINT, type Profile } from "../constants/judge";
import {
  MOOD_OPTIONS,
  MOOD_ORDER,
  MOOD_SEVERITY_ORDER,
  MOOD_VERDICT_PHRASE,
  moodPresetText,
  moodPresetsFor,
} from "../constants/mood";
import {
  fetchMood,
  getMoodDeviceId,
  resolveMoodPlace,
  submitMood,
  type MoodAction,
  type MoodSummary,
} from "../lib/moodApi";

/** 목록에 실제로 그리는 줄 수. 나머지는 "외 N명이 더 남겼어요"로 접어요. */
const MESSAGE_VISIBLE = 5;

/**
 * 동네 기분 투표 + 한마디 — "지금 우리 동네 날씨 어때요?"
 *
 * 판정(기상청 값)과 별개로, 같은 동네 사람들이 체감한 걸 모아 보여줘요. 두 가지를 받아요.
 *   1) 기분 — 😊 😐 😥 셋 중 하나
 *   2) 한마디 — **미리 만들어 둔 문장 중에서 고르기** (자유 입력이 아니에요)
 *
 * 자유 입력을 열지 않은 게 핵심이에요. 서버에는 문장이 아니라 프리셋 id만 올라가서
 * 사용자가 쓴 글자가 한 개도 저장되지 않아요 — 검수·신고 기능 없이도 안전해요.
 *
 * 집계는 시군구 단위예요. 동으로 묶으면 대부분의 동네가 텅 비고, 시도로 묶으면 남 얘기가
 * 되니까요. 대신 내 동네는 칩으로 강조해서 소속감을 남겨요.
 *
 * 이 카드는 부가 기능이라 실패하면 **조용히 사라져요**. 판정 화면이 이것 때문에 깨지면
 * 안 되니까요(에러 문구도 띄우지 않아요 — 사용자가 할 수 있는 일이 없어요).
 */
export default function MoodVote({
  label,
  nx,
  ny,
  profile,
}: {
  label: string;
  nx: number;
  ny: number;
  profile: Profile;
}) {
  const [summary, setSummary] = useState<MoodSummary | null>(null);
  const [available, setAvailable] = useState(true);
  const [sending, setSending] = useState(false);

  const place = resolveMoodPlace(label, nx, ny);
  // 객체를 그대로 의존성에 넣으면 렌더마다 새 참조라 매번 다시 불러요.
  const placeKey = `${place.region}|${place.dong}`;

  useEffect(() => {
    let cancelled = false;
    setSummary(null);

    void (async () => {
      try {
        const deviceId = await getMoodDeviceId();
        const next = await fetchMood(place, deviceId);
        if (!cancelled) {
          setSummary(next);
          setAvailable(true);
        }
      } catch {
        // 서버가 아직 이 기능을 안 켰거나(503) 일시적 장애 — 카드를 접어요.
        if (!cancelled) setAvailable(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey]);

  const send = async (action: MoodAction) => {
    if (sending) return;
    setSending(true);
    try {
      const deviceId = await getMoodDeviceId();
      setSummary(await submitMood(place, deviceId, action));
    } catch {
      // 전송 실패 — 이전 집계를 그대로 둬요. 다시 누르면 재시도돼요.
    } finally {
      setSending(false);
    }
  };

  if (!available || !summary) return null;

  const presets = moodPresetsFor(profile);

  return (
    <div style={{ padding: "0 24px" }}>
      <div
        style={{
          background: adaptive.grey50,
          border: `1px solid ${adaptive.grey200}`,
          borderRadius: 16,
          padding: "16px 14px",
        }}
      >
        <div style={{ paddingLeft: 2 }}>
          <Paragraph.Text color={adaptive.grey700} fontWeight="bold">
            지금 우리 동네 날씨 어때요?
          </Paragraph.Text>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {MOOD_ORDER.map((mood) => {
            const option = MOOD_OPTIONS[mood];
            const selected = summary.my === mood;
            return (
              <button
                key={mood}
                type="button"
                aria-pressed={selected}
                disabled={sending}
                onClick={() => void send({ mood })}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  padding: "10px 4px",
                  borderRadius: 12,
                  border: `1px solid ${selected ? MINT[400] : adaptive.grey200}`,
                  background: selected ? MINT[50] : adaptive.background,
                  cursor: sending ? "default" : "pointer",
                  outline: "none",
                  opacity: sending ? 0.6 : 1,
                }}
              >
                <img src={option.icon} alt="" width={26} height={26} style={{ display: "block" }} />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: selected ? 700 : 500,
                    color: selected ? MINT[900] : adaptive.grey700,
                  }}
                >
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 12, paddingLeft: 2 }}>
          <Paragraph.Text color={adaptive.grey700} fontWeight="medium">
            {summaryLine(summary)}
          </Paragraph.Text>
        </div>

        {summary.dong && (
          <div style={{ marginTop: 2, paddingLeft: 2 }}>
            <Paragraph.Text color={adaptive.grey500}>
              {`${summary.dong.name}에선 ${summary.dong.count}명이 참여했어요`}
            </Paragraph.Text>
          </div>
        )}

        <div style={{ height: 1, background: adaptive.grey200, margin: "16px 0" }} />

        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            paddingLeft: 2,
          }}
        >
          <Paragraph.Text color={adaptive.grey700} fontWeight="bold">
            {summary.myMessage ? "한마디 바꾸기" : "한마디 남기기"}
          </Paragraph.Text>
          {summary.messageTotal > 0 && (
            <Paragraph.Text color={adaptive.grey500}>
              {`${summary.messageTotal}명`}
            </Paragraph.Text>
          )}
        </div>

        {/* 문장은 여기 있는 것 중에서만 고를 수 있어요 — 자유 입력이 아니에요.
            개수가 8개라 한 줄에 다 못 넣어서 가로로 넘겨 봐요. */}
        <div
          style={{
            display: "flex",
            gap: 6,
            marginTop: 10,
            overflowX: "auto",
            paddingBottom: 4,
            // 카드 안쪽 여백까지 밀어내서, 넘기는 칩이 가장자리에서 잘려 보이게 해요.
            margin: "10px -14px 0",
            padding: "0 14px 4px",
          }}
        >
          {presets.map((preset) => {
            const selected = summary.myMessage === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={selected}
                disabled={sending}
                onClick={() => void send({ message: preset.id })}
                style={{
                  flexShrink: 0,
                  padding: "8px 12px",
                  borderRadius: 999,
                  border: `1px solid ${selected ? MINT[400] : adaptive.grey200}`,
                  background: selected ? MINT[50] : adaptive.background,
                  color: selected ? MINT[900] : adaptive.grey700,
                  fontSize: 13,
                  fontWeight: selected ? 700 : 500,
                  whiteSpace: "nowrap",
                  cursor: sending ? "default" : "pointer",
                  outline: "none",
                  opacity: sending ? 0.6 : 1,
                }}
              >
                {preset.text}
              </button>
            );
          })}
        </div>

        <MessageList summary={summary} myDong={place.dong} />
      </div>
    </div>
  );
}

/**
 * 최근 한마디 목록. 앱이 모르는 프리셋 id(예전 버전에서 남긴 것)는 건너뛰어요 —
 * 정체 모를 빈 줄을 보여주는 것보다 없는 게 나아요.
 *
 * 문장별 집계 막대로도 만들어봤는데 되돌렸어요. 위쪽 기분 투표가 이미 "몇 명이 어떻게
 * 느꼈나"를 숫자로 말하고 있어서, 한마디까지 숫자로 만들면 카드가 같은 일을 두 번 해요.
 * 한마디가 하는 일은 통계가 아니라 **동네 이름이 붙은 한 줄이 주는 사람 냄새**예요.
 * 출시 직후처럼 참여자가 서너 명일 때도 목록은 멀쩡히 읽히지만, 막대는 전부 길이가 같아서
 * 아무것도 말하지 못하고요.
 *
 * 대신 길이는 잡아둬요. 인기 지역은 하루에 수십 개가 쌓이는데 다 그리면 카드가 화면을
 * 넘어가요. 이 앱은 판정을 보고 25~40초 안에 나가는 게 목표라(기획서 §11) 피드처럼
 * 길어지면 안 돼요. 최신 MESSAGE_VISIBLE줄만 보여주고 나머지는 숫자로만 알려줘요.
 */
function MessageList({ summary, myDong }: { summary: MoodSummary; myDong: string }) {
  const rows = summary.messages
    .map((message) => ({ ...message, text: moodPresetText(message.id) }))
    .filter((message): message is typeof message & { text: string } => message.text !== null);

  if (rows.length === 0) return null;

  const shown = rows.slice(0, MESSAGE_VISIBLE);
  const hidden = Math.max(0, summary.messageTotal - shown.length);

  return (
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      {shown.map((message, index) => {
        // 내 동네 줄만 색으로 띄워요 — 시군구로 넓히면서 옅어진 소속감을 여기서 되찾아요.
        const mine = Boolean(myDong) && message.dong === myDong;
        return (
          <div
            key={`${message.id}-${index}`}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            {message.dong && (
              <span
                style={{
                  flexShrink: 0,
                  padding: "3px 8px",
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  background: mine ? MINT[50] : adaptive.greyOpacity100,
                  color: mine ? MINT[700] : adaptive.grey600,
                }}
              >
                {message.dong}
              </span>
            )}
            <span
              style={{
                fontSize: 14,
                fontWeight: mine ? 700 : 500,
                color: mine ? MINT[900] : adaptive.grey700,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {message.text}
            </span>
          </div>
        );
      })}

      {hidden > 0 && (
        <div style={{ paddingLeft: 2 }}>
          <Paragraph.Text color={adaptive.grey500}>
            {`외 ${hidden}명이 더 남겼어요`}
          </Paragraph.Text>
        </div>
      )}
    </div>
  );
}

/** 방 이름("서울특별시 마포구")에서 화면에 쓸 짧은 이름("마포구")만 뽑아요. */
function shortRegion(region: string): string {
  const tokens = region.trim().split(/\s+/).filter(Boolean);
  return tokens[tokens.length - 1] ?? region;
}

/**
 * 집계 한 줄. 가장 많이 나온 쪽을 기준으로 말해요 — "23명 중 18명이 좋대요".
 *
 * 표가 같으면 나쁜 쪽으로 기울여요(MOOD_SEVERITY_ORDER 참고). 아직 아무도 없으면 숫자를
 * 지어내지 않고 참여를 권하는 문장만 보여줘요.
 */
function summaryLine(summary: MoodSummary): string {
  const region = shortRegion(summary.region);
  if (summary.total === 0) {
    return `${region} 첫 소식을 남겨보세요`;
  }

  const top = MOOD_SEVERITY_ORDER.reduce((best, mood) =>
    summary.counts[mood] > summary.counts[best] ? mood : best,
  );
  return `${region} ${summary.total}명 중 ${summary.counts[top]}명이 ${MOOD_VERDICT_PHRASE[top]}`;
}
