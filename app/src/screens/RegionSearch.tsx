import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { List, ListRow, Paragraph, SearchField, Spacing } from "@toss/tds-mobile";
import { adaptive } from "@toss/tds-colors";
import { MINT } from "../constants/judge";
import { useSavedRegions } from "../hooks/useSavedRegions";
import { searchRegions, type RegionEntry } from "../lib/regions";
import { getStoredJSON, setStoredJSON, STORAGE_KEYS } from "../lib/storage";

// F9 지역 검색·추가. docs/오늘나가도되나_디자인프레임.html F9 참고.
// 설정(F8)의 '추가' 칩, 또는 F6(위치 권한 거부)의 '다른 지역 찾기'에서 진입해요.
// 정책: 위치 권한을 거부해도 이 화면 하나로 F6의 대안이 완성돼야 해요.
// 자체 뒤로가기·타이틀은 렌더링하지 않아요 — 내비게이션 바는 앱인토스가 제공해요 (CLAUDE.md 제약).

const PIN_EMOJI = "https://static.toss.im/2d-icons/emoji/png/4x/u1F4CD.png";
const CLOCK_EMOJI = "https://static.toss.im/2d-icons/emoji/png/4x/u1F557.png";

export default function RegionSearch() {
  const navigate = useNavigate();
  const { addRegion } = useSavedRegions();
  const [query, setQuery] = useState("");
  const [recentSearch, setRecentSearch] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStoredJSON<string | null>(STORAGE_KEYS.recentSearch, null).then((stored) => {
      if (!cancelled) setRecentSearch(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const results = useMemo(() => searchRegions(query), [query]);

  const handleAddRegion = (region: RegionEntry) => {
    addRegion({ name: `${region.sido} ${region.sigungu}`, nx: region.nx, ny: region.ny });
    setRecentSearch(region.sigungu);
    void setStoredJSON(STORAGE_KEYS.recentSearch, region.sigungu);
    navigate(-1);
  };

  return (
    <>
      <div style={{ padding: "14px 24px 4px" }}>
        <SearchField
          placeholder="시/군/구 이름으로 검색"
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
        />
      </div>

      <Spacing size={10} />

      {query.trim() && (
        <>
          <div style={{ padding: "0 24px" }}>
            <Paragraph.Text color={adaptive.grey500} fontWeight="bold">
              검색 결과
            </Paragraph.Text>
          </div>

          {results.length === 0 ? (
            <>
              <Spacing size={4} />
              <div style={{ padding: "0 24px" }}>
                <Paragraph.Text color={adaptive.grey500}>검색 결과가 없어요</Paragraph.Text>
              </div>
            </>
          ) : (
            <List>
              {results.map((region) => (
                <ListRow
                  key={`${region.sido}-${region.sigungu}`}
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
                      top={region.sigungu}
                      topProps={{ color: adaptive.grey800, fontWeight: "bold" }}
                      bottom={region.sido}
                      bottomProps={{ color: adaptive.grey500 }}
                    />
                  }
                  right={
                    <button
                      type="button"
                      onClick={() => handleAddRegion(region)}
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
          )}

          <Spacing size={18} />
        </>
      )}

      {recentSearch && (
        <>
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
                <ListRow.Texts type="1RowTypeA" top={recentSearch} topProps={{ color: adaptive.grey800 }} />
              }
              withArrow
              verticalPadding="large"
              onClick={() => setQuery(recentSearch)}
            />
          </List>
        </>
      )}
    </>
  );
}
