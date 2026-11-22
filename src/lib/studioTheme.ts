import studioFloorplanImg from '../assets/images/studio_office_floorplan_1795189786396.jpg';
import avatarArchitectImg from '../assets/images/avatar_architect_1795189786191.jpg';
import avatarCoderImg from '../assets/images/avatar_coder_1795189786585.jpg';
import avatarQaImg from '../assets/images/avatar_qa_1795189785923.jpg';
import avatarDirectorImg from '../assets/images/avatar_director_1795189786743.jpg';
import avatarArchivistImg from '../assets/images/avatar_archivist_1795189787044.jpg';
import gameTitleArtImg from '../assets/images/game_studio_title_art_1795252203471.jpg';
import gameCrewSpritesImg from '../assets/images/game_sprites_crew_1795252204553.jpg';
import gameRoomConsoleBgImg from '../assets/images/game_room_console_bg_1795252203399.jpg';
import gameGuildEmblemImg from '../assets/images/game_badge_emblem_1795252202876.jpg';
import type { NavSectionId } from '../types/autodev';

export type StudioRoomId = Exclude<NavSectionId, 'studio'>;

export const STUDIO_IMAGES = {
  floorplan: studioFloorplanImg,
  architect: avatarArchitectImg,
  coder: avatarCoderImg,
  qa: avatarQaImg,
  director: avatarDirectorImg,
  archivist: avatarArchivistImg,
  titleArt: gameTitleArtImg,
  crewSprites: gameCrewSpritesImg,
  roomConsoleBg: gameRoomConsoleBgImg,
  guildEmblem: gameGuildEmblemImg,
} as const;

export interface StudioRoomMeta {
  id: StudioRoomId;
  roomCode: string;
  hotkey: '1' | '2' | '3' | '4' | '5' | '6';
  shortNavLabel: string;
  roomName: string;
  rpgStationTitle: string;
  moduleName: string;
  storedArtifacts: string;
  characterName: string;
  characterRole: string;
  avatarUrl: string;
  avatarFallbackInitials: string;
  accentHex: string;
  accentTextClass: string;
  accentBorderClass: string;
  accentSoftBgClass: string;
  /** Percentage hotspot coordinates over the 16:9 isometric cutaway floorplan */
  hotspot: { leftPct: number; topPct: number };
}

export const STUDIO_ROOMS: StudioRoomMeta[] = [
  {
    id: 'environment',
    roomCode: 'RM-01',
    hotkey: '1',
    shortNavLabel: '指挥大厅',
    roomName: '指挥大厅 · 办公室大屏',
    rpgStationTitle: '总控大屏与机柜控制台',
    moduleName: '环境与引擎装配',
    storedArtifacts: '7 日效能与 Token 数据大屏、GitHub/Cloudflare 机柜与地下重置柜',
    characterName: '林工',
    characterRole: 'DevOps 总控官',
    avatarUrl: STUDIO_IMAGES.director,
    avatarFallbackInitials: '林',
    accentHex: '#F59E0B',
    accentTextClass: 'text-[#FBBF24]',
    accentBorderClass: 'border-[#F59E0B]/45',
    accentSoftBgClass: 'bg-[#F59E0B]/12',
    hotspot: { leftPct: 73, topPct: 28 },
  },
  {
    id: 'prd',
    roomCode: 'RM-02',
    hotkey: '2',
    shortNavLabel: '策划室',
    roomName: '架构策划室 · 蓝图白板',
    rpgStationTitle: '需求蓝图与任务拆解台',
    moduleName: '新建需求 (PRD)',
    storedArtifacts: 'PRD 需求草稿本、单对话架构任务树、盲测规格与在线编辑板',
    characterName: '周明',
    characterRole: '首席架构师 & PM',
    avatarUrl: STUDIO_IMAGES.architect,
    avatarFallbackInitials: '周',
    accentHex: '#38BDF8',
    accentTextClass: 'text-[#38BDF8]',
    accentBorderClass: 'border-[#38BDF8]/45',
    accentSoftBgClass: 'bg-[#38BDF8]/12',
    hotspot: { leftPct: 44, topPct: 52 },
  },
  {
    id: 'requirements',
    roomCode: 'RM-03',
    hotkey: '3',
    shortNavLabel: '档案室',
    roomName: '项目档案室 · 需求卷宗',
    rpgStationTitle: '全量需求卷宗与交付典籍',
    moduleName: '需求看板',
    storedArtifacts: '全量历史需求卷宗、Coding Agent 最终聊天交付与完整需求报告',
    characterName: '苏禾',
    characterRole: '项目档案官',
    avatarUrl: STUDIO_IMAGES.archivist,
    avatarFallbackInitials: '苏',
    accentHex: '#FBBF24',
    accentTextClass: 'text-[#FCD34D]',
    accentBorderClass: 'border-[#FBBF24]/45',
    accentSoftBgClass: 'bg-[#FBBF24]/12',
    hotspot: { leftPct: 60, topPct: 60 },
  },
  {
    id: 'pipeline',
    roomCode: 'RM-04',
    hotkey: '4',
    shortNavLabel: '编码工位',
    roomName: '代码车间 · 双屏研发工位',
    rpgStationTitle: '自动编码流水线中控台',
    moduleName: '全自动流水线看板',
    storedArtifacts: 'VPS AGY 实时编码终端、GitHub Actions 队列与盲测自动修复回路',
    characterName: '陈汐',
    characterRole: 'Coding Agent 工程师',
    avatarUrl: STUDIO_IMAGES.coder,
    avatarFallbackInitials: '陈',
    accentHex: '#34D399',
    accentTextClass: 'text-[#34D399]',
    accentBorderClass: 'border-[#34D399]/45',
    accentSoftBgClass: 'bg-[#34D399]/12',
    hotspot: { leftPct: 26, topPct: 28 },
  },
  {
    id: 'approval',
    roomCode: 'RM-05',
    hotkey: '5',
    shortNavLabel: '审批室',
    roomName: '验收会议室 · 发布审批台',
    rpgStationTitle: '预演验收与上线签批台',
    moduleName: '验收与上线审批',
    storedArtifacts: 'Cloudflare 隔离预览屏、验收标准清单与主分支一键上线发布台',
    characterName: '沈岚',
    characterRole: '产品验收总监',
    avatarUrl: STUDIO_IMAGES.director,
    avatarFallbackInitials: '沈',
    accentHex: '#A78BFA',
    accentTextClass: 'text-[#C4B5FD]',
    accentBorderClass: 'border-[#A78BFA]/45',
    accentSoftBgClass: 'bg-[#A78BFA]/12',
    hotspot: { leftPct: 81, topPct: 69 },
  },
  {
    id: 'quality',
    roomCode: 'RM-06',
    hotkey: '6',
    shortNavLabel: '质量实验室',
    roomName: '复盘实验室 · 进化书架',
    rpgStationTitle: '盲测实验室与 RSI 进化炉',
    moduleName: '质量与自进化 (RSI)',
    storedArtifacts: '盲测通过率趋势屏、AI 故障归因板与 RSI System Prompt 规则书架',
    characterName: '陆知',
    characterRole: '质量与自进化专家',
    avatarUrl: STUDIO_IMAGES.qa,
    avatarFallbackInitials: '陆',
    accentHex: '#FB7185',
    accentTextClass: 'text-[#FDA4AF]',
    accentBorderClass: 'border-[#FB7185]/45',
    accentSoftBgClass: 'bg-[#FB7185]/12',
    hotspot: { leftPct: 20, topPct: 69 },
  },
];

export const STUDIO_ROOM_MAP: Record<StudioRoomId, StudioRoomMeta> = STUDIO_ROOMS.reduce(
  (acc, room) => {
    acc[room.id] = room;
    return acc;
  },
  {} as Record<StudioRoomId, StudioRoomMeta>
);
