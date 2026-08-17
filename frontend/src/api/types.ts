// ---------- 认证 ----------
export interface User {
  id: string
  nickname: string
  avatar_url: string | null
  is_owner: boolean
  relation_tier: string
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
