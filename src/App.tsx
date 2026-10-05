import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Suspense, lazy, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { BoardPage } from './pages/BoardPage'
import { InvitePage } from './pages/InvitePage'
import { UpdateWatcher } from './components/layout/UpdateWatcher'
import { NavTracker } from './components/layout/NavTracker'
import { useWindowControlsOverlay } from './hooks/useWindowControls'
import { ErrorBoundary } from './components/layout/ErrorBoundary'

// Telefondaki gelen kutusu sayfası ana paketten ayrı (#74d303e2): etkinlik farkı editörü ve markdown okuyucuyu çekiyor.
const InboxPage = lazy(() => import('./pages/InboxPage').then((m) => ({ default: m.InboxPage })))

export default function App() {
  // Yüklü pencerede başlık çubuğunu uygulama çiziyor (#0DD02686); kanca
  // yalnız `<html data-wco>` bayrağını güncel tutar, ölçüler CSS'te.
  useWindowControlsOverlay()
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <NavTracker />
        <RoutedBoundary>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <BoardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/ticket/:ticketId"
            element={
              <ProtectedRoute>
                <BoardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/me/:meView"
            element={
              <ProtectedRoute>
                <BoardPage />
              </ProtectedRoute>
            }
          />
          {/* Bir listenin paylaşılabilir adresi (#d46f6d70): açan kişide o liste
              seçili gelir, sonra adres `/`'a düşer — seçim tercihte tutuluyor. */}
          <Route
            path="/list/:listId"
            element={
              <ProtectedRoute>
                <BoardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/page/:pageId"
            element={
              <ProtectedRoute>
                <BoardPage />
              </ProtectedRoute>
            }
          />
          {/* Yönetim artık kabuğun içinde bir ekran (#7AB2D9F6): şerit + panel + ana görünüm. */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <BoardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/:adminTab"
            element={
              <ProtectedRoute>
                <BoardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/inbox"
            element={
              <ProtectedRoute>
                <Suspense fallback={null}><InboxPage /></Suspense>
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </RoutedBoundary>
      </BrowserRouter>
      <UpdateWatcher />
    </QueryClientProvider>
  )
}

/** Resets the boundary on navigation: a crash in one screen must not trap the user. */
function RoutedBoundary({ children }: { children: ReactNode }) {
  const location = useLocation()
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>
}
