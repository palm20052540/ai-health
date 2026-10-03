# Training · Muscle Lens — Design QA

**Source visual truth**

- `C:\Users\ASUS\Documents\AI Health\design\concepts\training-redesign-muscle-lens.png`
- Source pixels: 853 × 1844.
- Normalized to 390 × 844 CSS pixels for comparison (same aspect ratio; source density ≈ 2.187×).

**Rendered implementation**

- URL: `http://127.0.0.1:5173/?tab=Training`
- Screenshot: `C:\Users\ASUS\Documents\AI Health\design\qa\training-muscle-lens-final.png`
- Comparison board: `C:\Users\ASUS\Documents\AI Health\design\qa\comparison-final.png`
- Implementation pixels: 390 × 844 at deviceScaleFactor 1.
- Browser state: mobile viewport 390 × 844, light theme, Training tab, Chest selected, 30D selected, sample-data fallback.
- Browser-rendered viewport metrics: innerWidth 390, innerHeight 844, scrollWidth 390, scrollHeight 844.

## Findings

- No actionable P0, P1, or P2 differences remain.
- [P3] The source includes a decorative calendar outline beside the first timeline entry; the implementation keeps the blue timeline marker but omits the extra icon. The timeline remains clear and usable, so this is optional polish.
- [P3] The source shows a concrete last-sync timestamp, while the local implementation correctly shows `Last synced: —` plus `Sample data` because no live API configuration is present. This is an intentional state/content difference, not visual drift.

## Required fidelity surfaces

- Fonts and typography: Both use the system/Inter-style sans stack with a bold display hierarchy. Training title, insight headline, section headings, metric values, metadata, and blue status text preserve the source hierarchy and wrapping at 390 px.
- Spacing and layout rhythm: Header, title, insight, progress controls, five-column summary, chart, exercise rows, timeline, and fixed navigation align to the source composition. The final screen fits exactly within the 390 × 844 viewport without horizontal or vertical overflow.
- Colors and visual tokens: White surface, near-black ink, muted slate metadata, primary blue, pale blue controls, and pale orange insight surface match the selected direction. Selected pills, chart, links, and navigation use the same semantic blue treatment.
- Image and asset fidelity: The source has no photography or hero imagery. Functional icons remain crisp vector icons; the chart and sparklines render as resolution-independent SVG at the tested density.
- Copy and content: Core fixed copy matches the source (`Training`, `Progress by muscle`, `Chest exercises`, `Workout timeline`, `See all`). Dynamic sample-state copy is coherent and exposes that the data is not live.
- Accessibility and behavior: Pills are semantic tabs, range controls and rows are buttons, focus-visible styles are present, interactive sheets have explicit close buttons, and the layout does not clip at 390 px.

## Full-view comparison evidence

The normalized side-by-side board verifies these visible points:

1. Brand/header and Training title begin at the same vertical position.
2. Orange AI insight has the same hierarchy, width, rounded shape, and two-line headline.
3. Progress heading, 30D/6M/1Y control, and five muscle pills appear in the same order and density.
4. Five summary metrics use matching vertical dividers and blue strength emphasis.
5. Volume chart includes axis labels, grid lines, blue area/line treatment, range labels, and period comparison.
6. Three exercise rows expose load, e1RM, mini trend, change, PR/status, chevron, and `See all`.
7. Workout timeline, top-set/PR highlights, and fixed three-tab navigation occupy the same lower-screen region.

Focused region comparisons were not necessary after the final pass because all type, icons, chart labels, row metadata, and navigation labels remain legible on the 780 × 844 normalized comparison board. The source and implementation were also opened individually at original resolution for typography and small-copy inspection.

## Comparison history

### Pass 1 — blocked

- [P1] The original implementation was 1503 CSS px tall at a 390 × 844 viewport, so exercise details and the workout timeline were pushed below the fold.
- [P2] Header, insight, range control, summary, chart, and rows were materially less dense than the selected concept.
- Fixes: added a Training-only compact layout, reduced header/insight/section spacing, made the overview timeline show the latest workout while `See all` retains full history, reduced bottom-navigation height, and removed the primary-view next-session card.

### Pass 2 — blocked

- [P2] Chart labeling did not match the concept: it lacked y-axis values, muscle-specific volume wording, and explicit comparison context.
- [P2] The header remained about 25–30 px lower than the source, which clipped the final timeline highlight behind navigation.
- Fixes: aligned header/title/insight vertical rhythm, added y-axis labels and muscle-specific chart copy, added `Strength (e1RM)`, and moved next-session review into the timeline sheet so it remains available as a secondary action.

### Final pass — passed

- Post-fix evidence: `comparison-final.png` shows the same above-the-fold information architecture and matched section landmarks at 390 × 844.
- Native implementation metrics are exactly 390 × 844 with no page overflow.
- No actionable P0/P1/P2 findings remain.

## Primary interactions tested

- Selected Back muscle and verified summary/exercise content updates.
- Selected 6M and verified range state and chart labels update.
- Opened exercise `See all` sheet.
- Opened workout timeline `See all` sheet.
- Opened a workout debrief.
- Opened the secondary next-session recommendation from the timeline sheet without performing any Hevy mutation.
- Checked browser console: no errors; only Vite connection/HMR messages and the React DevTools informational message.

## Implementation checklist

- [x] Match selected Option 1 visual hierarchy and mobile density.
- [x] Keep muscle and range selections functional.
- [x] Use `See all` wording for exercises and workout history.
- [x] Keep workout history and top-set/PR detail accessible.
- [x] Preserve next-session guidance as a secondary flow.
- [x] Pass production build, type checks, dependency audit, browser interaction checks, and visual comparison.

final result: passed
