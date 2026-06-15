/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Hanken Grotesk"', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Fraunces"', 'Georgia', 'serif'],
      },
      colors: {
        // Papel / creme (fundo editorial)
        creme: { DEFAULT: '#F6F1E7', 50: '#FBF8F1', 100: '#F1E8D6' },
        papel: '#FFFFFF',
        // Tinta (texto)
        tinta: { DEFAULT: '#23271F', suave: '#6F6C5E' },
        linha: '#E7DECB',
        pedra: '#A8A293',
        // Verdes do agro
        mata: { DEFAULT: '#1C4E37', escuro: '#143A29', claro: '#DCE9DF' },
        folha: { DEFAULT: '#3C7D52', claro: '#E4EFE2' },
        // Acentos quentes
        trigo: { DEFAULT: '#C08A2D', claro: '#F6ECD0', escuro: '#876213' },
        terra: { DEFAULT: '#B25A33', claro: '#F5E2D5', escuro: '#8C4322' },
      },
      boxShadow: {
        carta:
          '0 1px 2px rgba(35,39,31,0.04), 0 8px 20px -14px rgba(35,39,31,0.30)',
        flutua: '0 18px 50px -16px rgba(20,58,41,0.32)',
      },
      borderRadius: { xl2: '1.1rem' },
      keyframes: {
        sobe: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: { sobe: 'sobe 0.4s cubic-bezier(0.22,1,0.36,1) both' },
    },
  },
  plugins: [],
};
