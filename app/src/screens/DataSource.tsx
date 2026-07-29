import { adaptive } from "@toss/tds-colors";
import { List, ListRow, Paragraph, Spacing } from "@toss/tds-mobile";
import { useBackNavigation } from "../hooks/useBackNavigation";

// F16 데이터 출처 안내. F8의 '데이터 출처' 행이 여는 화면.
// 자체 뒤로가기·타이틀은 렌더링하지 않아요 — 내비게이션 바는 앱인토스가 제공해요 (CLAUDE.md 제약).
//
// 여기 적힌 출처는 실제로 worker(worker/src/kma.ts·engine.ts)가 쓰는 것만 적어요 —
// 디자인프레임 F16 목업엔 "종관기상관측(ASOS) 지면온도"가 있었는데, 실제로는 ASOS를
// 조회하지 않고 태양고도(자체 계산) + 하늘상태·강수형태(단기예보)로 노면온도를 추정해서
// 그 문구는 빼고 실제 계산 방식대로 고쳤어요 (정직성 원칙 — 안 쓰는 출처를 적지 않아요).
interface SourceRow {
  emoji: string;
  title: string;
  sub: string;
}

const SOURCE_SECTIONS: { heading: string; rows: SourceRow[] }[] = [
  {
    heading: "실황·예보",
    rows: [
      {
        emoji: "https://static.toss.im/2d-icons/emoji/png/4x/u1F4E1.png",
        title: "초단기실황 · 단기예보",
        sub: "기온·습도·풍속 · 10분~3시간 주기 갱신",
      },
      {
        emoji: "https://static.toss.im/2d-icons/emoji/png/4x/u2600.png",
        title: "생활기상지수",
        sub: "자외선지수 · 지역 코드가 있으면 실측, 없으면 태양고도로 추정",
      },
    ],
  },
  {
    heading: "노면 온도 계산용",
    rows: [
      {
        emoji: "https://static.toss.im/2d-icons/emoji/png/4x/u1F321.png",
        title: "태양고도 · 하늘 상태",
        sub: "날짜·시간·위치로 계산한 태양고도와 단기예보 하늘상태로 일사량을 추정해요",
      },
    ],
  },
  {
    heading: "특보",
    rows: [
      {
        emoji: "https://static.toss.im/2d-icons/emoji/png/4x/u26A0.png",
        title: "기상특보",
        sub: "폭염·한파 특보 · 수시 갱신",
      },
    ],
  },
];

export default function DataSource() {
  useBackNavigation();

  return (
    <>
      <div style={{ padding: "16px 24px 6px" }}>
        <Paragraph.Text color={adaptive.grey700} fontWeight="medium">
          모든 값은 기상청 공공데이터를 바탕으로 저희가 계산한 추정치예요.
        </Paragraph.Text>
      </div>

      {SOURCE_SECTIONS.map((section) => (
        <div key={section.heading}>
          <Spacing size={14} />
          <div style={{ padding: "0 24px" }}>
            <Paragraph.Text color={adaptive.grey500} fontWeight="bold">
              {section.heading}
            </Paragraph.Text>
          </div>
          <List>
            {section.rows.map((row) => (
              <ListRow
                key={row.title}
                left={
                  <ListRow.AssetImage
                    src={row.emoji}
                    shape="squircle"
                    backgroundColor={adaptive.greyOpacity100}
                    size="xsmall"
                  />
                }
                contents={
                  <ListRow.Texts
                    type="2RowTypeA"
                    top={row.title}
                    topProps={{ color: adaptive.grey800, fontWeight: "bold" }}
                    bottom={row.sub}
                    bottomProps={{ color: adaptive.grey600 }}
                  />
                }
                verticalPadding="large"
              />
            ))}
          </List>
        </div>
      ))}

      <Spacing size={20} />

      <div style={{ margin: "0 24px 24px", background: adaptive.grey100, borderRadius: 12, padding: "14px 16px" }}>
        <Paragraph.Text color={adaptive.grey700} fontWeight="medium">
          이 앱은 참고용 기상정보 안내예요. 의학적 판단이나 안전 진단을 대신하지 않아요. 응급 상황에는 즉시 119 또는 관련
          기관에 연락하세요.
        </Paragraph.Text>
      </div>
    </>
  );
}
