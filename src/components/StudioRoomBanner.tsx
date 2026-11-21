import { useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { STUDIO_ROOM_MAP, type StudioRoomId } from '../lib/studioTheme';

interface StudioRoomBannerProps {
  roomId: StudioRoomId;
  statusSpeech: string;
  isBusy?: boolean;
  onBackToFloorplan: () => void;
}

export function StudioRoomBanner({
  roomId,
  statusSpeech,
  isBusy = false,
  onBackToFloorplan,
}: StudioRoomBannerProps) {
  const room = STUDIO_ROOM_MAP[roomId];
  const [imgError, setImgError] = useState(false);

  return (
    <div className="mb-6 rounded-xl border border-[#263042] bg-[#141923]/95 px-4 py-3.5 sm:px-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="flex items-center gap-3.5 min-w-0">
        <div className="relative shrink-0">
          {!imgError ? (
            <img
              src={room.avatarUrl}
              alt={`${room.characterName} — ${room.characterRole}`}
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="h-12 w-12 rounded-xl object-cover border border-[#324056] bg-[#1C2433]"
            />
          ) : (
            <div className="h-12 w-12 rounded-xl border border-[#324056] bg-[#1C2433] flex items-center justify-center font-display text-[16px] font-bold text-[#F8FAFC]">
              {room.avatarFallbackInitials}
            </div>
          )}
          {isBusy && (
            <span
              title="该办公室有后台任务运行中"
              className="absolute -bottom-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-[#0C0F16] border border-[#38BDF8]"
            >
              <Loader2 className="h-2.5 w-2.5 animate-spin text-[#38BDF8]" />
            </span>
          )}
        </div>

        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className={`font-mono text-[11px] font-semibold ${room.accentTextClass}`}>
              {room.roomCode}
            </span>
            <span className="font-display text-[15px] font-semibold text-[#F8FAFC]">
              {room.roomName}
            </span>
            <span aria-hidden="true" className="text-[#4B5870]">·</span>
            <span className="text-[12px] text-[#94A3B8]">
              {room.characterName}（{room.characterRole}）
            </span>
          </div>
          <p className="text-[12px] text-[#B8C4D4] truncate">
            「{statusSpeech}」
            <span aria-hidden="true" className="mx-2 text-[#4B5870]">·</span>
            <span className="text-[#7E8FA6]">{room.storedArtifacts}</span>
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onBackToFloorplan}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#2D384D] bg-[#1B2230] px-3 py-1.5 text-[12px] font-medium text-[#CBD5E1] hover:bg-[#242D40] hover:text-[#F8FAFC] transition-colors whitespace-nowrap shrink-0 self-start md:self-auto"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>返回工作室全景</span>
      </button>
    </div>
  );
}
