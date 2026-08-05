import { useState } from "react";
import { BottomSheet, List, ListRow } from "@toss/tds-mobile";
import { adaptive } from "@toss/tds-colors";
import { openShareReward, shareNative } from "../lib/shareReward";

// 잠긴 저장 칸을 여는 공유 방법 선택 바텀시트. F6(LocationDenied)·F8(Settings)이 함께 써요.
// - 토스 친구 초대: contactsViral — 콘솔 공유 리워드로 지급돼요(토스 쓰는 친구만 떠요).
// - 카톡·문자로 공유: share() 네이티브 시트 — 어디로든 보낼 수 있어요.
// 둘 중 무엇이든 성공하면 onUnlocked()로 알려서, 부모가 보너스 칸을 열게 해요.

const FRIEND_ICON = "https://static.toss.im/2d-icons/emoji/png/4x/u1F381.png"; // 🎁
const CHAT_ICON = "https://static.toss.im/2d-icons/emoji/png/4x/u1F4AC.png"; // 💬

interface Props {
  open: boolean;
  onClose: () => void;
  // 공유가 성공해 칸을 열어도 될 때 호출돼요.
  onUnlocked: () => void;
}

export default function ShareToUnlockSheet({ open, onClose, onUnlocked }: Props) {
  const [busy, setBusy] = useState(false);

  const run = async (share: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(true);
    // 네이티브 모듈/시트가 뜨기 전에 바텀시트는 닫아둬요.
    onClose();
    const ok = await share();
    setBusy(false);
    if (ok) onUnlocked();
  };

  return (
    <BottomSheet open={open} onClose={onClose} header={<BottomSheet.Header>장소 1칸 더 열기</BottomSheet.Header>}>
      <List>
        <ListRow
          left={
            <ListRow.AssetImage
              src={FRIEND_ICON}
              shape="squircle"
              backgroundColor={adaptive.greyOpacity100}
              size="xsmall"
            />
          }
          contents={
            <ListRow.Texts
              type="2RowTypeA"
              top="토스 친구 초대하고 열기"
              topProps={{ color: adaptive.grey800, fontWeight: "bold" }}
              bottom="토스 쓰는 친구에게 공유하면 리워드로 지급돼요"
              bottomProps={{ color: adaptive.grey600 }}
            />
          }
          withArrow
          verticalPadding="large"
          onClick={() => void run(openShareReward)}
        />
        <ListRow
          left={
            <ListRow.AssetImage
              src={CHAT_ICON}
              shape="squircle"
              backgroundColor={adaptive.greyOpacity100}
              size="xsmall"
            />
          }
          contents={
            <ListRow.Texts
              type="2RowTypeA"
              top="카톡·문자로 공유하고 열기"
              topProps={{ color: adaptive.grey800, fontWeight: "bold" }}
              bottom="카카오톡·메시지 등 어디로든 보낼 수 있어요"
              bottomProps={{ color: adaptive.grey600 }}
            />
          }
          withArrow
          verticalPadding="large"
          onClick={() => void run(shareNative)}
        />
      </List>
    </BottomSheet>
  );
}
