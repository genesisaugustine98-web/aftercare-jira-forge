import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    files: ["src/**/*.{js,jsx,mjs,cjs}", "test/**/*.mjs"],

    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        URL: "readonly"
      }
    },

    plugins: {
      "react-hooks": reactHooks
    },

    rules: {
      "no-undef": "error",
      "no-unreachable": "error",
      "no-constant-condition": "error",
      "no-duplicate-imports": "error",
      "react-hooks/rules-of-hooks": "error"
    }
  },
  {
    files: ["src/**/*.mjs", "test/**/*.mjs"],
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }]
    }
  }
];
