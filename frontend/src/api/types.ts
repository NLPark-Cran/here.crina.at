// ---------- 认证 ----------
export interface User {
  id: string
  nickname: string
  avatar_url: string | null
  is_owner: boolean
  relation_tier: string
  email?: string | null
  notify_email?: boolean
}

export interface MeOptional {
  user: User | null
}

// ---------- 空间 / 居民 ----------
export interface Character {
  id: string
  name: string
  tagline: string
  mbti: string
  color: string
  avatar_url: string
  is_agent: boolean
}

export interface PresenceMap {
  presence: Record<string, string>
}

export interface GarbageItem {
  tier: string
  text: string
}

// ---------- 客厅碎碎念 ----------
export interface PostAuthor {
  name: string
  avatar_url: string | null
  color?: string
  type: 'user' | 'character'
}

export interface PostReply {
  id: string
  author: PostAuthor
  author_id?: string
  content: string
  created_at: string
}

export interface Post {
  id: string
  author: PostAuthor
  author_id: string
  content: string
  image_url: string | null
  created_at: string
  replies: PostReply[]
}

// ---------- 私聊 ----------
export type ChatMode = 'auto' | 'brainstorm' | 'guide' | 'probe' | 'extract' | 'off'

export interface Conversation {
  id: string
  character_id: string
  mode: ChatMode
  title: string | null
  updated_at: string
  /** "" = 未分组；"emind" = 旧家导入 */
  folder?: string
  /** 后端暂未返回，预留：最后一条消息预览 */
  last_message?: string | null
}

export interface ChatMessage {
  id: string
  role: 'user' | 'character' | 'narrator'
  character_id: string | null
  kind: string | null
  content: string
  created_at: string
}

export interface ConversationDetail extends Conversation {
  messages: ChatMessage[]
}

// SSE 流式事件
export type ChatStreamEvent =
  | { type: 'speaker'; character: string; name: string; color: string; avatar_url: string }
  | { type: 'delta'; character: string; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

// ---------- 信箱 ----------
export interface Letter {
  id: string
  character: { id: string; name: string; color: string }
  kind: string
  title: string
  content: string
  read: boolean
  created_at: string
}

// ---------- 档案馆 ----------
export type MemoryKind = 'fact' | 'preference' | 'summary' | string

export interface Memory {
  id: string
  kind: MemoryKind
  content: string
  salience: number
  character_id?: string | null
  created_at: string
}

export interface SpaceEvent {
  id: string
  title: string
  description: string
  start_at: string
  end_at: string | null
  remind_minutes: number
  source?: string
}

export interface WikiPage {
  id: string
  title: string
  content: string
  mode: string
  public?: boolean
  created_at: string
}

// ---------- 委托板 ----------
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export type TaskTarget = 'sandbox' | 'renovate'

export interface AgentTask {
  id: string
  title: string
  prompt: string
  status: TaskStatus
  target: TaskTarget
  result_summary: string | null
  created_at: string
  finished_at: string | null
}

/** 任务施工流事件（字段宽松，后端会回放落盘日志 + 实时追加） */
export interface TaskStreamEvent {
  type: 'started' | 'text' | 'tool_start' | 'tool_end' | 'finished' | 'error' | 'closed' | 'eof' | 'ping' | string
  text?: string
  name?: string
  id?: string
  ok?: boolean
  message?: string
  status?: string
}

// ---------- BYOK / Google / 搬家 ----------
export interface ByokStatus {
  connected: boolean
}

export interface GoogleStatus {
  connected: boolean
  available: boolean
}

export interface EmindStatus {
  available: boolean
  emind_name?: string
  conversations?: number
  messages?: number
  memories?: number
  reason?: string
}

export interface EmindImportResult {
  ok: boolean
  imported: { conversations: number; messages: number; memories: number }
  message: string
}

// ---------- 衣橱与小金库 ----------
export interface WardrobeItem {
  id: string
  kind: 'outfit' | 'decor'
  title: string
  image_url: string
  cost: number
  note: string
  wearing: boolean
  created_at: string
}

export interface LedgerEntry {
  delta: number
  reason: string
  created_at: string
}

export interface WardrobeData {
  balance: number
  items: WardrobeItem[]
  ledger: LedgerEntry[]
}

// ---------- 文件空间 ----------
export interface SpaceFile {
  path: string
  name: string
  size: number
  /** Unix 秒级时间戳 */
  mtime: number
  /** MIME 类型，如 image/png、text/markdown；未知为 "file" */
  kind: string
}

export interface FilesResponse {
  files: SpaceFile[]
  hint?: string
}
