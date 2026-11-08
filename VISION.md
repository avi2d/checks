# Vision

checks exists so that the rules a reviewer would otherwise carry in memory hold on every change without asking.
It serves the people who own shared repositories and answer for what lands in them.
It owns the judgment of whether a change belongs, and nothing past that judgment.

## Memory is not a control

- It allows a rule only as a program that runs without asking, it forbids a rule that lives in a reviewer's head, and it takes the trade of writing the program before enjoying its judgment.

## The referee stands apart from the work

- It allows a gate to refuse a change, it forbids a gate to reshape the change into something acceptable, and it takes the trade of a refusal that says what to fix without fixing it.

## One shape holds every repository

- It allows each repository to adopt a rule by upgrading one dependency, it forbids copying a rule's text between repositories, and it takes the trade of a slower rollout for a single source of truth.

## Adoption follows the change, never the calendar

- It allows an untouched file or line to keep passing, it forbids failing what the range leaves alone, and it takes the trade of a slow migration for a gate that never blocks unrelated work.

## Scope

- Releasing belongs to changesets, and editing belongs to the person or the agent making the change.
- Teaching belongs to the guides, and history belongs to the changelog and the decision records.

A change aligns when it moves a rule from memory into a program.
A change should be resisted when it judges taste, or when it fixes the change instead of refusing it.
