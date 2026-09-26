import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          blue: "#2563EB",
          blueSoft: "#EFF4FF",
          navy: "#0D1321",
          textSecondary: "#5B6477",
          background: "#F8FAFC",
          card: "#FFFFFF",
          border: "#E8EDF5",
          success: "#22C55E",
          error: "#EF4444",
        },
      },
    },
  },
  plugins: [],
};
export default config;
