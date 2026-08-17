import { Route, Routes } from 'react-router'
import { Layout } from './components/Layout'
import { HomePage } from './pages/Home'
import { ParlorPage } from './pages/Parlor'
import { ChatPage } from './pages/Chat'
import { BoardPage } from './pages/Board'
import { MailboxPage } from './pages/Mailbox'
import { ArchivePage } from './pages/Archive'
import { SettingsPage } from './pages/Settings'
import { LoginPage } from './pages/Login'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="parlor" element={<ParlorPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="chat/:convId" element={<ChatPage />} />
        <Route path="board" element={<BoardPage />} />
        <Route path="mailbox" element={<MailboxPage />} />
        <Route path="archive" element={<ArchivePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="*" element={<HomePage />} />
      </Route>
    </Routes>
  )
}
