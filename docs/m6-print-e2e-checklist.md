# M6 print E2E checklist (manual)

Bridge **≥ 0.3.10** online + printers assigned in Print Center (`windows_printer_name` + `bridge_id`).
Receipt branding (slogan / phone / address) is set in Print Center → Settings.
Per-section layout (order / fields / fonts / visibility / align / **field labels**) is set in Print Center → **تخطيط الورقة**.
**BP-15:** Bridge has **no** hardcoded document labels — Preview ≡ paper (WYSIWYG). Unsaved layout → Test Print asks to **save then print**.
Kitchen tickets include **شكرًا لك** by default; cut feed clears the thank-you line.

| # | Scenario | Expect |
| - | -------- | ------ |
| 1 | Pay Now dine-in / takeaway with kitchen items | Kitchen + receipt jobs → paper |
| 2 | Unpaid create (pay later) | Kitchen only; **no** receipt |
| 3 | Partial `record_collection` | Receipt job for that collection |
| 4 | Delivery unpaid then collect | Kitchen at create; receipt on collect |
| 5 | Reprint dialog: receipt / kitchen / both | New jobs + timeline + audit reason |
| 6 | Burst consecutive sales | Multiple jobs claimed in order |
| 7 | Bridge offline &lt; TTL then reconnect | Pending jobs print |
| 8 | Bridge offline &gt; TTL | Jobs `expired`; Print Again from Print Center |
| 9 | Edit a field label in Preview → Test Print (after save) | Paper matches Preview for that label |
| 10 | Test Print with dirty unsaved layout | Confirm → save → print (not stale template) |

Automated: `pnpm test:m6` · `pnpm test:m6b` · `pnpm test:field-text`.
