import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#071417",
        panel: "#10252a",
        cyan: "#42dce5",
        mint: "#8df3c8",
        amber: "#ffcf70",
      },
    },
  },
  plugins: [],
};

export default config;
