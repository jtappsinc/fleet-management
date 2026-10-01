# Joshua Tree Operations Console — Design System

A reusable spec for the visual language used in this admin app. Drop this whole file into another Claude Code project as `DESIGN_SYSTEM.md` and Claude will follow it.

---

## 1. Stack

- **Tailwind CSS v4** (with `@theme inline` token mapping)
- **shadcn/ui + Radix primitives** (cards, dialogs, selects, tables, etc.)
- **lucide-react** for icons (one icon per concept, consistent across the app)
- **recharts** for charts
- **Inter Tight** for sans, **JetBrains Mono** for mono — loaded via Google Fonts

---

## 2. Brand & mood

A **landscaping / fleet ops** console: dark evergreen sidebar, paper-white workspace, orange accent for calls to action. Reads as utilitarian-but-refined — heavy use of mono-typed eyebrow labels and tight numeric grids.

- **Primary** — deep forest green (`hsl(107 73% 26%)`) for default actions, focus rings, brand chrome
- **Accent** — orange (`hsl(24 92% 47%)`) for the single most important action on a page (CTAs, "create", "new")
- **Sidebar** — near-black evergreen (`hsl(107 35% 14%)`) so the workspace pops next to it
- **Background** — warm off-white (`hsl(40 33% 98%)`), not pure white

---

## 3. Color tokens (paste into `src/index.css`)

```css
@import "tailwindcss";
@import "tw-animate-css";
@plugin "@tailwindcss/typography";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-border: hsl(var(--border));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));

  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-popover: hsl(var(--popover));
  --color-popover-foreground: hsl(var(--popover-foreground));

  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));
  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));
  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));

  --color-chart-1: hsl(var(--chart-1));
  --color-chart-2: hsl(var(--chart-2));
  --color-chart-3: hsl(var(--chart-3));
  --color-chart-4: hsl(var(--chart-4));
  --color-chart-5: hsl(var(--chart-5));

  --color-sidebar: hsl(var(--sidebar));
  --color-sidebar-foreground: hsl(var(--sidebar-foreground));
  --color-sidebar-border: hsl(var(--sidebar-border));
  --color-sidebar-primary: hsl(var(--sidebar-primary));
  --color-sidebar-primary-foreground: hsl(var(--sidebar-primary-foreground));
  --color-sidebar-accent: hsl(var(--sidebar-accent));
  --color-sidebar-accent-foreground: hsl(var(--sidebar-accent-foreground));
  --color-sidebar-ring: hsl(var(--sidebar-ring));

  --font-sans: var(--app-font-sans);
  --font-mono: var(--app-font-mono);

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

/* LIGHT MODE */
:root {
  --background: 40 33% 98%;
  --foreground: 107 40% 13%;
  --border: 107 15% 85%;
  --input: 107 15% 82%;
  --ring: 107 73% 26%;

  --card: 0 0% 100%;
  --card-foreground: 107 40% 13%;
  --popover: 0 0% 100%;
  --popover-foreground: 107 40% 13%;

  --primary: 107 73% 26%;          /* deep forest green */
  --primary-foreground: 0 0% 100%;
  --secondary: 107 20% 92%;
  --secondary-foreground: 107 40% 13%;
  --muted: 107 20% 94%;
  --muted-foreground: 107 15% 38%;
  --accent: 24 92% 47%;             /* orange CTA */
  --accent-foreground: 0 0% 100%;
  --destructive: 0 75% 45%;
  --destructive-foreground: 0 0% 100%;

  --sidebar: 107 35% 14%;
  --sidebar-foreground: 40 33% 96%;
  --sidebar-border: 107 30% 22%;
  --sidebar-primary: 24 92% 47%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 107 30% 22%;
  --sidebar-accent-foreground: 40 33% 96%;
  --sidebar-ring: 24 92% 47%;

  --chart-1: 107 73% 26%;
  --chart-2: 24 92% 47%;
  --chart-3: 200 50% 35%;
  --chart-4: 40 60% 50%;
  --chart-5: 340 50% 40%;

  --app-font-sans: 'Inter Tight', 'Inter', ui-sans-serif, system-ui, sans-serif;
  --app-font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --radius: 0.5rem;
}

/* DARK MODE */
.dark {
  --background: 107 40% 9%;
  --foreground: 40 33% 96%;
  --border: 107 25% 22%;
  --input: 107 25% 22%;
  --ring: 107 60% 40%;

  --card: 107 40% 12%;
  --card-foreground: 40 33% 96%;
  --popover: 107 40% 12%;
  --popover-foreground: 40 33% 96%;

  --primary: 107 60% 40%;
  --primary-foreground: 0 0% 100%;
  --secondary: 107 25% 18%;
  --secondary-foreground: 40 33% 96%;
  --muted: 107 25% 18%;
  --muted-foreground: 107 15% 65%;
  --accent: 24 92% 50%;
  --accent-foreground: 0 0% 100%;
  --destructive: 0 70% 50%;
  --destructive-foreground: 0 0% 100%;

  --sidebar: 107 40% 8%;
  --sidebar-foreground: 40 33% 96%;
  --sidebar-border: 107 25% 22%;
  --sidebar-primary: 24 92% 50%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 107 25% 18%;
  --sidebar-accent-foreground: 40 33% 96%;
  --sidebar-ring: 24 92% 50%;

  --chart-1: 160 40% 40%;
  --chart-2: 26 50% 50%;
  --chart-3: 200 40% 45%;
  --chart-4: 40 30% 60%;
  --chart-5: 340 30% 50%;
}

@layer base {
  * { @apply border-border; }
  body {
    @apply font-sans antialiased bg-background text-foreground;
    letter-spacing: -0.005em;
  }
  * {
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--muted-foreground) / 0.25) transparent;
  }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background-color: hsl(var(--muted-foreground) / 0.2);
    border-radius: 999px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  ::-webkit-scrollbar-thumb:hover { background-color: hsl(var(--muted-foreground) / 0.4); }
}

@layer utilities {
  .card-interactive {
    @apply transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-accent/30;
  }
  .kpi-tile {
    background-image: linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--muted) / 0.35) 100%);
  }
}
```

Add the fonts in `index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

---

## 4. Typography

| Use | Class |
|---|---|
| Body | `font-sans text-sm` (Inter Tight, slightly tighter tracking via base) |
| Headings | `font-sans font-bold tracking-tight` |
| **Eyebrow labels** (signature look) | `text-xs font-mono uppercase tracking-widest text-muted-foreground` |
| Numeric values (KPIs, table totals) | `font-mono` |
| Tiny meta | `text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground` |

The mono eyebrow + headline pairing is the visual signature — use it for every section title.

```tsx
<div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
  Crew Lead
</div>
<div className="mt-1 text-sm font-semibold">Wilber Garcia</div>
```

---

## 5. Spacing & layout

- **Radius:** `--radius: 0.5rem`. Use `rounded-md` for inputs/buttons, `rounded-lg` for cards/tiles, `rounded-full` for pills.
- **Page rhythm:** `space-y-6` between major sections; `space-y-4` inside cards; `gap-3` in grids of small tiles.
- **Card padding:** `p-4` (small), `p-5` (KPI), `px-3 py-2.5` (table rows).
- **Page container:** put content in a `space-y-6` flex column. The app shell handles outer padding.
- **Grids:** always responsive — `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` for card grids; KPI rows usually `grid-cols-2 sm:grid-cols-3 md:grid-cols-5`.

---

## 6. Component patterns

### Page header
Every page opens with a `PageHeader` — eyebrow + title + description + optional action button.

```tsx
<PageHeader
  eyebrow="Fleet & Shop"
  title="Crews"
  icon={<HardHat className="h-5 w-5" />}
  description="Field crews with their assigned members, trucks, and equipment."
  actions={<Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" />New Crew</Button>}
/>
```

### KPI card

```tsx
<Card className="border-border/60">
  <CardContent className="flex items-center justify-between p-5">
    <div>
      <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
        Total Assets
      </div>
      <div className="mt-2 text-2xl font-bold">312</div>
    </div>
    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <Package className="h-5 w-5" />
    </div>
  </CardContent>
</Card>
```

Tone variants: amber (`text-amber-700`) for warnings, rose (`text-rose-700`) for destructive/overdue, default for neutral. Background uses `kpi-tile` utility for a subtle gradient.

### Status badges
Soft colored pills, never solid:

```tsx
const STATUS_COLORS: Record<string, string> = {
  ACTIVE:  "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  IN_SHOP: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  RETIRED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};
// inline-flex rounded-full px-2 py-0.5 text-xs font-medium
```

For "Overdue / Due Soon / OK" use `border-rose-200 bg-rose-100 text-rose-900` / amber / emerald.

### Selectable card (grid tile)
The signature "pick one of many" interaction (used for crews, asset tiles, quick-actions):

```tsx
<button
  className={cn(
    "group flex w-full flex-col gap-2 rounded-lg border bg-card px-3 py-3 text-left transition-all",
    "hover:border-primary/60 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring",
    selected ? "border-primary bg-primary/5 shadow-sm" : "border-border",
  )}
>
  <div className="flex items-center gap-2">
    <span className={cn(
      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
      selected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
    )}>
      <Icon className="h-4 w-4" />
    </span>
    <span className="truncate text-sm font-semibold">{name}</span>
  </div>
  {/* meta pills */}
  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
      <Users className="h-3 w-3" /> {count}
    </span>
  </div>
</button>
```

### Quick-actions tile (used on home dashboards)

```tsx
<Link className="group flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 transition-all hover:border-primary/60 hover:bg-accent/30 hover:shadow-sm">
  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
    <Icon className="h-4 w-4" />
  </span>
  <div className="min-w-0">
    <div className="truncate text-sm font-medium">{label}</div>
    <div className="truncate text-xs text-muted-foreground">{description}</div>
  </div>
</Link>
```

### Detail-row list (members, trucks, equipment under a section)

```tsx
<div className="mb-2 flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
  <Users className="h-3.5 w-3.5" /> Members ({n})
</div>
<div className="divide-y rounded-md border">
  {items.map(m => (
    <div className="flex items-center justify-between gap-2 px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{m.fullName}</p>
        <p className="truncate text-xs text-muted-foreground">{m.department}</p>
      </div>
      <Badge variant="secondary" className="shrink-0 text-xs">{m.role}</Badge>
    </div>
  ))}
</div>
```

### Tables
Wrap in `<div className="rounded-md border bg-card overflow-x-auto">` so they scroll horizontally on mobile. Sticky header: `<TableHeader className="sticky top-0 z-10 bg-muted/40 backdrop-blur">`. Right-align numbers with `font-mono`. Use `whitespace-nowrap` on date / status / action cells. Truncate long descriptions with `max-w-[280px] truncate` + `title=` tooltip.

### Dialogs
- Width: `w-[calc(100vw-2rem)] sm:max-w-md` (or `sm:max-w-sm` / `sm:max-w-lg` / `sm:max-w-2xl`).
- Add `max-h-[85vh] overflow-y-auto` for long-form dialogs.
- Header → form fields in `space-y-4 pt-2` → footer with `flex justify-end gap-2 pt-1` containing Cancel (outline) + primary action.

### Filter bar
On any list page:

```tsx
<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
  <div className="relative w-full sm:max-w-xs">
    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    <Input className="pl-8" placeholder="Search…" />
  </div>
  <div className="text-xs text-muted-foreground">Showing {n} of {total}</div>
</div>
```

---

## 7. Sidebar shell

- Always-on dark evergreen sidebar at `w-64`, sticky top, full viewport height.
- Mobile: hidden behind a `<Sheet>` with hamburger trigger (`md:hidden`).
- Nav is grouped: each group has a tiny mono uppercase label, then nav items. Active item gets the **orange** sidebar-primary background:

```tsx
className={cn(
  "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all",
  isActive
    ? "bg-sidebar-primary/95 text-sidebar-primary-foreground shadow-sm"
    : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:translate-x-0.5"
)}
```

The header (right of sidebar) is sticky `h-14 md:h-16`, glassy: `bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80`.

---

## 8. Icons

Use **lucide-react**, sized `h-3.5 w-3.5` (inline meta), `h-4 w-4` (default), `h-5 w-5` (page headers). One icon per domain concept:

| Concept | Icon |
|---|---|
| Trucks | `Truck` |
| Trailers | `Caravan` |
| Heavy/Compact equipment | `Construction` |
| Handheld equipment | `Hammer` |
| Maintenance | `Wrench` |
| Crews | `HardHat` |
| People | `Users` / `UserPlus` / `UserCog` |
| Department | `Building2` |
| Accounting / spend | `Calculator` / `DollarSign` / `Receipt` / `TrendingUp` |
| Status overview | `Activity` |
| Asset registry | `Package` |
| Delete | `Trash2` |
| Approvals / security | `Shield` |
| AI / Assistant | `Sparkles` |
| Confirm / OK | `CheckCircle2` |
| Warn / due-soon | `Clock` |
| Overdue / error | `AlertTriangle` |

---

## 9. Charts (recharts)

- Single-color bars use `--chart-1` (forest green).
- Multi-series stick to the `--chart-1` → `--chart-5` palette (green, orange, blue, gold, mulberry).
- Always wrap in `<ResponsiveContainer width="100%" height={...}>`.
- Use `<CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />`.

---

## 10. Motion

- Hover lift on interactive cards: `hover:-translate-y-0.5 hover:shadow-md` (`.card-interactive` utility).
- Active nav slides right 2px: `hover:translate-x-0.5`.
- All transitions: `transition-all duration-150` or `duration-200`. Avoid duration > 300ms.
- No bounce / spring — keep it crisp.

---

## 11. Responsive rules (non-negotiable)

- Target **375px** as the smallest viewport.
- Stat / KPI grids: always specify mobile first — `grid-cols-1 sm:grid-cols-2 md:grid-cols-3` etc. Never start at `grid-cols-3` with no fallback.
- Form field pairs: `grid grid-cols-1 gap-3 sm:grid-cols-2`.
- Dialogs: `w-[calc(100vw-2rem)] sm:max-w-…` — never bare `max-w-…`.
- Selects in a filter row: `w-full sm:w-[180px]`.
- Tables: wrap in `overflow-x-auto`.
- Use `truncate` on any text that could overflow, plus `min-w-0` on the flex parent.

---

## 12. Accessibility

- Always provide `aria-label` for icon-only buttons (`<Button aria-label="Delete asset">`).
- Focus rings come from the theme: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`.
- Status conveyed via color is also conveyed via icon (e.g., `AlertTriangle` for overdue).

---

## 13. Don't

- ❌ No purple, no gradients beyond the `kpi-tile` subtle background.
- ❌ No drop shadows heavier than `shadow-md`.
- ❌ No solid-color status badges — always soft `bg-{color}-100 text-{color}-800`.
- ❌ No multi-color buttons. Primary = green, Accent = orange. Pick one.
- ❌ No full-width hero images. This is an ops console, not a marketing site.
- ❌ No emojis in UI text.

---

## 14. Quick checklist when building a new page

1. `<PageHeader eyebrow title icon description actions />` at top
2. KPI grid (responsive `grid-cols-2 sm:grid-cols-3 md:grid-cols-5`)
3. Filter bar (search + result count) if it's a list
4. Main content — card grid OR table-in-card
5. Dialogs for create/edit, AlertDialog for delete
6. Mono eyebrow + bold value pattern in every section header
7. Verify at 375px width

When in doubt, copy a pattern from sections 6 and 11.
