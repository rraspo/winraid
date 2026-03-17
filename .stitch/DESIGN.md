# Design System Specification: High-End Desktop Utility

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Precision Architect."** 

While the user requires a system-native Windows experience, we are moving beyond the generic "utility" look. This system treats data management as an editorial craft. We replace rigid, spreadsheet-like grids with a sophisticated, layered environment that feels deep and immersive. By utilizing intentional white space, tonal shifts instead of borders, and high-contrast typographic scales, we transform a technical RAID management tool into a premium digital cockpit. 

The goal is a "Variable-Density" layout: high-density information where necessary (drive health, transfer speeds), surrounded by low-density, breathable surfaces that reduce cognitive load and provide an "executive" feel.

## 2. Colors
Our palette is rooted in professional stability, using deep blues and slate grays to convey reliability.

### Core Palette
- **Primary (`#004f96`):** The "Action Blue." Used for primary calls to action and critical system paths.
- **Secondary (`#515f74`):** The "Utility Slate." Reserved for secondary actions and meta-information.
- **Surface (`#f8f9ff`):** The "Canvas." A cooler, cleaner white that feels more "Windows" than a standard neutral white.

### The "No-Line" Rule
To achieve a high-end editorial feel, **1px solid borders for sectioning are strictly prohibited.** Do not use lines to separate the sidebar from the main content or to divide cards. Boundaries must be defined solely through background color shifts.
*   *Example:* A `surface-container-low` (`#eff4ff`) sidebar sitting adjacent to a `surface` (`#f8f9ff`) main content area.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. We use the surface tiers to create "nested" depth:
- **Level 1 (Base):** `surface`
- **Level 2 (Sections):** `surface-container-low`
- **Level 3 (Interactive Elements):** `surface-container`
- **Level 4 (High-Priority Overlays):** `surface-container-highest`

### The "Glass & Gradient" Rule
To break the "standard utility" mold, use **Glassmorphism** for floating elements (e.g., tooltips, popovers, or detached sidebars). Use a semi-transparent `surface-container-low` with a `backdrop-filter: blur(20px)`. 
Apply **Signature Textures**: CTAs should use a subtle linear gradient from `primary` (`#004f96`) to `primary-container` (`#0067c0`) at a 135-degree angle to provide a "jewel" polish.

## 3. Typography
We utilize **Inter** (as a high-end alternative to Segoe UI) to provide a modern, technical, yet readable foundation.

- **Display Scales (`display-lg` to `display-sm`):** Used sparingly for "Hero" stats, such as total array capacity (e.g., "48.2 TB"). These should have tight letter-spacing (-0.02em).
- **Headline & Title:** Used to anchor sections. `headline-sm` (`1.5rem`) is the standard for page headers, providing an authoritative editorial voice.
- **Body & Label:** Use `body-md` (`0.875rem`) for most data points to maintain a high information density without sacrificing legibility. Use `label-md` in all-caps with 0.05em tracking for category headers.

The hierarchy is built on **Contrast**: Pairing a large `headline-lg` title with a small, low-opacity `label-md` description creates a premium, intentional look that separates the app from generic system tools.

## 4. Elevation & Depth
In this system, depth is achieved through **Tonal Layering** rather than structural scaffolding.

### The Layering Principle
Shadows are a last resort. Instead, stack the surface tokens. Place a `surface-container-lowest` (`#ffffff`) card on a `surface-container-low` (`#eff4ff`) background. This creates a soft, natural lift that feels integrated into the OS.

### Ambient Shadows
When an element must "float" (like a context menu), use **Ambient Shadows**:
- **Blur:** 24px - 40px
- **Opacity:** 4% - 6%
- **Color:** Use a tinted version of `on-surface` (`#0b1c30`) to simulate natural light refraction rather than a "dirty" gray shadow.

### The "Ghost Border" Fallback
If an element lacks sufficient contrast against its background, use a **Ghost Border**: a 1px stroke using the `outline-variant` (`#c1c6d4`) at **15% opacity**. This provides a hint of a container without breaking the "No-Line" rule.

## 5. Components

### Buttons
- **Primary:** Gradient fill (`primary` to `primary-container`), `DEFAULT` (0.25rem) roundedness, white text.
- **Secondary:** `surface-container-high` fill with `on-secondary-container` text. No border.
- **States:** On hover, increase the brightness of the gradient by 5%. On press, shift to `primary-fixed-dim`.

### Input Fields
- **Styling:** Use `surface-container-low` as the background fill. 
- **Interaction:** Instead of a full border highlight on focus, use a 2px bottom-bar in `primary` color and a subtle "lift" by switching the background to `surface-container-lowest`.

### Chips (Status Indicators)
- **Synced:** Background `surface-container-lowest` with a `on-primary-fixed-variant` (green-tinted) text and a small 6px circular dot.
- **Active Transfer:** Background `surface-container-highest` (amber/warm tint) with a subtle pulse animation.

### Cards & Lists
- **The Divider Rule:** Strictly forbid the use of horizontal divider lines.
- **Separation:** Use `spacing-6` (1.3rem) of vertical white space or alternate row backgrounds using `surface` and `surface-container-low`.
- **RAID Drive Card:** A `surface-container-lowest` card with a `Ghost Border` and a subtle `surface-dim` shadow.

### Tooltips
- Use the **Glassmorphism** rule: `surface-container-low` (80% opacity) + 12px backdrop-blur. This ensures the tooltip feels like it is hovering "over" the system.

## 6. Do's and Don'ts

### Do:
- **Do** use `spacing-10` and `spacing-12` for major section padding to create "Executive Breathing Room."
- **Do** use `on-surface-variant` for secondary labels to create a clear visual hierarchy.
- **Do** utilize the `DEFAULT` (0.25rem) corner radius for most elements, but use `lg` (0.5rem) for large container groupings to soften the technical nature of the app.

### Don't:
- **Don't** use 100% black (`#000000`) for text. Always use `on-surface` (`#0b1c30`) to maintain the deep blue tonal integrity.
- **Don't** use standard "Drop Shadows." They look dated. Use the Ambient Shadow specifications.
- **Don't** use a border to separate the sidebar. Use the `surface-container-low` to `surface` transition.
- **Don't** use high-contrast "Success/Error" colors that clash with the slate palette. Use the defined `error` (`#ba1a1a`) and refined status tints.