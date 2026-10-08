import WaterproofGenre
import Verbose.English.All

open WaterproofGenre

#doc (WaterproofGenre) "Hole status (website test fixture)" =>

This is not a course sheet. It has the shape of one (Verso prose, `::::multilean` exercises
with `:::input` holes) and its own exercises, so the website's checks can see a hole that is
solved, one that is wrong, and one that is still empty, without publishing course solutions.

::::multilean
```lean
Exercise "fixture.1"
  Given: (p q : Prop)
  Assume: (_ : p) (_ : q)
  Conclusion: q ∧ p
Proof:
```
:::input
```lean
  Let's first prove that q
  · We conclude by hypothesis
  Let's now prove that p
  · We conclude by hypothesis
```
:::
```lean
QED
```
::::

::::multilean
```lean
Exercise "fixture.2"
  Given: (p q : Prop)
  Assume: (_ : p)
  Conclusion: p ∧ q
Proof:
```
:::input
```lean
  Let's first prove that p
  · We conclude by hypothesis
  Let's now prove that q
  · We conclude by hypothesis
```
:::
```lean
QED
```
::::

::::multilean
```lean
Exercise "fixture.3"
  Given: (p : Prop)
  Assume: (_ : p)
  Conclusion: p
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
