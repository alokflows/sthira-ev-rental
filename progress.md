# Sthira EV Rental - Development Progress & Technical Audit

## Overview
This document serves as a strict technical manifest of recent architecture modifications, ensuring codebase integrity for peer-agent review (Claude) and regression testing. All changes were applied surgically without mutating underlying data structures, maintaining the Google Apps Script RPC boundary and caching layer (`C`).

## 1. PWA & Mobile Initialization (Admin.html)
* **Meta Tags & Favicon**: Injected Apple/iOS-specific meta tags (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`) and a custom embedded SVG favicon into `<head>`.
* **Viewport Handling**: Enforced `user-scalable=no` for strict mobile application layout behavior.
* **Sticky Topbar**: Modified `.topbar` to utilize `position: sticky; top: 0; z-index: 50` for native-like header pinning on mobile.
* **Theme Transition**: Added `transition: background 0.2s, color 0.2s` to `body` to resolve laggy dark mode paint events.

## 2. Yard Module - Role-Based Lockdown (AdminJS.html)
* **View Masking**: Updated `applyRoleNav()` to restrict the `Yard` role operator to only the `yard` view. `['overview','bookings','fleet','money','reports','settings']` are injected into the hidden array for Yard workers. The sidebar hamburger button (`#sideCollapse`) and bottom navigation (`.bottom-nav`) are entirely removed from their DOM tree visually via `display: none`.
* **Top Bar Dynamics**: Admin-level users (Managers) testing the Yard view retain full access to top bar buttons ("New Booking", "Alerts"). Only true `Yard` roles have these stripped from the header.

## 3. Yard Module - Triage & Alphanumeric Sorting (AdminJS.html)
* **State Management**: Introduced `A.yardSortAlpha` (boolean, default `false`) to track the current sorting predicate.
* **Grid Rendering (`renderYard`)**: Intercepted the `gridVehicles` array build. 
  * If `!A.yardSortAlpha`: Enforces strict Triage sorting (`Available` -> `Charging` -> `Maintenance` -> `Out`) using a predefined weight map. Within each tier, items sort alphanumerically by `v.label`.
  * If `A.yardSortAlpha`: Bypasses the weight map and enforces absolute alphanumeric sorting across all statuses.
* **UI Toggle**: Injected a grid/list toggle SVG button into the `.panel` header for `gridHtml`. Event delegation handles `yard-sort` data-actions.

## 4. Yard Module - Surgical "Out" Inspection (AdminJS.html)
* **Custom Modal (`openYardBookingDetails`)**: Decoupled Yard workers from the master booking modal (which exposes financial data).
* **Implementation**: Tapping "Guest details" on an `Out` status vehicle reads `v.activeBooking.bookingId`, maps it to `C.bookings`, and generates a clean, read-only overlay. 
* **Data Exposed**: Guest Name, Cottage, Check-in/Return dates, and a `tel:` anchored Mobile number for instant native dialing. Finances (`rent`, `deposit`, `refund`) are completely obscured.

## 5. Optimistic UI & Safety Gates (AdminJS.html)
* **Instant UI Reflow**: Updated `submitAddVehicle()` to inject a provisional vehicle object directly into `C.vehicles` with a temporary UUID (`'temp-'+Date.now()`) and trigger `renderFleet()` *before* the RPC resolves.
* **Safeguards**: Hardened `vehDelete()` with a native `confirm()` barrier before executing destructive server-side calls.

## 6. Persistent Session Layer (AdminJS.html)
* **Storage Migration**: Replaced volatile `sessionStorage` with persistent `localStorage` inside `saveSession()`, `readSession()`, and `clearSession()`.
* **Flow**: Valid tokens bypass `showLogin()` during `boot()`, passing immediately to `loadBootstrap()`. If the token fails server validation, the app silently purges `localStorage` and falls back to the PIN keypad. This guarantees a native-app retention feel while preserving strict auth invalidation protocols.

## Status
Codebase is stable. No backend `.gs` controllers were mutated, ensuring no schema regressions. Client-side state logic remains isolated in `AdminJS.html`.

## 7. Handover Workflow Upgrades (AdminJS.html)
* **Push Notifications**: Upgraded the `Notification` payload in `yardNotify()`. It now triggers a clean "New Booking: Bring out [Scooter Number]" style alert, explicitly hiding un-actionable guest details from the push body to keep the focus purely on the scooter task.
* **Notification Interaction**: Bound `n.onclick` to force `window.focus()` and dynamically invoke `gotoView('yard')` so tapping the OS notification instantly brings the Yard worker to the correct screen where they can then see the guest details.
* **Yard Task Cards (`yardTaskCard`)**: Rebuilt the "Bring out" task UI.
  * Resolved the scooter location from `C.vehicles` and embedded it as a native visual badge at the top right of the card.
  * Replaced the abbreviated first name with the full `riderName`.
  * Injected a direct, actionable `tel:` link with the guest's mobile number for instantaneous calling right from the task card.

## 8. Nav Bug & Fleet Analytics (AdminJS.html)
* **Navbar Reset Bug**: Fixed a bug in `applyRoleNav()` where logging out of a Yard account and logging into an Admin account failed to un-hide the `display: none` elements. The DOM now explicitly restores `display: ''` for Admins.
* **Total Vehicles Count**: 
  * **Fleet View**: Injected a new `<b style="color:var(--txt-1);">[Count]</b> total` metric into the top analytics ribbon of `renderFleet()`.
  * **Yard View**: Appended `<span style="font-size:12px;font-weight:500;color:var(--muted-2);">(Total: [Count])</span>` directly into the `<h2>Fleet</h2>` header for quick context without cluttering the UI.

## 9. Final Polish & Professional UX
* **Professional Login Branding**: Rewrote the login screen copy. Replaced the generic "calm desk" phrase with "Authorized Personnel Only / Sthira Fleet Management System" to convey strict professionalism.
* **Guest Form Polish**: Fixed a scrolling obstruction in the Guest Rider Form (`RiderForm.html`) by converting the light/dark theme toggle from `position: fixed` to `position: absolute`. It now scrolls out of the way natively. Re-instated `position: sticky` on the Admin dashboard topbar.
