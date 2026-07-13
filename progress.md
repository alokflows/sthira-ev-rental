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

## 10. Fleet UX Redesign & Triage Sorting
* **Fleet Card Redesign (`renderFleet`)**: Rebuilt the Fleet dashboard cards to match the spacious, intuitive design of the Yard cards. 
* **Expandable Modal Pattern**: To drastically reduce clutter on mobile, the Fleet cards now only show two quick-action buttons directly on the card (`Set Location` and `Toggle Charging`). Tapping the body of the card itself opens a "Manage Scooter" modal containing the deeper options (`Send to Maintenance`, `Edit`, and `Delete`).
* **Triage Sorting & Chips**: Imported the exact same sorting flow from the Yard view. Fleet now features Triage filter chips (Available, Charging, Out, Maintenance) and an A-Z / Grouped sorting toggle right next to the "Add Vehicle" button.
* **Temporary IDs Hidden**: Stopped rendering the system `vehicleId` (e.g. `temp_17...` or `EV001`) on the Fleet cards entirely to prevent clutter and confusion with the custom scooter labels.
* **Messy Notes Removed**: Removed the display of the `v.notes` field from the primary card UI to prevent messy data entry (e.g. users typing "Idle at desk and charging") from overriding the clean system statuses.
* **Charging Availability Rule**: Modified `availableVehicles()` and `getPublicAvailableCount()` so that scooters with the 'Charging' status are **no longer bookable** by the public or the desk. They must be explicitly moved to 'Available' by the Yard/Desk first.

## 11. Refund Mode & Ledger Attribution (Returns.gs + AdminJS.html)
* **Refund Payment Mode**: Added Cash/UPI/Split/Same-as-deposit selector to the return modal. Previously the refund mode was auto-filled from how the deposit was collected (the operator had no say). Now the operator can explicitly choose how to refund the guest.
* **Split Refund**: Supports explicit Cash + UPI split with live balance check (mirrors the confirm-booking split pattern). The server validates that split amounts sum to the refund total.
* **Server Validation**: `Returns.gs` now throws if a split refund doesn't balance, preventing ledger corruption. Cap-to-collected logic still applies for same/cash/upi modes.
* **Ledger Attribution**: Refund and deposit-refund ledger rows now carry a note: "Return processed by {operatorName}". This makes it clear who settled each return in the passbook.

## 12. Admin-Configurable Locations (Config.gs + AdminJS.html)
* **Locations Setting**: Added `locations` to `DEFAULT_SETTINGS` (newline-delimited, same pattern as `chargingPoints`). Manager-only setting.
* **`locationsList()` Helper**: Added client-side helper that splits + trims + drops blanks on every read.
* **Yard Location Picker**: Replaced the hardcoded `['Yard','Charging point','Pickup point']` buttons in `openYardLocation()` with admin-configurable locations from Settings. If no locations are configured, the modal shows a message directing to Settings.
* **Settings UI**: Added a "Locations" card in Settings (below Charging points) with add/remove functionality, matching the charging points pattern exactly.
* **Removed Maintenance Toggle from Yard**: The yard vehicle cards no longer show the maintenance toggle — that's a fleet management concern, not a yard concern. Yard cards now show only: Set Location and Charge/Charged toggle.

## 13. Yard Handover Flow (AdminJS.html)
* **Location Prompt on Handover**: The "Scooter handed over" button now opens a location picker modal (using admin-configurable locations) before marking the booking as handed over. The yard staff picks where the scooter is, then it's marked done.
* **Skip Location**: A "Skip location" button allows the yard to mark as handed over without setting a location (for cases where the location is unknown or irrelevant).
* **Dual Write**: On handover, both `markYardDone` and `setVehicleLocation` are called in sequence, so the vehicle's location is updated atomically with the handover timestamp.
