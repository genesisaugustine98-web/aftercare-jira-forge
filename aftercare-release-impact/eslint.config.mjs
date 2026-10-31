import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    files: ["src/**/*.{js,jsx,mjs,cjs}"],

    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      }
    },

    plugins: {
      "react-hooks": reactHooks
    },

    rules: {
      "react-hooks/rules-of-hooks": "error"
    }
  }
];
