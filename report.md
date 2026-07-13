# Pre-Production Debug Report (Sthira EV Rental)

## 1. Frontend UI/UX Debugger Findings

### Hardcoded colors breaking Dark Mode
**In `Styles.html`:**
* **Disabled Primary Buttons**: `.btn-primary[disabled]` and `.btn-primary.is-disabled` use a hardcoded light gray/beige (`background:#CDC6B6; color:#8E877A;`). There is no dark mode override, meaning disabled buttons will be glaringly bright in a dark theme.
* **Form Placeholders**: `.field::placeholder` uses `#B6AE9D`. It lacks an override, making placeholders look bright against dark inputs.
* **Toggle Boxes**: `.toggle .box` uses `border: 2px solid #C9C0AE;` without a dark mode override.
* **Section Numbers**: `.num` uses `color: #B6AE9D;` with no dark mode override.

**In `Admin.html`:**
* **Summary Totals**: `.summary .sr.total` uses a hardcoded bright line `border-top: 1px solid #E4DCCC;` that remains visible and bright in dark mode.
* **Large Ghost Buttons**: `.btn-ghost-lg` uses `border: 1px solid #DDD5C5;`. In dark mode, this creates a bright, visible gray box around the button.
* **Login PIN Dots**: `.pin-dots span` uses `border: 2px solid #CFC7B6;`, remaining a bright beige/gray border in the dark mode login view.
* **Keypad Tap State**: `.key:active` uses `background: #F3EEE3;`. Tapping keys in dark mode causes a harsh, bright flash.

### Unhandled edge cases in the UI
* **Empty Terms State Trap (`RiderJS.html`)**: If `getTermsSections()` fails to load, `SECTIONS` remains an empty array `[]`. The `allTermsAccepted()` function requires `SECTIONS.length > 0` to pass, meaning the form becomes permanently un-submittable. The user is trapped without a retry button or clear error state.
* **Long Text Overflow on Desktop (`Admin.html`)**: 
  * The `.bk-row .bk-name .nm` text truncation rule (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`) is applied for mobile (`max-width:640px`) but missing on desktop. A very long rider name can break the row layout.
  * The `#topTitle` lacks overflow protection. A sufficiently long view title could wrap and unpredictably increase the sticky topbar's height.

### Mobile responsiveness issues
* **Modal Action Buttons (`Admin.html`)**: The modal footer (`.bk-foot`) uses `flex-wrap: wrap;`. For `@media(max-width:560px)`, the primary action (`.pri`) expands (`flex: 1 1 auto`). However, multiple `.sec` secondary action buttons lack shrink/grow flexibility, which can cause them to clumsily wrap onto multiple narrow rows or crowd out completely on devices under 360px wide.

### Client-side JS errors or potential crashes
* **Analytics Object Assumption (`AdminJS.html`)**: If a user switches to the `reports` tab and `C.analytics` hasn't been safely initialized during a partial load or offline hydration, accessing `C.analytics[A.period]` will throw a `Cannot read properties of undefined` error and crash the rendering of the reports view.
* **Checkout Date Overrides (`RiderJS.html`)**: `updatePrice()` lacks the `co < ci` validation present in the `submit()` function. If the user overrides the DOM `min` date constraint, it can technically pass an invalid negative date difference to the preview. (Fortunately, `SharedCalc.html` floors the result at `1` day, but the frontend still misses the visual validation warning).

### Inconsistencies in the UI components
* **Ghost Button Styles**: `.btn-ghost` is completely borderless (consistent with the design system intent), but `.btn-ghost-lg` defines a `1px solid #DDD5C5` border.
* **Disabled Button Syntax**: The CSS defines both `.btn-primary[disabled]` and `.btn-primary.is-disabled`. JS scripts arbitrarily mix using standard `el.disabled = true` and `el.classList.add('is-disabled')`. 
* **Card Border Radii**: Standard cards use `border-radius: var(--radius);` (22px), but `.how .step` cards in the Rider form inconsistently use `var(--radius-md);` (16px).

---

## 2. Backend Logic Debugger Findings
### 1. Concurrency Issues & Race Conditions

**A. Ledger Corruption due to missing `LockService`**
- **Files:** `Ledger.gs` (`recordRefund`, `recordRelieve`, `_decideHandover`)
- **Issue:** The standalone actions `recordRefund`, `recordRelieve`, and Handover approvals call `_appendLedgerRows` **without** acquiring the `LockService`. 
- **Impact:** `_appendLedgerRows` calculates the insertion row using `sheet.getLastRow() + 1`. Without a lock, simultaneous operations will fetch the exact same last row. The slower network request will overwrite the ledger rows written by the faster one, causing silent financial data loss.

**B. Unsafe ID Generation during Vehicle & Cottage Addition**
- **Files:** `Vehicles.gs` (`addVehicle`) and `Cottages.gs` (`addCottage`)
- **Issue:** Neither function acquires a lock before finding the next ID and appending a row. `addCottage` generates its new ID using `'CT' + String(data.length)`.
- **Impact:** If two managers add a vehicle or cottage at the exact same time, they will calculate the exact same ID (e.g., `EV016` or `CT012`) and both will be inserted. In cottages, deleted rows lead to duplicated IDs.

### 2. Google Apps Script Quota Limits & Performance Bottlenecks

**A. `appendRow()` inside Loops while Locked**
- **File:** `Returns.gs` (`processReturn`)
- **Issue:** The script loops over the `returnData.deductions` array and calls `deductSheet.appendRow()` inside the loop for each deduction.
- **Impact:** Executing slow `appendRow()` calls inside a loop while holding the global 10-second `LockService` means a return with multiple deductions will stall the entire booking desk for other operators, increasing the risk of timeouts. Should use a single batched `.setValues()` call.

**B. Multiple individual `setValue()` calls**
- **Files:** `Bookings.gs` (`editBooking`) and `Vehicles.gs` (`updateVehicle`)
- **Issue:** To update row fields, the scripts execute multiple sequential `sheet.getRange(...).setValue(...)` API calls.
- **Impact:** Sequential `.setValue()` calls are an anti-pattern that heavily degrades performance and counts rapidly against API quotas.

### 3. Logical Flaws and Edge Cases

**A. Discrepancy in "Available" Vehicle Definitions**
- **File:** `Vehicles.gs` (`getPublicAvailableCount` vs Admin UI)
- **Issue:** The public availability count used by the Rider Form filters strictly using `v.status === 'Available'`. However, `confirmBooking` correctly recognizes that `Charging` vehicles are also bookable.
- **Impact:** The public Rider Form underreports available vehicles. Guests will see 0 availability and be blocked from booking even if multiple vehicles are charging and ready.

**B. Trusting Client Timestamps (Late Fee Evasion Risk)**
- **File:** `Returns.gs` (`processReturn`)
- **Issue:** `const actualReturn = returnData.actualReturn ? new Date(returnData.actualReturn) : new Date();`
- **Impact:** The backend trusts the `actualReturn` timestamp sent in the client payload without server-side boundaries. An operator can send a past timestamp for `actualReturn`, easily evading late fees without generating an audit flag.

**C. Per-Operator Profit Distortion on Cross-Operator Returns**
- **File:** `Cash.gs` (`getOperatorMoney`)
- **Issue:** `profitCash` is calculated as `cashIn - depHeldCash - cashRefund`. `cashIn` belongs to the operator who *booked* the vehicle, while `cashRefund` penalty belongs to the operator who *returned* it.
- **Impact:** If Operator A checks out the vehicle and Operator B returns it with a withheld late fee, Operator A's stats show inflated profit, and Operator B's stats can show negative profit, distorting individual performance reporting.
