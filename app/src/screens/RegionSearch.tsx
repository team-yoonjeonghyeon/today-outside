import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog, List, ListRow, Loader, Paragraph, SearchField, Spacing } from "@toss/tds-mobile";
import { adaptive } from "@toss/tds-colors";
import { Accuracy, getCurrentLocation } from "@apps-in-toss/web-framework";
import { MINT } from "../constants/judge";
import { useLastProfile } from "../hooks/useLastProfile";
import { useNotificationPrefs } from "../hooks/useNotificationPrefs";
import { useSavedRegions, type StoredRegion } from "../hooks/useSavedRegions";
import { syncSubscriptions } from "../lib/notifications";
import { resolveMyLocation } from "../lib/location";
import { searchRegions } from "../lib/regions";
import { searchRegionsRemote } from "../lib/judgeApi";
import { getStoredJSON, setStoredJSON, STORAGE_KEYS } from "../lib/storage";
import { useBackNavigation } from "../hooks/useBackNavigation";
import { useDisablePullToRefresh } from "../hooks/useDisablePullToRefresh";
import { ROUTES } from "../routes";

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
// 지도+핀 아이콘 — "현재 위치로 찾기" 버튼용 (LocationDenied.tsx의 MAP_PIN_ICON과 동일).
const MAP_PIN_ICON = "https://static.toss.im/2d-icons/emoji/png/4x/uE116.png";
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
  useDisablePullToRefresh();

  const navigate = useNavigate();
  const { addRegion, savedRegions, primaryRegion, maxRegions } = useSavedRegions();
  const { prefs } = useNotificationPrefs();
  const [profile] = useLastProfile();
  // 저장한 지역을 내 장소로 바꿀지 물어볼 후보. null이면 확인 창이 닫힌 상태예요.
  const [pendingPrimary, setPendingPrimary] = useState<StoredRegion | null>(null);
  const [query, setQuery] = useState("");
  const [recentSearch, setRecentSearch] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);

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

  // 검색해서 지역을 골랐다는 건 그 지역이 궁금하다는 뜻이라, 이전 화면(F6·F8)으로 돌아가는
  // 대신 바로 그 지역의 홈 화면으로 이동해요.
  const goHome = (region: StoredRegion) => {
    navigate(ROUTES.home, { state: { nx: region.nx, ny: region.ny, label: region.name } });
  };

  // "현재 위치로 찾기" — GPS 권한을 확인하고 현재 위치를 불러와 그 지역 홈으로 바로 이동해요.
  // LocationDenied(F6)의 위치 재요청과 같은 흐름이에요. 권한을 거부하거나 위치 조회가 실패하면
  // 이 화면에 그대로 머물러서, 검색으로 직접 고를 수 있게 해요 (정책: 위치 없이도 전 기능 동작).
  const handleUseCurrentLocation = async () => {
    if (locating) return;
    setLocating(true);
    try {
      const status = await getCurrentLocation.openPermissionDialog();
      if (status !== "allowed") return;

      const { coords } = await getCurrentLocation({ accuracy: Accuracy.Balanced });
      const { nx, ny, name } = await resolveMyLocation(coords.latitude, coords.longitude);
      // 아직 내 장소가 없으면 여기서 확정해요 — 권한을 거부했다가 이 버튼으로 돌아온 사용자는
      // 이 경로 말고는 내 장소를 가질 기회가 없어서, 안 잡아주면 알림을 영영 못 받아요.
      // 이미 내 장소가 있으면 화면만 그 위치로 보여줘요(기준을 옮기려면 홈의 ↻를 써요).
      if (!primaryRegion) {
        await addRegion({ name, nx, ny });
      }
      navigate(ROUTES.home, { state: { nx, ny, label: name } });
    } catch {
      // 다이얼로그 호출 실패·권한은 허용됐지만 위치 조회 자체가 실패한 경우 등 — 화면에 머물러요.
    } finally {
      setLocating(false);
    }
  };

  const handleAddRegion = async (item: SearchResultItem) => {
    const name = item.sub ? `${item.sub} ${item.name}`.trim() : item.name;
    const region: StoredRegion = { name, nx: item.nx, ny: item.ny };
    setRecentSearch(item.name);
    void setStoredJSON(STORAGE_KEYS.recentSearch, item.name);

    // Storage 쓰기가 끝난 뒤에 navigate해야, 돌아간 화면이 다시 마운트되며 저장된 지역을
    // 곧바로 읽어와요 (안 그러면 방금 추가한 지역이 안 보이는 레이스가 생겨요).

    // 아직 내 장소가 없으면(위치 권한을 거부하고 지역을 직접 고르는 흐름) 여기서 확정해요.
    if (!primaryRegion) {
      await addRegion(region, { asPrimary: true });
      goHome(region);
      return;
    }

    // 이미 저장돼 있는 곳(같은 격자)이면 저장할 게 없어요 — 보여주기만 해요.
    if (savedRegions.some((r) => r.nx === region.nx && r.ny === region.ny)) {
      goHome(region);
      return;
    }

    // 빈 칸이 있으면(공유로 두 번째 칸이 열린 경우) 그냥 거기에 넣어요. 자리가 남는데도
    // "내 장소로 할까요?"를 묻는 건 맥락에 안 맞아요 — 사용자는 장소를 하나 더 추가하려는
    // 거지 기준을 옮기려는 게 아니거든요. 내 장소는 그대로 두고 뒤에 붙여요.
    if (savedRegions.length < maxRegions) {
      await addRegion(region, { asPrimary: false });
      goHome(region);
      return;
    }

    // 자리가 다 찼어요. 이제부터는 저장 = 내 장소 교체라서, 저장하기 전에 확인을 받아요.
    setPendingPrimary(region);
  };

  const handleConfirmPrimary = async () => {
    if (!pendingPrimary) return;
    await addRegion(pendingPrimary, { asPrimary: true });
    void syncSubscriptions({ profile, region: pendingPrimary, prefs });
    setPendingPrimary(null);
    goHome(pendingPrimary);
  };

  return (
    <>
      {/* SearchField 자체가 안쪽에 좌우 16px 패딩을 더 갖고 있어서(보이는 회색 알약이 화면 쪽
          24px보다 더 좁아 보였어요), 탭바 때와 같은 방식으로 그 내부 패딩을 0으로 없애서
          다른 화면 요소들과 같은 폭(24px 하나)을 쓰게 맞춰요. */}
      <div className="region-search-field" style={{ padding: "14px 24px 4px" }}>
        <style>{`.region-search-field .tds-mobile-search-field > div { padding-left: 0; padding-right: 0; }`}</style>
        <SearchField
          placeholder="시/군/구·동 이름으로 검색"
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
        />
      </div>

      {/* 검색 대신 현재 위치를 바로 불러오는 지름길. 항상 검색창 바로 아래에 둬요. */}
      <List>
        <ListRow
          left={
            <ListRow.AssetImage
              src={MAP_PIN_ICON}
              shape="squircle"
              backgroundColor={adaptive.greyOpacity100}
              size="xsmall"
            />
          }
          contents={
            <ListRow.Texts
              type="1RowTypeA"
              top={locating ? "현재 위치를 불러오는 중…" : "현재 위치로 찾기"}
              topProps={{ color: MINT[700], fontWeight: "bold" }}
            />
          }
          right={locating ? <Loader size="small" /> : undefined}
          verticalPadding="large"
          onClick={() => void handleUseCurrentLocation()}
        />
      </List>

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

      {/* 저장 = 내 장소 지정이라 저장 전에 확인해요. "지금만 보기"를 누르면 저장하지 않고
          그 지역 화면만 보여줘요. */}
      <ConfirmDialog
        open={pendingPrimary != null}
        title={<ConfirmDialog.Title>여기를 내 장소로 할까요?</ConfirmDialog.Title>}
        description={
          <ConfirmDialog.Description>
            {/* 이 창은 자리가 다 찼을 때만 떠요 — 그래서 항상 하나는 목록에서 내려가요.
                어느 곳인지(맨 뒤, 가장 오래 둔 곳) 미리 알려주고 확인받아요.

                지역 이름 뒤에 조사를 붙이면 받침에 따라 은/는·이/가가 갈려서("해운대구는"
                vs "공덕동은") 문장이 깨져요. 이름을 괄호에 넣고 항상 "곳"으로 끝내면
                받침이 고정돼서 어떤 지역이 와도 자연스러워요. */}
            {[
              "알림 받는 기준 장소가 바뀌어요.",
              `자리가 다 차서 가장 오래 둔 곳(${savedRegions[savedRegions.length - 1]?.name})이 목록에서 내려가요.`,
            ].join("\n")}
          </ConfirmDialog.Description>
        }
        cancelButton={
          <ConfirmDialog.CancelButton
            onClick={() => {
              const region = pendingPrimary;
              setPendingPrimary(null);
              if (region) goHome(region);
            }}
          >
            지금만 보기
          </ConfirmDialog.CancelButton>
        }
        confirmButton={
          <ConfirmDialog.ConfirmButton onClick={() => void handleConfirmPrimary()}>
            내 장소로 하기
          </ConfirmDialog.ConfirmButton>
        }
        onClose={() => {
          const region = pendingPrimary;
          setPendingPrimary(null);
          if (region) goHome(region);
        }}
      />
    </>
  );
}
