import { useCallback, useEffect, useRef } from "react";

const DEFAULT_DELAY_MS = 500;

/**
 * 꾹 누르기(롱프레스) 핸들러 묶음을 돌려줘요. 반환값을 그대로 엘리먼트에 펼쳐 넣으면 돼요.
 *
 * 한 번 누르기와 다른 동작을 붙일 때 써요 — 목록에서 행을 누르면 그 지역을 보러 가고, 꾹 누르면
 * 내 장소로 지정하는 식이에요. 실수로 바뀌면 안 되는 동작이라 한 번 누르기로는 안 되게 했어요.
 *
 * 터치·마우스를 함께 다루려고 Pointer 이벤트를 써요. 누른 채로 손가락이 벗어나거나(leave)
 * 취소되면(cancel) 타이머를 접어서, 스크롤하려다 잘못 발동되는 걸 막아요.
 */
export function useLongPress(onLongPress: () => void, delayMs = DEFAULT_DELAY_MS) {
  const timer = useRef<number | null>(null);
  // 콜백이 매 렌더 새로 만들어져도 타이머를 다시 걸지 않도록 ref에 담아둬요.
  const callback = useRef(onLongPress);
  callback.current = onLongPress;

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // 언마운트될 때 타이머가 남아 있으면 사라진 화면의 콜백이 뒤늦게 실행돼요.
  useEffect(() => clear, [clear]);

  const start = useCallback(() => {
    clear();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      callback.current();
    }, delayMs);
  }, [clear, delayMs]);

  return {
    onPointerDown: start,
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    // 길게 누를 때 뜨는 기본 컨텍스트 메뉴(모바일의 텍스트 선택·복사 팝업)를 막아요.
    onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
  };
}
