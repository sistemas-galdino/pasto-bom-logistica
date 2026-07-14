/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Hanken Grotesk"', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Fraunces"', 'Georgia', 'serif'],
      },
      // Paleta da marca Rede do Campo / Pasto Bom, amostrada do logo oficial:
      //   verde da faixa #1B6D2D · verde vivo #119A36 · limão #BDCB3B
      //   sol #F2D216 · madeira #523B22
      // Os tokens carregam SEMÂNTICA de status (ver components/status.ts):
      //   folha=agendada · trigo=em rota · mata=entregue · terra=cancelada.
      // Por isso cada um precisa continuar distinguível dos outros.
      colors: {
        // Papel / creme (fundo editorial)
        creme: { DEFAULT: '#F6F1E7', 50: '#FBF8F1', 100: '#F1E8D6' },
        papel: '#FFFFFF',
        // Tinta (texto)
        tinta: { DEFAULT: '#23271F', suave: '#6F6C5E' },
        linha: '#E7DECB',
        pedra: '#A8A293',
        // Verdes da marca (mata = verde da faixa "PASTO BOM"; folha = verde vivo)
        mata: { DEFAULT: '#176D2E', escuro: '#0F5222', claro: '#DCEBDD' },
        folha: { DEFAULT: '#199A3C', claro: '#E2F2E4' },
        // Limão da folha clara do logo — acento (ocupação de carga, destaques)
        limao: { DEFAULT: '#BDCB3B', claro: '#F0F3D8', escuro: '#7C8720' },
        // Sol do logo, rebaixado ao ponto de contraste legível
        trigo: { DEFAULT: '#D9AE07', claro: '#FBF1C9', escuro: '#7A5E00' },
        // Madeira do "Rede do Campo"
        terra: { DEFAULT: '#8C5A2B', claro: '#EFE4D7', escuro: '#523B22' },
        // Alerta: entrega NÃO REALIZADA. Único vermelho da paleta — precisa se
        // separar do trigo (amarelo, "em rota") e do terra (marrom, "cancelada"),
        // que são os vizinhos quentes.
        brasa: { DEFAULT: '#B3261E', claro: '#FBE4E2', escuro: '#7A1912' },
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
