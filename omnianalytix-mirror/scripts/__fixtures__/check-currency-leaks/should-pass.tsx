// Real-world non-leak shapes. The checker MUST NOT flag any of these.

// 1. Symbol comes from a runtime variable, not a hard-coded "$".
const a = `${symbol}${value.toFixed(0)}`;
const b = `${getCurrencySymbol(quote)}${converted}`;

// 2. Plain string interpolation with no leading $.
const c = `Synced ${rows} rows · ${days} days`;
const d = `${count} items`;

// 3. Single $ followed by interpolation but NOT a template literal (no backtick).
const e = "$" + value.toString();

// 4. Inline allow comment opt-out.
// usd-leak-allow: this fixture line is intentionally allow-listed
const f = `$${legacyValue}`;

// 5. Allow comment on the previous line.
// usd-leak-allow: this fixture line is intentionally allow-listed
const g = `$${legacyValue}`;

// 6. Dollar sign elsewhere in the template, not as the prefix to interpolation.
const h = `total: $5 fixed`;

// 7. Pattern inside a line-comment is intentional (commented-out code or docs).
//    const oldStuff = `$${legacyValue}`;
// const i = `$${commented}`;
