# Ghana Payroll API

PAYE, SSNIT and net pay for Ghana, calculated exactly and explained line by line.

> **Status: in development.** I'm building this in public. Follow along here or on the project page:
> **https://jacksonkojoosei.com/projects/ghana-payroll-api**

## What it does

An API that takes gross pay and allowances and returns PAYE, SSNIT tiers and net pay, using the current published GRA and SSNIT rates. Every result shows its working, and every rate change is versioned so old payslips can always be recalculated the same way.

## Why

Small businesses and HR tools in Ghana still calculate payroll in spreadsheets, and tax bands change. Mistakes cost money and trust.

## Planned features

- [ ] PAYE bands and SSNIT tiers from versioned rate tables
- [ ] Integer money maths, no floating-point rounding errors
- [ ] A full breakdown of how each figure was reached
- [ ] Recalculate any past period with the rates that applied then
- [ ] Bulk runs with idempotency keys, so a retry never doubles a run

## Stack

TypeScript, Node.js, PostgreSQL, OpenAPI

## Author

Built by **[Jackson Kojo Osei](https://jacksonkojoosei.com)**, CTO in Accra, Ghana.
[LinkedIn](https://www.linkedin.com/in/jackson-kojo-osei-740846189) · [All projects](https://jacksonkojoosei.com/projects)

## License

MIT
