import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { List, ListRow, Loader, Paragraph, SearchField, Spacing } from "@toss/tds-mobile";
import { adaptive } from "@toss/tds-colors";
import { MINT } from "../constants/judge";
import { useSavedRegions } from "../hooks/useSavedRegions";
import { searchRegions } from "../lib/regions";
import { searchRegionsRemote } from "../lib/judgeApi";
import { getStoredJSON, setStoredJSON, STORAGE_KEYS } from "../lib/storage";
import { useBackNavigation } from "../hooks/useBackNavigation";

// F9 지역 검색·추가. docs/오늘나가도되나_디자인프레임.html F9 참고.
// 설정(F8)의 '추가' 칩, 또는 F6(위치 권한 거부)의 '다른 지역 찾기'에서 진입해요.
// 정책: 위치 권한을 거부해도 이 화면 하나로 F6의 대안이 완성돼야 해요.
// 자체 뒤로가기·타이틀은 렌더링하지 않아요 — 내비게이션 바는 앱인토스가 제공해요 (CLAUDE.md 제약).
//
// 구 단위(data/regions.json, 205개)에서 동 단위(카카오 주소 검색 /search)로 바꿨어요 — 검색할
// 때마다 실시간으로 전국 읍면동까지 찾아줘서 정적 파일을 동 단위로 새로 만들 필요가 없어요.
//
// 로컬(구 단위)·원격(동 단위) 검색을 항상 같이 돌려서 합쳐요 — 카카오 주소 검색은 "인천"·"서구"처럼
// 시/구 이름만 쳤을 때는 결과가 잘 안 나오는데(완전한 주소 형태를 기대하는 API라서), 로컬
// searchRegions()는 시/도·시/군/구 이름 부분 일치를 지원해서 그런 검색어를 보완해줘요. 카카오
// 키 미설정·장애로 /search 자체가 실패해도 로컬 결과는 그대로 남아있어요 (정책: 위치 관련
// 기능이 부분 실패해도 검색 자체는 계속 동작해야 해요).

// 193개 전 지역에 형평 있게, 건물 아이콘 하나로 통일해요 (LocationDenied.tsx와 동일).
const REGION_ICON = "https://static.toss.im/2d-icons/emoji/png/4x/u1F3E2.png";
const CLOCK_EMOJI = "https://static.toss.im/2d-icons/emoji/png/4x/u1F557.png";
const SEARCH_DEBOUNCE_MS = 350;

// 카카오(동 단위) · 로컬 폴백(구 단위) 결과를 화면에서 똑같이 다루기 위한 공통 모양.
interface SearchResultItem {
  key: string;
  name: string;
  sub: string;
  nx: number;
  ny: number;
}

export default function RegionSearch() {
  useBackNavigation();

  const navigate = useNavigate();
  const { addRegion } = useSavedRegions();
  const [query, setQuery] = useState("");
  const [recentSearch, setRecentSearch] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getStoredJSON<string | null>(STORAGE_KEYS.recentSearch, null).then((stored) => {
      if (!cancelled) setRecentSearch(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timer = setTimeout(async () => {
      const localMatches: SearchResultItem[] = searchRegions(trimmed).map((r) => ({
        key: `local-${r.sido}-${r.sigungu}`,
        name: r.sigungu,
        sub: r.sido,
        nx: r.nx,
        ny: r.ny,
      }));

      let remoteMatches: SearchResultItem[] = [];
      try {
        const remote = await searchRegionsRemote(trimmed);
        remoteMatches = remote
          // 지번 전용 주소 등 동까지 안 잡히는 카카오 결과는 제목이 빈 채로 나와서 빼요.
          .filter((r) => r.dong)
          .map((r) => ({
            key: `remote-${r.code || `${r.sigungu}-${r.dong}`}`,
            name: r.dong,
            sub: `${r.sido} ${r.sigungu}`.trim(),
            nx: r.nx,
            ny: r.ny,
          }));
      } catch {
        // 카카오 실패 — 로컬 결과만으로도 검색은 계속 동작해요.
      }

      if (cancelled) return;

      // 동 단위(더 구체적)를 먼저, 구 단위를 뒤에. 같은 지역이 두 소스에서 겹치면 하나만 남겨요.
      const seen = new Set<string>();
      const merged = [...remoteMatches, ...localMatches].filter((item) => {
        const dedupeKey = `${item.name}|${item.sub}`;
        if (seen.has(dedupeKey)) return false;
        seen.add(dedupeKey);
        return true;
      });
      setResults(merged);
      setSearching(false);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const handleAddRegion = async (item: SearchResultItem) => {
    const name = item.sub ? `${item.sub} ${item.name}`.trim() : item.name;
    // Storage 쓰기가 끝난 뒤에 navigate해야, 돌아간 화면이 다시 마운트되며 저장된 지역을
    // 곧바로 읽어와요 (안 그러면 방금 추가한 지역이 안 보이는 레이스가 생겨요).
    await addRegion({ name, nx: item.nx, ny: item.ny });
    setRecentSearch(item.name);
    void setStoredJSON(STORAGE_KEYS.recentSearch, item.name);
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

      {query.trim() && (
        <>
          <div style={{ padding: "0 24px" }}>
            <Paragraph.Text color={adaptive.grey500} fontWeight="bold">
              검색 결과
            </Paragraph.Text>
          </div>

          {searching ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "24px" }}>
              <Loader size="small" />
            </div>
          ) : results.length === 0 ? (
            <>
              <Spacing size={4} />
              <div style={{ padding: "0 24px" }}>
                <Paragraph.Text color={adaptive.grey500}>검색 결과가 없어요</Paragraph.Text>
              </div>
            </>
          ) : (
            <List>
              {results.map((item) => (
                <ListRow
                  key={item.key}
                  left={
                    <ListRow.AssetImage
                      src={REGION_ICON}
                      shape="squircle"
                      backgroundColor={adaptive.greyOpacity100}
                      size="xsmall"
                    />
                  }
                  contents={
                    <ListRow.Texts
                      type="2RowTypeA"
                      top={item.name}
                      topProps={{ color: adaptive.grey800, fontWeight: "bold" }}
                      bottom={item.sub}
                      bottomProps={{ color: adaptive.grey500 }}
                    />
                  }
                  right={
                    <button
                      type="button"
                      onClick={() => handleAddRegion(item)}
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
