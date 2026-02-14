# Business Use Case - Why TaxTrack Exists (BIR 2307 Automation)

This document explains the business context and the reason behind the system's custom rules and workflow choices. It is written for software engineers who want to understand the "why" behind the implementation.

Source requirements: `docs/original_requirement/requirement.md`.

## Current Process and Expected Process

The original requirement bundle includes a value stream map:

- As-Is process: `docs/original_requirement/pages/page-7/img-2.jpeg`
- To-Be process: `docs/original_requirement/pages/page-7/img-3.jpeg`

These diagrams are the best source for "what they do today" and what the target operating process should look like once TaxTrack is in place.

### Current Process Today As-Is

At a high level, the current state is a manual, multi-step flow across teams where the same certificate data is handled repeatedly across steps:

1. Collection and pre-work.
   - Finance or revenue team collects BIR 2307 PDFs from customers, typically in a shared location.
   - Certificates may be native PDFs or scanned images.
2. Manual setup and organization.
   - Files are manually downloaded and placed into working folders.
   - Duplicates may exist because the same certificate can be resent or re-uploaded.
3. Manual consolidation and checking.
   - Someone reviews each file for completeness.
   - Key fields are manually encoded or copy-pasted into a reconciliation sheet.
   - Signature and printed name completeness is manually checked.
4. Manual computation and validation.
   - The team identifies the ATC and manually applies the implied rate.
   - They compute tax base checks and decide whether the certificate is acceptable.
5. Manual reconciliation and reporting.
   - "Per books" dataset is compared against "per collected 2307" values.
   - Monthly and quarterly reports are prepared from the reconciliation sheet.

Why this matters:

- It is slow and expensive at volume.
- It creates inconsistent decisions and rework because "rules" live in people’s heads.
- It increases audit risk because the business cannot easily prove consistent controls were applied to every certificate.

Reference diagram:

![VSM As-Is Process](original_requirement/pages/page-7/img-2.jpeg)

### Expected Process After TaxTrack To-Be

The target state keeps the same business outcome, but moves most of the repetitive work into deterministic, logged system steps:

1. Intake remains in a shared folder.
   - Revenue team continues to place certificates in the designated Google Drive folder.
2. Automated ingestion, including backfill.
   - Existing files in the folder are backfilled and queued.
   - New files are detected via Drive notifications and queued automatically.
3. Automated extraction and standardization.
   - OCR and normalization extract required fields.
   - Output is a consistent schema that downstream reconciliation can rely on.
4. Automated controls.
   - Duplicate detection segregates duplicates to a dedicated area and prevents double counting.
   - Completeness checks enforce required fields.
   - Signature and printed name checks enforce authorization evidence.
   - ATC mapping and tax base work-back checks enforce consistency with a PHP 100 tolerance.
5. Automated reconciliation and reporting.
   - Extracted certificate values are plotted into the reconciliation view and matched against the "per books" dataset.
   - Monthly and quarterly reports are generated and stored.
6. Human attention is focused on exceptions.
   - The team reviews only the errors and edge cases, with reason codes and artifact links.
   - Everything else is processed consistently and traceably.

Reference diagram:

![VSM To-Be Process](original_requirement/pages/page-7/img-3.jpeg)

## Glossary - Acronyms and Codes

This section defines the most common acronyms and code prefixes you'll see in this project.

- **BIR**: Bureau of Internal Revenue (Philippines).
- **BIR Form 2307**: Certificate of Creditable Tax Withheld at Source. This is the certificate being processed.
- **CWT**: Creditable Withholding Tax. The withheld tax can be credited against the company's income tax due.
- **EWT**: Expanded Withholding Tax. A common category of creditable withholding tax reported and remitted by the withholding agent.
- **TIN**: Taxpayer Identification Number.
- **ATC**: Alphanumeric Tax Code. A BIR code that identifies the nature of the income payment and the applicable withholding tax rate.
  - In BIR schedules, ATCs are used in remittance returns and certificates to classify the withholding tax and rate applied.
  - Example: `WC158`, `WC160`, `WC051`.
- **WI / WC prefixes**: In BIR schedules, ATCs are often paired with:
  - `WI...` for **Individual** payees
  - `WC...` for **Corporation / Non-individual** payees
  - Example: BIR Form 1601-EQ schedule shows `WI158` and `WC158` with the same 1% rate, and `WI160` and `WC160` with the same 2% rate.
- **WC158 / WC160 examples (what they represent)**:
  - `WC158`: Income payment made by top withholding agents to their local/resident supplier of goods (1%).
  - `WC160`: Income payment made by top withholding agents to their local/resident supplier of services (2%).
  - These descriptions and rates appear in the official BIR Form 1601-EQ ATC schedule (January 2019 ENCS).

## Executive Story

The finance/revenue team receives BIR Form 2307 certificates from customers. Each 2307 is evidence that the customer withheld tax at source and remitted it, and the company can later claim that amount as a tax credit.

The business problem is that:

1. The company must only claim credits supported by valid, complete certificates.
2. They must reconcile what is in the books (recognized prepaid creditable withholding tax) with the certificates collected.
3. The work arrives as hundreds to thousands of PDFs, many scanned, and manual validation/data entry is slow, inconsistent, and audit-risky.

TaxTrack exists to turn a Drive folder of PDFs into:

- Extracted structured data (fields + confidence)
- Clear exceptions (duplicates, missing fields, variance errors)
- Reconciled monthly/quarterly reports aligned with the finance team's reconciliation sheet
- Audit-ready traceability back to the source PDF

## Why Google Drive Intake (Not Uploading to TaxTrack)

The operating model is designed to fit existing finance operations:

- The revenue team already uses a Drive folder as the working intake point.
- TaxTrack should not require users to re-upload sensitive tax files to a separate platform just to start processing.
- Drive provides a single source of truth for "what has been received" and allows the team to continue their current process.

Business reasons this matters:

- It reduces friction and user error by keeping the team's working intake point unchanged.
- It creates one operational source of truth for what has been received for a period.
- It supports consistent, repeatable handling of high document volumes.

## Why "Completeness" Rules Are Strict

The company is not trying to "best-effort" extract data. They need auditable, compliant outputs.

That is why the workflow treats missing/invalid fields as explicit errors and routes those documents to an error queue/storage path.

### Why Printed Name and Signature Are Checked

The requirement states that the 2307 must have complete printed name and signature of the payor's authorized tax representative.

Business reason:

- A certificate without proper authorization markers increases dispute/audit risk.
- Finance needs a defensible basis to accept/reject certificates without relying on undocumented judgment.

Engineering reason:

- It creates a deterministic rule to classify documents and avoid silently accepting incomplete certificates.

## Why Duplicate Segregation Exists

In the real world, duplicates are common:

- Customers resend the same certificate.
- A file is re-uploaded with a different filename.
- The same certificate is stored in multiple subfolders.

Business reason:

- Duplicates can cause overstated tax credits or double-counting in reconciliation.
- During audits, showing "we detected and excluded duplicates" is a control.

Engineering reason:

- Duplicate detection is an integrity control that prevents downstream reconciliation errors.
- It enables idempotent processing: repeated events (webhooks/backfill replays) must not create duplicated financial entries.

### Example Duplicate

Two PDFs differ in filename but represent the same certificate:

- Payee TIN: 201-115-150
- Payor TIN: 000-000-001-00000
- Period end: 2024-03-31
- ATC: WC160
- Tax withheld: 783.51

TaxTrack should mark the second as duplicate, segregate it, and ensure it does not affect reconciliation totals.

## Why ATC Logic and Tax Base Work-Back Exists

The requirement defines a validation control:

- Identify ATC code
- Compute expected tax base using an ATC rate
- Compare it with the tax base printed on the 2307
- Flag variance above a threshold

Business reason:

- The certificate could be wrong (incorrect base, incorrect withheld tax, wrong ATC).
- The books and collected certificates must agree to avoid incorrect tax credit recognition.
- Finance needs a rule to detect likely errors early.

Engineering reason:

- This is a cross-field consistency check that catches OCR/LLM mistakes and source-document issues.
- It provides an explainable reason for errors, not just "low confidence."

### ATC Rate Examples

Current rates required:

- WC160: 2%
- WC158: 1%
- WC051: 15%

The system should be extensible because additional codes may be added later.

### Where These Percentages Come From

In `docs/original_requirement/requirement.md`, the project requirements state that the system must support:

- `WC160 = 2%`
- `WC158 = 1%`
- `WC051 = 15%`

The requirement document does not explain why the rates are those values; it treats them as given.

The "reason" for the values in practice is that they are prescribed by BIR withholding tax rules and are published in official schedules/issuances, for example:

- **BIR Form 1601-EQ (January 2019 ENCS), Schedule of Alphanumeric Tax Codes** lists:
  - `WI158 / WC158` at **1%** for income payments made by top withholding agents to suppliers of goods
  - `WI160 / WC160` at **2%** for income payments made by top withholding agents to suppliers of services
  - `WC050 / WC051` for management and technical consultants at **10% / 15%** depending on gross income thresholds
- **BIR RMO No. 38-2018** also enumerates `WI158/WC158` (1%) and `WI160/WC160` (2%) and ties them to RR No. 11-2018 under the TRAIN law (RA No. 10963).

Engineering implication:

- Treat the ATC-to-rate mapping as configuration with provenance (source document + effective date), because BIR can create/modify ATCs over time.

References:

- BIR Form 1601-EQ (January 2019 ENCS) PDF: https://bir-cdn.bir.gov.ph/BIR/pdf/1601-EQ%20Jan%202019%20ENCS.pdf
- BIR RMO No. 38-2018 PDF: https://bir-cdn.bir.gov.ph/BIR/pdf/RMO%20No.%2038-2018.pdf

### Example: Work-Back + Variance Check

Input from 2307:

- ATC: WC160 (2%)
- Tax withheld: 783.51
- Printed tax base: 39,100.00

Computed tax base:

- 783.51 / 0.02 = 39,175.50

Variance:

- |39,175.50 - 39,100.00| = 75.50

Result:

- 75.50 <= 100.00, so this passes the variance check.

### Example: Variance Failure

Same withheld and rate, but printed tax base is 38,900.00:

- Computed base: 39,175.50
- Variance: 275.50

Result:

- 275.50 > 100.00, so this is routed as an error.

## Why the Variance Threshold Is PHP 100

The requirement sets a maximum variance threshold of PHP 100.

Business reason:

- Minor differences can arise from rounding, formatting, or OCR noise.
- The team wants to avoid flooding the error queue with immaterial discrepancies.
- PHP 100 is a pragmatic tolerance that still catches meaningful mismatches.

Engineering reason:

- It reduces false positives while still enforcing a measurable control.
- It stabilizes the system under imperfect inputs (scans, smudges, low-quality images).

## Why File Naming Convention Exists

Required format:

`Co.Name_TIN_PeriodEnd_Sequence`

Example:

`ABOITIZ ENERGY SOLUTIONS INC_201115150_03312024_1`

Business reason:

- Helps finance and audit quickly locate certificates by customer and period.
- Creates a consistent artifact inventory for month-end and quarter-end close.
- Aligns with masterlist mapping the company already maintains.

Engineering reason:

- Deterministic naming makes storage paths stable and searchable.
- It enables easy human verification without opening the document.
- It improves reconciliation workflows because artifacts can be matched by convention.

## Why Reconciliation Exists (Core Outcome)

Requirement states the revenue team uploads a "per books" dataset:

- Customer name, TIN, invoice numbers, billing period, GL date, tax base, tax withheld

TaxTrack must plot extracted "per collected 2307" values and match them.

### What the Reconciliation Sheet Is and Why Users Provide It

The reconciliation sheet is the finance-side source of truth for what was recorded in the accounting books for a period.

It is needed because the BIR 2307 certificates only show what was withheld on the certificate. They do not contain the company's internal "per books" records such as invoice references, billing periods, and GL dates.

Business purpose of the sheet:

- It defines what the company believes it should be able to claim as prepaid CWT for the month or quarter.
- It allows the team to prove that each booked amount is supported by collected, valid certificates.
- It highlights gaps that require follow-up before period close or audit.

Operational flow:

1. Revenue team collects or stores 2307 certificates in the designated Drive folder.
2. TaxTrack processes certificates and produces "per collected 2307" extracted values with exceptions.
3. Revenue team provides the reconciliation sheet for the same period (the "per books" dataset).
4. TaxTrack matches "per books" to "per collected 2307" and produces monthly or quarterly reconciliation outputs.

What this accomplishes:

- A clean match supports claiming the credit with confidence.
- A mismatch or missing certificate becomes an actionable worklist (chase a certificate, correct a book entry, or investigate a wrong ATC/rate).

Business reason:

- The company needs to ensure that recognized prepaid CWT in the books is supported by collected certificates.
- Gaps matter:
  - Booked but not collected: the team must chase missing certificates.
  - Collected but not booked: potential accounting mismatch or missed recognition.
- Reconciliation is how finance closes periods with confidence.

Engineering reason:

- Reconciliation is the integration point where document extraction becomes a financial control.
- It creates clear outputs and statuses that can be reviewed and audited.

### Example Reconciliation Outcomes

1. Match:
- Extracted tax withheld and tax base match the books within tolerances.
- Status: matched

2. Unmatched certificate:
- A certificate exists in Drive but no corresponding record in the books dataset.
- Status: collected-only

3. Missing certificate:
- A books record exists but no corresponding certificate is found/valid.
- Status: books-only

4. Variance:
- Certificate extracted values disagree with books beyond allowed thresholds.
- Status: needs review

## Why Errors Are Routed to a Dedicated Queue/Folder

The requirement explicitly says errors must be dumped to a designated folder for review.

Business reason:

- Finance needs a prioritized worklist of what to correct or request from customers.
- It separates clean, reconciled outputs from questionable inputs.

Engineering reason:

- It allows the pipeline to proceed without blocking on manual review.
- It keeps the system deterministic: every doc ends in exactly one terminal state (done, duplicate, error).

## Summary: How the Logic Maps to Controls

- Completeness checks: ensure certificates are valid enough to support tax credits.
- Signature/printed name checks: enforce authorization evidence.
- Duplicate segregation: prevent double-counting and integrity issues.
- ATC work-back and variance: catch inconsistent or incorrect certificates and extraction errors.
- Naming convention: supports operational traceability and audit workflows.
- Reconciliation: converts documents into month/quarter-close deliverables.
- Drive + backfill: fits real operations and ensures no gaps in historical coverage.
