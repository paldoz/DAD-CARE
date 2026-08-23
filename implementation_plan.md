# Business Overview Accuracy Fix - Implementation Plan

## Problem Analysis

The core issue causing discrepancies between the Maqal History page and the Business Overview is a **data model disconnect**:
1. **Business Overview** defines Maqals dynamically by pairing `DailyBook` dates in SQL (assigning `mq_num`).
2. **History Page (`ledgerHelpers.ts`)** defines Maqals by grouping `PRODUCT` Ledger rows chronologically (15-sec intervals) and assigns a local `displayMaqalId` counter per customer. 
3. **Payments** are currently assigned to Maqals via waterfall logic if untagged, which violates the strict ownership rule.

## Proposed Changes

To establish **ONE source of truth** and explicit Maqal ownership, we must migrate `maqal_id` to be a permanent, explicit relationship in the database for all `PRODUCT` rows, and completely eliminate "guessing" (waterfall) logic.

### 1. Database Backup & Reversibility
- **Backup**: We will perform a complete database dump via `pg_dump` before touching any production records.
- **Audit Log**: The migration script will generate a JSON audit export (`maqal_migration_audit.json`) containing every Ledger row ID being modified, its old `maqal_id`, the newly assigned `maqal_id`, and the evidence (the `DailyBook` date pair that justified it).

### 2. Data Model Migration (Strict Evidence Only)
- Create a migration script `scripts/assign-maqal-ids.ts`.
- It will read the definitive `DailyBook` date pairs.
- It will assign a permanent `maqal_id` to `PRODUCT` rows in the `Ledger` table ONLY based on exact date matching (`reference_date`).
- **No Guessing**: If a historical `PAYMENT` row currently has `maqal_id = NULL`, it will REMAIN `NULL`. We will not use the waterfall logic to guess its owner. It must be manually linked by the business if they want it to count.

### 3. Reconciliation & Verification Phase
- **Before** deleting the old waterfall logic, we will write a reconciliation script `scripts/verify-maqals.ts`.
- This script will compare the output of the old waterfall logic vs the new strict `maqal_id` logic for MQ#18, MQ#19, MQ#20, and several older Maqals.
- We will verify that the new strict logic perfectly aligns **Maqal History UI ↔ Business Overview** in both directions.

### 4. Remove Waterfall Logic
- Once reconciliation proves the migration was successful and accurate, we will:
  - Remove the waterfall block from `ledgerHelpers.ts`.
  - Remove the untagged pool / pre-debt guessing logic from `mq-analytics/route.ts`.
  - Ensure both systems query purely by `maqal_id`.

### 5. Prevent Future Disconnects
- Update `app/api/daily-book/route.ts` to ensure that when it creates or updates `PRODUCT` Ledger entries, it assigns the explicit global `maqal_id`.
- Add a database index on `maqal_id` to ensure queries remain performant.

## User Review Required
> [!IMPORTANT]
> The plan has been updated with your safeguards. We will run the migration, export an audit log, and verify MQ#18/19/20 BEFORE removing the old logic. Do you approve this revised, fully-safeguarded plan?
