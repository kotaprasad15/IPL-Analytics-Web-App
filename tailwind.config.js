/**
 * Reference Tailwind theme for IPL Analytics (site currently uses plain CSS + variables in styles.css).
 * Run: npx tailwindcss -i ./src/input.css -o ./dist/tailwind.css --watch
 * Or merge these tokens into your build when adopting Tailwind.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.html", "./*.js"],
  theme: {
    extend: {
      colors: {
        brand: {
          blue: "#0b3d91",
          "blue-hover": "#1e5ed6",
          "blue-dark": "#082c6c",
        },
        accent: {
          cyan: "#00c2ff",
          gold: "#f5c542",
        },
        surface: {
          page: "#f7faff",
          gradient: "#e8f0ff",
          anim1: "#e8f0ff",
          anim2: "#dbeafe",
          anim3: "#f0f7ff",
        },
        text: {
          primary: "#1a1a1a",
          secondary: "#555555",
          muted: "#888888",
        },
        team: {
          rcb: { primary: "#d32f2f", secondary: "#000000" },
          mi: { primary: "#004ba0", secondary: "#d1ab3e" },
          csk: { primary: "#fbc02d", secondary: "#1a237e" },
          kkr: { primary: "#4a148c", secondary: "#d4af37" },
          dc: { primary: "#17479e", secondary: "#e53935" },
          srh: { primary: "#ff6f00", secondary: "#000000" },
          rr: { primary: "#ff4081", secondary: "#1a237e" },
          pbks: { primary: "#d32f2f", secondary: "#b71c1c" },
          gt: { primary: "#0d1b2a", secondary: "#00bcd4" },
          lsg: { primary: "#00acc1", secondary: "#ffb300" },
        },
      },
      boxShadow: {
        card: "0 8px 32px rgba(11, 61, 145, 0.08)",
        "card-hover": "0 12px 40px rgba(11, 61, 145, 0.2)",
        "btn-glow": "0 12px 36px rgba(11, 61, 145, 0.4)",
      },
      backdropBlur: {
        glass: "10px",
      },
      transitionDuration: {
        theme: "380ms",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};
