# BRICK BOOK DESIGN SYSTEM V1

This package is the machine-readable implementation companion to the Brick Book design audit.

The PDF explains strategy.
This package provides:
- design laws
- semantic tokens
- component rules
- UX patterns
- canonical screen specifications
- Claude-specific instructions
- visual quality gates

## Recommended Claude Design setup

Give Claude the entire folder, plus the existing Brick Book repository.

Use this instruction:

"Treat this folder as the binding Brick Book design system. Read the Constitution, Tokens, Components, Patterns, Reference Screen Specs and Quality Gate before designing or modifying UI. Inspect the existing implementation and reuse its data model and behavior. Do not invent a generic SaaS visual language. Any new visual decision must fit the existing token/component system."

## Recommended workflow
1. Audit current implementation against the system.
2. Fix foundations first.
3. Build/revise shared components.
4. Redesign one canonical screen.
5. Compare visually.
6. Run the quality gate.
7. Expand to secondary screens.

Do not ask "Make this app premium."
Ask "Redesign the Owner Dashboard using the Brick Book Design System. Do not introduce new visual primitives. Preserve behavior and data. Follow the Dashboard reference specification and run the quality gate."

## Versioning
Changes to tokens, typography, component anatomy or navigation are design-system changes, not isolated screen changes.
