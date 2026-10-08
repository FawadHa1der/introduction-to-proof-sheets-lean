/-
  The preamble of L07 (sheet 1, weak induction), as a library module.

  L08 (strong induction) uses L07's bridge lemmas and its Verbose
  registrations. It used to import the L07 sheet itself, but a sheet
  with empty exercise holes never compiles, so that import cannot be
  served. This module is a verbatim copy of L07's preamble: everything
  from its first `import` up to its `#doc` line. The website build
  checks that the copy is identical (website/scripts/check-preambles.py);
  edit L07 and copy the preamble here again.
-/

import WaterproofGenre
import Verbose.English.All
import Bewijzen.Customlib.Integers
import Bewijzen.Customlib.Reals

open WaterproofGenre
open Verbose.NameLess
open Finset
open scoped Bewijzen.FinsetIntervalNotation

-- Re-register compute lemmas from Integers for the #doc block context.
addAnonymousComputeLemma sum_icc_zero_succ_id
addAnonymousComputeLemma sum_icc_zero_succ_cubed
addAnonymousComputeLemma sum_icc_zero_succ_pow_two
addAnonymousComputeLemma sum_icc_zero_succ_poly

-- Bridge (compute): the ℕ-division step in Gauss' formula,
-- n(n+1)/2 + (n+1) = (n+1)(n+2)/2. On paper this is plain algebra;
-- in ℕ it needs the fact that n(n+1) is even.
lemma gauss_div_step (m : ℕ) : m * (m + 1) / 2 + (m + 1) = (m + 1) * (m + 1 + 1) / 2 := by
  have h1 : (m + 1) * (m + 1 + 1) = m * (m + 1) + 2 * (m + 1) := by ring
  have h2 : 2 ∣ m * (m + 1) := (Nat.even_mul_succ_self m).two_dvd
  omega

addAnonymousComputeLemma gauss_div_step

-- Bridge (compute): expanding (n+1)³ - (n+1) in ℕ. On paper this is
-- plain algebra; in ℕ the truncated subtraction needs n ≤ n³.
lemma cube_sub_succ (m : ℕ) : (m + 1) ^ 3 - (m + 1) = m ^ 3 - m + 3 * (m ^ 2 + m) := by
  have h1 : (m + 1) ^ 3 = m ^ 3 + 3 * m ^ 2 + 3 * m + 1 := by ring
  have h2 : m ≤ m ^ 3 := Nat.le_self_pow (by norm_num) m
  omega

addAnonymousComputeLemma cube_sub_succ

-- Bridge (compute): the book's "expand brackets" step,
-- (n+1)³ - (n+1) = (n³ + 3n² + 3n + 1) - n - 1, under ℕ-subtraction.
lemma cube_sub_expand (m : ℕ) :
    (m + 1) ^ 3 - (m + 1) = m ^ 3 + 3 * m ^ 2 + 3 * m + 1 - m - 1 := by
  have h1 : (m + 1) ^ 3 = m ^ 3 + 3 * m ^ 2 + 3 * m + 1 := by ring
  omega

addAnonymousComputeLemma cube_sub_expand

-- Bridge (compute): the book's "rearrange terms" step,
-- (n³ + 3n² + 3n + 1) - n - 1 = n³ - n + 3n² + 3n + 1 - 1,
-- under ℕ-subtraction.
lemma cube_sub_rearrange (m : ℕ) :
    m ^ 3 + 3 * m ^ 2 + 3 * m + 1 - m - 1 = m ^ 3 - m + 3 * m ^ 2 + 3 * m + 1 - 1 := by
  have h2 : m ≤ m ^ 3 := Nat.le_self_pow (by norm_num) m
  omega

addAnonymousComputeLemma cube_sub_rearrange

-- Bridge (compute): the book's "since 1 - 1 = 0" step,
-- n³ - n + 3n² + 3n + 1 - 1 = n³ - n + 3n² + 3n, under ℕ-subtraction.
lemma cube_sub_cancel (m : ℕ) :
    m ^ 3 - m + 3 * m ^ 2 + 3 * m + 1 - 1 = m ^ 3 - m + 3 * m ^ 2 + 3 * m := by
  have h2 : m ≤ m ^ 3 := Nat.le_self_pow (by norm_num) m
  omega

addAnonymousComputeLemma cube_sub_cancel

-- Bridge (fact): 3 ≤ 2 ^ (m + 4), justifying "since 3 < 16 ≤ 2^(m+4)".
lemma three_le_two_pow (m : ℕ) : 3 ≤ 2 ^ (m + 4) := by
  calc 3 ≤ 2 ^ 4 := by norm_num
  _ ≤ 2 ^ (m + 4) := Nat.pow_le_pow_right (by norm_num) (by omega)

addAnonymousFactSplittingLemma three_le_two_pow

-- Bridge (fact): 2 ^ 4 ≤ 2 ^ (m + 4), the book's "since n ≥ 4" step.
lemma two_pow_four_le (m : ℕ) : 2 ^ 4 ≤ 2 ^ (m + 4) :=
  Nat.pow_le_pow_right (by norm_num) (by omega)

addAnonymousFactSplittingLemma two_pow_four_le

-- Bridge (fact): 2 ^ 4 ≤ 2 ^ n for n ≥ 4, the book's "since n ≥ 4" step.
lemma two_pow_four_le_of_ge {n : ℕ} (h : n ≥ 4) : 2 ^ 4 ≤ 2 ^ n := by
  have : n = (n - 4) + 4 := by omega
  rw [this]
  exact two_pow_four_le (n - 4)

addAnonymousFactSplittingLemma two_pow_four_le_of_ge

-- Bridge (compute): the ℕ-division step in the sum-of-cubes formula,
-- n²(n+1)²/4 + (n+1)³ = (n+1)²(n+2)²/4.
lemma sum_cubes_div_step (m : ℕ) :
    m ^ 2 * (m + 1) ^ 2 / 4 + (m + 1) ^ 3 = (m + 1) ^ 2 * (m + 1 + 1) ^ 2 / 4 := by
  obtain ⟨s, hs⟩ : ∃ s, m * (m + 1) = 2 * s := (Nat.even_mul_succ_self m).two_dvd
  have h1 : m ^ 2 * (m + 1) ^ 2 = 4 * s ^ 2 := by
    calc m ^ 2 * (m + 1) ^ 2 = (m * (m + 1)) ^ 2 := by ring
    _ = (2 * s) ^ 2 := by rw [hs]
    _ = 4 * s ^ 2 := by ring
  have h2 : (m + 1) ^ 2 * (m + 1 + 1) ^ 2 = 4 * s ^ 2 + 4 * (m + 1) ^ 3 := by
    calc (m + 1) ^ 2 * (m + 1 + 1) ^ 2 = m ^ 2 * (m + 1) ^ 2 + 4 * (m + 1) ^ 3 := by ring
    _ = 4 * s ^ 2 + 4 * (m + 1) ^ 3 := by rw [h1]
  omega

addAnonymousComputeLemma sum_cubes_div_step

-- Bridge (compute): the book's first "algebra" step, pulling the denominator
-- 4 through: n²(n+1)²/4 + (n+1)³ = (n²(n+1)² + 4(n+1)³)/4.
lemma sum_cubes_div_combine (m : ℕ) :
    m ^ 2 * (m + 1) ^ 2 / 4 + (m + 1) ^ 3 = (m ^ 2 * (m + 1) ^ 2 + 4 * (m + 1) ^ 3) / 4 := by
  obtain ⟨s, hs⟩ : ∃ s, m * (m + 1) = 2 * s := (Nat.even_mul_succ_self m).two_dvd
  have h1 : m ^ 2 * (m + 1) ^ 2 = 4 * s ^ 2 := by
    calc m ^ 2 * (m + 1) ^ 2 = (m * (m + 1)) ^ 2 := by ring
    _ = (2 * s) ^ 2 := by rw [hs]
    _ = 4 * s ^ 2 := by ring
  have h2 : m ^ 2 * (m + 1) ^ 2 + 4 * (m + 1) ^ 3 = 4 * s ^ 2 + 4 * (m + 1) ^ 3 := by rw [h1]
  omega

addAnonymousComputeLemma sum_cubes_div_combine

-- Bridge (compute): the book's second "algebra" step, regrouping the numerator:
-- (n²(n+1)² + 4(n+1)³)/4 = ((n+1)²(n² + 4(n+1)))/4.
lemma sum_cubes_regroup (m : ℕ) :
    (m ^ 2 * (m + 1) ^ 2 + 4 * (m + 1) ^ 3) / 4 = ((m + 1) ^ 2 * (m ^ 2 + 4 * (m + 1))) / 4 := by
  have h : m ^ 2 * (m + 1) ^ 2 + 4 * (m + 1) ^ 3 = (m + 1) ^ 2 * (m ^ 2 + 4 * (m + 1)) := by ring
  rw [h]

addAnonymousComputeLemma sum_cubes_regroup

-- Bridge (compute): the book's third "algebra" step, the final factorisation
-- (n² + 4(n+1) = (n+1)² + 4 = (n+2)²):
-- ((n+1)²(n² + 4(n+1)))/4 = ((n+1)²(n+2)²)/4.
lemma sum_cubes_factor (m : ℕ) :
    ((m + 1) ^ 2 * (m ^ 2 + 4 * (m + 1))) / 4 = ((m + 1) ^ 2 * (m + 1 + 1) ^ 2) / 4 := by
  have h : (m + 1) ^ 2 * (m ^ 2 + 4 * (m + 1)) = (m + 1) ^ 2 * (m + 1 + 1) ^ 2 := by ring
  rw [h]

addAnonymousComputeLemma sum_cubes_factor

-- Bridge (compute): n²(n+1)²/4 = (n(n+1)/2)² in ℕ, used when combining
-- the sum-of-cubes formula with Gauss' formula.
lemma half_prod_squared (n : ℕ) : n ^ 2 * (n + 1) ^ 2 / 4 = (n * (n + 1) / 2) ^ 2 := by
  obtain ⟨s, hs⟩ : ∃ s, n * (n + 1) = 2 * s := (Nat.even_mul_succ_self n).two_dvd
  have h1 : n ^ 2 * (n + 1) ^ 2 = 4 * s ^ 2 := by
    calc n ^ 2 * (n + 1) ^ 2 = (n * (n + 1)) ^ 2 := by ring
    _ = (2 * s) ^ 2 := by rw [hs]
    _ = 4 * s ^ 2 := by ring
  have h2 : n * (n + 1) / 2 = s := by omega
  rw [h1, h2]
  omega

addAnonymousComputeLemma half_prod_squared

-- Registered statements of results proven in this sheet, so that later
-- exercises can cite them by statement (like citing a proposition on paper).
-- The Verbose proofs are in proposition 4.2.3 and Example 4.2.9 below.
lemma sum_consec_integers (n : ℕ) : ∑ k ∈ [0, n], k = n * (n + 1) / 2 := by
  induction n with
  | zero => decide
  | succ n ih => rw [sum_icc_succ_top 0 n (fun k => k) (by omega), ih, gauss_div_step]

addAnonymousFactSplittingLemma sum_consec_integers

lemma sum_cubes_formula (n : ℕ) : ∑ k ∈ [0, n], k ^ 3 = n ^ 2 * (n + 1) ^ 2 / 4 := by
  induction n with
  | zero => decide
  | succ n ih => rw [sum_icc_succ_top 0 n (fun k => k ^ 3) (by omega), ih, sum_cubes_div_step]

addAnonymousFactSplittingLemma sum_cubes_formula

-- Bridge (compute): the ℕ-subtraction step for the sum of powers of two,
-- (2^(n+1) - 1) + 2^(n+1) = 2^(n+2) - 1.
lemma two_pow_sub_one_step (m : ℕ) : 2 ^ (m + 1) - 1 + 2 ^ (m + 1) = 2 ^ (m + 1 + 1) - 1 := by
  have h1 : 2 ^ (m + 1 + 1) = 2 * 2 ^ (m + 1) := by ring
  have h2 : 1 ≤ 2 ^ (m + 1) := Nat.one_le_two_pow
  omega

addAnonymousComputeLemma two_pow_sub_one_step

-- Bridge (compute): the "simplifying" half of the step above,
-- (2^(n+1) - 1) + 2^(n+1) = 2·2^(n+1) - 1.
lemma two_pow_sub_one_double (m : ℕ) : 2 ^ (m + 1) - 1 + 2 ^ (m + 1) = 2 * 2 ^ (m + 1) - 1 := by
  have h : 1 ≤ 2 ^ (m + 1) := Nat.one_le_two_pow
  omega

addAnonymousComputeLemma two_pow_sub_one_double

-- Bridge (compute): the "laws of indices" half, 2·2^(n+1) - 1 = 2^(n+2) - 1.
lemma two_pow_double_sub_one (m : ℕ) : 2 * 2 ^ (m + 1) - 1 = 2 ^ (m + 1 + 1) - 1 := by
  have h : 2 ^ (m + 1 + 1) = 2 * 2 ^ (m + 1) := by ring
  omega

addAnonymousComputeLemma two_pow_double_sub_one

-- Bridge (fact): 1 - r ≠ 0 from r ≠ 1.
lemma one_sub_ne_zero {r : ℝ} (h : r ≠ 1) : 1 - r ≠ 0 := by
  intro h'
  apply h
  linarith

addAnonymousFactSplittingLemma one_sub_ne_zero

-- Bridge (goal): base case of the geometric sum formula —
-- field algebra with the nonzero denominator 1 - r.
lemma geometric_sum_base (a r : ℝ) (h : 1 - r ≠ 0) :
    ∑ k ∈ [0, 0], a * r ^ k = a * (1 - r ^ (0 + 1)) / (1 - r) := by
  simp
  field_simp

addAnonymousGoalSplittingLemma geometric_sum_base

-- Bridge (goal): the field-algebra step in the geometric sum induction,
-- a(1-r^(n+1))/(1-r) + ar^(n+1) = a(1-r^(n+2))/(1-r).
lemma geometric_sum_step (a r : ℝ) (m : ℕ) (h : 1 - r ≠ 0) :
    a * (1 - r ^ (m + 1)) / (1 - r) + a * r ^ (m + 1) = a * (1 - r ^ (m + 1 + 1)) / (1 - r) := by
  field_simp
  ring

addAnonymousGoalSplittingLemma geometric_sum_step

-- Bridge (goal): for the sum-of-cubes statement, once the closed-form
-- formula ∑ k³ = n²(n+1)²/4 is established for all n, the original
-- statement follows by combining it with Gauss' formula (proposition
-- 4.2.3; used here via its preamble twin sum_consec_integers, since the
-- Lemma header below is defined later): n²(n+1)²/4 = (n(n+1)/2)² = (∑ k)².
lemma sum_cubes_via_formula
    (h_formula : ∀ m : ℕ, ∑ k ∈ [0, m], k ^ 3 = m ^ 2 * (m + 1) ^ 2 / 4) :
    ∀ n : ℕ, ∑ k ∈ [0, n], k ^ 3 = (∑ k ∈ [0, n], k) ^ 2 := by
  intro n
  calc ∑ k ∈ [0, n], k ^ 3 = n ^ 2 * (n + 1) ^ 2 / 4 := h_formula n
  _ = (n * (n + 1) / 2) ^ 2 := half_prod_squared n
  _ = (∑ k ∈ [0, n], k) ^ 2 := by rw [← sum_consec_integers n]

addAnonymousGoalSplittingLemma sum_cubes_via_formula
