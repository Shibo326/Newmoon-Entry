/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx}', './public/index.html'],
  theme: {
    extend: {
      colors: {
        night: {
          bg: '#0A0B0F',
          card: '#13141A',
          accent: '#8B5CF6',
          text: '#F8FAFC',
          muted: '#94A3B8',
        },
      },
      boxShadow: {
        glow: '0 0 20px rgba(139, 92, 246, 0.3)',
        'glow-lg': '0 0 40px rgba(139, 92, 246, 0.4)',
      },
    },
  },
  plugins: [],
};
