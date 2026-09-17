---
version: alpha
name: Brex
slug: brex
source: "https://www.brex.com/"
extractedAt: "2026-05-22"
description: "Precise intelligent-finance system with Brex orange actions, tight Inter typography, white modular product cards, muted enterprise neutrals, and screenshot-led finance workflows."

colors:
  primary: "#FF5900"
  accent: "#FF5900"
  accentHover: "#E65000"
  accentPressed: "#CC4700"
  ink: "#15191E"
  body: "#33383F"
  muted: "#60646C"
  canvas: "#FCFCFD"
  surface: "#FFFFFF"
  surfaceAlt: "#F6F7F9"
  border: "#E6E8EB"
  borderStrong: "#C9CDD2"
  link: "#15191E"
  success: "#138A43"
  warning: "#B35C00"
  error: "#C92A2A"
  brex-orange: "#FF5900"
  soft-orange-surface: "#FFF3EC"
  navy-ink: "#15191E"
  graphite: "#33383F"
  logo-gray: "#A5A9B1"
  footerBg: "#15191E"
  developerBg: "#FAFAFA"
  on-primary: "#FFFFFF"
  on-dark: "#FCFCFD"

typography:
  display:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 72px
    fontWeight: 600
    lineHeight: 0.96
    letterSpacing: "-0.04em"
  hero:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 56px
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  headline-lg:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 40px
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.03em"
  title-lg:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.13
    letterSpacing: "-0.025em"
  title-md:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.21
    letterSpacing: "-0.02em"
  title-sm:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.28
    letterSpacing: "-0.015em"
  label:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "0.02em"
    textTransform: uppercase
  button:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.43
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  caption:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  legal:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  pricing-display:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.13
    letterSpacing: "-0.025em"
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.54
    letterSpacing: "0em"

rounded:
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  pill: 9999px

spacing:
  xs: 8px
  sm: 16px
  md: 24px
  lg: 32px
  xl: 80px
  section: 120px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 12px 20px
  button-primary-active:
    backgroundColor: "{colors.accentPressed}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 12px 20px
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 10px 12px
  button-link-arrow:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 0px 0px
  nav-shell:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    height: 72px
    padding: 0px 32px
  announcement-bar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-dark}"
    typography: "{typography.caption}"
    padding: 8px 16px
  hero-media:
    backgroundColor: "{colors.surfaceAlt}"
    rounded: "{rounded.lg}"
    overflow: hidden
  feature-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: 32px
    shadowHover: "0px 4px 16px rgba(0, 0, 0, 0.12)"
  editorial-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: 0px
  pricing-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border}"
    rounded: "{rounded.lg}"
    padding: 32px
  metric-panel:
    backgroundColor: "{colors.surfaceAlt}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: 32px
  product-screenshot-panel:
    backgroundColor: "{colors.surfaceAlt}"
    rounded: "{rounded.lg}"
    padding: 24px
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.borderStrong}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 12px 14px
  search-command:
    backgroundColor: "{colors.surfaceAlt}"
    textColor: "{colors.muted}"
    borderColor: "{colors.border}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
    padding: 8px 12px
  footer:
    backgroundColor: "{colors.footerBg}"
    textColor: "{colors.on-dark}"
    typography: "{typography.caption}"
    padding: 80px 32px
---

**Overview**

Brex presents itself as an intelligent finance operating system: confident, controlled, and fast rather than decorative or playful. Its marketing pages pair very large, tightly tracked Inter headlines with calm neutral surfaces and a sharp orange action system. The distinctiveness comes from the contrast between high-trust enterprise restraint and vivid moments of Brex orange used for primary CTAs, icons, hover states, and AI/control emphasis.

The brand has three visual modes. The marketing mode uses cinematic product imagery, logo strips, big section headlines, and modular white cards. The product-feature mode is more workflow-led, with screenshots, AI automation language, and repeated control/approval modules. The developer/content mode is plainer and documentation-oriented, using dense navigation, command search, monospace code, and smaller type while still carrying the Brex logo and restrained neutral palette.

Key Characteristics:

- Tight Inter typography with negative tracking on almost every marketing text level.
- Orange is concentrated in action and intelligence moments, not washed across backgrounds.
- White cards on pale neutral canvases create hierarchy with subtle borders and hover shadows.
- Product screenshots are hero assets, usually clipped to 12px radii and allowed to carry detail.
- Navigation is sober and utility-first, with a black announcement bar above a white nav shell.
- Rounded corners are controlled: 6px for editorial media, 8px for inputs, 12px for cards and product panels.
- Copy is direct and operational: speed, control, AI automation, global spend, compliance.

**Colors**

Primary & Action:

`{colors.primary}` is Brex orange, the brand's strongest recognition color. Use it for the primary CTA, selected icon treatments, active states, and small moments that indicate motion, intelligence, or spend action.

`{colors.accentHover}` and `{colors.accentPressed}` are darker orange action states. They should appear only on interactive states so the base orange remains crisp and not overused.

`{colors.link}` is usually the ink color rather than a blue convention. Brex links feel editorial and product-native, often supported by an arrow rather than underlined color contrast.

Surfaces:

`{colors.canvas}` is the near-white page base. It keeps the interface bright without looking sterile and supports long-form marketing sections.

`{colors.surface}` is the white module surface for cards, pricing plans, navigation, and form fields. It is the default container color when content needs to feel operational and trustworthy.

`{colors.surfaceAlt}` is the pale neutral band used behind product screenshots, metrics, and grouped modules. It gives sections a quiet rhythm without turning them into saturated brand blocks.

`{colors.soft-orange-surface}` is an occasional supportive orange tint. Use it sparingly for AI badges or inline emphasis, never as a full-page wash.

Neutrals & Text:

`{colors.ink}` is the core headline and navigation color. It should carry nearly all high-priority text.

`{colors.body}` is for denser paragraphs and product descriptions when pure ink would be too loud.

`{colors.muted}` is for captions, secondary body copy, legal notes, metadata, and supporting text inside cards.

`{colors.border}` and `{colors.borderStrong}` define quiet structure. Borders should be light and functional rather than decorative.

Semantic:

`{colors.success}` fits policy compliance, completed approvals, and healthy financial status.

`{colors.warning}` fits risk, pending review, budget caution, or items that need finance attention.

`{colors.error}` fits failed payments, blocked expenses, missing receipts, and rule violations.

Brand-specific signatures:

`{colors.brex-orange}` is the signature orange repeated for primary actions and icon hover fills. It is visually distinctive because it is surrounded by restrained neutrals.

`{colors.navy-ink}` and `{colors.footerBg}` create the dark footer and high-contrast announcement moments.

`{colors.logo-gray}` appears in trust-logo strips and quiet brand proof. It lets customer logos function as credibility texture instead of competing with the main message.

**Typography**

Brex uses Inter as the dominant type family, implemented as a variable font with font-feature settings and tight tracking. The type voice is modern, compact, and executive; it avoids ornamental display faces and relies on scale, weight, and spacing discipline.

| Level | Size | Weight | Line Height | Letter Spacing | Use |
|---|---:|---:|---:|---:|---|
| `{typography.display}` | 72px | 600 | 0.96 | -0.04em | Oversized homepage or campaign statements |
| `{typography.hero}` | 56px | 600 | 1.02 | -0.035em | Main page hero headlines |
| `{typography.headline-lg}` | 40px | 600 | 1.08 | -0.03em | Section headlines |
| `{typography.title-lg}` | 32px | 600 | 1.13 | -0.025em | Pricing amounts, major module titles |
| `{typography.title-md}` | 24px | 600 | 1.21 | -0.02em | Feature-card titles and article cards |
| `{typography.title-sm}` | 18px | 600 | 1.28 | -0.015em | Compact panels and submodules |
| `{typography.label}` | 12px | 600 | 1.33 | 0.02em | Eyebrows and all-caps trust labels |
| `{typography.button}` | 14px | 600 | 1.43 | -0.01em | Buttons, nav actions, inline CTAs |
| `{typography.body}` | 16px | 400 | 1.5 | -0.02em | Paragraph copy and product explanations |
| `{typography.caption}` | 14px | 400 | 1.5 | -0.02em | Metadata, captions, card descriptions |
| `{typography.legal}` | 12px | 400 | 1.5 | -0.01em | Footnotes and regulatory copy |
| `{typography.pricing-display}` | 32px | 600 | 1.13 | -0.025em | Plan prices and custom pricing labels |
| `{typography.code}` | 13px | 400 | 1.54 | 0em | Developer portal examples and API snippets |

Principles:

- Track marketing text tighter as it gets larger; Brex headlines should feel compressed and precise.
- Keep weights mostly 400 and 600. Avoid 700+ unless a product UI requires a compact status label.
- Use uppercase labels only for short category or trust statements, never for long paragraphs.
- Let product screenshots and data modules do visual work; type should stay direct and uncluttered.
- Use monospace only in developer or API contexts, paired with the same neutral surface system.

**Layout**

The spacing rhythm is based on 8px increments, with common internal gaps of `{spacing.xs}`, `{spacing.sm}`, `{spacing.md}`, and `{spacing.lg}`. Marketing sections use generous vertical padding around `{spacing.section}`, while content rows often constrain text and media inside a wide centered max-width near 1200-1280px. Cards and product screenshot panels commonly use 32px internal padding.

Desktop layouts favor strong two-column or three-column compositions: copy beside product screenshots, card grids for product categories, and plan columns for pricing. Mobile collapses into single-column stacks with the image following or preceding copy depending on message priority. Logo strips become compact horizontal or wrapped proof bands.

Whitespace is controlled, not airy for its own sake. Brex pages leave enough room for enterprise confidence, but sections remain dense with proof points, product modules, and operational benefits. Avoid huge empty editorial spaces that detach the brand from financial utility.

**Elevation & Depth**

Brex is mostly flat. Hierarchy comes from section bands, card boundaries, typography scale, and high-quality product imagery rather than heavy elevation.

The observed hover shadow for feature cards is `0px 4px 16px rgba(0, 0, 0, 0.12)`. Use this only for interactive cards or product tiles. Static pricing and content cards should depend on `{colors.border}`, `{colors.surface}`, and `{rounded.lg}`.

Depth philosophy: make modules feel tangible enough to click, but never glossy. Shadows should be soft, low, and rare; orange hover fills and icon state changes are more brand-accurate than dramatic elevation.

**Components**

Buttons:

`{components.button-primary}` is a pill-shaped orange CTA used for "Get started", "Open an account", and similar conversion actions. It should be visually compact, high contrast, and surrounded by neutral space.

`{components.button-primary-active}` darkens the orange for pressed or active states. Do not introduce new hue shifts; keep the action family tightly tied to `{colors.primary}`.

`{components.button-secondary}` supports "See a demo" and contact-style actions. It should read as calm and secondary through white fill, ink text, and a quiet border.

`{components.button-ghost}` is for navigation and utility actions. It should remain visually lightweight and avoid stealing attention from the primary CTA.

`{components.button-link-arrow}` is a signature Brex marketing link pattern. Use ink text with an arrow icon to signal exploration inside cards and feature sections.

Cards & Containers:

`{components.hero-media}` frames the first-view product or campaign image. It should be large, screenshot-led, clipped to `{rounded.lg}`, and integrated into the composition rather than treated as decoration.

`{components.feature-card}` is a white product module with 32px padding, a 12px radius, and an optional hover shadow. The internal rhythm is usually title, concise description, icon or image, and sometimes a link-arrow CTA.

`{components.editorial-card}` is used for insight or article modules. Its media often uses `{rounded.sm}`, with text stacked below in a tight 8px rhythm.

`{components.metric-panel}` presents quantified proof such as hours saved, yield, or compliance rates. It should be clean, large-number-first, and avoid chart junk.

`{components.product-screenshot-panel}` holds screenshots of budgets, expenses, approvals, inboxes, or accounting workflows. Keep screenshots legible and use neutral panel backgrounds instead of decorative gradients.

Inputs & Forms:

`{components.input-field}` uses a white fill, 8px radius, and strong enough border to be visible on pale surfaces. Labels should use `{typography.caption}` or `{typography.label}` depending on density.

`{components.search-command}` is especially relevant to developer pages, where "Search Ctrl+K" appears as a compact command affordance. It should feel like a utility control, not a marketing CTA.

Navigation:

`{components.announcement-bar}` is a dark, narrow top strip for launch or release messaging. It should use concise copy and a single inline arrow.

`{components.nav-shell}` is white, low-noise, and product-catalog oriented. It includes dropdown categories, resource links, sign-in, demo, and a primary CTA.

`{components.footer}` switches to the dark ink background. Footer text should be smaller, systematic, and organized into practical link columns.

Pricing:

`{components.pricing-card}` uses the same modular white-card language as product pages. Plans are differentiated by content and CTA, not by excessive color blocking.

Pricing amounts should use `{typography.pricing-display}` and direct language such as "$0 user/month", "$12 user/month", or "Custom pricing". Keep plan comparison tables dense and border-led.

Signature Components:

Brex's trust-logo strip uses grayscale customer marks on a quiet background. The logos should feel like proof texture, not a colorful sponsor wall.

The AI/control module is a recurring brand pattern: a concise claim about controls, approvals, receipts, or compliance paired with a product screenshot. Use `{colors.primary}` for the active or intelligent element within the module.

The finance-metric trio is another signature pattern. Pair a short category label, a large metric, and a one-sentence business outcome in a neutral panel.

The developer portal pattern is documentation-first: left navigation, top API tabs, command search, markdown-copy utility, and dense content tables. It should stay quieter than marketing pages.

**Do's and Don'ts**

Do:

- Use `{colors.primary}` for the one dominant action per viewport.
- Set large headlines in `{typography.hero}` or `{typography.display}` with tight negative tracking.
- Build feature surfaces with `{components.feature-card}` and 32px internal padding.
- Clip product imagery with `{rounded.lg}` for screenshots and `{rounded.sm}` for editorial thumbnails.
- Use `{components.button-link-arrow}` for secondary exploration instead of blue links.
- Keep proof logos in `{colors.logo-gray}` or similarly muted treatments.
- Use `{colors.surfaceAlt}` to group product modules without making them feel promotional.
- Preserve the black announcement bar plus white navigation contrast on marketing pages.

Don't:

- Do not flood sections with orange backgrounds; Brex orange is an action signal, not the page canvas.
- Do not use blue SaaS link styling where `{colors.link}` and arrow CTAs are more accurate.
- Do not add glassmorphism, glossy gradients, or heavy drop shadows.
- Do not round every element into large soft blobs; most containers stop at `{rounded.lg}`.
- Do not use playful illustration as the primary product proof; use screenshots and real workflow imagery.
- Do not loosen headline tracking to 0em at large sizes; the compressed Inter voice is essential.
- Do not make pricing cards visually unrelated to feature cards; they share the same modular system.
- Do not hide finance details behind oversized marketing cards; Brex layouts should remain operational.

**Responsive Behavior**

| Breakpoint | Width | Behavior |
|---|---:|---|
| mobile-sm | 375px | Single-column stack, compressed nav, 24px page gutters |
| mobile | 767px | Mobile logo size increases slightly, cards stack, hero media reorders |
| tablet | 1023px | Two-column layouts begin collapsing, gutters around 32px |
| desktop | 1024px | Full nav, multi-column card grids, larger media panels |
| wide | 1280px | Centered max-width content, generous section rhythm |
| max | 1440px | Preserve readable line lengths; do not stretch text columns |

Touch targets should be at least 44px high for buttons, nav toggles, dropdown triggers, search controls, and pricing CTAs. Even compact link-arrow actions need enough surrounding space to tap comfortably.

Collapsing strategy:

- Collapse nav into a mobile menu while preserving sign-in and primary CTA access.
- Stack pricing cards vertically before comparison tables become cramped.
- Let product screenshots move below copy on narrow screens unless the screenshot is the main hero proof.
- Convert multi-card grids into one-column stacks with the same `{spacing.md}` gap.
- Keep logo strips either horizontally scrollable or wrapped with muted marks and consistent spacing.

Image behavior:

Product images should use `object-fit: cover` or `contain` depending on whether the asset is scenic or UI-specific. Screenshots must remain legible; avoid cropping UI details that prove automation, approvals, or finance controls.

**Iteration Guide**

1. Check that the first viewport has one clear `{components.button-primary}` and that no competing orange blocks dilute it.
2. Verify all major headlines use Inter-like proportions, weight 600, and negative tracking matching `{typography.hero}` or `{typography.headline-lg}`.
3. Inspect cards for `{rounded.lg}`, white surfaces, and 32px padding; reduce radius or padding only for editorial modules.
4. Confirm product screenshots are doing real work: budgets, expenses, cards, receipts, approvals, accounting, or API workflows should be visible.
5. Audit links: replace generic blue links with `{components.button-link-arrow}` unless the context is developer documentation.
6. Test hover states on cards and icons; use the observed soft shadow and orange icon fill rather than new visual effects.
7. Review pricing layouts for plan clarity, dense comparison behavior, and consistency with `{components.pricing-card}`.
8. Run a mobile pass at 375px and 767px to ensure text does not overlap imagery, cards stack cleanly, and CTAs remain tappable.

**Known Gaps**

Observed directly: homepage structure, top announcement and navigation content, product/expense page messaging, pricing plan structure, developer portal navigation, visible CSS snippets for Inter, color values such as `{colors.ink}`, `{colors.muted}`, `{colors.surface}`, `{colors.primary}`, card radius, editorial media radius, hover shadow, and responsive breakpoints at 766px and 1023px.

Derived conservatively: full type scale, semantic colors, input details, pricing-card borders, and several spacing tokens. These are inferred from repeated CSS fragments, page structure, and standard Brex component behavior rather than a public design-token file.

Uncertain: exact production token names, every brand color used inside imagery, exact nav dropdown dimensions, form validation styling, and developer portal CSS variables. If a future extraction can access the bundled CSS and rendered screenshots, refine component measurements, full breakpoint rules, and any dark-mode or app-dashboard-specific tokens.
