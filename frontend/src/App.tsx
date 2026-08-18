import { lazy, Suspense } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { Layout } from './components/Layout'
import { HomePage } from './pages/Home'
import { LoginPage } from './pages/Login'

const ParlorPage = lazy(() => import('./pages/Parlor').then((m) => ({ default: m.ParlorPage })))
const ChatPage = lazy(() => import('./pages/Chat').then((m) => ({ default: m.ChatPage })))
const BoardPage = lazy(() => import('./pages/Board').then((m) => ({ default: m.BoardPage })))
const MailboxPage = lazy(() => import('./pages/Mailbox').then((m) => ({ default: m.MailboxPage })))
const ArchivePage = lazy(() => import('./pages/Archive').then((m) => ({ default: m.ArchivePage })))
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })))
const RoomPage = lazy(() => import('./pages/Room').then((m) => ({ default: m.RoomPage })))
const ArticleViewPage = lazy(() => import('./pages/ArticleView').then((m) => ({ default: m.ArticleViewPage })))
const WriterPage = lazy(() => import('./pages/Writer').then((m) => ({ default: m.WriterPage })))
const BedroomPage = lazy(() => import('./pages/Bedroom').then((m) => ({ default: m.BedroomPage })))

function PageLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-ink-soft">
      <div className="w-8 h-8 rounded-full border-2 border-crina/30 border-t-crina animate-spin" />
      <p className="mt-4 text-sm">搬椅子上楼中…</p>
    </div>
  )
}

/** /@handle 房间页：React Router 不支持段内「前缀+动态参数」，在 * 兜底里自己解析 */
function StarRoute() {
  const { pathname } = useLocation()
  if (/^\/@[A-Za-z0-9-]{1,32}\/?$/.test(pathname)) {
    return (
      <Suspense fallback={<PageLoading />}>
        <RoomPage />
      </Suspense>
    )
  }
  return <HomePage />
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="login" element={<LoginPage />} />
        <Route
          path="parlor"
          element={
            <Suspense fallback={<PageLoading />}>
              <ParlorPage />
            </Suspense>
          }
        />
        <Route
          path="chat"
          element={
            <Suspense fallback={<PageLoading />}>
              <ChatPage />
            </Suspense>
          }
        />
        <Route
          path="chat/:convId"
          element={
            <Suspense fallback={<PageLoading />}>
              <ChatPage />
            </Suspense>
          }
        />
        <Route
          path="board"
          element={
            <Suspense fallback={<PageLoading />}>
              <BoardPage />
            </Suspense>
          }
        />
        <Route
          path="mailbox"
          element={
            <Suspense fallback={<PageLoading />}>
              <MailboxPage />
            </Suspense>
          }
        />
        <Route
          path="archive"
          element={
            <Suspense fallback={<PageLoading />}>
              <ArchivePage />
            </Suspense>
          }
        />
        <Route
          path="settings"
          element={
            <Suspense fallback={<PageLoading />}>
              <SettingsPage />
            </Suspense>
          }
        />
        <Route
          path="p/:id"
          element={
            <Suspense fallback={<PageLoading />}>
              <ArticleViewPage />
            </Suspense>
          }
        />
        <Route
          path="write"
          element={
            <Suspense fallback={<PageLoading />}>
              <WriterPage />
            </Suspense>
          }
        />
        <Route
          path="write/:id"
          element={
            <Suspense fallback={<PageLoading />}>
              <WriterPage />
            </Suspense>
          }
        />
        <Route
          path="bedroom"
          element={
            <Suspense fallback={<PageLoading />}>
              <BedroomPage />
            </Suspense>
          }
        />
        <Route path="*" element={<StarRoute />} />
      </Route>
    </Routes>
  )
}
