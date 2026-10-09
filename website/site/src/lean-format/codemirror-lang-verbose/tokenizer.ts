import { StringStream } from "@codemirror/language";

/**
 * Keyword vocabulary, sourced from Verbose Lean 4 (English) (https://github.com/PatrickMassot/verbose-lean4).
 *
 * Matching is a word-by-word (longest possible) lookup, trying to mirror the approach of codemirror-lang-rocq.
 * Sometimes words have both casings (`By` and `by`), but only if they are potentially used both at a sentence start and mid-sentence.
 */

// Block delimiters (statement start, proof end).
const structureWords = new Set(["Example", "Exercise", "Lemma", "QED"]);

// Block headers. Tagged `param` only when followed by a colon (`Assume:`), so the bare `Assume` tactic still reads as a tactic.
const headerWords = new Set(["Given", "Assume", "Conclusion", "Proof"]);

const tacticWords = new Set([
  "and",
  "applied",
  "apply",
  "as",
  "Assume",
  "at",
  "becomes",
  "By",
  "by",
  "Calc",
  "choose",
  "Claim",
  "combine",
  "computation",
  "compute",
  "conclude",
  "contradicting",
  "contradiction",
  "contradictory",
  "contrapose",
  "contrapositive",
  "depending",
  "discuss",
  "everywhere",
  "Fact",
  "finally",
  "first",
  "Fix",
  "for",
  "forget",
  "from",
  "get",
  "help",
  "hence",
  "hypothesis",
  "induction",
  "it",
  "It",
  "it's",
  "Let's",
  "negation",
  "now",
  "observe",
  "obtain",
  "on",
  "or",
  "proceed",
  "prove",
  "push",
  "reformulate",
  "rename",
  "rewrite",
  "Set",
  "simply",
  "since",
  "Since",
  "such",
  "suffices",
  "that",
  "the",
  "to",
  "unfold",
  "using",
  "we",
  "We",
  "whether",
  "which",
  "works",
]);

export type Token =
  | "verbose"
  | "param"
  | "tactic"
  | "argument"
  | "string"
  | "comment"
  | "code"
  | "bracket";

export interface VerboseState {
  blockCommentDepth: number;
  // Whether we are inside a `--` line comment.
  lineComment: boolean;
}

function lookupWord(word: string): Token {
  if (structureWords.has(word)) return "verbose";
  if (tacticWords.has(word)) return "tactic";
  return "argument";
}

/**
 * Consume an inline `` `code` `` span.
 */
function tokenInlineCode(stream: StringStream): Token {
  stream.next(); // opening backtick
  while (!stream.eol()) {
    if (stream.next() === "`") break;
  }
  return "code";
}

/**
 * Consume a run of plain comment text, stopping before the next inline code
 * span (backtick) or, for block comments, at the nesting/terminating delimiter.
 */
function consumeCommentText(
  stream: StringStream,
  state: VerboseState,
  isBlock: boolean,
): Token {
  while (!stream.eol()) {
    if (stream.peek() === "`") break;
    if (isBlock) {
      if (stream.match("-/")) {
        state.blockCommentDepth--;
        if (state.blockCommentDepth === 0) break;
        continue;
      }
      if (stream.match("/-")) {
        state.blockCommentDepth++;
        continue;
      }
    }
    stream.next();
  }

  if (!isBlock && stream.eol()) state.lineComment = false;
  return "comment";
}

/**
 * Tokenize the body of an already-open comment into `comment` runs and inline
 * `code` spans.
 */
function tokenComment(
  stream: StringStream,
  state: VerboseState,
  isBlock: boolean,
): Token {
  if (stream.peek() === "`") {
    return tokenInlineCode(stream);
  }
  return consumeCommentText(stream, state, isBlock);
}

export function token(stream: StringStream, state: VerboseState): Token | null {
  // Line comments never span lines, so clear the flag at each line start.
  if (stream.sol()) state.lineComment = false;

  // Resume a comment.
  if (state.blockCommentDepth > 0) {
    return tokenComment(stream, state, true);
  }
  if (state.lineComment) {
    return tokenComment(stream, state, false);
  }

  if (stream.eatSpace()) return null;

  if (stream.match("--")) {
    state.lineComment = true;
    return consumeCommentText(stream, state, false);
  }
  if (stream.match("/-")) {
    state.blockCommentDepth = 1;
    return consumeCommentText(stream, state, true);
  }

  if (stream.peek() === '"') {
    stream.next();
    let escaped = false;
    let ch: string | void;
    while ((ch = stream.next()) != null) {
      if (ch === '"' && !escaped) break;
      escaped = !escaped && ch === "\\";
    }
    return "string";
  }

  if (stream.match(/^[()[\]{}]/)) return "bracket";

  const word = stream.match(/^[\w']+/);
  if (word) {
    const text = (word as RegExpMatchArray)[0];
    if (headerWords.has(text) && stream.peek() === ":") return "param";
    return lookupWord(text);
  }

  // Operators, math symbols and numbers all fall through as plain arguments.
  if (!stream.match(/^[^\s()[\]{}"\w]+/)) stream.next();
  return "argument";
}
