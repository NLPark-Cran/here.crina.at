import type {
  AgentTask,
  ByokStatus,
  Character,
  ChatMode,
  ChatStreamEvent,
  Conversation,
  ConversationDetail,
  EmindImportResult,
  EmindStatus,
  FilesResponse,
  GarbageItem,
  GoogleStatus,
  Letter,
  MeOptional,
  Memory,
  Post,
  PresenceMap,
  SpaceDoc,
  SpaceEvent,
  TaskStreamEvent,
  TaskTarget,
  User,
  WardrobeData,
  WikiPage,
} from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
  get isAuth() {
    return this.status === 401 || this.status === 403
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  })
  if (!res.ok) {
    let message = `请求失败（${res.status}）`
    try {
      const data = await res.json()
      if (typeof data?.detail === 'string') message = data.detail
    } catch {
      /* 忽略非 JSON 错误体 */
    }
    throw new ApiError(res.status, message)
  }
  return (await res.json()) as T
}

const get = <T>(path: string) => request<T>(path)
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' })

// ---------- 认证 ----------
export const authApi = {
  meOptional: () => get<MeOptional>('/api/auth/me/optional'),
  me: () => get<User>('/api/auth/me'),
  logout: () => post<{ ok: boolean }>('/api/auth/logout'),
}

// ---------- 空间 ----------
export const spaceApi = {
  characters: () => get<{ characters: Character[] }>('/api/space/characters'),
  presence: () => get<PresenceMap>('/api/space/presence'),
  garbage: () => post<GarbageItem>('/api/space/garbage'),
  wardrobe: () => get<WardrobeData>('/api/space/wardrobe'),
  fundWardrobe: (amount: number) =>
    post<{ ok: boolean; balance: number; message: string }>('/api/space/wardrobe/fund', { amount }),
  wishWardrobe: (kind: 'outfit' | 'decor', hint: string) =>
    post<{ ok: boolean; message: string }>('/api/space/wardrobe/wish', { kind, hint }),
}

// ---------- 客厅 ----------
export const postsApi = {
  list: (limit = 30) => get<{ posts: Post[] }>(`/api/posts?limit=${limit}`),
  create: (content: string) => post<{ id: string }>('/api/posts', { content }),
  reply: (postId: string, content: string) =>
    post<{ id: string }>(`/api/posts/${postId}/replies`, { content }),
}

// ---------- 私聊 ----------
export const chatApi = {
  list: () => get<{ conversations: Conversation[] }>('/api/chat/conversations'),
  create: (character_id: string, mode: ChatMode = 'auto') =>
    post<Conversation>('/api/chat/conversations', { character_id, mode }),
  detail: (id: string) => get<ConversationDetail>(`/api/chat/conversations/${id}`),
  setMode: (id: string, mode: ChatMode) =>
    patch<Conversation>(`/api/chat/conversations/${id}`, { mode }),
  remove: (id: string) => del<{ ok: boolean }>(`/api/chat/conversations/${id}`),
}

/** 通用 SSE 解析：逐行读 `data: {...}\n\n`，把 JSON 事件回调出去 */
async function readSseStream<T>(
  res: Response,
  onEvent: (ev: T) => void,
  failMessage: string,
): Promise<void> {
  if (!res.ok || !res.body) {
    let message = `${failMessage}（${res.status}）`
    try {
      const data = await res.json()
      if (typeof data?.detail === 'string') message = data.detail
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const separator = /\r?\n\r?\n/

  const handleEvent = (rawEvent: string) => {
    for (const line of rawEvent.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload) continue
      try {
        onEvent(JSON.parse(payload) as T)
      } catch {
        /* 跳过无法解析的行 */
      }
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // SSE 事件以空行分隔（兼容 \n\n 与 \r\n\r\n）
    let match: RegExpExecArray | null
    while ((match = separator.exec(buffer))) {
      handleEvent(buffer.slice(0, match.index))
      buffer = buffer.slice(match.index + match[0].length)
    }
  }
  // 冲刷解码器并处理流末尾没有空行结尾的残余事件
  buffer += decoder.decode()
  if (buffer.trim()) handleEvent(buffer)
}

/**
 * 发消息（SSE 流式）：逐行解析 `data: {...}\n\n`，把事件回调出去。
 */
export async function streamChatMessage(
  convId: string,
  content: string,
  onEvent: (ev: ChatStreamEvent) => void,
  signal?: AbortSignal,
  docIds?: string[],
): Promise<void> {
  const res = await fetch(`/api/chat/conversations/${convId}/messages`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, doc_ids: docIds ?? [] }),
    signal,
  })
  await readSseStream(res, onEvent, '发送失败')
}

/** TTS：返回 audio/mpeg 的 Blob */
export async function fetchTtsAudio(text: string, characterId: string): Promise<Blob> {
  const res = await fetch('/api/chat/tts', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 500), character_id: characterId }),
  })
  if (!res.ok) {
    let message = '语音生成失败'
    try {
      const data = await res.json()
      if (typeof data?.detail === 'string') message = data.detail
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message)
  }
  return res.blob()
}

// ---------- 信箱 ----------
export const lettersApi = {
  list: () => get<{ letters: Letter[]; unread: number }>('/api/letters'),
  read: (id: string) => post<{ ok: boolean }>(`/api/letters/${id}/read`),
  send: (character_id: string, content: string) =>
    post<{ ok: boolean; message: string }>('/api/letters', { character_id, content }),
}

// ---------- 委托板 ----------
export const agentApi = {
  list: () => get<{ tasks: AgentTask[] }>('/api/agent/tasks'),
  create: (title: string, prompt: string, target: TaskTarget = 'sandbox') =>
    post<AgentTask>('/api/agent/tasks', { title, prompt, target }),
  detail: (id: string) => get<AgentTask>(`/api/agent/tasks/${id}`),
  cancel: (id: string) => post<{ ok: boolean }>(`/api/agent/tasks/${id}/cancel`),
}

/** 任务施工流（SSE）：历史回放 + 实时追加 */
export async function streamTask(
  taskId: string,
  onEvent: (ev: TaskStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/agent/tasks/${taskId}/stream`, {
    credentials: 'include',
    signal,
  })
  await readSseStream(res, onEvent, '施工流连接失败')
}

// ---------- BYOK / Google / 搬家 ----------
export const byokApi = {
  status: () => get<ByokStatus>('/api/byok/status'),
  disconnect: () => del<{ ok: boolean }>('/api/byok'),
  googleStatus: () => get<GoogleStatus>('/api/byok/google/status'),
}

export const importApi = {
  emindStatus: () => get<EmindStatus>('/api/import/emind/status'),
  emindImport: () => post<EmindImportResult>('/api/import/emind'),
}

// ---------- 文件空间 ----------
export const filesApi = {
  list: () => get<FilesResponse>('/api/files'),
  /** 下载地址（同源 cookie 鉴权，直接 <a href download>） */
  url: (path: string) => `/api/files/${path.split('/').map(encodeURIComponent).join('/')}`,
  read: (path: string) =>
    get<{ path: string; content: string; truncated: boolean }>(
      `/api/files/read/${path.split('/').map(encodeURIComponent).join('/')}`,
    ),
  write: (path: string, content: string) =>
    request<{ ok: boolean; path: string; size: number }>(
      `/api/files/write/${path.split('/').map(encodeURIComponent).join('/')}`,
      { method: 'PUT', body: JSON.stringify({ content }) },
    ),
}

// ---------- 文档处理 ----------
export const docsApi = {
  list: () => get<{ docs: SpaceDoc[] }>('/api/docs'),
  upload: async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/docs/upload', { method: 'POST', credentials: 'include', body: fd })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new ApiError(res.status, data.detail || '上传失败')
    }
    return (await res.json()) as SpaceDoc & { message: string }
  },
  remove: (id: string) => del<{ ok: boolean }>(`/api/docs/${id}`),
  /** 导出 docx/pdf（blob 下载） */
  export: async (body: { doc_id?: string; path?: string; format: 'docx' | 'pdf'; title?: string }) => {
    const res = await fetch('/api/docs/export', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new ApiError(res.status, data.detail || '导出失败')
    }
    const blob = await res.blob()
    const cd = res.headers.get('Content-Disposition') ?? ''
    const m = /filename\*=UTF-8''([^;]+)/.exec(cd)
    const name = m ? decodeURIComponent(m[1]) : `export.${body.format}`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  },
}

// ---------- 设置扩展（邮箱绑定 / 通知偏好） ----------
export const settingsApi = {
  sendEmailCode: (email: string) =>
    post<{ ok: boolean; message: string }>('/api/settings/email/send-code', { email }),
  verifyEmail: (email: string, code: string) =>
    post<{ ok: boolean; email: string; message: string }>('/api/settings/email/verify', { email, code }),
  setNotify: (notify_email: boolean) =>
    post<{ ok: boolean; notify_email: boolean }>('/api/settings/notify', { notify_email }),
  setTimezone: (timezone: string) =>
    post<{ ok: boolean; timezone: string }>('/api/settings/timezone', { timezone }),
}

// ---------- 档案馆 ----------
export const archiveApi = {
  memories: () => get<{ memories: Memory[] }>('/api/memories'),
  deleteMemory: (id: string) => del<{ ok: boolean }>(`/api/memories/${id}`),
  events: () => get<{ events: SpaceEvent[] }>('/api/events'),
  createEvent: (body: {
    title: string
    description: string
    start_at: string
    remind_minutes: number
  }) => post<{ id: string }>('/api/events', body),
  deleteEvent: (id: string) => del<{ ok: boolean }>(`/api/events/${id}`),
  icsUrl: () => get<{ url: string }>('/api/events/ics-url'),
  wiki: () => get<{ pages: WikiPage[] }>('/api/wiki'),
  extractWiki: (conversation_id: string) =>
    post<{ id: string; title: string }>('/api/wiki/extract', {
      conversation_id,
      public: false,
    }),
}

/** 探测静态图片是否存在（HEAD 请求） */
export async function probeImage(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}
