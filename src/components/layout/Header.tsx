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
  currentUserProfile,
  project,
  team,
}: Props) {
  const { signOut } = useAuth();
  const { isDark, toggle } = useTheme();
  const [showStatuses, setShowStatuses] = useState(false);

  return (
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-5 py-3 flex items-center justify-between flex-shrink-0">
      {/* Left */}
      <div className="flex items-center gap-4">
        {project ? (
          <div>
            <p className="text-xs text-gray-400 dark:text-gray-500">{team?.name}</p>
            <h1 className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-tight">
              {project.name}
            </h1>
          </div>
        ) : (
          <span className="text-sm text-gray-400 dark:text-gray-500">Proje seç</span>
        )}

        {project && (
          <>
            <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button
                onClick={() => onViewChange("board")}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                  view === "board"
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                Kanban
              </button>
              <button
                onClick={() => onViewChange("list")}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                  view === "list"
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                Liste
              </button>
            </div>

            <div className="relative">
              <button
                onClick={() => setShowStatuses(!showStatuses)}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1"
              >
                Durumlar ⚙
              </button>
              {showStatuses && (
                <div className="absolute left-0 top-10 z-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-4 w-64">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                      Durum Yönetimi
                    </p>
                    <button
                      onClick={() => setShowStatuses(false)}
                      className="text-gray-400 hover:text-gray-600 text-xs"
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
      <div className="flex items-center gap-3">
        {/* Dark mode toggle */}

        {project && (
          <button
            onClick={onNewTicket}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <span className="text-base leading-none">+</span> Yeni Ticket
          </button>
        )}
        <button
          onClick={toggle}
          title={isDark ? "Açık mod" : "Karanlık mod"}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-base"
        >
          {isDark ? "☀️" : "🌙"}
        </button>
        {currentUserProfile && (
          <div className="flex items-center gap-2">
            <UserAvatar
              user={currentUserProfile as Parameters<typeof UserAvatar>[0]["user"]}
              size="sm"
              showName
            />
            <button
              onClick={signOut}
              className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Çıkış
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
