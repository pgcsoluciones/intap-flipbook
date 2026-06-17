/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#4F46E5",
        accent: "#06B6D4",
        success: "#10B981",
        warning: "#F59E0B",
        dark: "#0F172A",
        surface: "#F8FAFC",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
      },
      boxShadow: {
        glow: "0 20px 60px rgba(79, 70, 229, 0.20)",
        lift: "0 18px 40px rgba(15, 23, 42, 0.10)",
      },
      backgroundImage: {
        "hero-grid":
          "radial-gradient(circle at top left, rgba(79, 70, 229, 0.18), transparent 26%), radial-gradient(circle at 85% 15%, rgba(6, 182, 212, 0.18), transparent 22%)",
      },
      animation: {
        float: "float 7s ease-in-out infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-14px)" },
        },
      },
    },
  },
  plugins: [],
};
