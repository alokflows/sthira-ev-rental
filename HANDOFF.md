# Handoff for Next Agent (Sthira EV Rental)

**CRITICAL RULES: BE SURGICAL, DO NOT MESS UP, BE PERFECT.** 
Do not assume things. Do not break existing flows. Read the context and the codebase carefully before making any edits.
Check `progress.md` to see the full history of what has been accomplished so far.

## 1. Click-to-Call in Booking Details
* **The Goal**: In all modal views that display booking details (specifically `openBookingDetails` and anywhere else mobile numbers are displayed), the mobile number must be a clickable button.
* **The Implementation**: When the admin clicks the mobile number, it should instantly open the phone's native dialer. Use `href="tel:..."`. Make it look like a clean, clickable button/link (perhaps similar to how it was done in `openYardBookingDetails`).

## 2. Restore Total Vehicle Count Subtitle
* **The Bug**: During the recent Fleet UI redesign where the triage chips were added, the "Total Vehicles" metric was accidentally removed/lost from the Fleet view. 
* **The Fix**: The user specifically wants the total vehicle number placed right under the main "Fleet" heading on the page, acting as a clean subtitle.
* **Styling Rules**: Do **not** use the word "Total", and do **not** use brackets `( )`. Just cleanly display the number in the same size/font aesthetic beneath the title, so they immediately have context of the total fleet size.

## 3. Fleet Action Buttons Alignment
* **The Bug**: The newly added action buttons on the Fleet cards (Location, Charge) are currently left-aligned (`justify-content:flex-start`).
* **The Fix**: The user wants them perfectly centered in the middle of the card so that they match the exact uniformity and layout style of the Yard cards. Update the `btns` wrapper div in `renderFleet` to use `justify-content:center;`.

## 4. Mobile Bottom Nav "Fleet" Icon Bug
* **The Bug**: On Android mobile views, the Fleet logo in the bottom navigation bar (`<nav class="bottomnav">` in `Admin.html`) looks "chopped off" or slightly off-center/malformed.
* **The Fix**: Inspect the SVG used for the Fleet button (the one with two wheels and a line `path d="M8 17.5h8"`). Fix the `viewBox`, scaling, or replace the SVG entirely with a robust, centered, aesthetic icon that renders perfectly on mobile without getting clipped.

## 5. Dark Mode Bug: "Delete Scooter" Button
* **The Bug**: Inside the new Fleet card's "Manage Scooter" expandable popup, the red "Delete Scooter" button has a hard-coded white/light-red background (`background:#FEF2F2;`). When the user switches to Dark Mode, this hard-coded color blinds the user and breaks the dark aesthetic.
* **The Fix**: Remove the hard-coded hex colors (`#FEF2F2` / `#FCA5A5`) from the delete button's inline style in `openFleetVehicleDetails`. Use standard CSS variables (like `var(--terra-tint)` and `var(--terra)`) so that the background and border adapt perfectly when toggled to Dark Mode.

## 6. General Instructions
* Review `AdminJS.html` and `Admin.html` where these UI components live. 
* Test your changes mentally to ensure they do not break the new Expandable Modal pattern for Fleet cards. 
* Be perfect. Keep the codebase professional.
