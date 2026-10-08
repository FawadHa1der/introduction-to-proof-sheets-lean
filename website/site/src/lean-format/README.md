# Lean file format (vendored from waterproof-vscode)

These files are copied verbatim from impermeable/waterproof-vscode at commit
01f9105257d824a53257c27d52fdaae6b903db32 (the fork in website/forks/waterproof-vscode):

- `editor/src/leanFileConfiguration.ts`, `leanSerializer.ts`, `versoMarkdownSupport.ts`
- `editor/src/document-construction/{construct-document,lean,inner-blocks,block-extraction}.ts`
- `completions/tacticsLean.json`
- `completions/symbols+lean.json` as `symbols-lean.json`, generated in the fork by
  `node scripts/generate-symbols.mts` with @leanprover/unicode-input 0.1.9 (the version the
  extension locks).

They are LGPL-2.1-only, as waterproof-vscode is (see its LICENSE). They are what the
Waterproof VS Code extension uses to turn a Verso proof sheet into editor blocks and back; the
website reuses them so that a sheet looks and edits exactly as it does in the extension.
