import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ASAP brand
        brand: {
          50:  "#e6edf5",
          100: "#bfcfe3",
          200: "#94afcf",
          300: "#688fbb",
          400: "#3d6fa6",
          500: "#003f87",
          600: "#003875",
          700: "#002e60",
          800: "#00254c",
          900: "#001b38",
        },
        ink: {
          50:  "#f7f7f8",
          100: "#eeeef1",
          200: "#dcdce2",
          300: "#b8b8c2",
          400: "#8a8a99",
          500: "#5c5c6e",
          600: "#3f3f50",
          700: "#2a2a37",
          800: "#1a1a24",
          900: "#0e0e15",
        },
      },
      fontFamily: {
        sans: ["'IBM Plex Sans'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
