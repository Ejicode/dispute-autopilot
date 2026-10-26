import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Roboto'", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Arial", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        dashboard: {
          sidebar: "#FFFFFF",
          canvas: "#F4F6F8",
          card: "#FFFFFF",
          border: "#E2E8F0",
        },
        forest: {
          DEFAULT: "#0A3E29",
          50: "#F2F8F5",
          100: "#E2F0EA",
          200: "#C4E2D3",
          300: "#97CCB4",
          400: "#60B08E",
          500: "#37926F",
          600: "#247556",
          700: "#1A5C43",
          800: "#0A3E29",
          900: "#06291B",
          950: "#02170E",
        },
        mint: {
          DEFAULT: "#10B981",
          50: "#ECFDF5",
          100: "#D1FAE5",
          200: "#A7F3D0",
          300: "#6EE7B7",
          400: "#34D399",
          500: "#10B981",
          600: "#059669",
          700: "#047857",
        },
        sage: {
          DEFAULT: "#EBF5EF",
          50: "#F6FAF7",
          100: "#EBF5EF",
          200: "#D6ECE0",
          300: "#B9DEC9",
        },
        paypal: {
          blue: "#0070BA",
          darkblue: "#003087",
          sky: "#009CDE",
          gold: "#FFC439",
          golddim: "#E6A800",
          light: "#F5F7FA",
        },
        royal: {
          50: "#F0F8FF",
          100: "#E0F2FE",
          500: "#0070BA",
          600: "#0070BA",
          700: "#003087",
          800: "#00205B",
          900: "#001845",
        },
      },
      boxShadow: {
        card: "0 1px 3px 0 rgba(15, 23, 42, 0.05), 0 1px 2px -1px rgba(15, 23, 42, 0.05)",
        cardhover: "0 10px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.04)",
        forestpill: "0 4px 14px 0 rgba(10, 62, 41, 0.25)",
        mintpill: "0 4px 14px 0 rgba(16, 185, 129, 0.3)",
        paypalpill: "0 4px 14px 0 rgba(0, 112, 186, 0.35)",
        goldpill: "0 4px 14px 0 rgba(255, 196, 57, 0.35)",
      },
    },
  },
  plugins: [],
};
export default config;
