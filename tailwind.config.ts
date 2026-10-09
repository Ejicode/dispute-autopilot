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
        sans: ["'Plus Jakarta Sans'", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        dashboard: {
          sidebar: "#0B0F19",
          canvas: "#EDF2F7",
          card: "#FFFFFF",
          border: "#E2E8F0",
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
        paypalpill: "0 4px 14px 0 rgba(0, 112, 186, 0.35)",
        goldpill: "0 4px 14px 0 rgba(255, 196, 57, 0.35)",
      },
    },
  },
  plugins: [],
};
export default config;
