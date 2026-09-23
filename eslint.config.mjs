import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.ts"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    rules: {
      "no-undef": "off",
      "prefer-const": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "separate-type-imports",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "variable",
          format: ["snake_case"],
          leadingUnderscore: "allow",
        },
        {
          selector: ["parameter", "function", "method", "classProperty", "typeProperty"],
          format: ["snake_case"],
          leadingUnderscore: "allow",
        },
        {
          selector: "typeLike",
          format: ["PascalCase"],
        },
      ],
    },
  },
);
