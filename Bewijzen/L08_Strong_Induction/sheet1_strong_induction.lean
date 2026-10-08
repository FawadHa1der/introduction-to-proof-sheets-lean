/-
  Sheet 3a: Strong induction — sequences and recursive definitions

  Focus: Strong induction principle (one and several base cases),
  recursively defined sequences, and coin sums.

  Source: Section 4.3 of *An Infinite Descent into Pure Mathematics*
-/

import WaterproofGenre
import Verbose.English.All
import Bewijzen.Customlib.Integers
import Bewijzen.Customlib.WeakInduction

open WaterproofGenre
open Verbose.NameLess
open Finset
open scoped Bewijzen.FinsetIntervalNotation

-- Bridge (goal): rewrite under a sum using the strong induction hypothesis,
-- c + ∑_{k≤n} b k = c + ∑_{k≤n} g k when b k = g k for all k ≤ n.  The
-- hypothesis carries the `k ≥ 0` side condition that the strong induction
-- announcement puts on the induction hypothesis, so the Calc step can cite the
-- induction hypothesis in exactly the form the student sees it.
lemma add_sum_eq_of_eq_below {c : ℕ} {b g : ℕ → ℕ} {n : ℕ} (h : ∀ k ≤ n, b k = g k) :
    c + ∑ k ∈ [0, n], b k = c + ∑ k ∈ [0, n], g k := by
  congr 1
  apply Finset.sum_congr rfl
  intro k hk
  exact h k (by simp at hk; omega)

addAnonymousGoalSplittingLemma add_sum_eq_of_eq_below

-- Bridge (compute): 1 + (2^(n+1) - 1) = 2^(n+1) in ℕ.
lemma one_add_two_pow_sub_one (m : ℕ) : 1 + (2 ^ (m + 1) - 1) = 2 ^ (m + 1) := by
  have : 1 ≤ 2 ^ (m + 1) := Nat.one_le_two_pow
  omega

addAnonymousComputeLemma one_add_two_pow_sub_one

-- Bridge (fact): from m ≥ 1, write m as p + 1.
lemma exists_pred_of_ge_one {m : ℕ} (h : m ≥ 1) : ∃ p, m = p + 1 := ⟨m - 1, by omega⟩

addAnonymousFactSplittingLemma exists_pred_of_ge_one

-- Bridge (fact): from m ≥ 5, write m as p + 5.
lemma exists_sub_five_of_ge_five {m : ℕ} (h : m ≥ 5) : ∃ p, m = p + 5 := ⟨m - 5, by omega⟩

addAnonymousFactSplittingLemma exists_sub_five_of_ge_five

-- Bridge (compute): the ℕ-subtraction arithmetic 3(2^(p+1)-1) - 2(2^p-1) = 2^(p+2)-1.
lemma three_two_recurrence_step (p : ℕ) :
    3 * (2 ^ (p + 1) - 1) - 2 * (2 ^ p - 1) = 2 ^ (p + 1 + 1) - 1 := by
  have h1 : 2 ^ (p + 1) = 2 * 2 ^ p := by ring
  have h2 : 2 ^ (p + 1 + 1) = 4 * 2 ^ p := by ring
  have h3 : 1 ≤ 2 ^ p := Nat.one_le_two_pow
  omega

addAnonymousComputeLemma three_two_recurrence_step

-- Bridge (compute): 5(3·2^(p+1) + 3^(p+1)) - 6(3·2^p + 3^p) = 3·2^(p+2) + 3^(p+2).
lemma five_six_recurrence_step (p : ℕ) :
    5 * (3 * 2 ^ (p + 1) + 3 ^ (p + 1)) - 6 * (3 * 2 ^ p + 3 ^ p)
      = 3 * 2 ^ (p + 1 + 1) + 3 ^ (p + 1 + 1) := by
  have h1 : 2 ^ (p + 1) = 2 * 2 ^ p := by ring
  have h2 : 3 ^ (p + 1) = 3 * 3 ^ p := by ring
  have h3 : 2 ^ (p + 1 + 1) = 4 * 2 ^ p := by ring
  have h4 : 3 ^ (p + 1 + 1) = 9 * 3 ^ p := by ring
  omega

addAnonymousComputeLemma five_six_recurrence_step

-- The next groups of compute lemmas back the book-granularity calculation
-- steps ("expanding" / "laws of indices" / "simplifying") of Example 4.2.2
-- and Exercise 4.2.17; each covers one line of the book's align-block under
-- ℕ-subtraction.

-- Bridge (compute): expanding, 3(2^(p+1) - 1) - 2(2^p - 1) = 3·2^(p+1) - 3 - 2·2^p + 2.
lemma three_two_expand (p : ℕ) :
    3 * (2 ^ (p + 1) - 1) - 2 * (2 ^ p - 1) = 3 * 2 ^ (p + 1) - 3 - 2 * 2 ^ p + 2 := by
  have h1 : 2 ^ (p + 1) = 2 * 2 ^ p := by ring
  have h2 : 1 ≤ 2 ^ p := Nat.one_le_two_pow
  omega

addAnonymousComputeLemma three_two_expand

-- Bridge (compute): laws of indices, 2·2^p = 2^(p+1).
lemma three_two_indices (p : ℕ) :
    3 * 2 ^ (p + 1) - 3 - 2 * 2 ^ p + 2 = 3 * 2 ^ (p + 1) - 3 - 2 ^ (p + 1) + 2 := by
  have h1 : 2 ^ (p + 1) = 2 * 2 ^ p := by ring
  omega

addAnonymousComputeLemma three_two_indices

-- Bridge (compute): simplifying, 3·2^(p+1) - 3 - 2^(p+1) + 2 = 2·2^(p+1) - 1.
lemma three_two_simplify (p : ℕ) :
    3 * 2 ^ (p + 1) - 3 - 2 ^ (p + 1) + 2 = 2 * 2 ^ (p + 1) - 1 := by
  have h : 1 ≤ 2 ^ (p + 1) := Nat.one_le_two_pow
  omega

addAnonymousComputeLemma three_two_simplify

-- Bridge (compute): laws of indices, 2·2^(p+1) - 1 = 2^(p+2) - 1.
lemma two_mul_two_pow_sub_one (p : ℕ) : 2 * 2 ^ (p + 1) - 1 = 2 ^ (p + 1 + 1) - 1 := by
  have h : 2 ^ (p + 1 + 1) = 2 * 2 ^ (p + 1) := by ring
  omega

addAnonymousComputeLemma two_mul_two_pow_sub_one

-- Bridge (compute): expanding, 5(3·2^(p+1) + 3^(p+1)) - 6(3·2^p + 3^p)
-- = 15·2^(p+1) + 5·3^(p+1) - 18·2^p - 6·3^p.
lemma five_six_expand (p : ℕ) :
    5 * (3 * 2 ^ (p + 1) + 3 ^ (p + 1)) - 6 * (3 * 2 ^ p + 3 ^ p)
      = 15 * 2 ^ (p + 1) + 5 * 3 ^ (p + 1) - 18 * 2 ^ p - 6 * 3 ^ p := by
  have h1 : 2 ^ (p + 1) = 2 * 2 ^ p := by ring
  have h2 : 3 ^ (p + 1) = 3 * 3 ^ p := by ring
  omega

addAnonymousComputeLemma five_six_expand

-- Bridge (compute): laws of indices, 18·2^p = 9·2^(p+1) and 6·3^p = 2·3^(p+1).
lemma five_six_indices (p : ℕ) :
    15 * 2 ^ (p + 1) + 5 * 3 ^ (p + 1) - 18 * 2 ^ p - 6 * 3 ^ p
      = 15 * 2 ^ (p + 1) + 5 * 3 ^ (p + 1) - 9 * 2 ^ (p + 1) - 2 * 3 ^ (p + 1) := by
  have h1 : 2 ^ (p + 1) = 2 * 2 ^ p := by ring
  have h2 : 3 ^ (p + 1) = 3 * 3 ^ p := by ring
  omega

addAnonymousComputeLemma five_six_indices

-- Bridge (compute): simplifying, 15a + 5b - 9a - 2b = 6a + 3b under ℕ-subtraction.
lemma five_six_simplify (p : ℕ) :
    15 * 2 ^ (p + 1) + 5 * 3 ^ (p + 1) - 9 * 2 ^ (p + 1) - 2 * 3 ^ (p + 1)
      = 6 * 2 ^ (p + 1) + 3 * 3 ^ (p + 1) := by
  omega

addAnonymousComputeLemma five_six_simplify

-- Bridge (compute): 2^(p+2) + 2^(p+1) + 2^p ≤ 2^(p+3) (since 7 ≤ 8),
-- stated in the index form produced by the induction hypothesis.
lemma tribonacci_pow_bound (p : ℕ) :
    2 ^ (p + 5 - 3) + 2 ^ (p + 4 - 3) + 2 ^ (p + 3 - 3) ≤ 2 ^ (p + 5 + 1 - 3) := by
  have e1 : p + 5 - 3 = p + 2 := by omega
  have e2 : p + 4 - 3 = p + 1 := by omega
  have e3 : p + 3 - 3 = p := by omega
  have e4 : p + 5 + 1 - 3 = p + 3 := by omega
  rw [e1, e2, e3, e4]
  have h1 : 2 ^ (p + 1) = 2 * 2 ^ p := by ring
  have h2 : 2 ^ (p + 2) = 4 * 2 ^ p := by ring
  have h3 : 2 ^ (p + 3) = 8 * 2 ^ p := by ring
  omega

addAnonymousComputeLemma tribonacci_pow_bound

-- Bridges for reaching back to an earlier value in a strong induction step:
-- they let the step work directly with `m - d`, the value the argument actually
-- looks back at, instead of first reindexing `m` as `p + c`.  The first two are
-- general in the offset `d` and the lower bound `l`, and supply the two side
-- conditions the strong induction hypothesis asks for; the third puts back the
-- coins that were taken off.

-- Bridge (goal): if m is at least l + d, then m - d is still at least l — the
-- lower-bound side condition of the induction hypothesis.
lemma sub_ge_of_ge_add {m d l : ℕ} (h : m ≥ l + d) : m - d ≥ l := by omega

addAnonymousGoalSplittingLemma sub_ge_of_ge_add

-- Bridge (goal): m - d is within reach of the induction hypothesis.  The
-- hypothesis is not needed for the proof, but keeps the citation reading like
-- its neighbours (see the .md notes).
lemma sub_le_self_of_ge {m d l : ℕ} (h : m ≥ l) : m - d ≤ m := by omega

addAnonymousGoalSplittingLemma sub_le_self_of_ge

-- Bridge (goal): a representation of m - 2, plus one more 3-coin, is a
-- representation of m + 1.  Unlike the two bridges above, this one cannot have
-- its offset and coin values generalised: Verbose discharges a goal-splitting
-- lemma's side goals only with the facts the student cited, so every argument
-- has to be pinned down by unification against the goal and those facts — a
-- leftover condition such as `u = 3` is never discharged.
lemma succ_eq_of_sub_two_eq {m a b : ℕ} (hm : m ≥ 10) (h : m - 2 = 3 * a + 5 * b) :
    m + 1 = 3 * (a + 1) + 5 * b := by omega

-- Registered statement of the result of Exercise 4.2.5, citable later
-- (also used by the strong induction sheet).
lemma sum_pow_two (n : ℕ) : ∑ k ∈ [0, n], 2 ^ k = 2 ^ (n + 1) - 1 := by
  induction n with
  | zero => decide
  | succ n ih => rw [sum_icc_succ_top 0 n (fun k => 2 ^ k) (by omega), ih, two_pow_sub_one_step]

addAnonymousFactSplittingLemma sum_pow_two

addAnonymousGoalSplittingLemma succ_eq_of_sub_two_eq

#doc (WaterproofGenre) "Strong induction — sequences, recursive definitions, and coin sums" =>

You can start a proof by strong induction using `Let's proceed by strong induction on n`, which
creates the base case and the induction step. In the induction step you write `Fix n`, then
`Assume ∀ k ≤ n, [statement for k]` to assume the induction hypothesis for all `k` up to `n` and
prove the statement for `n + 1`.

In the following example `b : ℕ → ℕ` denotes a function from naturals to naturals, that is,
a sequence. `b n` denotes the `n`-th element of the sequence.

```lean
Example "4.3.4"
  Given: (b : ℕ → ℕ)
  Assume: (_ : b 0 = 1) (_ : ∀ (n : ℕ), b (n + 1) = 1 + ∑ k ∈ [0, n], b k)
  Conclusion: ∀ n : ℕ, b n = 2 ^ n
Proof:
  Let's proceed by strong induction on n
  · Calc
      b 0 = 1 by hypothesis
      _ = 2 ^ 0 by computation
  · Fix n
    Assume that ∀ k ≤ n, b k = 2 ^ k
    Calc
      b (n + 1)
        = 1 + ∑ k ∈ [0, n], b k since ∀ m : ℕ, b (m + 1) = 1 + ∑ k ∈ [0, m], b k
      _ = 1 + ∑ k ∈ [0, n], 2 ^ k since ∀ k ≤ n, b k = 2 ^ k
      _ = 1 + (2 ^ (n + 1) - 1) since ∑ k ∈ [0, n], 2 ^ k = 2 ^ (n + 1) - 1
      _ = 2 ^ (n + 1) by computation
QED
```

When several base cases are needed, list their values after `with base cases`. For example:

`Let's proceed by strong induction on m, with base cases 0 and 1`

This creates the goals for `n = 0` and `n = 1` and a step goal that starts at
`n ≥ 1`, so the step only has to work from the first value where the
recurrence applies. The same announcement works on a goal `∀ n ≥ 3, ...` with
`with base cases 3, 4 and 5`.

::::multilean
```lean
Exercise "4.3.10"
  Given:
  Assume:
  Conclusion: ∀ n ≥ 8, ∃ a b : ℕ, n = 3 * a + 5 * b
Proof:
```
:::input
```lean

```
:::
```lean
QED
```
::::
