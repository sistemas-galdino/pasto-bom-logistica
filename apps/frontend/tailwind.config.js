/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Manrope em tudo, como no Cadastro. `display` continua existindo para
        // os números e títulos, que ganham peso extra em vez de outra fonte.
        sans: ['Manrope', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Manrope', 'system-ui', '-apple-system', 'sans-serif'],
      },
      // Paleta do Cadastro (guia de cores de 30/10/2026), aplicada a web e app.
      // Os nomes dos tokens não mudaram — só os valores —, então nenhum
      // componente precisou ser tocado.
      // Os tokens carregam SEMÂNTICA de status (ver components/status.ts):
      //   folha=agendada · trigo=em rota · mata=entregue · terra=cancelada.
      // Por isso cada um precisa continuar distinguível dos outros: mata é o
      // verde ESCURO do guia (e não o principal) para se separar da folha.
      colors: {
        // Fundos neutros levemente esverdeados
        creme: { DEFAULT: '#F8F9FA', 50: '#FBFCFA', 100: '#F1F5EF' },
        papel: '#FFFFFF',
        // Tinta (texto)
        tinta: { DEFAULT: '#191C1D', suave: '#6C757D' },
        linha: '#E3E8DF',
        pedra: '#A3ACA0',
        // Verdes da marca (mata = verde escuro; folha = verde médio)
        mata: { DEFAULT: '#1C4416', escuro: '#0F2E1E', claro: '#D6EDD3' },
        folha: { DEFAULT: '#3A7D2E', claro: '#D8F3DC' },
        // Limão do logo — acento (ocupação de carga, rotas por cidade). Fica
        // fora do guia de propósito: é a única cor que não colide com nenhum
        // status (ver ChipRotaCidade).
        limao: { DEFAULT: '#BDCB3B', claro: '#F0F3D8', escuro: '#7C8720' },
        // Amarelo sol
        trigo: { DEFAULT: '#E8B800', claro: '#FBF3D6', escuro: '#9A7A00' },
        // Cancelada: o cinza de "bloqueado" do guia
        terra: { DEFAULT: '#6C757D', claro: '#EDEDED', escuro: '#5A5A5A' },
        // Alerta: entrega NÃO REALIZADA. Único vermelho da paleta.
        brasa: { DEFAULT: '#BA1A1A', claro: '#F7E3E1', escuro: '#9A3B32' },
      },
      boxShadow: {
        carta: '0 4px 20px rgba(45,106,39,0.08)',
        flutua: '0 18px 50px -16px rgba(28,68,22,0.32)',
      },
      borderRadius: { xl2: '1rem' },
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
