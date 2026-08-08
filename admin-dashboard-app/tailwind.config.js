/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: '#00d4ff',
        background: '#030305',
        card: '#0d0d12',
      }
    },
  },
  plugins: [],
}
