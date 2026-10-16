# Rate tables

Rates live in [`/rates`](../rates) as plain JSON, one file per change, so every change is visible in code review and history.

| File | Applies from | Official source |
| --- | --- | --- |
| [`gh-paye-2026-09.json`](../rates/gh-paye-2026-09.json) | 1 Sep 2026 | [GRA notice on Act 1178](https://gra.gov.gh/wp-content/uploads/2026/09/Amendments-To-The-Income-Tax-2015-Act-896_Updated-1.pdf), [GRA PAYE page](https://gra.gov.gh/domestic-tax/tax-types/paye/) |
| [`gh-ssnit-2026-01.json`](../rates/gh-ssnit-2026-01.json) | 1 Jan 2026 | [SSNIT notice, 13 Jan 2026](https://www.ssnit.org.gh/wp-content/uploads/2026/01/Public-Notice-Min-Max-Insurable.pdf), [SSNIT FAQ](https://www.ssnit.org.gh/faq/the-new-pension-scheme) |

## Rules

1. **Official sources only.** Every table must cite GRA, SSNIT, NPRA or the Act itself. Payroll vendor blogs often disagree with each other, and with the law.
2. **Never edit a table that's been used.** Add a new file with a new `effective_from` instead. That way an old payslip recalculates exactly as it did at the time.
3. Tables are checked when the service starts:
   - only the last band may be open-ended;
   - every monthly band must be exactly one twelfth of the annual one.
4. `GET /v1/rates?date=2026-10-31` shows which tables apply on a date. `GET /v1/rates` lists them all.

## Adding a new table

```bash
cp rates/gh-paye-2026-09.json rates/gh-paye-2027-01.json
# edit id, effective_from, sources (with the date you retrieved them) and the bands
npm test
```

Add a test with a hand-worked example from the new table before opening a pull request.

## Known gaps

- **Pay periods before September 2026.** GRA's notice says the Act 1178 bands apply from 1 September 2026, so January to August 2026 used the earlier bands. GRA no longer publishes those on its PAYE page, and secondary sources disagree. Until the official table is added, those periods return `422 no_rate_table` rather than a guess. If you have the official GRA document, please open an issue.
- **SSNIT minimum contribution.** SSNIT's 2026 notice gives a minimum contribution of GHS 79.40. 13.5% of the minimum insurable earnings (GHS 587.80) is GHS 79.35. The API uses the formula (79.35), so a 5-pesewa difference is possible for anyone paid at the minimum.
