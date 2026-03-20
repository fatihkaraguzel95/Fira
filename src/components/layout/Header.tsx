import { useAuth } from "../../hooks/useAuth";
import { useTheme } from "../../hooks/useTheme";
import type { ViewMode, Project, Team } from "../../types";
import { UserAvatar } from "../ticket/UserAvatar";
import { StatusManager } from "../board/StatusManager";
import { useState } from "react";

interface Props {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  onNewTicket: () => void;
  onShowWhatsNew: () => void;
  onOpenProfile: () => void;
  onMenuToggle: () => void;
  currentUserProfile: {
    id: string;
    email: string;
    full_name: string | null;
    avatar_url: string | null;
  } | null;
  project: Project | null;
  team: Team | null;
}

export function Header({
  view,
  onViewChange,
  onNewTicket,
  onShowWhatsNew,
  onOpenProfile,
  onMenuToggle,
  currentUserProfile,
  project,
  team,
}: Props) {
  const { signOut } = useAuth();
  const { isDark, toggle } = useTheme();
  const [showStatuses, setShowStatuses] = useState(false);

  return (
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-3 md:px-5 py-2 md:py-3 flex items-center justify-between flex-shrink-0 gap-2">
      {/* Left */}
      <div className="flex items-center gap-2 md:gap-4 min-w-0">
        {/* Hamburger — mobile only */}
        <button
          onClick={onMenuToggle}
          className="md:hidden w-11 h-11 flex items-center justify-center rounded-xl text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 active:bg-gray-200 dark:active:bg-gray-700 transition-colors flex-shrink-0"
          aria-label="Menüyü aç"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {project ? (
          <div className="min-w-0">
            <p className="text-xs text-gray-400 dark:text-gray-500 truncate hidden sm:block">{team?.name}</p>
            <h1 className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-tight truncate max-w-[110px] sm:max-w-[180px] md:max-w-none">
              {project.name}
            </h1>
          </div>
        ) : (
          <span className="text-sm text-gray-400 dark:text-gray-500 hidden md:block">Proje seç</span>
        )}

        {project && (
          <>
            <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button
                onClick={() => onViewChange("board")}
                className={`px-3 md:px-4 py-2 text-sm font-medium transition-colors min-h-[36px] ${
                  view === "board"
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                Kanban
              </button>
              <button
                onClick={() => onViewChange("list")}
                className={`px-3 md:px-4 py-2 text-sm font-medium transition-colors min-h-[36px] ${
                  view === "list"
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                Liste
              </button>
            </div>

            <div className="relative hidden md:block">
              <button
                onClick={() => setShowStatuses(!showStatuses)}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
                </svg>
                Durumlar
              </button>
              {showStatuses && (
                <div className="absolute left-0 top-10 z-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-4 w-64">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                      Durum Yönetimi
                    </p>
                    <button
                      onClick={() => setShowStatuses(false)}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs"
                    >
                      ✕
                    </button>
                  </div>
                  <StatusManager projectId={project.id} />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
        {project && (
          <button
            onClick={onNewTicket}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-3 md:px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 active:bg-blue-800 transition-colors min-h-[44px] md:min-h-0 shadow-sm"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">Yeni Ticket</span>
          </button>
        )}

        {/* What's New — desktop only */}
        <button
          onClick={onShowWhatsNew}
          title="Yenilikler"
          className="hidden md:flex w-9 h-9 items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
          </svg>
        </button>

        {/* Dark mode toggle — desktop only */}
        <button
          onClick={toggle}
          title={isDark ? "Açık mod" : "Karanlık mod"}
          className="hidden md:flex w-9 h-9 items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          {isDark ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 110 8 4 4 0 010-8z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </button>

        {currentUserProfile && (
          <div className="flex items-center gap-1">
            <button
              onClick={onOpenProfile}
              className="flex items-center gap-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 px-1.5 py-1 transition-colors min-h-[44px] md:min-h-0"
            >
              <UserAvatar
                user={currentUserProfile as Parameters<typeof UserAvatar>[0]["user"]}
                size="sm"
                showName
              />
            </button>
            <button
              onClick={signOut}
              className="hidden md:block text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Çıkış
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
