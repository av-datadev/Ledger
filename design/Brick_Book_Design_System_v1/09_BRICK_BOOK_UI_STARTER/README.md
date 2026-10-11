# UI starter

Import `02_BRICK_BOOK_TOKENS.css` from your application entry CSS.

Use semantic variables in React/Tailwind rather than raw hex values.

Example:
```tsx
<button className="bb-button-primary">Add payment</button>
```

For Tailwind v4, map the semantic variables into your existing `@theme` layer if useful, while keeping the CSS variables as the source of truth.
