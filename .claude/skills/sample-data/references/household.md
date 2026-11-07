# The Parker household

Source of truth: `scripts/lib/sample-data-household.mjs`. This page is the map; amounts carry a
seeded jitter unless marked fixed. "ref" is the generation day (`--reference-date`, default today);
the window runs `--months` back from it. Offsets are calendar months relative to the reference month.

## People and accounts

| User | Role |
|---|---|
| 1 Avery Parker (primary) | Salaried, biweekly on Fridays; owns Household Checking, Rainy Day Savings, Rewards Visa, 401(k); mortgage and furnace financing |
| 2 Jordan Parker | Salaried, 1st and 15th; owns Household Joint (joint), Travel Mastercard, 529 (joint), auto loan |
| 3 Riley Parker (teen) | Part-time job biweekly; Riley Teen Checking with a debit card; receives an allowance |
| 4 Sam Parker (child) | Sam Custodial Savings; monthly deposit, birthday gift, interest |

| Id | Account | Type | Owner | Balance tracking | Opening balance (at window start) |
|---|---|---|---|---|---|
| 1 | Household Checking | checking | Avery | rows | 4,250.00 |
| 2 | Rainy Day Savings | savings | Avery | rows (+3.5% APY interest rows) | 12,600.00 |
| 3 | Rewards Visa | credit, limit 12,000 | Avery (card 8 is Jordan's authorized card) | rows | −842.17 |
| 4 | Household Joint | checking, joint | Jordan | rows | 2,380.00 |
| 5 | Travel Mastercard | credit, limit 8,000 | Jordan | rows | −215.40 |
| 6 | Riley Teen Checking | checking | Riley | rows | 310.00 |
| 7 | Sam Custodial Savings | savings | Sam | rows (+3% APY) | 1,875.00 |
| 8 | Avery 401(k) | retirement | Avery | monthly snapshots (from 86,400) | — |
| 9 | BrightFuture 529 | investment, joint | Jordan | monthly snapshots (from 14,200) | — |
| 10 | Home Mortgage | loan, joint | Avery | opening snapshot −286,400; loan scan syncs | — |
| 11 | Auto Loan | loan | Jordan | opening snapshot −24,800 (no rule → never synced) | — |

Cards: 1 `4821` (checking, full number `400000000004821`), 2 `6502`, 3 `9034` (Visa), 4 `1176`
(joint), 5 `4821` (Visa backup, `550000000004821`), 6 `2210` (Riley), 7 `7781` (Mastercard),
8 `5519` (Jordan on the Visa).

Categories 1–15 are unchanged from before; 16 Interest, 17 Gifts Received (income); 18 Gifts &
Donations, 19 Subscriptions, 20 Personal Care (expense).

## Monthly flows

Income (`type income` by sign):

| Row | Account | Amount | When |
|---|---|---|---|
| `CEDAR VALLEY PAYROLL DIRECT DEP` | 1 | 2,480.00 per check, +3% each calendar year | every other Friday |
| `PINE RIDGE HEALTH NETWORK PAYROLL` | 4 | 1,480.00 per check, +3%/yr | 1st and 15th |
| `SUMMIT CAFE PAYROLL` | 6 | 96–188 | every other Thursday |
| `FREELANCE COLLECTIVE …` | 1 | 435–595 (+95 in Dec) | odd months, 27th |
| `STATE REVENUE DEPT TAX REFUND` | 2 | 2,175–2,425 | March 5 |
| `CEDAR VALLEY PAYROLL YEAR END BONUS` | 1 | 985 | Dec 12 |
| `BIRTHDAY GIFT DEPOSIT` | 7 | 100 | June 14 |
| `INTEREST PAID` | 2, 7 | balance × APY / 12 | last day of month |

Transfers between tracked accounts (two rows each, paired by the classification scan; `transferKey`
`<month>:<key>`):

| Key | From → To | Amount | Days | Wording out / in |
|---|---|---|---|---|
| joint-funding | 1 → 4 | 300 | 2 | `ONLINE TRANSFER TO HOUSEHOLD JOINT` / `ONLINE TRANSFER FROM HOUSEHOLD CHECKING` |
| savings | 1 → 2 | 400 | 5 | `ONLINE TRANSFER TO RAINY DAY SAVINGS` (rule 1) / `ONLINE TRANSFER FROM HOUSEHOLD CHECKING` |
| allowance | 4 → 6 | 60 | 1 | `ZELLE TO RILEY PARKER` (rule 3) / `ZELLE FROM JORDAN PARKER` |
| custodial | 1 → 7 | 50 | 15 | `TRANSFER TO SAM CUSTODIAL SAVINGS` / `TRANSFER FROM HOUSEHOLD CHECKING` |
| visa-payment | 1 → 3 | previous month's Visa activity | 26 / 27 | `REWARDS VISA AUTOPAY` (rule 2) / `PAYMENT RECEIVED - THANK YOU` |
| mastercard-payment | 4 → 5 | previous month's Mastercard activity | 27 / 28 | `PINE STATE BANK CARD PMT` / `MASTERCARD PAYMENT RECEIVED THANK YOU` |

One-legged transfer: `BRIGHTFUTURE 529 CONTRIBUTION`, 250 from account 4 on the 10th, typed by
classification rule 4 (counterpart account 9, which only has snapshots).

Loan payments (`type expense`; the loan rule scan claims them):

| Loan | Row | Account | Amount | Rule |
|---|---|---|---|---|
| 1 Home mortgage (installment, 286,400 at 6.125%, 360 mo, opened at window start) | `MEADOWBROOK MORTGAGE PAYMENT` | 1, day 3 | amortizing payment (≈1,740) | `MEADOWBROOK MORTGAGE` on account 1 |
| 2 Auto loan (installment, 24,800 at 5.49%, 60 mo) | `LAKESIDE AUTO FINANCE PMT` | 4, day 8 | amortizing (≈474) | **none** (intentional) |
| 3 Furnace financing (deferred interest, 5,800, promo ends ref+9 months, 29.99% if missed) | `COMFORT HOME CREDIT PAYMENT` | 1, day 20 | 325 from ref−8 until paid | `COMFORT HOME CREDIT` on account 1 |

Fixed charges (`recurringKey`; the subscription scan detects them with three or more occurrences):
`FIBERLINK HOME INTERNET` 79.99 (1), `HORIZON WIRELESS` 145 (4), `FAMILY SHIELD AUTO INSURANCE` 168.40
(4), `STREAMHOUSE MEDIA` 15.99 (3), `MELODY MUSIC` 10.99 (3), `FITLIFE GYM MEMBERSHIP` 45 (4),
`CLOUD VAULT STORAGE` 2.99 (3), `GAMESTATION ONLINE` 19.99 (6), `COMMUNITY SOCCER CLUB DUES` 85 (4),
`RIVER COUNTY FOOD BANK` 50 (4), and the unlinked `LAKESIDE AUTO FINANCE PMT`. `WAREHOUSE CLUB ANNUAL
MEMBERSHIP` 65 (September) is yearly and not detectable within one year.

Variable spending: weekly Saturday groceries `FRESH MARKET #214` on the Visa (card 3 or Jordan's
card 8), monthly `WAREHOUSE CLUB` (4), fuel `HIGHWAY FUEL STOP` (3 twice, 5 once), `SUBURBAN GAS &
ELECTRIC` and `METRO WATER & SEWER` (1), `CORNER TABLE BISTRO` (5), `TACO JUNCTION` (3), `SUNRISE
DINER` (4), `ONLINE MARKETPLACE` twice (3), `UPTOWN OUTFITTERS` (3; every third month a return of
24–58 comes back as a `refund`; Nov adds holiday gifts; gifts for others on 5 in Feb/May/Sep/Dec),
`RIVER CITY CINEMA` (5, every other month), `LAKESIDE SALON & BARBER` (4), `MAIN STREET PHARMACY` (3,
every other month) plus seasonal `BRIGHTPATH PEDIATRICS` / pharmacy visits (1), school rows (4:
`RIVER COUNTY SCHOOL DISTRICT`, `LITTLE OAKS LEARNING CENTER`, seasonal `COMMUNITY SOCCER CLUB`),
`GREENFIELD LAWN CARE` Apr–Oct (4), `RIVER CITY AUTO SERVICE` quarterly (5), `MAPLE HARDWARE` /
`GREENFIELD LAWN CARE` home projects in Apr/Jun/Oct, `FAMILY SHIELD HOME INSURANCE` 742 quarterly (1),
`RIVER COUNTY TAX COLLECTOR` 2,350 in Jan and Jul (1). Riley: `CAMPUS COFFEE` twice, `THRIFT LOOP`
every other month, `GAMESTATION ONLINE` (6).

## Projects, trips, budget

| Entity | Dates | Linked rows |
|---|---|---|
| Project 1 Mudroom Storage Refresh (completed) | ref−11 day 10 → ref−10 day 2 | three `MAPLE HARDWARE` rows (1 and 3) |
| Project 2 Furnace Replacement (hvac, completed) | ref−9 days 6–8 | permit 240 (1), `COMFORT AIR HVAC` 350 (3), every furnace loan payment |
| Project 3 Patio Shade Install (planning) | ref+1 → ref+2 | none; savings fund: Home Improvement, 150/month from ref−3 |
| Trip 1 Outer Banks Summer Week | most recent July 13–19 | flights the month before, lodging, two `SEASIDE GRILL`, fuel (all on 5) |
| Trip 2 Spring Break in Charleston (planning) | next April 5–10 | none; savings fund: Travel, 200/month from ref−2 |

Budget plans: plan 1 effective at the window's first month (baseline, every spending category); plan 2
at ref−3 when the window has four or more months (Groceries 1,100, Dining Out 320 with
`carry_mode = 'surplus'`, Travel 400, Home Improvement 300).

Income sources: Avery biweekly, Jordan semi-monthly, Riley biweekly (`recurring_salary` with
`deposit_account_id` and `match_pattern`), plus the `linked_account` source on Household Checking.

## expectations.json

Top-level keys: `window` (dates, `completeMonths` = months containing neither the first nor the last
day of the window), `transactions` (`total`, `byExpectedType`, `bySignType`), `months[]` (income,
expenses, refunds, transfersOut, transferLegCount, net, spendByCategory, incomeByAccount), `accounts[]`
(opening/ending balance, rowCount, tracksBalanceBySnapshots), `transfers` (pairs with both legs'
ids, `expectedTransferRowCount`, orphans), `refunds[]`, `loans[]` (expectedPaymentCount,
expectedTotalPaid, ruleLinked, paymentDescription, paymentRowsInWindow), `subscriptions[]`
(description, amount, occurrences, detectable, cadence), `budget` (plans, funds), `projects[]`,
`trips[]`. "expenses" follow `spendExpr` (expense rows minus refunds), "income" `incomeExpr`;
transfers count toward neither.
