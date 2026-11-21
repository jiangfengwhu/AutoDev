import studioFloorplanImg from '../assets/images/studio_office_floorplan_1795189786396.jpg';
import avatarArchitectImg from '../assets/images/avatar_architect_1795189786191.jpg';
import avatarCoderImg from '../assets/images/avatar_coder_1795189786585.jpg';
import avatarQaImg from '../assets/images/avatar_qa_1795189785923.jpg';
import avatarDirectorImg from '../assets/images/avatar_director_1795189786743.jpg';
import avatarArchivistImg from '../assets/images/avatar_archivist_1795189787044.jpg';
import type { NavSectionId } from '../types/autodev';

export type StudioRoomId = Exclude<NavSectionId, 'studio'>;

export const STUDIO_IMAGES = {
  floorplan: studioFloorplanImg,
  architect: avatarArchitectImg,
  coder: avatarCoderImg,
  qa: avatarQaImg,
  director: avatarDirectorImg,
  archivist: avatarArchivistImg,
} as const;

export interface StudioRoomMeta {
  id: StudioRoomId;
  roomCode: string;
  shortNavLabel: string;
  roomName: string;
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
    shortNavLabel: '指挥大屏',
    roomName: '指挥大厅 · 办公室大屏',
    moduleName: '环境与引擎装配',
    storedArtifacts: '7 日效能与 Token 数据大屏、GitHub/Cloudflare 机柜与地下重置柜',
    characterName: '林工',
    characterRole: 'DevOps 总控官',
    avatarUrl: STUDIO_IMAGES.director,
    avatarFallbackInitials: '林',
    accentHex: '#F59E0B',
    accentTextClass: 'text-[#FBBF24]',
    accentBorderClass: 'border-[#F59E0B]/40',
    accentSoftBgClass: 'bg-[#F59E0B]/10',
    hotspot: { leftPct: 73, topPct: 28 },
  },
  {
    id: 'prd',
    roomCode: 'RM-02',
    shortNavLabel: '策划室',
    roomName: '架构策划室 · 蓝图白板',
    moduleName: '新建需求 (PRD)',
    storedArtifacts: 'PRD 需求草稿本、单对话架构任务树、盲测规格与在线编辑板',
    characterName: '周明',
    characterRole: '首席架构师 & PM',
    avatarUrl: STUDIO_IMAGES.architect,
    avatarFallbackInitials: '周',
    accentHex: '#38BDF8',
    accentTextClass: 'text-[#38BDF8]',
    accentBorderClass: 'border-[#38BDF8]/40',
    accentSoftBgClass: 'bg-[#38BDF8]/10',
    hotspot: { leftPct: 44, topPct: 52 },
  },
  {
    id: 'requirements',
    roomCode: 'RM-03',
    shortNavLabel: '档案室',
    roomName: '项目档案室 · 需求卷宗',
    moduleName: '需求看板',
    storedArtifacts: '全量历史需求卷宗、Coding Agent 最终聊天交付与完整需求报告',
    characterName: '苏禾',
    characterRole: '项目档案官',
    avatarUrl: STUDIO_IMAGES.archivist,
    avatarFallbackInitials: '苏',
    accentHex: '#A78BFA',
    accentTextClass: 'text-[#C4B5FD]',
    accentBorderClass: 'border-[#A78BFA]/40',
    accentSoftBgClass: 'bg-[#A78BFA]/10',
    hotspot: { leftPct: 60, topPct: 60 },
  },
  {
    id: 'pipeline',
    roomCode: 'RM-04',
    shortNavLabel: '代码车间',
    roomName: '代码车间 · 双屏研发工位',
    moduleName: '全自动流水线看板',
    storedArtifacts: 'VPS AGY 实时编码终端、GitHub Actions 队列与盲测自动修复回路',
    characterName: '陈汐',
    characterRole: 'Coding Agent 工程师',
    avatarUrl: STUDIO_IMAGES.coder,
    avatarFallbackInitials: '陈',
    accentHex: '#34D399',
    accentTextClass: 'text-[#34D399]',
    accentBorderClass: 'border-[#34D399]/40',
    accentSoftBgClass: 'bg-[#34D399]/10',
    hotspot: { leftPct: 26, topPct: 28 },
  },
  {
    id: 'approval',
    roomCode: 'RM-05',
    shortNavLabel: '验收室',
    roomName: '验收会议室 · 发布审批台',
    moduleName: '验收与上线审批',
    storedArtifacts: 'Cloudflare 隔离预览屏、验收标准清单与主分支一键上线发布台',
    characterName: '沈岚',
    characterRole: '产品验收总监',
    avatarUrl: STUDIO_IMAGES.director,
    avatarFallbackInitials: '沈',
    accentHex: '#FB923C',
    accentTextClass: 'text-[#FDBA74]',
    accentBorderClass: 'border-[#FB923C]/40',
    accentSoftBgClass: 'bg-[#FB923C]/10',
    hotspot: { leftPct: 81, topPct: 69 },
  },
  {
    id: 'quality',
    roomCode: 'RM-06',
    shortNavLabel: '复盘室',
    roomName: '复盘实验室 · 进化书架',
    moduleName: '质量与自进化 (RSI)',
    storedArtifacts: '盲测通过率趋势屏、AI 故障归因板与 RSI System Prompt 规则书架',
    characterName: '陆知',
    characterRole: '质量与自进化专家',
    avatarUrl: STUDIO_IMAGES.qa,
    avatarFallbackInitials: '陆',
    accentHex: '#2DD4BF',
    accentTextClass: 'text-[#5EEAD4]',
    accentBorderClass: 'border-[#2DD4BF]/40',
    accentSoftBgClass: 'bg-[#2DD4BF]/10',
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
