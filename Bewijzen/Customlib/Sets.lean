/-
  Generic set-theory lemmas for Waterproof exercise sheets.

  Works for any type α; no domain-specific mathematics required.
  Register these in each sheet's doc block with addAnonymousGoalSplittingLemma.
-/

import Verbose.English.All
import Mathlib.Data.Finset.Basic
import Mathlib.Data.Fin.Basic
import Mathlib.Data.Fin.SuccPred

open Fin

-- ══════════════════════════════════════════════════════════════
-- § Subset and set equality
-- ══════════════════════════════════════════════════════════════

-- Set equality from mutual inclusion, conjunction form.
-- Lets "It suffices to prove that A ⊆ B ∧ B ⊆ A" discharge A = B goals.
lemma set_eq_of_subset_conj {α : Type} {A B : Set α}
    (h : A ⊆ B ∧ B ⊆ A) : A = B :=
  Set.Subset.antisymm h.1 h.2

-- Transport membership along an equality of sets — lets
-- "Since A = B and x ∈ A we get that x ∈ B" work directly.
lemma mem_of_set_eq {U : Type} {A B : Set U} {x : U}
    (h : A = B) (hx : x ∈ A) : x ∈ B := h ▸ hx

-- Transport membership backwards along an equality of sets.
lemma mem_of_set_eq' {U : Type} {A B : Set U} {x : U}
    (h : A = B) (hx : x ∈ B) : x ∈ A := h ▸ hx

-- ══════════════════════════════════════════════════════════════
-- § Complement
-- ══════════════════════════════════════════════════════════════

-- An element outside the complement lies in the set.
lemma mem_of_not_mem_compl {U : Type} {A : Set U} {x : U}
    (h : x ∉ Aᶜ) : x ∈ A := by
  by_contra hx
  exact h hx

-- An element of the set lies outside the complement.
lemma not_mem_compl_of_mem {U : Type} {A : Set U} {x : U}
    (h : x ∈ A) : x ∉ Aᶜ := fun hc => hc h

-- ══════════════════════════════════════════════════════════════
-- § Empty set
-- ══════════════════════════════════════════════════════════════

def SetIsEmpty {U : Type} (X : Set U) : Prop :=
  ∀ _ ∈ X, False

-- The notation `X is empty` reads as `∀ x ∈ X, False`
notation:50 X " is empty" => SetIsEmpty X

lemma empty_set_is_empty {α : Type} (X : Set α) (h : X = ∅) : X is empty := by
  simp [h, SetIsEmpty]

-- x ∈ ∅ implies False — lets "We conclude by contradicting x ∈ ∅" work directly.
lemma mem_empty_contra {α : Type} {x : α} (h : x ∈ (∅ : Set α)) : False := by
  simp [Set.mem_empty_iff_false] at h

-- A set equals ∅ when every membership assumption yields False.
-- Lets "It suffices to prove that ∀ x, x ∈ S → False" discharge S = ∅ goals.
lemma set_eq_empty_of_forall_not_mem {α : Type} {S : Set α}
    (h : ∀ x, x ∈ S → False) : S = ∅ :=
  Set.eq_empty_of_forall_notMem h

-- Membership in a known-empty set yields False.
lemma false_of_mem_empty_set {α : Type} {S : Set α} {x : α}
    (hS : S = ∅) (hx : x ∈ S) : False := by
  rw [hS] at hx; exact hx

-- ══════════════════════════════════════════════════════════════
-- § Disjoint sets
-- ══════════════════════════════════════════════════════════════

def SetsAreDisjoint {U : Type} (A : Set U) (B : Set U) : Prop :=
  A ∩ B is empty

notation:50 A " is disjoint from " B => SetsAreDisjoint A B

-- ══════════════════════════════════════════════════════════════
-- § Well-ordering of natural numbers
-- ══════════════════════════════════════════════════════════════

-- Well-ordering principle for ℕ: every nonempty set of naturals has a least element.
-- This is the core lemma that students can cite directly when applying well-ordering.
-- Usage: "Since S is nonempty we get m such that m ∈ S and ∀ n ∈ S, m ≤ n"
lemma well_ordering_nat {S : Set ℕ} (h : S.Nonempty) :
    ∃ m, m ∈ S ∧ ∀ n ∈ S, m ≤ n := by
  classical
  let P : ℕ → Prop := fun n => n ∈ S
  have h_exists : ∃ m : ℕ, P m := h
  let m : ℕ := Nat.find h_exists
  use m
  constructor
  · exact Nat.find_spec h_exists
  · intro n hn
    exact Nat.find_min' h_exists hn

-- Least element property: if m is the least element of S, then m ∈ S
-- and every element of S is at least m.
-- Usage: "By well-ordering we get m with these properties"
lemma isLeast_nat {S : Set ℕ} (h : S.Nonempty) : ∃ m, m ∈ S ∧ ∀ n, n ∈ S → m ≤ n :=
  well_ordering_nat h

-- Well-ordering for bounded-below sets: if S ⊆ ℕ and S is nonempty and bounded below,
-- then S has a least element.
-- This version is useful when S comes from a bounded range context.
-- For ℕ, any nonempty set is automatically bounded below by 0, so the
-- h_bdd hypothesis is informational rather than logically necessary.
lemma well_ordering_bddBelow {S : Set ℕ} (h : S.Nonempty) (_ : BddBelow S) :
    ∃ m, m ∈ S ∧ ∀ n ∈ S, m ≤ n :=
  well_ordering_nat h

-- ══════════════════════════════════════════════════════════════
-- § Tuple bijection lemmas
-- ══════════════════════════════════════════════════════════════

-- Helper equivalence: split off the last element of a dependent product
-- over Fin (n+1), producing a pair (product over Fin n, last component).
-- This is the core bijection used when reasoning about tuples / finite products
-- by induction on their length.
noncomputable def splitLastEquiv (n : ℕ) (X : Fin (n + 1) → Type) :
    Equiv ((Π k : Fin (n + 1), X k))
          ((Π j : Fin n, X (Fin.castSucc j)) × X (last n)) :=
  Equiv.mk
    (fun f => (fun j => f (Fin.castSucc j), f (last n)))
    (fun ⟨g, an⟩ k => Fin.lastCases an (fun j => g j) k)
    (by
      intro f
      ext k
      cases k using Fin.lastCases
      · simp
      · simp [Fin.lastCases])
    (by
      intro p
      ext j
      · simp
      · simp)

-- Helper equivalence: explicit bijection between product of n+1 indexed sets and
-- (product of n indexed sets) × the last set.
-- This equivalence splits a dependent function over Fin (n+1) into
-- a pair: the restriction to Fin n (via castSucc) and the value at last.
-- Returns an Equiv (not a Prop), so use it directly in proofs rather than
-- as a bridge lemma.
noncomputable def prod_succ_bijection_equiv (n : ℕ) (X : Fin (n + 1) → Type) :
    (Π k : Fin (n + 1), X k) ≃ ((Π j : Fin n, X (Fin.castSucc j)) × X (last n)) :=
  Equiv.mk
    (fun f => (fun j => f (Fin.castSucc j), f (last n)))
    (fun ⟨g, an⟩ k => Fin.lastCases an (fun j => g j) k)
    (by
      intro f
      ext k
      cases k using Fin.lastCases
      · simp
      · simp [Fin.lastCases])
    (by
      intro p
      ext j
      · simp
      · simp)

-- Bridge lemma: existence of bijection (convenience wrapper).
-- Usage: "Since we have a product over n+1 indices we conclude that it is
--        in bijection with the product over n indices times the last component"
lemma prod_succ_bijection (n : ℕ) (X : Fin (n + 1) → Type) :
    Nonempty ((Π k : Fin (n + 1), X k) ≃ ((Π j : Fin n, X (Fin.castSucc j)) × X (last n))) := by
  exact ⟨prod_succ_bijection_equiv n X⟩

-- § Propositional contradiction
-- ══════════════════════════════════════════════════════════════

lemma prop_and_neg_false {P : Prop} (h : P) (hn : ¬P) : False := hn h

-- From ¬(P ∧ Q) and P, obtain ¬Q.
lemma not_and_imp_not_right {P Q : Prop} (h1 : ¬(P ∧ Q)) (h2 : P) : ¬Q := by
  intro hq; exact h1 ⟨h2, hq⟩

-- ══════════════════════════════════════════════════════════════
-- § Set difference
-- ══════════════════════════════════════════════════════════════

lemma mem_diff_bridge {U : Type} {x : U} {A B : Set U} (h : x ∈ A \ B) :
    x ∈ A ∧ x ∉ B := h

lemma mem_diff_of_mem_not {U : Type} {x : U} {A B : Set U}
    (h1 : x ∈ A) (h2 : x ∉ B) : x ∈ A \ B := ⟨h1, h2⟩

-- ══════════════════════════════════════════════════════════════
-- § Negated membership (De Morgan bridges)
-- ══════════════════════════════════════════════════════════════

lemma not_inter_mem {U : Type} {x : U} {A B : Set U}
    (h : ¬ (x ∈ A ∧ x ∈ B)) : x ∉ A ∩ B := h

lemma not_mem_inter_of_not_left {U : Type} {x : U} {A B : Set U}
    (h1 : x ∉ A) : ¬ (x ∈ A ∧ x ∈ B) := by
  intro h
  rcases h with ⟨hA, hB⟩
  exact h1 hA

lemma not_mem_inter_of_not_right {U : Type} {x : U} {A B : Set U}
    (h1 : x ∉ B) : ¬ (x ∈ A ∧ x ∈ B) := by
  intro h
  rcases h with ⟨hA, hB⟩
  exact h1 hB

lemma not_mem_union_split {U : Type} {x : U} {A B : Set U}
    (h : x ∉ A ∪ B) : x ∉ A ∧ x ∉ B := by
  constructor
  · intro hA
    have : x ∈ A ∪ B := Or.inl hA
    exact h this
  · intro hB
    have : x ∈ A ∪ B := Or.inr hB
    exact h this

-- From x ∉ A ∪ B, extract just the left membership negation — lets
-- "Since x ∉ A ∪ B we get that x ∉ A" work directly without also
-- deriving (and discarding) x ∉ B.
lemma not_mem_left_of_not_mem_union {U : Type} {x : U} {A B : Set U}
    (h : x ∉ A ∪ B) : x ∉ A := (not_mem_union_split h).1

-- De Morgan for negated intersection membership — lets
-- "Since x ∉ A ∩ B we get that x ∉ A ∨ x ∉ B" work directly.
lemma not_mem_or_of_not_mem_inter {U : Type} {x : U} {A B : Set U}
    (h : x ∉ A ∩ B) : x ∉ A ∨ x ∉ B := not_and_or.mp h

lemma not_union_mem {U : Type} {x : U} {A B : Set U}
    (h1 : x ∉ A) (h2 : x ∉ B) : ¬ (x ∈ A ∪ B) := by
  intro h
  rcases h with (hA | hB)
  · exact h1 hA
  · exact h2 hB

-- ══════════════════════════════════════════════════════════════
-- § Set union membership
-- ══════════════════════════════════════════════════════════════

lemma mem_union_left_bridge {U : Type} {x : U} {A B : Set U} (h : x ∈ A) : x ∈ A ∪ B := Or.inl h

lemma mem_union_right_bridge {U : Type} {x : U} {A B : Set U} (h : x ∈ B) : x ∈ A ∪ B := Or.inr h

-- ══════════════════════════════════════════════════════════════
-- § Elaboration: ∅ without a type ascription (issue #46)
-- ══════════════════════════════════════════════════════════════

-- `Assume that`/`Since` elaborate the stated term without the goal's expected
-- type, so `x ∈ ∅` leaves the typeclass problems `Membership ?α ?γ` and
-- `EmptyCollection ?γ` stuck and students are forced to write `(∅ : Set U)`.
-- Lean's default-instance mechanism resolves exactly this situation: with the
-- two attributes below, `Assume that x ∈ ∅`, `Since x ∈ ∅ we conclude that
-- False` and `Conclusion: f ⁻¹' ∅ = ∅` all elaborate unascribed.
--
-- These attributes are global for downstream importers.  That is harmless
-- here: these are the only `Membership`/`EmptyCollection` carriers the sheets
-- ever use.  (`Fix x ∈ ∅` additionally needs the Fix patch below, since the
-- Fix mem branch bypasses default instances.)
attribute [default_instance] Set.instMembership Set.instEmptyCollection

-- ══════════════════════════════════════════════════════════════
-- § Elaboration: Fix x ∈ s infers the element type (issue #47)
-- ══════════════════════════════════════════════════════════════

-- Verbose's mem branch (Verbose/Tactics/Fix.lean) elaborates the set
-- expression alone (`elabTerm e none`) and then hand-builds `Membership.mem`
-- with `mkAppM`, whose raw instance search sees no default instances and will
-- not assign metavariables.  The element type sitting in the goal's binder is
-- never used, so `Fix x ∈ {x | x * x < x}` fails to infer it.  (Verbose's own
-- test file carries a FIXME for `Fix (l ∈ Set.univ)`.)
--
-- This rule introduces the object and its membership hypothesis first, then
-- elaborates `x ∈ s` against the actual hypothesis type using Verbose's own
-- `elabTermEnsuringValue`.  Declared later than Verbose's rule, so it takes
-- precedence with Verbose itself untouched.
section FixMemPatch
open Lean Elab Tactic Meta Verbose.English

elab_rules : tactic
  | `(tactic| Fix₁ $x:ident ∈ $set) => withMainContext do
    let n := x.getId
    checkName n
    let intro1 ← introObj (← getMainGoal) n
    let new_goal := intro1.2
    new_goal.withContext do
      let hypName : Name := Name.mkSimple (n.toString ++ "_mem")
      let intro2 ← new_goal.intro hypName
      let hyp_fvar := intro2.1
      let newer_goal := intro2.2
      newer_goal.withContext do
        let hypType := (← hyp_fvar.getDecl).type
        let e ← elabTermEnsuringValue (← `($x ∈ $set)) hypType
        let new_mvarid ← newer_goal.changeLocalDecl hyp_fvar e
        replaceMainGoal [new_mvarid]

end FixMemPatch

-- ══════════════════════════════════════════════════════════════
-- § Elaboration: a type X used as a set means univ (issue #67)
-- ══════════════════════════════════════════════════════════════

-- On paper a student writes `f ⁻¹' Y = X`, not `f ⁻¹' univ = (univ : Set X)`.
-- The coercion below supplies `univ` wherever a `Set X` is expected but the
-- type `X` is written.
instance instTypeAsUniv (X : Type) : CoeDep Type X (Set X) := ⟨Set.univ⟩

-- Membership needs separate treatment: core's `∈` is a plain `notation`
-- (a macro), and it *infers* the collection type from the argument rather
-- than expecting one, so no coercion site exists and `x ∈ X` fails with
-- `Membership X Type`.  Re-route the notation through an elaborator that
-- looks at what the right-hand side actually is: a type becomes `univ`,
-- anything else (Set, List, Finset, …) elaborates exactly as before.
-- A written *type* in a position where a set is meant should denote the set of
-- all its elements.  The set operators below are plain `infix` notations that
-- infer their type from their arguments, so — unlike `f ⁻¹' _`, which expects
-- a set and therefore triggers the coercion above — the coercion is never
-- consulted: `x ∈ X` fails with `Membership X Type`, `X ⊆ f ⁻¹' Y` with
-- `HasSubset Type`.
--
-- Each operator is re-routed through an elaborator that first asks whether an
-- operand is a type.  When none is — the overwhelmingly common case — the
-- original syntax is elaborated completely untouched, so Set, List and Finset
-- membership, `rcases` shapes and error messages are exactly as before.
section TypesAsSets
open Lean Elab Term Meta

/-- Is this syntax a type (rather than a set, list, …)? Probed without
committing any elaboration state. -/
private def writtenAsType (s : Syntax) : TermElabM Bool :=
  withoutModifyingState do
    try
      let se ← withoutErrToSorry <| elabTerm s none
      return (← instantiateMVars <| ← inferType se).isSort
    catch _ => return false

syntax:max "memTypeAware% " term:max ppSpace term:max : term
syntax:max "subsetTypeAware% " term:max ppSpace term:max : term
syntax:max "ssubsetTypeAware% " term:max ppSpace term:max : term

elab_rules : term <= expected
  | `(memTypeAware% $x $s) => do
    if ← writtenAsType s then
      elabTerm (← `(Membership.mem (Set.univ : Set $s) $x)) expected
    else
      elabTerm (← `(Membership.mem $s $x)) expected

-- Since Mathlib v4.34 `⊆` and `⊂` have their own elaborators
-- (`Mathlib.Tactic.SetNotationForOrder`): on `Set` and `Finset` they mean `≤` and `<`, and `Set`
-- has no `HasSubset` instance any more. The two rules below therefore hand the (rewritten)
-- relation to Mathlib's elaborator directly, which also keeps the `⊆`/`⊂` macros below from
-- expanding again.
elab_rules : term <= expected
  | `(subsetTypeAware% $a $b) => do
    let elabRel := Mathlib.Meta.SetNotationForOrder.elabSubsetStx'
    match ← writtenAsType a, ← writtenAsType b with
    | true,  true  => elabRel (← `((Set.univ : Set $a) ⊆ (Set.univ : Set $b))) expected
    | true,  false => elabRel (← `((Set.univ : Set $a) ⊆ $b)) expected
    | false, true  => elabRel (← `($a ⊆ (Set.univ : Set $b))) expected
    | false, false => elabRel (← `($a ⊆ $b)) expected

elab_rules : term <= expected
  | `(ssubsetTypeAware% $a $b) => do
    let elabRel := Mathlib.Meta.SetNotationForOrder.elabSSubsetStx'
    match ← writtenAsType a, ← writtenAsType b with
    | true,  true  => elabRel (← `((Set.univ : Set $a) ⊂ (Set.univ : Set $b))) expected
    | true,  false => elabRel (← `((Set.univ : Set $a) ⊂ $b)) expected
    | false, true  => elabRel (← `($a ⊂ (Set.univ : Set $b))) expected
    | false, false => elabRel (← `($a ⊂ $b)) expected

end TypesAsSets

macro_rules | `($x ∈ $s) => `(memTypeAware% $x $s)
macro_rules | `($a ⊆ $b) => `(subsetTypeAware% $a $b)
macro_rules | `($a ⊂ $b) => `(ssubsetTypeAware% $a $b)

-- The coercion above is only consulted when a `Set` is *expected*.  In a
-- relation such as `f ⁻¹' Y = X`, Lean instead finds the opposite route —
-- `Set.instCoeSortType`, which lifts the left-hand *set* up to a *type* —
-- and silently produces a statement about type equality (`↑(f ⁻¹' univ) = X`)
-- rather than the intended equality of sets.  Lowering that instance's
-- priority does not help; it has to be out of scope.  Instance erasure is
-- file-local and cannot be exported, so sheets invoke this command in their
-- preamble to get the `X`-means-`univ` reading.
macro "readTypesAsSets" : command =>
  `(attribute [-instance] Set.instCoeSortType)
