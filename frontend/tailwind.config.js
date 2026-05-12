/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        uta: {
          50:  "#FEF2F2",
          100: "#FEE2E2",
          300: "#FCA5A5",
          500: "#DC2626",
          700: "#991B1B",
          900: "#5C0A0A",
        },
        ok: {
          50:  "#D1FAE5",
          900: "#14532D",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
