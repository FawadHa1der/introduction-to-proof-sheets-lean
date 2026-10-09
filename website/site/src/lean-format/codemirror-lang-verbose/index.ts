import {
  HighlightStyle,
  LanguageSupport,
  StreamLanguage,
} from "@codemirror/language";
import { Tag } from "@lezer/highlight";
import { token, VerboseState } from "./tokenizer";

const tags = {
  verbose: Tag.define(),
  tactic: Tag.define(),
  argument: Tag.define(),
  param: Tag.define(),
  string: Tag.define(),
  comment: Tag.define(),
  code: Tag.define(),
  bracket: Tag.define(),
};

export const highlight_dark = HighlightStyle.define([
  { tag: tags.verbose, color: "#912828" },
  { tag: tags.tactic, color: "#56b3ffff" },
  { tag: tags.param, color: "#0077ee" },
  { tag: tags.string, color: "#00aa00" },
  { tag: tags.comment, color: "#9ea0b1ff" },
  { tag: tags.code, color: "#3badf5" },
  { tag: tags.bracket, color: "#ff0000" },
]);

export const highlight_light = HighlightStyle.define([
  { tag: tags.verbose, color: "#eb0808ff" },
  { tag: tags.tactic, color: "#004cf0ff" },
  { tag: tags.param, color: "#0077aa" },
  { tag: tags.string, color: "#00aa00" },
  { tag: tags.comment, color: "#787c99" },
  { tag: tags.code, color: "#1c7fc4" },
  { tag: tags.bracket, color: "#ff0000" },
]);

export const leanVerboseLanguage = StreamLanguage.define<VerboseState>({
  name: "leanVerbose",
  startState() {
    return { blockCommentDepth: 0, lineComment: false };
  },
  token,
  tokenTable: {
    verbose: tags.verbose,
    param: tags.param,
    tactic: tags.tactic,
    argument: tags.argument,
    string: tags.string,
    comment: tags.comment,
    code: tags.code,
    bracket: tags.bracket,
  },
  languageData: {
    closeBrackets: { brackets: ["(", "[", "{", "'", '"', "`"] },
    commentTokens: { block: { open: "/- ", close: " -/" }, line: "--" },
  },
});

export function verbose() {
  return new LanguageSupport(leanVerboseLanguage);
}
