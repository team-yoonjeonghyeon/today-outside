import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { List, ListRow, Paragraph, SearchField, Spacing } from "@toss/tds-mobile";
import { adaptive } from "@toss/tds-colors";
import { MINT } from "../constants/judge";

// F9 지역 검색·추가. docs/오늘나가도되나_디자인프레임.html F9 참고.
// 설정(F8)의 '추가' 칩, 또는 F6(위치 권한 거부)의 '다른 지역 찾기'에서 진입해요.
// 정책: 위치 권한을 거부해도 이 화면 하나로 F6의 대안이 완성돼야 해요.
// 자체 뒤로가기·타이틀은 렌더링하지 않아요 — 내비게이션 바는 앱인토스가 제공해요 (CLAUDE.md 제약).

const PIN_EMOJI = "https://static.toss.im/2d-icons/emoji/png/4x/u1F4CD.png";
const CLOCK_EMOJI = "https://static.toss.im/2d-icons/emoji/png/4x/u1F557.png";

interface SearchResult {
  name: string;
  region: string;
}

// TODO: data/ 지역·격자 매핑 완성 전까지의 예시 검색 결과. 실제로는 입력값으로 격자 매핑 데이터를 검색해요.
const SAMPLE_RESULTS: SearchResult[] = [
  { name: "수원시 영통구", region: "경기도" },
  { name: "수원시 팔달구", region: "경기도" },
  { name: "수원시 장안구", region: "경기도" },
];

// TODO: Storage에서 최근 검색어를 읽어와요.
const RECENT_SEARCH = "해운대구";

export default function RegionSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const handleAddRegion = (_result: SearchResult) => {
    // TODO: 저장된 지역이 이미 3개면 "가장 오래된 지역과 바꿀까요?" 확인 문구 표시 (디자인프레임 F9 메모).
    // TODO: Storage에 지역 추가 후 이전 화면(F6/설정)으로 복귀.
    navigate(-1);
  };

  return (
    <>
      <div style={{ padding: "14px 24px 4px" }}>
        <SearchField
          placeholder="동 이름으로 검색"
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
        />
      </div>

      <Spacing size={10} />

      <div style={{ padding: "0 24px" }}>
        <Paragraph.Text color={adaptive.grey500} fontWeight="bold">
          검색 결과
        </Paragraph.Text>
      </div>

      <List>
        {SAMPLE_RESULTS.map((result) => (
          <ListRow
            key={result.name}
            left={
              <ListRow.AssetImage
                src={PIN_EMOJI}
                shape="squircle"
                backgroundColor={adaptive.greyOpacity100}
                size="xsmall"
              />
            }
            contents={
              <ListRow.Texts
                type="2RowTypeA"
                top={result.name}
                topProps={{ color: adaptive.grey800, fontWeight: "bold" }}
                bottom={result.region}
                bottomProps={{ color: adaptive.grey500 }}
              />
            }
            right={
              <button
                type="button"
                onClick={() => handleAddRegion(result)}
                style={{
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                  color: MINT[700],
                  background: MINT[50],
                  padding: "6px 11px",
                  borderRadius: 9,
                }}
              >
                추가
              </button>
            }
            verticalPadding="large"
          />
        ))}
      </List>

      <Spacing size={18} />

      <div style={{ padding: "0 24px" }}>
        <Paragraph.Text color={adaptive.grey500} fontWeight="bold">
          최근 검색
        </Paragraph.Text>
      </div>

      <List>
        <ListRow
          left={
            <ListRow.AssetImage
              src={CLOCK_EMOJI}
              shape="squircle"
              backgroundColor="transparent"
              size="xsmall"
            />
          }
          contents={
            <ListRow.Texts type="1RowTypeA" top={RECENT_SEARCH} topProps={{ color: adaptive.grey800 }} />
          }
          withArrow
          verticalPadding="large"
          onClick={() => setQuery(RECENT_SEARCH)}
        />
      </List>
    </>
  );
}
