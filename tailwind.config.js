/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    // Ölçekler (#fc1659d8): köşe yarıçapı ve gölge üçer değer. Kodda yalnız kanonik adlar
    // kullanılır (rounded-md/lg/xl, rounded-full; shadow-sm/lg/2xl); eski adlar aynı üç
    // değere eşli ki gözden kaçan bir sınıf ölçeğin dışına çıkmasın. CSS tarafı index.css
    // `--radius-*` / `--shadow-*` değişkenleri.
    borderRadius: {
      none: '0',
      sm: '0.375rem', DEFAULT: '0.375rem', md: '0.375rem', // 6 px — çip, rozet, küçük denetim
      lg: '0.5rem',                                        // 8 px — düğme, alan, menü öğesi, satır
      xl: '0.75rem', '2xl': '0.75rem', '3xl': '0.75rem',   // 12 px — kart, açılır pencere, panel, pencere
      full: '9999px',
    },
    boxShadow: {
      none: 'none',
      // sm — duran yüzey (kart)
      sm: '0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.04)',
      DEFAULT: '0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.04)',
      card: '0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.04)',
      // lg — yükselen yüzey (üzerine gelme, açılır menü, bildirim)
      lg: '0 8px 24px -6px rgba(0,0,0,0.16), 0 3px 6px -3px rgba(0,0,0,0.08)',
      md: '0 8px 24px -6px rgba(0,0,0,0.16), 0 3px 6px -3px rgba(0,0,0,0.08)',
      'card-hover': '0 8px 24px -6px rgba(0,0,0,0.16), 0 3px 6px -3px rgba(0,0,0,0.08)',
      // 2xl — pencere (modal, iletişim kutusu, tam ekran katman)
      '2xl': '0 25px 60px -12px rgba(0,0,0,0.28)',
      xl: '0 25px 60px -12px rgba(0,0,0,0.28)',
      modal: '0 25px 60px -12px rgba(0,0,0,0.28)',
    },
    extend: {
      fontSize: {
        '2xs': '0.6875rem', // 11 px — yalnız rozet ve sayaç (#fc1659d8); en küçük metin text-xs (12 px)
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      colors: {
        // ── Semantic theme tokens — values live in src/index.css (:root / .dark) ──
        // Use these instead of "bg-white dark:bg-gray-900" pairs.
        app:         'rgb(var(--c-app) / <alpha-value>)',        // page background
        surface:     'rgb(var(--c-surface) / <alpha-value>)',    // cards, modals
        nav:         'rgb(var(--c-nav) / <alpha-value>)',        // the rail (darkest step)
        panel:       'rgb(var(--c-panel) / <alpha-value>)',      // level-2 sidebar panel
        field:       'rgb(var(--c-field) / <alpha-value>)',      // inputs
        raised:      'rgb(var(--c-raised) / <alpha-value>)',     // hover fills, subtle panels
        fg:          'rgb(var(--c-fg) / <alpha-value>)',         // primary text
        'fg-2':      'rgb(var(--c-fg-2) / <alpha-value>)',       // secondary text
        'fg-muted':  'rgb(var(--c-fg-muted) / <alpha-value>)',   // labels, meta
        'fg-faint':  'rgb(var(--c-fg-faint) / <alpha-value>)',   // placeholders, disabled
        line:        'rgb(var(--c-line) / <alpha-value>)',       // borders
        'line-soft': 'rgb(var(--c-line-soft) / <alpha-value>)',  // dividers
        danger:      'rgb(var(--c-danger) / <alpha-value>)',
        success:     'rgb(var(--c-success) / <alpha-value>)',
        warning:     'rgb(var(--c-warning) / <alpha-value>)',
        info:        'rgb(var(--c-info) / <alpha-value>)',
        // Brand scale (same in both themes). Every step the code names must be here: a class of a missing
        // step is not an error, it is silently no rule at all (400 and 800 were missing until 0.96.1 and
        // some ninety uses did nothing; src/lib/brandScale.test.ts keeps the two in step).
        primary: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
      },
      animation: {
        'fade-in':  'fadeIn 150ms ease-out',
        'fade-out': 'fadeOut 320ms ease-in forwards',
        'slide-up': 'slideUp 200ms ease-out',
        'slide-in-right': 'slideInRight 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-left': 'slideInLeft 220ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        fadeOut: { from: { opacity: '1', transform: 'scale(1)' }, to: { opacity: '0', transform: 'scale(0.97)' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideInRight: { from: { opacity: '0', transform: 'translateX(24px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        slideInLeft: { from: { opacity: '0', transform: 'translateX(-24px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
      },
    },
  },
  plugins: [],
}
