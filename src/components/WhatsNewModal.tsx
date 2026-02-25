const features = [
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
      </svg>
    ),
    color: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400',
    title: 'Karanlık Mod',
    desc: 'Sağ üstteki ikondan açık/koyu tema arasında geçiş yapabilirsin.',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
    color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400',
    title: 'Açıklamaya Ekran Görüntüsü Yapıştır',
    desc: 'Ticket açıklamasına Ctrl+V ile ekran görüntüsü yapıştırabilirsin. Görsel anında önizlenir, tıklayınca tam ekran açılır.',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
    color: 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400',
    title: 'Alt Görevler (Subtasks)',
    desc: 'Her ticket altında alt görevler oluşturabilir, tamamlandıkça işaretleyebilirsin.',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
    color: 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400',
    title: 'Ekstra Deadline Tarihleri',
    desc: 'Bir ticket\'a birden fazla son tarih ekleyebilir, her birine açıklama yazabilirsin.',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    color: 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/40 dark:text-yellow-400',
    title: 'Hızlı Ticket Oluşturma',
    desc: 'Yeni ticket oluştururken artık tüm detayları anında düzenleyebileceğin tam ekran açılıyor.',
  },
]

interface Props {
  onClose: () => void
}

export function WhatsNewModal({ onClose }: Props) {
  const handleClose = () => {
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="inline-block text-xs font-semibold tracking-widest uppercase text-blue-600 dark:text-blue-400 mb-1">
                Yenilikler
              </span>
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Fira'ya neler geldi?
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Bu sürümde eklenen özellikler
              </p>
            </div>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none flex-shrink-0 mt-1"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Feature list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {features.map((f, i) => (
            <div
              key={i}
              className="flex gap-4 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${f.color}`}>
                {f.icon}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{f.title}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={handleClose}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm py-2.5 rounded-xl transition-colors"
          >
            Anladım, başlayalım
          </button>
        </div>
      </div>
    </div>
  )
}

