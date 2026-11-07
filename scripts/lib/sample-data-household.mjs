// The Parker household: the one scenario behind every sample-data fixture.
//
// Everything here is derived from the generation window (reference "today",
// months back, seed), so the data always reaches into the current month and
// every date-bearing row (projects, trips, loans, budget plans, snapshots)
// sits in the right place relative to it. The transactions are emitted the
// way a bank would export them: income and expenses typed by sign, transfer
// legs as plain money-out / money-in rows with transfer wording, refunds as
// merchant credits. The app's own scans (classification, loan rules,
// subscription detection) then derive transfers, loan payments and series;
// `buildSampleDataExpectations` records what those scans are expected to
// find so the validation layers can compare.
//
// Shape of the family: two adults with separate and joint accounts, a teen
// with a checking account and a debit card, a younger child with a custodial
// savings account, a mortgage and an auto loan backed by loan accounts, a
// deferred-interest financing plan for a furnace project, a 401(k) and a 529
// whose balances come from statement snapshots. US dollars throughout.

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Ids. The first four accounts, the first five cards and categories 1-15 keep
// the ids and names the e2e suite already relies on (Household Checking,
// Rewards Visa, the two cards ending 4821, Groceries, ...).
// ---------------------------------------------------------------------------

export const USER_IDS = { AVERY: 1, JORDAN: 2, RILEY: 3, SAM: 4 };

export const ACCOUNT_IDS = {
  HOUSEHOLD_CHECKING: 1,
  RAINY_DAY_SAVINGS: 2,
  REWARDS_VISA: 3,
  HOUSEHOLD_JOINT: 4,
  TRAVEL_MASTERCARD: 5,
  RILEY_TEEN_CHECKING: 6,
  SAM_CUSTODIAL_SAVINGS: 7,
  AVERY_401K: 8,
  BRIGHTFUTURE_529: 9,
  HOME_MORTGAGE: 10,
  AUTO_LOAN: 11,
};

export const CARD_IDS = {
  HOUSEHOLD_CHECKING: 1,
  RAINY_DAY_SAVINGS: 2,
  REWARDS_VISA: 3,
  HOUSEHOLD_JOINT: 4,
  REWARDS_VISA_BACKUP: 5,
  RILEY_DEBIT: 6,
  TRAVEL_MASTERCARD: 7,
  REWARDS_VISA_JORDAN: 8,
};

export const CATEGORY_IDS = {
  HOUSING: 1,
  GROCERIES: 2,
  UTILITIES: 3,
  TRANSPORTATION: 4,
  HEALTHCARE: 5,
  CHILDCARE_AND_SCHOOL: 6,
  DINING_OUT: 7,
  SHOPPING: 8,
  ENTERTAINMENT: 9,
  INSURANCE: 10,
  TRAVEL: 11,
  HOME_IMPROVEMENT: 12,
  SALARY: 13,
  SIDE_INCOME: 14,
  TAX_REFUND: 15,
  INTEREST: 16,
  GIFTS_RECEIVED: 17,
  GIFTS_AND_DONATIONS: 18,
  SUBSCRIPTIONS: 19,
  PERSONAL_CARE: 20,
};

export const COMPANY_IDS = {
  PRIMARY_PAYROLL: 1,
  SECONDARY_PAYROLL: 2,
  MORTGAGE_SERVICER: 3,
  FRESH_MARKET: 4,
  WAREHOUSE_CLUB: 5,
  ELECTRIC_AND_GAS: 6,
  WATER_AND_SEWER: 7,
  HIGHWAY_FUEL: 8,
  CORNER_BISTRO: 9,
  STREAMHOUSE_MEDIA: 10,
  FAMILY_SHIELD_INSURANCE: 11,
  BRIGHTPATH_PEDIATRICS: 12,
  LITTLE_OAKS_LEARNING: 13,
  MAPLE_HARDWARE: 14,
  UPTOWN_OUTFITTERS: 15,
  SUNTRAIL_AIRLINES: 16,
  HARBOR_DUNES_RESORT: 17,
  RIVER_COUNTY_SCHOOLS: 18,
  FREELANCE_COLLECTIVE: 19,
  STATE_REVENUE: 20,
  MAIN_STREET_PHARMACY: 21,
  FIBERLINK_HOME: 22,
  GREENFIELD_LAWN: 23,
  COMMUNITY_SOCCER_CLUB: 24,
  LAKESIDE_AUTO_FINANCE: 25,
  COMFORT_HOME_CREDIT: 26,
  HORIZON_WIRELESS: 27,
  MELODY_MUSIC: 28,
  FITLIFE_GYM: 29,
  CLOUD_VAULT_STORAGE: 30,
  TACO_JUNCTION: 31,
  CAMPUS_COFFEE: 32,
  GAMESTATION_ONLINE: 33,
  THRIFT_LOOP: 34,
  SUMMIT_CAFE: 35,
  RIVER_COUNTY_FOOD_BANK: 36,
  CEDAR_VALLEY_CREDIT_UNION: 37,
  BRIGHTFUTURE_529_PLAN: 38,
  LAKESIDE_SALON: 39,
  SEASIDE_GRILL: 40,
  COMFORT_AIR_HVAC: 41,
  RIVER_CITY_CINEMA: 42,
  ONLINE_MARKETPLACE: 43,
  RIVER_CITY_AUTO_SERVICE: 44,
  SUNRISE_DINER: 45,
  RIVER_COUNTY_TAX_COLLECTOR: 46,
};

export const PROJECT_IDS = { MUDROOM: 1, FURNACE: 2, PATIO: 3 };
export const TRIP_IDS = { BEACH_WEEK: 1, SPRING_BREAK: 2 };
export const LOAN_IDS = { MORTGAGE: 1, AUTO: 2, FURNACE: 3 };

/** Annual raise applied to every salary each calendar year inside the window. */
const ANNUAL_RAISE = 0.03;
const RAINY_DAY_APY = 0.035;
const CUSTODIAL_APY = 0.03;

const ACCOUNT_DEFINITIONS = [
  {
    id: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
    name: 'Household Checking',
    type: 'checking',
    ownership: 'individual',
    owner_user_id: USER_IDS.AVERY,
    institution: 'Cedar Valley Credit Union',
    opening_balance: 4250,
    card_id: CARD_IDS.HOUSEHOLD_CHECKING,
  },
  {
    id: ACCOUNT_IDS.RAINY_DAY_SAVINGS,
    name: 'Rainy Day Savings',
    type: 'savings',
    ownership: 'individual',
    owner_user_id: USER_IDS.AVERY,
    institution: 'Cedar Valley Credit Union',
    opening_balance: 12600,
    card_id: CARD_IDS.RAINY_DAY_SAVINGS,
  },
  {
    id: ACCOUNT_IDS.REWARDS_VISA,
    name: 'Rewards Visa',
    type: 'credit',
    ownership: 'individual',
    owner_user_id: USER_IDS.AVERY,
    institution: 'Summit Card Services',
    opening_balance: -842.17,
    credit_limit: 12000,
    card_id: CARD_IDS.REWARDS_VISA,
  },
  {
    id: ACCOUNT_IDS.HOUSEHOLD_JOINT,
    name: 'Household Joint',
    type: 'checking',
    ownership: 'joint',
    owner_user_id: USER_IDS.JORDAN,
    institution: 'Cedar Valley Credit Union',
    opening_balance: 2380,
    card_id: CARD_IDS.HOUSEHOLD_JOINT,
  },
  {
    id: ACCOUNT_IDS.TRAVEL_MASTERCARD,
    name: 'Travel Mastercard',
    type: 'credit',
    ownership: 'individual',
    owner_user_id: USER_IDS.JORDAN,
    institution: 'Pine State Bank',
    opening_balance: -215.4,
    credit_limit: 8000,
    card_id: CARD_IDS.TRAVEL_MASTERCARD,
  },
  {
    id: ACCOUNT_IDS.RILEY_TEEN_CHECKING,
    name: 'Riley Teen Checking',
    type: 'checking',
    ownership: 'individual',
    owner_user_id: USER_IDS.RILEY,
    institution: 'Cedar Valley Credit Union',
    opening_balance: 310,
    card_id: CARD_IDS.RILEY_DEBIT,
  },
  {
    id: ACCOUNT_IDS.SAM_CUSTODIAL_SAVINGS,
    name: 'Sam Custodial Savings',
    type: 'savings',
    ownership: 'individual',
    owner_user_id: USER_IDS.SAM,
    institution: 'Cedar Valley Credit Union',
    opening_balance: 1875,
    card_id: null,
  },
  {
    id: ACCOUNT_IDS.AVERY_401K,
    name: 'Avery 401(k)',
    type: 'retirement',
    ownership: 'individual',
    owner_user_id: USER_IDS.AVERY,
    institution: 'Northstar Retirement',
    opening_balance: 0,
    card_id: null,
  },
  {
    id: ACCOUNT_IDS.BRIGHTFUTURE_529,
    name: 'BrightFuture 529',
    type: 'investment',
    ownership: 'joint',
    owner_user_id: USER_IDS.JORDAN,
    institution: 'BrightFuture 529 Plan',
    opening_balance: 0,
    card_id: null,
  },
  {
    id: ACCOUNT_IDS.HOME_MORTGAGE,
    name: 'Home Mortgage',
    type: 'loan',
    ownership: 'joint',
    owner_user_id: USER_IDS.AVERY,
    institution: 'Meadowbrook Mortgage',
    opening_balance: 0,
    card_id: null,
  },
  {
    id: ACCOUNT_IDS.AUTO_LOAN,
    name: 'Auto Loan',
    type: 'loan',
    ownership: 'individual',
    owner_user_id: USER_IDS.JORDAN,
    institution: 'Lakeside Auto Finance',
    opening_balance: 0,
    card_id: null,
  },
];

const ACCOUNTS_BY_ID = new Map(ACCOUNT_DEFINITIONS.map((account) => [account.id, account]));

/** Default card used for a row on `accountId` (null for snapshot-only accounts). */
export function getCardIdForAccount(accountId) {
  return ACCOUNTS_BY_ID.get(accountId)?.card_id ?? null;
}

// ---------------------------------------------------------------------------
// Scenario: the dated skeleton (window, months, projects, trips, loans, plans)
// ---------------------------------------------------------------------------

/**
 * Builds the dated household scenario for a resolved generation config
 * (`referenceDate`, `startDate`, `monthsBack`, `seed`, all UTC).
 */
export function buildHouseholdScenario(config) {
  const referenceDate = config.referenceDate;
  const startDate = config.startDate;
  const referenceMonth = firstDayOfMonth(referenceDate);
  const startMonth = firstDayOfMonth(startDate);
  const monthCount = diffCalendarMonths(startMonth, referenceMonth) + 1;
  const rangeStart = formatDate(startDate);
  const rangeEnd = formatDate(referenceDate);
  const startYear = startMonth.getUTCFullYear();

  const months = Array.from({ length: monthCount }, (_, index) => {
    const monthDate = addUtcMonths(startMonth, index);
    return {
      index,
      monthDate,
      monthKey: formatMonthKey(monthDate),
      monthNumber: monthDate.getUTCMonth(),
      yearOffset: monthDate.getUTCFullYear() - startYear,
      monthsBeforeReference: monthCount - 1 - index,
      daysInMonth: getDaysInMonth(monthDate),
    };
  });

  // A month relative to the reference month, as a 'YYYY-MM' key and a date.
  const relMonth = (offset) => addUtcMonths(referenceMonth, offset);
  const relDate = (offset, day) => buildMonthDateString(relMonth(offset), day);
  const statusFor = (start, end) => (end < rangeEnd ? 'completed' : start > rangeEnd ? 'planning' : 'in_progress');

  const projects = [
    {
      id: PROJECT_IDS.MUDROOM,
      name: 'Mudroom Storage Refresh',
      company_name: 'Maple Hardware',
      contact_details: 'service@maplehardware.example',
      project_category: 'other',
      start_date: relDate(-11, 10),
      end_date: relDate(-10, 2),
      estimated_cost: 1800,
      actual_cost: 1645,
      notes: 'Built-in cubbies and bench seating for school gear',
      budget_category_id: null,
      monthly_contribution: null,
      contribution_start_month: null,
    },
    {
      id: PROJECT_IDS.FURNACE,
      name: 'Furnace Replacement',
      company_name: 'Comfort Air HVAC',
      contact_details: 'office@comfortair.example',
      project_category: 'hvac',
      start_date: relDate(-9, 6),
      end_date: relDate(-9, 8),
      estimated_cost: 6000,
      actual_cost: 6390,
      notes: 'High-efficiency furnace; $5,800 financed through Comfort Home Credit (18 months deferred interest)',
      budget_category_id: null,
      monthly_contribution: null,
      contribution_start_month: null,
    },
    {
      id: PROJECT_IDS.PATIO,
      name: 'Patio Shade Install',
      company_name: 'GreenField Lawn Care',
      contact_details: 'hello@greenfield.example',
      project_category: 'landscaping',
      start_date: relDate(1, 14),
      end_date: relDate(2, 8),
      estimated_cost: 2600,
      actual_cost: 0,
      notes: 'Shade sail and raised planters for the back patio; saving $150 a month toward it',
      budget_category_id: CATEGORY_IDS.HOME_IMPROVEMENT,
      monthly_contribution: 150,
      contribution_start_month: formatMonthKey(relMonth(-3)),
    },
  ].map((project) => ({ ...project, status: statusFor(project.start_date, project.end_date) }));

  // The most recent July on or before the reference month hosts the beach
  // week; the next April after it is the spring-break trip being saved for.
  const referenceYear = referenceMonth.getUTCFullYear();
  const beachYear = referenceMonth.getUTCMonth() >= 6 ? referenceYear : referenceYear - 1;
  const springYear = referenceMonth.getUTCMonth() >= 3 ? referenceYear + 1 : referenceYear;
  const beachMonth = new Date(Date.UTC(beachYear, 6, 1));
  const springMonth = new Date(Date.UTC(springYear, 3, 1));

  const trips = [
    {
      id: TRIP_IDS.BEACH_WEEK,
      name: 'Outer Banks Summer Week',
      destination: 'Outer Banks',
      purpose: 'Family beach vacation',
      trip_category: 'family',
      start_date: buildMonthDateString(beachMonth, 13),
      end_date: buildMonthDateString(beachMonth, 19),
      estimated_cost: 2100,
      actual_cost: 2248.63,
      notes: 'Rental house, beach gear, and family activities',
      budget_category_id: null,
      monthly_contribution: null,
      contribution_start_month: null,
      monthDate: beachMonth,
    },
    {
      id: TRIP_IDS.SPRING_BREAK,
      name: 'Spring Break in Charleston',
      destination: 'Charleston',
      purpose: 'School break city trip',
      trip_category: 'family',
      start_date: buildMonthDateString(springMonth, 5),
      end_date: buildMonthDateString(springMonth, 10),
      estimated_cost: 2450,
      actual_cost: 0,
      notes: 'Historic district hotel plus aquarium and food tour; saving $200 a month toward it',
      budget_category_id: CATEGORY_IDS.TRAVEL,
      monthly_contribution: 200,
      contribution_start_month: formatMonthKey(relMonth(-2)),
      monthDate: springMonth,
    },
  ].map((trip) => ({ ...trip, status: statusFor(trip.start_date, trip.end_date) }));

  const mortgagePrincipal = 286400;
  const mortgageRate = 6.125;
  const mortgagePayment = amortizingPayment(mortgagePrincipal, mortgageRate, 360);
  const autoPrincipal = 24800;
  const autoRate = 5.49;
  const autoPayment = amortizingPayment(autoPrincipal, autoRate, 60);
  const furnaceOpened = relDate(-9, 8);

  const loans = [
    {
      id: LOAN_IDS.MORTGAGE,
      name: 'Home mortgage',
      loan_type: 'installment',
      status: 'active',
      owner_user_id: USER_IDS.AVERY,
      project_id: null,
      account_id: ACCOUNT_IDS.HOME_MORTGAGE,
      lender: 'Meadowbrook Mortgage',
      opened_date: formatDate(startMonth),
      original_principal: mortgagePrincipal,
      interest_rate: mortgageRate,
      term_months: 360,
      expected_payment: mortgagePayment,
      payment_due_day: 3,
      first_payment_date: buildMonthDateString(startMonth, 3),
      allows_full_payoff: 1,
      prepayment_terms: null,
      promo_end_date: null,
      deferred_interest_rate: null,
      notes: '30-year fixed; principal and interest only, escrow paid separately',
      // Rule-linked: payments are claimed by the loan rule below.
      paymentDescription: 'MEADOWBROOK MORTGAGE PAYMENT',
      paymentAccountId: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
      paymentCategoryId: CATEGORY_IDS.HOUSING,
      paymentCompanyId: COMPANY_IDS.MORTGAGE_SERVICER,
      paymentDay: 3,
      paymentAmount: mortgagePayment,
      rule: { pattern: 'MEADOWBROOK MORTGAGE', match_type: 'contains', account_id: ACCOUNT_IDS.HOUSEHOLD_CHECKING },
    },
    {
      id: LOAN_IDS.AUTO,
      name: 'Auto loan',
      loan_type: 'installment',
      status: 'active',
      owner_user_id: USER_IDS.JORDAN,
      project_id: null,
      account_id: ACCOUNT_IDS.AUTO_LOAN,
      lender: 'Lakeside Auto Finance',
      opened_date: formatDate(startMonth),
      original_principal: autoPrincipal,
      interest_rate: autoRate,
      term_months: 60,
      expected_payment: autoPayment,
      payment_due_day: 8,
      first_payment_date: buildMonthDateString(startMonth, 8),
      allows_full_payoff: 1,
      prepayment_terms: null,
      promo_end_date: null,
      deferred_interest_rate: null,
      notes: 'Deliberately left without a payment rule: the state a user is in before linking payments',
      paymentDescription: 'LAKESIDE AUTO FINANCE PMT',
      paymentAccountId: ACCOUNT_IDS.HOUSEHOLD_JOINT,
      paymentCategoryId: CATEGORY_IDS.TRANSPORTATION,
      paymentCompanyId: COMPANY_IDS.LAKESIDE_AUTO_FINANCE,
      paymentDay: 8,
      paymentAmount: autoPayment,
      rule: null,
    },
    {
      id: LOAN_IDS.FURNACE,
      name: 'Furnace financing',
      loan_type: 'deferred_interest',
      status: 'active',
      owner_user_id: USER_IDS.AVERY,
      project_id: PROJECT_IDS.FURNACE,
      account_id: null,
      lender: 'Comfort Home Credit',
      opened_date: furnaceOpened,
      original_principal: 5800,
      interest_rate: null,
      term_months: null,
      expected_payment: 325,
      payment_due_day: 20,
      first_payment_date: relDate(-8, 20),
      allows_full_payoff: 1,
      prepayment_terms: null,
      promo_end_date: relDate(9, 8),
      deferred_interest_rate: 29.99,
      notes: 'No interest if paid in full by the promo end date; otherwise 29.99% charged back from the purchase date',
      paymentDescription: 'COMFORT HOME CREDIT PAYMENT',
      paymentAccountId: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
      paymentCategoryId: CATEGORY_IDS.HOME_IMPROVEMENT,
      paymentCompanyId: COMPANY_IDS.COMFORT_HOME_CREDIT,
      paymentDay: 20,
      paymentAmount: 325,
      rule: { pattern: 'COMFORT HOME CREDIT', match_type: 'contains', account_id: ACCOUNT_IDS.HOUSEHOLD_CHECKING },
    },
  ];

  const baselinePlanCategories = [
    [CATEGORY_IDS.HOUSING, Math.ceil(mortgagePayment / 50) * 50 + 400],
    [CATEGORY_IDS.GROCERIES, 1050],
    [CATEGORY_IDS.UTILITIES, 460],
    [CATEGORY_IDS.TRANSPORTATION, 760],
    [CATEGORY_IDS.DINING_OUT, 280],
    [CATEGORY_IDS.SUBSCRIPTIONS, 80],
    [CATEGORY_IDS.CHILDCARE_AND_SCHOOL, 520],
    [CATEGORY_IDS.GIFTS_AND_DONATIONS, 100],
    [CATEGORY_IDS.HEALTHCARE, 120],
    [CATEGORY_IDS.SHOPPING, 320],
    [CATEGORY_IDS.ENTERTAINMENT, 60],
    [CATEGORY_IDS.PERSONAL_CARE, 90],
    [CATEGORY_IDS.INSURANCE, 420],
    [CATEGORY_IDS.HOME_IMPROVEMENT, 200],
    [CATEGORY_IDS.TRAVEL, 250],
  ];
  const budgetPlans = [
    {
      id: 1,
      effective_month: formatMonthKey(startMonth),
      notes: 'Baseline household budget',
      categories: baselinePlanCategories.map(([category_id, amount]) => ({ category_id, amount, carry_mode: 'none' })),
    },
  ];
  if (monthCount >= 4) {
    budgetPlans.push({
      id: 2,
      effective_month: formatMonthKey(relMonth(-3)),
      notes: 'Adjusted for the patio and spring-break savings funds; dining surplus rolls over',
      categories: baselinePlanCategories.map(([category_id, amount]) => {
        if (category_id === CATEGORY_IDS.GROCERIES) return { category_id, amount: 1100, carry_mode: 'none' };
        if (category_id === CATEGORY_IDS.DINING_OUT) return { category_id, amount: 320, carry_mode: 'surplus' };
        if (category_id === CATEGORY_IDS.TRAVEL) return { category_id, amount: 400, carry_mode: 'none' };
        if (category_id === CATEGORY_IDS.HOME_IMPROVEMENT) return { category_id, amount: 300, carry_mode: 'none' };
        return { category_id, amount, carry_mode: 'none' };
      }),
    });
  }
  for (const plan of budgetPlans) {
    plan.total_amount = roundCurrency(plan.categories.reduce((sum, line) => sum + line.amount, 0));
  }

  const paySchedule = {
    averyPerCheck: 2480,
    jordanPerCheck: 1480,
    rileyPerCheck: 142,
  };

  return {
    config,
    referenceDate,
    startDate,
    referenceMonth,
    startMonth,
    rangeStart,
    rangeEnd,
    months,
    projects,
    trips,
    loans,
    budgetPlans,
    paySchedule,
    accounts: ACCOUNT_DEFINITIONS,
  };
}

// ---------------------------------------------------------------------------
// Base rows for every non-transaction table
// ---------------------------------------------------------------------------

export function getHouseholdBaseRows(tableName, scenario) {
  switch (tableName) {
    case 'users':
      return [
        { id: USER_IDS.AVERY, display_name: 'Avery Parker', is_primary: 1 },
        { id: USER_IDS.JORDAN, display_name: 'Jordan Parker', is_primary: 0 },
        { id: USER_IDS.RILEY, display_name: 'Riley Parker', is_primary: 0 },
        { id: USER_IDS.SAM, display_name: 'Sam Parker', is_primary: 0 },
      ];
    case 'accounts':
      return scenario.accounts.map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
        ownership: account.ownership,
        owner_user_id: account.owner_user_id,
        institution: account.institution,
        opening_balance: account.opening_balance,
        // Balances are stated as of the first day of the window, so the running
        // balance is opening_balance + every generated row.
        opening_balance_date: scenario.rangeStart,
        credit_limit: account.credit_limit ?? null,
        is_active: 1,
        include_in_net_worth: 1,
        import_sign_inverted: 0,
        currency: 'USD',
      }));
    case 'account_cards':
      return [
        {
          id: CARD_IDS.HOUSEHOLD_CHECKING,
          account_id: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
          last_four: '4821',
          full_number: '400000000004821',
          nickname: 'Main Debit',
          user_id: USER_IDS.AVERY,
        },
        {
          id: CARD_IDS.RAINY_DAY_SAVINGS,
          account_id: ACCOUNT_IDS.RAINY_DAY_SAVINGS,
          last_four: '6502',
          nickname: 'Savings ATM',
          user_id: USER_IDS.AVERY,
        },
        {
          id: CARD_IDS.REWARDS_VISA,
          account_id: ACCOUNT_IDS.REWARDS_VISA,
          last_four: '9034',
          nickname: 'Rewards Card',
          user_id: USER_IDS.AVERY,
        },
        {
          id: CARD_IDS.HOUSEHOLD_JOINT,
          account_id: ACCOUNT_IDS.HOUSEHOLD_JOINT,
          last_four: '1176',
          nickname: 'Joint Debit',
          user_id: USER_IDS.JORDAN,
        },
        // Deliberately shares last_four with card 1 but on a different
        // account, distinguished by full_number — exercises CSV-import
        // disambiguation between cards that share their last four digits.
        {
          id: CARD_IDS.REWARDS_VISA_BACKUP,
          account_id: ACCOUNT_IDS.REWARDS_VISA,
          last_four: '4821',
          full_number: '550000000004821',
          nickname: 'Backup Card',
          user_id: USER_IDS.AVERY,
        },
        {
          id: CARD_IDS.RILEY_DEBIT,
          account_id: ACCOUNT_IDS.RILEY_TEEN_CHECKING,
          last_four: '2210',
          nickname: 'Riley Debit',
          user_id: USER_IDS.RILEY,
        },
        {
          id: CARD_IDS.TRAVEL_MASTERCARD,
          account_id: ACCOUNT_IDS.TRAVEL_MASTERCARD,
          last_four: '7781',
          nickname: 'Travel Card',
          user_id: USER_IDS.JORDAN,
        },
        // Jordan's authorized-user card on Avery's Rewards Visa: spending on it
        // is attributed to Jordan, not the account owner.
        {
          id: CARD_IDS.REWARDS_VISA_JORDAN,
          account_id: ACCOUNT_IDS.REWARDS_VISA,
          last_four: '5519',
          nickname: 'Jordan Rewards Card',
          user_id: USER_IDS.JORDAN,
        },
      ];
    case 'categories':
      return [
        { id: CATEGORY_IDS.HOUSING, name: 'Housing', color: '#8D6E63', type: 'expense' },
        { id: CATEGORY_IDS.GROCERIES, name: 'Groceries', color: '#43A047', type: 'expense' },
        { id: CATEGORY_IDS.UTILITIES, name: 'Utilities', color: '#FB8C00', type: 'expense' },
        { id: CATEGORY_IDS.TRANSPORTATION, name: 'Transportation', color: '#1E88E5', type: 'expense' },
        { id: CATEGORY_IDS.HEALTHCARE, name: 'Healthcare', color: '#E53935', type: 'expense' },
        { id: CATEGORY_IDS.CHILDCARE_AND_SCHOOL, name: 'Childcare & School', color: '#5E35B1', type: 'expense' },
        { id: CATEGORY_IDS.DINING_OUT, name: 'Dining Out', color: '#F4511E', type: 'expense' },
        { id: CATEGORY_IDS.SHOPPING, name: 'Shopping', color: '#6D4C41', type: 'expense' },
        { id: CATEGORY_IDS.ENTERTAINMENT, name: 'Entertainment', color: '#8E24AA', type: 'expense' },
        { id: CATEGORY_IDS.INSURANCE, name: 'Insurance', color: '#546E7A', type: 'expense' },
        { id: CATEGORY_IDS.TRAVEL, name: 'Travel', color: '#00ACC1', type: 'expense' },
        { id: CATEGORY_IDS.HOME_IMPROVEMENT, name: 'Home Improvement', color: '#7CB342', type: 'expense' },
        { id: CATEGORY_IDS.SALARY, name: 'Salary', color: '#2E7D32', type: 'income' },
        { id: CATEGORY_IDS.SIDE_INCOME, name: 'Side Income', color: '#C0CA33', type: 'income' },
        { id: CATEGORY_IDS.TAX_REFUND, name: 'Tax Refund', color: '#FDD835', type: 'income' },
        { id: CATEGORY_IDS.INTEREST, name: 'Interest', color: '#00897B', type: 'income' },
        { id: CATEGORY_IDS.GIFTS_RECEIVED, name: 'Gifts Received', color: '#D81B60', type: 'income' },
        { id: CATEGORY_IDS.GIFTS_AND_DONATIONS, name: 'Gifts & Donations', color: '#AD1457', type: 'expense' },
        { id: CATEGORY_IDS.SUBSCRIPTIONS, name: 'Subscriptions', color: '#3949AB', type: 'expense' },
        { id: CATEGORY_IDS.PERSONAL_CARE, name: 'Personal Care', color: '#F06292', type: 'expense' },
      ];
    case 'companies':
      return [
        { id: COMPANY_IDS.PRIMARY_PAYROLL, name: 'Cedar Valley Payroll' },
        { id: COMPANY_IDS.SECONDARY_PAYROLL, name: 'Pine Ridge Health Network' },
        { id: COMPANY_IDS.MORTGAGE_SERVICER, name: 'Meadowbrook Mortgage' },
        { id: COMPANY_IDS.FRESH_MARKET, name: 'Fresh Market' },
        { id: COMPANY_IDS.WAREHOUSE_CLUB, name: 'Warehouse Club' },
        { id: COMPANY_IDS.ELECTRIC_AND_GAS, name: 'Suburban Gas & Electric' },
        { id: COMPANY_IDS.WATER_AND_SEWER, name: 'Metro Water & Sewer' },
        { id: COMPANY_IDS.HIGHWAY_FUEL, name: 'Highway Fuel Stop' },
        { id: COMPANY_IDS.CORNER_BISTRO, name: 'Corner Table Bistro' },
        { id: COMPANY_IDS.STREAMHOUSE_MEDIA, name: 'StreamHouse Media' },
        { id: COMPANY_IDS.FAMILY_SHIELD_INSURANCE, name: 'Family Shield Insurance' },
        { id: COMPANY_IDS.BRIGHTPATH_PEDIATRICS, name: 'BrightPath Pediatrics' },
        { id: COMPANY_IDS.LITTLE_OAKS_LEARNING, name: 'Little Oaks Learning Center' },
        { id: COMPANY_IDS.MAPLE_HARDWARE, name: 'Maple Hardware' },
        { id: COMPANY_IDS.UPTOWN_OUTFITTERS, name: 'Uptown Outfitters' },
        { id: COMPANY_IDS.SUNTRAIL_AIRLINES, name: 'SunTrail Airlines' },
        { id: COMPANY_IDS.HARBOR_DUNES_RESORT, name: 'Harbor Dunes Resort' },
        { id: COMPANY_IDS.RIVER_COUNTY_SCHOOLS, name: 'River County School District' },
        { id: COMPANY_IDS.FREELANCE_COLLECTIVE, name: 'Neighborhood Freelance Collective' },
        { id: COMPANY_IDS.STATE_REVENUE, name: 'State Revenue Department' },
        { id: COMPANY_IDS.MAIN_STREET_PHARMACY, name: 'Main Street Pharmacy' },
        { id: COMPANY_IDS.FIBERLINK_HOME, name: 'FiberLink Home' },
        { id: COMPANY_IDS.GREENFIELD_LAWN, name: 'GreenField Lawn Care' },
        { id: COMPANY_IDS.COMMUNITY_SOCCER_CLUB, name: 'Community Soccer Club' },
        { id: COMPANY_IDS.LAKESIDE_AUTO_FINANCE, name: 'Lakeside Auto Finance' },
        { id: COMPANY_IDS.COMFORT_HOME_CREDIT, name: 'Comfort Home Credit' },
        { id: COMPANY_IDS.HORIZON_WIRELESS, name: 'Horizon Wireless' },
        { id: COMPANY_IDS.MELODY_MUSIC, name: 'Melody Music' },
        { id: COMPANY_IDS.FITLIFE_GYM, name: 'FitLife Gym' },
        { id: COMPANY_IDS.CLOUD_VAULT_STORAGE, name: 'Cloud Vault Storage' },
        { id: COMPANY_IDS.TACO_JUNCTION, name: 'Taco Junction' },
        { id: COMPANY_IDS.CAMPUS_COFFEE, name: 'Campus Coffee' },
        { id: COMPANY_IDS.GAMESTATION_ONLINE, name: 'GameStation Online' },
        { id: COMPANY_IDS.THRIFT_LOOP, name: 'Thrift Loop' },
        { id: COMPANY_IDS.SUMMIT_CAFE, name: 'Summit Cafe' },
        { id: COMPANY_IDS.RIVER_COUNTY_FOOD_BANK, name: 'River County Food Bank' },
        { id: COMPANY_IDS.CEDAR_VALLEY_CREDIT_UNION, name: 'Cedar Valley Credit Union' },
        { id: COMPANY_IDS.BRIGHTFUTURE_529_PLAN, name: 'BrightFuture 529 Plan' },
        { id: COMPANY_IDS.LAKESIDE_SALON, name: 'Lakeside Salon & Barber' },
        { id: COMPANY_IDS.SEASIDE_GRILL, name: 'Seaside Grill' },
        { id: COMPANY_IDS.COMFORT_AIR_HVAC, name: 'Comfort Air HVAC' },
        { id: COMPANY_IDS.RIVER_CITY_CINEMA, name: 'River City Cinema' },
        { id: COMPANY_IDS.ONLINE_MARKETPLACE, name: 'Online Marketplace' },
        { id: COMPANY_IDS.RIVER_CITY_AUTO_SERVICE, name: 'River City Auto Service' },
        { id: COMPANY_IDS.SUNRISE_DINER, name: 'Sunrise Diner' },
        { id: COMPANY_IDS.RIVER_COUNTY_TAX_COLLECTOR, name: 'River County Tax Collector' },
      ];
    case 'projects':
      return scenario.projects.map((project) => ({
        id: project.id,
        name: project.name,
        company_name: project.company_name,
        contact_details: project.contact_details,
        project_category: project.project_category,
        status: project.status,
        start_date: project.start_date,
        end_date: project.end_date,
        estimated_cost: project.estimated_cost,
        actual_cost: project.actual_cost,
        notes: project.notes,
        budget_category_id: project.budget_category_id,
        monthly_contribution: project.monthly_contribution,
        contribution_start_month: project.contribution_start_month,
      }));
    case 'trips':
      return scenario.trips.map((trip) => ({
        id: trip.id,
        name: trip.name,
        destination: trip.destination,
        purpose: trip.purpose,
        trip_category: trip.trip_category,
        status: trip.status,
        start_date: trip.start_date,
        end_date: trip.end_date,
        estimated_cost: trip.estimated_cost,
        actual_cost: trip.actual_cost,
        notes: trip.notes,
        budget_category_id: trip.budget_category_id,
        monthly_contribution: trip.monthly_contribution,
        contribution_start_month: trip.contribution_start_month,
      }));
    case 'budget_plans':
      return scenario.budgetPlans.map((plan) => ({
        id: plan.id,
        effective_month: plan.effective_month,
        total_amount: plan.total_amount,
        notes: plan.notes,
      }));
    case 'budget_plan_categories': {
      let nextId = 1;
      return scenario.budgetPlans.flatMap((plan) =>
        plan.categories.map((line) => ({
          id: nextId++,
          plan_id: plan.id,
          category_id: line.category_id,
          amount: line.amount,
          carry_mode: line.carry_mode,
          carry_reset: 0,
        }))
      );
    }
    case 'income_sources': {
      const pay = scenario.paySchedule;
      return [
        {
          id: 1,
          name: 'Avery salary',
          kind: 'recurring_salary',
          user_id: USER_IDS.AVERY,
          account_id: null,
          amount: pay.averyPerCheck,
          frequency: 'biweekly',
          start_date: scenario.rangeStart,
          end_date: null,
          is_active: 1,
          notes: 'Take-home pay per biweekly paycheck',
          deposit_account_id: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
          match_pattern: 'CEDAR VALLEY PAYROLL',
        },
        {
          id: 2,
          name: 'Household checking income deposits',
          kind: 'linked_account',
          user_id: USER_IDS.AVERY,
          account_id: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
          amount: null,
          frequency: null,
          start_date: scenario.rangeStart,
          end_date: null,
          is_active: 1,
          notes: 'Actual income linked from deposits',
          deposit_account_id: null,
          match_pattern: null,
        },
        {
          id: 3,
          name: 'Jordan salary',
          kind: 'recurring_salary',
          user_id: USER_IDS.JORDAN,
          account_id: null,
          amount: pay.jordanPerCheck,
          frequency: 'semi_monthly',
          start_date: scenario.rangeStart,
          end_date: null,
          is_active: 1,
          notes: 'Take-home pay on the 1st and 15th',
          deposit_account_id: ACCOUNT_IDS.HOUSEHOLD_JOINT,
          match_pattern: 'PINE RIDGE HEALTH',
        },
        {
          id: 4,
          name: 'Riley part-time job',
          kind: 'recurring_salary',
          user_id: USER_IDS.RILEY,
          account_id: null,
          amount: pay.rileyPerCheck,
          frequency: 'biweekly',
          start_date: scenario.rangeStart,
          end_date: null,
          is_active: 1,
          notes: 'Weekend shifts at Summit Cafe',
          deposit_account_id: ACCOUNT_IDS.RILEY_TEEN_CHECKING,
          match_pattern: 'SUMMIT CAFE PAYROLL',
        },
      ];
    }
    case 'loans':
      return scenario.loans.map((loan) => ({
        id: loan.id,
        name: loan.name,
        loan_type: loan.loan_type,
        status: loan.status,
        owner_user_id: loan.owner_user_id,
        project_id: loan.project_id,
        account_id: loan.account_id,
        lender: loan.lender,
        opened_date: loan.opened_date,
        original_principal: loan.original_principal,
        interest_rate: loan.interest_rate,
        term_months: loan.term_months,
        expected_payment: loan.expected_payment,
        payment_due_day: loan.payment_due_day,
        first_payment_date: loan.first_payment_date,
        allows_full_payoff: loan.allows_full_payoff,
        prepayment_terms: loan.prepayment_terms,
        promo_end_date: loan.promo_end_date,
        deferred_interest_rate: loan.deferred_interest_rate,
        notes: loan.notes,
      }));
    case 'loan_match_rules': {
      let nextId = 1;
      return scenario.loans
        .filter((loan) => loan.rule)
        .map((loan) => ({
          id: nextId++,
          loan_id: loan.id,
          pattern: loan.rule.pattern,
          match_type: loan.rule.match_type,
          account_id: loan.rule.account_id,
          enabled: 1,
          notes: null,
        }));
    }
    case 'classification_rules':
      return [
        {
          id: 1,
          rule_key: 'user:sample-rainy-day-transfer',
          source: 'user',
          pattern: 'TRANSFER TO RAINY DAY SAVINGS',
          match_type: 'contains',
          priority: 100,
          type: 'transfer',
          account_id: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
          counterpart_account_id: ACCOUNT_IDS.RAINY_DAY_SAVINGS,
          enabled: 1,
          notes: 'Monthly savings sweep',
        },
        {
          id: 2,
          rule_key: 'user:sample-rewards-visa-autopay',
          source: 'user',
          pattern: 'REWARDS VISA AUTOPAY',
          match_type: 'contains',
          priority: 100,
          type: 'transfer',
          account_id: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
          counterpart_account_id: ACCOUNT_IDS.REWARDS_VISA,
          enabled: 1,
          notes: 'Statement balance paid in full each month',
        },
        {
          id: 3,
          rule_key: 'user:sample-riley-allowance',
          source: 'user',
          pattern: 'ZELLE TO RILEY',
          match_type: 'contains',
          priority: 100,
          type: 'transfer',
          account_id: ACCOUNT_IDS.HOUSEHOLD_JOINT,
          counterpart_account_id: ACCOUNT_IDS.RILEY_TEEN_CHECKING,
          enabled: 1,
          notes: "Riley's allowance",
        },
        // A one-legged transfer: the 529 is tracked by statement snapshots, so
        // the contribution has no incoming row to pair with. The rule alone
        // keeps it out of spending.
        {
          id: 4,
          rule_key: 'user:sample-529-contribution',
          source: 'user',
          pattern: 'BRIGHTFUTURE 529 CONTRIBUTION',
          match_type: 'contains',
          priority: 100,
          type: 'transfer',
          account_id: ACCOUNT_IDS.HOUSEHOLD_JOINT,
          counterpart_account_id: ACCOUNT_IDS.BRIGHTFUTURE_529,
          enabled: 1,
          notes: 'College savings contribution',
        },
      ];
    case 'account_balance_snapshots':
      return buildBalanceSnapshots(scenario);
    default:
      return null;
  }
}

/**
 * Statement balances for the accounts the app does not reconstruct from
 * transactions: the 401(k) and 529 grow a little every month, the two loan
 * accounts start at the borrowed amount (the loan rule scan keeps them in
 * step with the ledger afterwards).
 */
function buildBalanceSnapshots(scenario) {
  const random = createRandom(hashSeed(scenario.config.seed, 'snapshots'));
  const rows = [];
  let nextId = 1;
  let retirement = 86400;
  let college = 14200;

  rows.push({
    id: nextId++,
    account_id: ACCOUNT_IDS.HOME_MORTGAGE,
    as_of_date: scenario.rangeStart,
    balance: -scenario.loans[0].original_principal,
    note: 'Opening principal',
  });
  rows.push({
    id: nextId++,
    account_id: ACCOUNT_IDS.AUTO_LOAN,
    as_of_date: scenario.rangeStart,
    balance: -scenario.loans[1].original_principal,
    note: 'Opening principal',
  });

  for (const month of scenario.months) {
    const asOf = buildMonthDateString(month.monthDate, month.daysInMonth);
    if (asOf > scenario.rangeEnd) break;
    // Contribution plus employer match, then market movement between -1.5% and +2.5%.
    retirement = roundCurrency(retirement * (1 + random.between(-0.015, 0.025)) + 1150);
    college = roundCurrency(college * (1 + random.between(-0.01, 0.02)) + 250);
    rows.push({ id: nextId++, account_id: ACCOUNT_IDS.AVERY_401K, as_of_date: asOf, balance: retirement, note: 'Statement balance' });
    rows.push({ id: nextId++, account_id: ACCOUNT_IDS.BRIGHTFUTURE_529, as_of_date: asOf, balance: college, note: 'Statement balance' });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/**
 * Every baseline transaction of the window, oldest first, grouped by month.
 * Each entry carries what the row needs plus what the validation needs:
 * `expectedType` (income | expense | refund | transfer: what the app's scans
 * should decide), `transferKey` (shared by the two legs of a paired transfer),
 * `loanId` (a payment the loan rules should claim) and `recurringKey` (a
 * fixed charge the subscription scan should detect).
 */
export function buildHouseholdTransactionEntries(scenario) {
  const random = createRandom(hashSeed(scenario.config.seed, 'transactions'));
  const entries = [];
  const balances = new Map(scenario.accounts.map((account) => [account.id, toCents(account.opening_balance)]));
  // Card activity of the current month, paid off the following month.
  const cardActivity = new Map([
    [ACCOUNT_IDS.REWARDS_VISA, -toCents(ACCOUNTS_BY_ID.get(ACCOUNT_IDS.REWARDS_VISA).opening_balance)],
    [ACCOUNT_IDS.TRAVEL_MASTERCARD, -toCents(ACCOUNTS_BY_ID.get(ACCOUNT_IDS.TRAVEL_MASTERCARD).opening_balance)],
  ]);
  const furnaceLoan = scenario.loans.find((loan) => loan.id === LOAN_IDS.FURNACE);
  let furnaceRemainingCents = toCents(furnaceLoan.original_principal);

  const push = (month, spec) => {
    const date = buildMonthDateString(month.monthDate, spec.day);
    if (date < scenario.rangeStart || date > scenario.rangeEnd) return false;
    const amountCents = toCents(spec.amount);
    if (amountCents === 0) return false;
    const entry = {
      monthKey: month.monthKey,
      monthDate: month.monthDate,
      date,
      day: Number(date.slice(-2)),
      amountCents,
      description: spec.description,
      accountId: spec.accountId,
      cardId: spec.cardId === undefined ? getCardIdForAccount(spec.accountId) : spec.cardId,
      categoryId: spec.categoryId ?? null,
      companyId: spec.companyId ?? null,
      projectId: spec.projectId ?? null,
      tripId: spec.tripId ?? null,
      comment: spec.comment ?? null,
      type: amountCents > 0 ? 'income' : 'expense',
      expectedType: spec.expectedType ?? (amountCents > 0 ? 'income' : 'expense'),
      transferKey: spec.transferKey ?? null,
      loanId: spec.loanId ?? null,
      recurringKey: spec.recurringKey ?? null,
      hour: spec.hour ?? 12,
      minute: spec.minute ?? 0,
    };
    entries.push(entry);
    balances.set(entry.accountId, (balances.get(entry.accountId) ?? 0) + amountCents);
    if (cardActivity.has(entry.accountId) && entry.expectedType !== 'transfer') {
      cardActivity.set(entry.accountId, cardActivity.get(entry.accountId) - amountCents);
    }
    return true;
  };

  // Both legs of a transfer between two tracked accounts. `inDay` defaults to
  // the same day; card payments post a day later.
  const pushTransfer = (month, spec) => {
    const transferKey = `${month.monthKey}:${spec.key}`;
    const outPushed = push(month, {
      day: spec.day,
      amount: -spec.amount,
      description: spec.outDescription,
      accountId: spec.fromAccountId,
      expectedType: 'transfer',
      transferKey,
      hour: spec.hour ?? 9,
      minute: spec.minute ?? 0,
    });
    const inPushed = push(month, {
      day: spec.inDay ?? spec.day,
      amount: spec.amount,
      description: spec.inDescription,
      accountId: spec.toAccountId,
      expectedType: 'transfer',
      transferKey,
      hour: spec.hour ?? 9,
      minute: (spec.minute ?? 0) + 1,
    });
    return outPushed || inPushed;
  };

  // Paydays: Avery every other Friday, Riley every other Thursday.
  const averyPaydays = biweeklyDates(scenario.startDate, scenario.referenceDate, 5);
  const rileyPaydays = biweeklyDates(scenario.startDate, scenario.referenceDate, 4, 7);
  const paydaysByMonth = (paydays) => {
    const map = new Map();
    for (const date of paydays) {
      const key = date.slice(0, 7);
      map.set(key, [...(map.get(key) ?? []), Number(date.slice(-2))]);
    }
    return map;
  };
  const averyByMonth = paydaysByMonth(averyPaydays);
  const rileyByMonth = paydaysByMonth(rileyPaydays);

  const raise = (base, month) => roundCurrency(base * (1 + ANNUAL_RAISE) ** month.yearOffset);

  for (const month of scenario.months) {
    const { monthNumber, index } = month;

    // --- Income -----------------------------------------------------------
    for (const day of averyByMonth.get(month.monthKey) ?? []) {
      push(month, {
        day,
        amount: raise(scenario.paySchedule.averyPerCheck, month),
        description: 'CEDAR VALLEY PAYROLL DIRECT DEP',
        accountId: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
        categoryId: CATEGORY_IDS.SALARY,
        companyId: COMPANY_IDS.PRIMARY_PAYROLL,
        hour: 6,
        minute: 15,
      });
    }
    for (const day of [1, 15]) {
      push(month, {
        day,
        amount: raise(scenario.paySchedule.jordanPerCheck, month),
        description: 'PINE RIDGE HEALTH NETWORK PAYROLL',
        accountId: ACCOUNT_IDS.HOUSEHOLD_JOINT,
        categoryId: CATEGORY_IDS.SALARY,
        companyId: COMPANY_IDS.SECONDARY_PAYROLL,
        hour: 6,
        minute: 40,
      });
    }
    for (const day of rileyByMonth.get(month.monthKey) ?? []) {
      push(month, {
        day,
        amount: random.money(96, 188),
        description: 'SUMMIT CAFE PAYROLL',
        accountId: ACCOUNT_IDS.RILEY_TEEN_CHECKING,
        categoryId: CATEGORY_IDS.SALARY,
        companyId: COMPANY_IDS.SUMMIT_CAFE,
        hour: 7,
        minute: 5,
      });
    }
    if (monthNumber % 2 === 1) {
      push(month, {
        day: 27,
        amount: roundCurrency(435 + month.yearOffset * 28 + random.money(0, 160) + (monthNumber === 11 ? 95 : 0)),
        description: sideIncomeDescription(monthNumber),
        accountId: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
        categoryId: CATEGORY_IDS.SIDE_INCOME,
        companyId: COMPANY_IDS.FREELANCE_COLLECTIVE,
        hour: 18,
        minute: 10,
      });
    }
    if (monthNumber === 2) {
      push(month, {
        day: 5,
        amount: roundCurrency(2175 + month.yearOffset * 90 + random.money(0, 250)),
        description: 'STATE REVENUE DEPT TAX REFUND',
        accountId: ACCOUNT_IDS.RAINY_DAY_SAVINGS,
        categoryId: CATEGORY_IDS.TAX_REFUND,
        companyId: COMPANY_IDS.STATE_REVENUE,
        hour: 9,
        minute: 5,
      });
    }
    if (monthNumber === 11) {
      push(month, {
        day: 12,
        amount: roundCurrency(985 + month.yearOffset * 72),
        description: 'CEDAR VALLEY PAYROLL YEAR END BONUS',
        accountId: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
        categoryId: CATEGORY_IDS.SALARY,
        companyId: COMPANY_IDS.PRIMARY_PAYROLL,
        hour: 8,
        minute: 55,
      });
    }
    if (monthNumber === 5) {
      push(month, {
        day: 14,
        amount: 100,
        description: 'BIRTHDAY GIFT DEPOSIT',
        accountId: ACCOUNT_IDS.SAM_CUSTODIAL_SAVINGS,
        categoryId: CATEGORY_IDS.GIFTS_RECEIVED,
        companyId: null,
        cardId: null,
        hour: 11,
        minute: 30,
      });
    }

    // --- Moving money between the household's accounts ---------------------
    pushTransfer(month, {
      key: 'joint-funding',
      day: 2,
      amount: 300,
      fromAccountId: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
      toAccountId: ACCOUNT_IDS.HOUSEHOLD_JOINT,
      outDescription: 'ONLINE TRANSFER TO HOUSEHOLD JOINT',
      inDescription: 'ONLINE TRANSFER FROM HOUSEHOLD CHECKING',
      hour: 7,
    });
    pushTransfer(month, {
      key: 'savings',
      day: 5,
      amount: 400,
      fromAccountId: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
      toAccountId: ACCOUNT_IDS.RAINY_DAY_SAVINGS,
      outDescription: 'ONLINE TRANSFER TO RAINY DAY SAVINGS',
      inDescription: 'ONLINE TRANSFER FROM HOUSEHOLD CHECKING',
      hour: 7,
      minute: 30,
    });
    pushTransfer(month, {
      key: 'allowance',
      day: 1,
      amount: 60,
      fromAccountId: ACCOUNT_IDS.HOUSEHOLD_JOINT,
      toAccountId: ACCOUNT_IDS.RILEY_TEEN_CHECKING,
      outDescription: 'ZELLE TO RILEY PARKER',
      inDescription: 'ZELLE FROM JORDAN PARKER',
      hour: 8,
    });
    pushTransfer(month, {
      key: 'custodial',
      day: 15,
      amount: 50,
      fromAccountId: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
      toAccountId: ACCOUNT_IDS.SAM_CUSTODIAL_SAVINGS,
      outDescription: 'TRANSFER TO SAM CUSTODIAL SAVINGS',
      inDescription: 'TRANSFER FROM HOUSEHOLD CHECKING',
      hour: 8,
      minute: 20,
    });
    // One leg only: the 529 account is tracked by statement snapshots.
    push(month, {
      day: 10,
      amount: -250,
      description: 'BRIGHTFUTURE 529 CONTRIBUTION',
      accountId: ACCOUNT_IDS.HOUSEHOLD_JOINT,
      companyId: COMPANY_IDS.BRIGHTFUTURE_529_PLAN,
      expectedType: 'transfer',
      hour: 9,
      minute: 45,
    });
    // Card statements: last month's activity, paid from checking.
    const visaDue = cardActivity.get(ACCOUNT_IDS.REWARDS_VISA);
    if (visaDue > 0) {
      cardActivity.set(ACCOUNT_IDS.REWARDS_VISA, 0);
      pushTransfer(month, {
        key: 'visa-payment',
        day: 26,
        inDay: 27,
        amount: fromCents(visaDue),
        fromAccountId: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
        toAccountId: ACCOUNT_IDS.REWARDS_VISA,
        outDescription: 'REWARDS VISA AUTOPAY',
        inDescription: 'PAYMENT RECEIVED - THANK YOU',
        hour: 10,
      });
    }
    const mastercardDue = cardActivity.get(ACCOUNT_IDS.TRAVEL_MASTERCARD);
    if (mastercardDue > 0) {
      cardActivity.set(ACCOUNT_IDS.TRAVEL_MASTERCARD, 0);
      pushTransfer(month, {
        key: 'mastercard-payment',
        day: 27,
        inDay: 28,
        amount: fromCents(mastercardDue),
        fromAccountId: ACCOUNT_IDS.HOUSEHOLD_JOINT,
        toAccountId: ACCOUNT_IDS.TRAVEL_MASTERCARD,
        outDescription: 'PINE STATE BANK CARD PMT',
        inDescription: 'MASTERCARD PAYMENT RECEIVED THANK YOU',
        hour: 10,
        minute: 15,
      });
    }

    // --- Loans ------------------------------------------------------------
    for (const loan of scenario.loans) {
      if (loan.id === LOAN_IDS.FURNACE) {
        // Payments start the month after the purchase and stop once paid.
        if (month.monthKey <= loan.opened_date.slice(0, 7) || furnaceRemainingCents <= 0) continue;
        const amountCents = Math.min(toCents(loan.paymentAmount), furnaceRemainingCents);
        if (
          push(month, {
            day: loan.paymentDay,
            amount: -fromCents(amountCents),
            description: loan.paymentDescription,
            accountId: loan.paymentAccountId,
            categoryId: loan.paymentCategoryId,
            companyId: loan.paymentCompanyId,
            projectId: loan.project_id,
            loanId: loan.id,
            hour: 9,
            minute: 20,
          })
        ) {
          furnaceRemainingCents -= amountCents;
        }
        continue;
      }
      push(month, {
        day: loan.paymentDay,
        amount: -loan.paymentAmount,
        description: loan.paymentDescription,
        accountId: loan.paymentAccountId,
        categoryId: loan.paymentCategoryId,
        companyId: loan.paymentCompanyId,
        loanId: loan.rule ? loan.id : null,
        // Without a rule the scan treats the fixed monthly payment as a bill.
        recurringKey: loan.rule ? null : loan.paymentDescription,
        hour: 9,
        minute: 10,
      });
    }

    // --- Fixed bills and subscriptions (detectable series) -----------------
    const fixed = [
      { day: 14, amount: 79.99, description: 'FIBERLINK HOME INTERNET', accountId: ACCOUNT_IDS.HOUSEHOLD_CHECKING, categoryId: CATEGORY_IDS.UTILITIES, companyId: COMPANY_IDS.FIBERLINK_HOME },
      { day: 16, amount: 145, description: 'HORIZON WIRELESS', accountId: ACCOUNT_IDS.HOUSEHOLD_JOINT, categoryId: CATEGORY_IDS.UTILITIES, companyId: COMPANY_IDS.HORIZON_WIRELESS },
      { day: 24, amount: 168.4, description: 'FAMILY SHIELD AUTO INSURANCE', accountId: ACCOUNT_IDS.HOUSEHOLD_JOINT, categoryId: CATEGORY_IDS.INSURANCE, companyId: COMPANY_IDS.FAMILY_SHIELD_INSURANCE },
      { day: 5, amount: 15.99, description: 'STREAMHOUSE MEDIA', accountId: ACCOUNT_IDS.REWARDS_VISA, categoryId: CATEGORY_IDS.SUBSCRIPTIONS, companyId: COMPANY_IDS.STREAMHOUSE_MEDIA },
      { day: 7, amount: 10.99, description: 'MELODY MUSIC', accountId: ACCOUNT_IDS.REWARDS_VISA, categoryId: CATEGORY_IDS.SUBSCRIPTIONS, companyId: COMPANY_IDS.MELODY_MUSIC },
      { day: 2, amount: 45, description: 'FITLIFE GYM MEMBERSHIP', accountId: ACCOUNT_IDS.HOUSEHOLD_JOINT, categoryId: CATEGORY_IDS.SUBSCRIPTIONS, companyId: COMPANY_IDS.FITLIFE_GYM },
      { day: 11, amount: 2.99, description: 'CLOUD VAULT STORAGE', accountId: ACCOUNT_IDS.REWARDS_VISA, categoryId: CATEGORY_IDS.SUBSCRIPTIONS, companyId: COMPANY_IDS.CLOUD_VAULT_STORAGE },
      { day: 9, amount: 19.99, description: 'GAMESTATION ONLINE', accountId: ACCOUNT_IDS.RILEY_TEEN_CHECKING, categoryId: CATEGORY_IDS.ENTERTAINMENT, companyId: COMPANY_IDS.GAMESTATION_ONLINE },
    ];
    for (const bill of fixed) {
      push(month, { ...bill, amount: -bill.amount, recurringKey: bill.description, hour: 4, minute: 30 });
    }
    if (monthNumber === 8) {
      push(month, {
        day: 4,
        amount: -65,
        description: 'WAREHOUSE CLUB ANNUAL MEMBERSHIP',
        accountId: ACCOUNT_IDS.HOUSEHOLD_JOINT,
        categoryId: CATEGORY_IDS.SHOPPING,
        companyId: COMPANY_IDS.WAREHOUSE_CLUB,
        recurringKey: 'WAREHOUSE CLUB ANNUAL MEMBERSHIP',
        hour: 13,
      });
    }
    push(month, {
      day: 20,
      amount: -50,
      description: 'RIVER COUNTY FOOD BANK',
      accountId: ACCOUNT_IDS.HOUSEHOLD_JOINT,
      categoryId: CATEGORY_IDS.GIFTS_AND_DONATIONS,
      companyId: COMPANY_IDS.RIVER_COUNTY_FOOD_BANK,
      recurringKey: 'RIVER COUNTY FOOD BANK',
      hour: 12,
      minute: 5,
    });

    // --- Variable bills -----------------------------------------------------
    push(month, {
      day: 9,
      amount: -roundCurrency(142 + seasonalUtilitiesAdjustment(monthNumber) + random.money(0, 38)),
      description: 'SUBURBAN GAS & ELECTRIC',
      accountId: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
      categoryId: CATEGORY_IDS.UTILITIES,
      companyId: COMPANY_IDS.ELECTRIC_AND_GAS,
      hour: 10,
      minute: 5,
    });
    push(month, {
      day: 12,
      amount: -random.money(58, 74),
      description: 'METRO WATER & SEWER',
      accountId: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
      categoryId: CATEGORY_IDS.UTILITIES,
      companyId: COMPANY_IDS.WATER_AND_SEWER,
      hour: 10,
      minute: 20,
    });
    if (monthNumber === 0 || monthNumber === 6) {
      push(month, {
        day: 15,
        amount: -roundCurrency(2350 + month.yearOffset * 60),
        description: 'RIVER COUNTY TAX COLLECTOR',
        accountId: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
        categoryId: CATEGORY_IDS.HOUSING,
        companyId: COMPANY_IDS.RIVER_COUNTY_TAX_COLLECTOR,
        comment: 'Semiannual property tax',
        hour: 9,
        minute: 50,
      });
    }
    push(month, {
      day: 2,
      amount: -85,
      description: 'COMMUNITY SOCCER CLUB DUES',
      accountId: ACCOUNT_IDS.HOUSEHOLD_JOINT,
      categoryId: CATEGORY_IDS.CHILDCARE_AND_SCHOOL,
      companyId: COMPANY_IDS.COMMUNITY_SOCCER_CLUB,
      comment: 'Monthly club dues',
      recurringKey: 'COMMUNITY SOCCER CLUB DUES',
      hour: 8,
      minute: 30,
    });
    if (monthNumber >= 3 && monthNumber <= 9) {
      push(month, {
        day: 11,
        amount: -120,
        description: 'GREENFIELD LAWN CARE',
        accountId: ACCOUNT_IDS.HOUSEHOLD_JOINT,
        categoryId: CATEGORY_IDS.HOME_IMPROVEMENT,
        companyId: COMPANY_IDS.GREENFIELD_LAWN,
        comment: 'Mowing and edging',
        hour: 13,
        minute: 15,
      });
    }
    if ([0, 3, 6, 9].includes(monthNumber)) {
      push(month, {
        day: 14,
        amount: -random.money(180, 420),
        description: 'RIVER CITY AUTO SERVICE',
        accountId: ACCOUNT_IDS.TRAVEL_MASTERCARD,
        categoryId: CATEGORY_IDS.TRANSPORTATION,
        companyId: COMPANY_IDS.RIVER_CITY_AUTO_SERVICE,
        comment: 'Oil change, tires and inspection',
        hour: 11,
        minute: 10,
      });
    }
    if ([1, 4, 8, 11].includes(monthNumber)) {
      push(month, {
        day: 21,
        amount: -random.money(60, 150),
        description: 'UPTOWN OUTFITTERS',
        accountId: ACCOUNT_IDS.TRAVEL_MASTERCARD,
        categoryId: CATEGORY_IDS.GIFTS_AND_DONATIONS,
        companyId: COMPANY_IDS.UPTOWN_OUTFITTERS,
        comment: 'Birthday gift',
        hour: 17,
        minute: 20,
      });
    }
    push(month, {
      day: 28,
      amount: -random.money(35, 70),
      description: 'SUNRISE DINER',
      accountId: ACCOUNT_IDS.HOUSEHOLD_JOINT,
      categoryId: CATEGORY_IDS.DINING_OUT,
      companyId: COMPANY_IDS.SUNRISE_DINER,
      hour: 9,
      minute: 15,
    });
    for (const day of [3, 20]) {
      push(month, {
        day,
        amount: -random.money(40, 120),
        description: 'ONLINE MARKETPLACE',
        accountId: ACCOUNT_IDS.REWARDS_VISA,
        categoryId: CATEGORY_IDS.SHOPPING,
        companyId: COMPANY_IDS.ONLINE_MARKETPLACE,
        hour: 21,
        minute: 5,
      });
    }
    if ([1, 4, 7, 10].includes(monthNumber)) {
      push(month, {
        day: 24,
        amount: -roundCurrency(742 + month.yearOffset * 24),
        description: 'FAMILY SHIELD HOME INSURANCE',
        accountId: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
        categoryId: CATEGORY_IDS.INSURANCE,
        companyId: COMPANY_IDS.FAMILY_SHIELD_INSURANCE,
        hour: 11,
        minute: 30,
      });
    }

    // --- Groceries, fuel, dining, shopping ----------------------------------
    for (const day of saturdaysOf(month)) {
      const jordanShopping = random.chance(0.4);
      push(month, {
        day,
        amount: -roundCurrency((165 + seasonalGroceriesAdjustment(monthNumber)) * (1 + ANNUAL_RAISE) ** month.yearOffset + random.money(0, 90)),
        description: 'FRESH MARKET #214',
        accountId: ACCOUNT_IDS.REWARDS_VISA,
        cardId: jordanShopping ? CARD_IDS.REWARDS_VISA_JORDAN : CARD_IDS.REWARDS_VISA,
        categoryId: CATEGORY_IDS.GROCERIES,
        companyId: COMPANY_IDS.FRESH_MARKET,
        hour: 10,
        minute: 45,
      });
    }
    push(month, {
      day: 13,
      amount: -random.money(210, 290),
      description: 'WAREHOUSE CLUB',
      accountId: ACCOUNT_IDS.HOUSEHOLD_JOINT,
      categoryId: CATEGORY_IDS.GROCERIES,
      companyId: COMPANY_IDS.WAREHOUSE_CLUB,
      hour: 17,
      minute: 45,
    });
    for (const day of [6, 21]) {
      push(month, {
        day,
        amount: -random.money(42, 68),
        description: 'HIGHWAY FUEL STOP',
        accountId: ACCOUNT_IDS.REWARDS_VISA,
        categoryId: CATEGORY_IDS.TRANSPORTATION,
        companyId: COMPANY_IDS.HIGHWAY_FUEL,
        hour: 7,
        minute: 25,
      });
    }
    push(month, {
      day: 19,
      amount: -random.money(38, 61),
      description: 'HIGHWAY FUEL STOP',
      accountId: ACCOUNT_IDS.TRAVEL_MASTERCARD,
      categoryId: CATEGORY_IDS.TRANSPORTATION,
      companyId: COMPANY_IDS.HIGHWAY_FUEL,
      hour: 17,
      minute: 50,
    });
    push(month, {
      day: 10,
      amount: -random.money(64, 118),
      description: 'CORNER TABLE BISTRO',
      accountId: ACCOUNT_IDS.TRAVEL_MASTERCARD,
      categoryId: CATEGORY_IDS.DINING_OUT,
      companyId: COMPANY_IDS.CORNER_BISTRO,
      hour: 19,
      minute: 10,
    });
    push(month, {
      day: 23,
      amount: -random.money(28, 46),
      description: 'TACO JUNCTION',
      accountId: ACCOUNT_IDS.REWARDS_VISA,
      categoryId: CATEGORY_IDS.DINING_OUT,
      companyId: COMPANY_IDS.TACO_JUNCTION,
      hour: 18,
      minute: 35,
    });
    const shoppingAmount = random.money(70, 160);
    push(month, {
      day: 17,
      amount: -shoppingAmount,
      description: 'UPTOWN OUTFITTERS',
      accountId: ACCOUNT_IDS.REWARDS_VISA,
      categoryId: CATEGORY_IDS.SHOPPING,
      companyId: COMPANY_IDS.UPTOWN_OUTFITTERS,
      hour: 14,
      minute: 15,
    });
    if (index % 3 === 1) {
      // A return a few days later: money back on the card from the same merchant.
      push(month, {
        day: 22,
        amount: roundCurrency(Math.min(shoppingAmount, random.money(24, 58))),
        description: 'UPTOWN OUTFITTERS',
        accountId: ACCOUNT_IDS.REWARDS_VISA,
        categoryId: CATEGORY_IDS.SHOPPING,
        companyId: COMPANY_IDS.UPTOWN_OUTFITTERS,
        comment: 'Returned a jacket',
        expectedType: 'refund',
        hour: 15,
        minute: 5,
      });
    }
    if (monthNumber === 10) {
      push(month, {
        day: 28,
        amount: -roundCurrency(362 + month.yearOffset * 18 + random.money(0, 90)),
        description: 'UPTOWN OUTFITTERS',
        accountId: ACCOUNT_IDS.REWARDS_VISA,
        categoryId: CATEGORY_IDS.SHOPPING,
        companyId: COMPANY_IDS.UPTOWN_OUTFITTERS,
        comment: 'Holiday gifts and winter gear',
        hour: 20,
        minute: 5,
      });
    }
    if (index % 2 === 0) {
      push(month, {
        day: 15,
        amount: -random.money(38, 62),
        description: 'RIVER CITY CINEMA',
        accountId: ACCOUNT_IDS.TRAVEL_MASTERCARD,
        categoryId: CATEGORY_IDS.ENTERTAINMENT,
        companyId: COMPANY_IDS.RIVER_CITY_CINEMA,
        hour: 19,
        minute: 40,
      });
    }
    push(month, {
      day: 19,
      amount: -random.money(45, 85),
      description: 'LAKESIDE SALON & BARBER',
      accountId: ACCOUNT_IDS.HOUSEHOLD_JOINT,
      categoryId: CATEGORY_IDS.PERSONAL_CARE,
      companyId: COMPANY_IDS.LAKESIDE_SALON,
      hour: 16,
      minute: 0,
    });

    // --- Health, school, home -----------------------------------------------
    if ([0, 3, 8].includes(monthNumber)) {
      push(month, {
        day: 13,
        amount: -healthcareAmount(month.yearOffset, monthNumber),
        description: monthNumber === 8 ? 'MAIN STREET PHARMACY' : 'BRIGHTPATH PEDIATRICS',
        accountId: ACCOUNT_IDS.HOUSEHOLD_CHECKING,
        categoryId: CATEGORY_IDS.HEALTHCARE,
        companyId: monthNumber === 8 ? COMPANY_IDS.MAIN_STREET_PHARMACY : COMPANY_IDS.BRIGHTPATH_PEDIATRICS,
        comment: healthcareComment(monthNumber),
        hour: 16,
        minute: 35,
      });
    }
    if (index % 2 === 1) {
      push(month, {
        day: 8,
        amount: -random.money(18, 42),
        description: 'MAIN STREET PHARMACY',
        accountId: ACCOUNT_IDS.REWARDS_VISA,
        categoryId: CATEGORY_IDS.HEALTHCARE,
        companyId: COMPANY_IDS.MAIN_STREET_PHARMACY,
        hour: 12,
        minute: 50,
      });
    }
    push(month, {
      day: 18,
      amount: -schoolAndActivityAmount(month.yearOffset, monthNumber, index),
      description: schoolExpenseDescription(monthNumber),
      accountId: ACCOUNT_IDS.HOUSEHOLD_JOINT,
      categoryId: CATEGORY_IDS.CHILDCARE_AND_SCHOOL,
      companyId: schoolExpenseCompanyId(monthNumber),
      comment: schoolExpenseComment(monthNumber, index),
      hour: 14,
      minute: 20,
    });
    if ([3, 5, 9].includes(monthNumber)) {
      push(month, {
        day: monthNumber === 5 ? 25 : 26,
        amount: -homeImprovementAmount(month.yearOffset, monthNumber),
        description: monthNumber === 5 ? 'GREENFIELD LAWN CARE' : 'MAPLE HARDWARE',
        accountId: monthNumber === 9 ? ACCOUNT_IDS.RAINY_DAY_SAVINGS : ACCOUNT_IDS.HOUSEHOLD_CHECKING,
        categoryId: CATEGORY_IDS.HOME_IMPROVEMENT,
        companyId: monthNumber === 5 ? COMPANY_IDS.GREENFIELD_LAWN : COMPANY_IDS.MAPLE_HARDWARE,
        comment: homeImprovementComment(month.yearOffset, monthNumber),
        hour: 15,
        minute: 45,
      });
    }

    // --- Riley's own spending -----------------------------------------------
    for (const day of [4, 18]) {
      push(month, {
        day,
        amount: -random.money(6, 14),
        description: 'CAMPUS COFFEE',
        accountId: ACCOUNT_IDS.RILEY_TEEN_CHECKING,
        categoryId: CATEGORY_IDS.DINING_OUT,
        companyId: COMPANY_IDS.CAMPUS_COFFEE,
        hour: 15,
        minute: 30,
      });
    }
    if (index % 2 === 1) {
      push(month, {
        day: 25,
        amount: -random.money(12, 38),
        description: 'THRIFT LOOP',
        accountId: ACCOUNT_IDS.RILEY_TEEN_CHECKING,
        categoryId: CATEGORY_IDS.SHOPPING,
        companyId: COMPANY_IDS.THRIFT_LOOP,
        hour: 16,
        minute: 10,
      });
    }

    // --- Projects and trips -------------------------------------------------
    for (const spec of projectSpendFor(scenario, month)) push(month, spec);
    for (const spec of tripSpendFor(scenario, month, random)) push(month, spec);

    // --- Interest, on the last day of the month -------------------------------
    for (const [accountId, apy] of [
      [ACCOUNT_IDS.RAINY_DAY_SAVINGS, RAINY_DAY_APY],
      [ACCOUNT_IDS.SAM_CUSTODIAL_SAVINGS, CUSTODIAL_APY],
    ]) {
      const balanceCents = balances.get(accountId) ?? 0;
      if (balanceCents <= 0) continue;
      push(month, {
        day: month.daysInMonth,
        amount: roundCurrency((balanceCents / 100) * (apy / 12)),
        description: 'INTEREST PAID',
        accountId,
        categoryId: CATEGORY_IDS.INTEREST,
        companyId: COMPANY_IDS.CEDAR_VALLEY_CREDIT_UNION,
        cardId: null,
        hour: 23,
        minute: 30,
      });
    }
  }

  entries.sort((left, right) => left.date.localeCompare(right.date) || left.hour - right.hour || left.minute - right.minute);
  return entries;
}

function projectSpendFor(scenario, month) {
  const specs = [];
  const mudroom = scenario.projects.find((project) => project.id === PROJECT_IDS.MUDROOM);
  const furnace = scenario.projects.find((project) => project.id === PROJECT_IDS.FURNACE);
  const mudroomStart = mudroom.start_date.slice(0, 7);
  const mudroomEnd = mudroom.end_date.slice(0, 7);

  if (month.monthKey === mudroomStart) {
    specs.push(
      { day: 10, amount: -640, description: 'MAPLE HARDWARE', accountId: ACCOUNT_IDS.HOUSEHOLD_CHECKING, categoryId: CATEGORY_IDS.HOME_IMPROVEMENT, companyId: COMPANY_IDS.MAPLE_HARDWARE, projectId: PROJECT_IDS.MUDROOM, comment: 'Plywood, hooks and bench hardware', hour: 11, minute: 15 },
      { day: 24, amount: -385, description: 'MAPLE HARDWARE', accountId: ACCOUNT_IDS.HOUSEHOLD_CHECKING, categoryId: CATEGORY_IDS.HOME_IMPROVEMENT, companyId: COMPANY_IDS.MAPLE_HARDWARE, projectId: PROJECT_IDS.MUDROOM, comment: 'Paint and trim', hour: 11, minute: 40 }
    );
  }
  if (month.monthKey === mudroomEnd) {
    specs.push({ day: 2, amount: -620, description: 'MAPLE HARDWARE', accountId: ACCOUNT_IDS.REWARDS_VISA, categoryId: CATEGORY_IDS.HOME_IMPROVEMENT, companyId: COMPANY_IDS.MAPLE_HARDWARE, projectId: PROJECT_IDS.MUDROOM, comment: 'Cubby doors and cushions', hour: 12, minute: 5 });
  }
  if (month.monthKey === furnace.start_date.slice(0, 7)) {
    specs.push(
      { day: 6, amount: -240, description: 'RIVER COUNTY PERMIT OFFICE', accountId: ACCOUNT_IDS.HOUSEHOLD_CHECKING, categoryId: CATEGORY_IDS.HOME_IMPROVEMENT, companyId: null, projectId: PROJECT_IDS.FURNACE, comment: 'Mechanical permit', hour: 9, minute: 30 },
      { day: 8, amount: -350, description: 'COMFORT AIR HVAC', accountId: ACCOUNT_IDS.REWARDS_VISA, categoryId: CATEGORY_IDS.HOME_IMPROVEMENT, companyId: COMPANY_IDS.COMFORT_AIR_HVAC, projectId: PROJECT_IDS.FURNACE, comment: 'Thermostat upgrade, paid outside the financing', hour: 16, minute: 20 }
    );
  }
  return specs;
}

function tripSpendFor(scenario, month, random) {
  const beach = scenario.trips.find((trip) => trip.id === TRIP_IDS.BEACH_WEEK);
  const tripMonth = beach.start_date.slice(0, 7);
  const monthBefore = formatMonthKey(addUtcMonths(beach.monthDate, -1));
  const specs = [];

  if (month.monthKey === monthBefore) {
    specs.push({ day: 8, amount: -roundCurrency(486 + random.money(0, 90)), description: 'SUNTRAIL AIRLINES', accountId: ACCOUNT_IDS.TRAVEL_MASTERCARD, categoryId: CATEGORY_IDS.TRAVEL, companyId: COMPANY_IDS.SUNTRAIL_AIRLINES, tripId: TRIP_IDS.BEACH_WEEK, comment: 'Flights for four', hour: 6, minute: 20 });
  }
  if (month.monthKey === tripMonth) {
    specs.push(
      { day: 13, amount: -roundCurrency(892 + random.money(0, 120)), description: 'HARBOR DUNES RESORT', accountId: ACCOUNT_IDS.TRAVEL_MASTERCARD, categoryId: CATEGORY_IDS.TRAVEL, companyId: COMPANY_IDS.HARBOR_DUNES_RESORT, tripId: TRIP_IDS.BEACH_WEEK, comment: 'Beach house rental', hour: 12, minute: 50 },
      { day: 15, amount: -random.money(58, 96), description: 'SEASIDE GRILL', accountId: ACCOUNT_IDS.TRAVEL_MASTERCARD, categoryId: CATEGORY_IDS.DINING_OUT, companyId: COMPANY_IDS.SEASIDE_GRILL, tripId: TRIP_IDS.BEACH_WEEK, hour: 19, minute: 15 },
      { day: 17, amount: -random.money(58, 96), description: 'SEASIDE GRILL', accountId: ACCOUNT_IDS.TRAVEL_MASTERCARD, categoryId: CATEGORY_IDS.DINING_OUT, companyId: COMPANY_IDS.SEASIDE_GRILL, tripId: TRIP_IDS.BEACH_WEEK, hour: 19, minute: 45 },
      { day: 19, amount: -random.money(62, 84), description: 'HIGHWAY FUEL STOP', accountId: ACCOUNT_IDS.TRAVEL_MASTERCARD, categoryId: CATEGORY_IDS.TRANSPORTATION, companyId: COMPANY_IDS.HIGHWAY_FUEL, tripId: TRIP_IDS.BEACH_WEEK, comment: 'Drive home', hour: 14, minute: 10 }
    );
  }
  return specs;
}

// ---------------------------------------------------------------------------
// Expectations: what the app should show once its scans have run
// ---------------------------------------------------------------------------

/**
 * Builds the expectations manifest from the final transaction rows paired
 * with the entries they came from (`{ row, entry }`, natural mode only) and
 * the scenario. Money is in dollars rounded to cents; "expenses" follow the
 * app's `spendExpr` (expense rows minus refunds), "income" its `incomeExpr`,
 * and transfers count toward neither.
 */
export function buildSampleDataExpectations({ rowsWithEntries, scenario, meta }) {
  const months = new Map();
  const accounts = new Map(
    scenario.accounts.map((account) => [
      account.id,
      {
        id: account.id,
        name: account.name,
        type: account.type,
        openingBalance: account.opening_balance,
        openingBalanceDate: scenario.rangeStart,
        endingBalance: toCents(account.opening_balance),
        rowCount: 0,
        tracksBalanceBySnapshots: ['loan', 'investment', 'retirement'].includes(account.type),
      },
    ])
  );
  const transferGroups = new Map();
  const refunds = [];
  const loanPayments = new Map(scenario.loans.map((loan) => [loan.id, []]));
  const recurring = new Map();
  const expenseRowsByDescription = new Map();
  const projectSpend = new Map(scenario.projects.map((project) => [project.id, { rows: 0, spendCents: 0 }]));
  const tripSpend = new Map(scenario.trips.map((trip) => [trip.id, { rows: 0, spendCents: 0 }]));
  const byType = { income: 0, expense: 0, refund: 0, transfer: 0 };
  let singleLegTransfers = 0;

  for (const { row, entry } of rowsWithEntries) {
    const amountCents = toCents(row.amount);
    const monthKey = row.date.slice(0, 7);
    const month = months.get(monthKey) ?? {
      month: monthKey,
      rowCount: 0,
      incomeCents: 0,
      expenseCents: 0,
      refundCents: 0,
      transferOutCents: 0,
      transferLegCount: 0,
      spendByCategoryCents: {},
      incomeByAccountCents: {},
    };
    month.rowCount += 1;
    byType[entry.expectedType] += 1;

    const account = accounts.get(row.account_id);
    account.rowCount += 1;
    account.endingBalance += amountCents;

    switch (entry.expectedType) {
      case 'income':
        month.incomeCents += amountCents;
        month.incomeByAccountCents[row.account_id] = (month.incomeByAccountCents[row.account_id] ?? 0) + amountCents;
        break;
      case 'expense':
        month.expenseCents += -amountCents;
        addSpend(month.spendByCategoryCents, row.category_id, -amountCents);
        break;
      case 'refund':
        month.refundCents += amountCents;
        month.expenseCents -= amountCents;
        addSpend(month.spendByCategoryCents, row.category_id, -amountCents);
        refunds.push({ id: row.id, date: row.date, accountId: row.account_id, amount: row.amount, description: row.description });
        break;
      case 'transfer':
        month.transferLegCount += 1;
        if (amountCents < 0) month.transferOutCents += -amountCents;
        if (entry.transferKey) {
          const group = transferGroups.get(entry.transferKey) ?? { key: entry.transferKey, legs: [] };
          group.legs.push({ id: row.id, date: row.date, accountId: row.account_id, amount: row.amount, description: row.description });
          transferGroups.set(entry.transferKey, group);
        } else {
          singleLegTransfers += 1;
        }
        break;
      default:
        break;
    }

    if (entry.loanId) {
      loanPayments.get(entry.loanId).push({ id: row.id, date: row.date, amount: Math.abs(row.amount) });
    }
    if (entry.expectedType === 'expense') {
      expenseRowsByDescription.set(row.description, (expenseRowsByDescription.get(row.description) ?? 0) + 1);
    }
    if (entry.recurringKey && entry.expectedType === 'expense') {
      const series = recurring.get(entry.recurringKey) ?? {
        description: entry.recurringKey,
        accountId: row.account_id,
        amount: Math.abs(row.amount),
        occurrences: 0,
        dates: [],
      };
      series.occurrences += 1;
      series.dates.push(row.date);
      recurring.set(entry.recurringKey, series);
    }
    if (row.project_id) {
      const spend = projectSpend.get(row.project_id);
      spend.rows += 1;
      spend.spendCents += -amountCents;
    }
    if (row.trip_id) {
      const spend = tripSpend.get(row.trip_id);
      spend.rows += 1;
      spend.spendCents += -amountCents;
    }
    months.set(monthKey, month);
  }

  for (const payments of loanPayments.values()) payments.sort((left, right) => left.date.localeCompare(right.date));
  for (const series of recurring.values()) series.dates.sort();
  for (const group of transferGroups.values()) group.legs.sort((left, right) => left.date.localeCompare(right.date) || left.amount - right.amount);
  refunds.sort((left, right) => left.date.localeCompare(right.date));

  // Only groups with both legs inside the window are pairs the app can find.
  const pairs = [...transferGroups.values()].filter((group) => group.legs.length === 2);
  const orphanLegs = [...transferGroups.values()].filter((group) => group.legs.length !== 2);

  const monthList = [...months.values()]
    .sort((left, right) => left.month.localeCompare(right.month))
    .map((month) => ({
      month: month.month,
      rowCount: month.rowCount,
      income: fromCents(month.incomeCents),
      expenses: fromCents(month.expenseCents),
      refunds: fromCents(month.refundCents),
      transfersOut: fromCents(month.transferOutCents),
      transferLegCount: month.transferLegCount,
      net: fromCents(month.incomeCents - month.expenseCents),
      spendByCategory: Object.fromEntries(
        Object.entries(month.spendByCategoryCents).map(([categoryId, cents]) => [categoryId, fromCents(cents)])
      ),
      incomeByAccount: Object.fromEntries(
        Object.entries(month.incomeByAccountCents).map(([accountId, cents]) => [accountId, fromCents(cents)])
      ),
    }));

  const completeMonths = monthList.filter((month) => month.month !== scenario.rangeEnd.slice(0, 7) && month.month !== scenario.rangeStart.slice(0, 7));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    natural: Boolean(meta?.natural),
    currency: 'USD',
    window: {
      referenceDate: scenario.rangeEnd,
      startDate: scenario.rangeStart,
      monthsBack: scenario.config.monthsBack,
      firstMonth: scenario.months[0].monthKey,
      lastMonth: scenario.months[scenario.months.length - 1].monthKey,
      // Months with neither the window's first nor its last day inside them:
      // complete months, where every scheduled row is present.
      completeMonths: completeMonths.map((month) => month.month),
      seed: scenario.config.seed,
    },
    household: {
      users: getHouseholdBaseRows('users', scenario).map((user) => ({ id: user.id, name: user.display_name })),
      accountCount: scenario.accounts.length,
    },
    transactions: {
      total: rowsWithEntries.length,
      byExpectedType: byType,
      // Rows typed by the amount sign at import, before any scan runs.
      bySignType: {
        income: rowsWithEntries.filter(({ row }) => row.amount > 0).length,
        expense: rowsWithEntries.filter(({ row }) => row.amount < 0).length,
      },
    },
    months: monthList,
    accounts: [...accounts.values()].map((account) => ({
      ...account,
      endingBalance: fromCents(account.endingBalance),
    })),
    transfers: {
      pairCount: pairs.length,
      pairedLegCount: pairs.length * 2,
      singleLegCount: singleLegTransfers + orphanLegs.reduce((sum, group) => sum + group.legs.length, 0),
      // What `SELECT COUNT(*) FROM transactions WHERE type = 'transfer'` should return.
      expectedTransferRowCount: pairs.length * 2 + singleLegTransfers + orphanLegs.reduce((sum, group) => sum + group.legs.length, 0),
      // Legs whose partner falls outside the window (first or last month) and
      // therefore stay income / expense (or become a card refund) after the scan.
      orphanLegCount: orphanLegs.reduce((sum, group) => sum + group.legs.length, 0),
      pairs,
      orphans: orphanLegs,
    },
    refunds,
    loans: scenario.loans.map((loan) => {
      const payments = loanPayments.get(loan.id);
      return {
        id: loan.id,
        name: loan.name,
        loanType: loan.loan_type,
        accountId: loan.account_id,
        projectId: loan.project_id,
        originalPrincipal: loan.original_principal,
        expectedPayment: loan.expected_payment,
        ruleLinked: Boolean(loan.rule),
        paymentDescription: loan.paymentDescription,
        // Rule-linked loans: payments the loan rule scan should claim. The
        // auto loan has no rule, so its payments stay unlinked until one is added.
        expectedPaymentCount: payments.length,
        expectedTotalPaid: fromCents(payments.reduce((sum, payment) => sum + toCents(payment.amount), 0)),
        firstPaymentDate: payments[0]?.date ?? null,
        lastPaymentDate: payments[payments.length - 1]?.date ?? null,
        // Payment rows that exist in the window regardless of linking.
        paymentRowsInWindow: rowsWithEntries.filter(({ row }) => row.description === loan.paymentDescription && row.amount < 0).length,
      };
    }),
    subscriptions: [...recurring.values()]
      .map((series) => ({
        ...series,
        normalizedDescription: series.description,
        // Heuristic detection needs three regular occurrences of a fixed
        // amount, with no differently priced rows under the same description.
        detectable:
          series.occurrences >= 3 &&
          (expenseRowsByDescription.get(series.description) ?? 0) === series.occurrences,
        cadence: series.description === 'WAREHOUSE CLUB ANNUAL MEMBERSHIP' ? 'yearly' : 'monthly',
      }))
      .sort((left, right) => left.description.localeCompare(right.description)),
    budget: {
      plans: scenario.budgetPlans.map((plan) => ({
        id: plan.id,
        effectiveMonth: plan.effective_month,
        totalAmount: plan.total_amount,
        categories: plan.categories,
      })),
      funds: [
        ...scenario.projects.filter((project) => project.budget_category_id).map((project) => ({ kind: 'project', id: project.id, name: project.name, categoryId: project.budget_category_id, monthlyContribution: project.monthly_contribution, startMonth: project.contribution_start_month })),
        ...scenario.trips.filter((trip) => trip.budget_category_id).map((trip) => ({ kind: 'trip', id: trip.id, name: trip.name, categoryId: trip.budget_category_id, monthlyContribution: trip.monthly_contribution, startMonth: trip.contribution_start_month })),
      ],
    },
    projects: scenario.projects.map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
      startDate: project.start_date,
      endDate: project.end_date,
      linkedRows: projectSpend.get(project.id).rows,
      linkedSpend: fromCents(projectSpend.get(project.id).spendCents),
    })),
    trips: scenario.trips.map((trip) => ({
      id: trip.id,
      name: trip.name,
      status: trip.status,
      startDate: trip.start_date,
      endDate: trip.end_date,
      linkedRows: tripSpend.get(trip.id).rows,
      linkedSpend: fromCents(tripSpend.get(trip.id).spendCents),
    })),
  };
}

function addSpend(map, categoryId, cents) {
  const key = categoryId == null ? 'uncategorized' : String(categoryId);
  map[key] = (map[key] ?? 0) + cents;
}

// ---------------------------------------------------------------------------
// Flavor helpers
// ---------------------------------------------------------------------------

function sideIncomeDescription(monthNumber) {
  return monthNumber === 11
    ? 'FREELANCE COLLECTIVE HOLIDAY PORTRAITS'
    : ['FREELANCE COLLECTIVE CONSULTING', 'FREELANCE COLLECTIVE TUTORING', 'FREELANCE COLLECTIVE DESIGN'][monthNumber % 3];
}

function seasonalGroceriesAdjustment(monthNumber) {
  if (monthNumber === 10 || monthNumber === 11) return 24;
  if (monthNumber >= 5 && monthNumber <= 7) return 12;
  return 0;
}

function seasonalUtilitiesAdjustment(monthNumber) {
  if (monthNumber === 11 || monthNumber <= 1) return 72;
  if (monthNumber >= 5 && monthNumber <= 7) return 55;
  return 18;
}

function schoolAndActivityAmount(yearOffset, monthNumber, monthIndex) {
  if (monthNumber >= 5 && monthNumber <= 6) return roundCurrency(648 + yearOffset * 24 + (monthIndex % 2) * 42);
  if (monthNumber === 7) return roundCurrency(418 + yearOffset * 18 + (monthIndex % 3) * 28);
  if (monthNumber >= 8 && monthNumber <= 10) return roundCurrency(332 + yearOffset * 16 + (monthIndex % 3) * 22);
  if (monthNumber === 4) return roundCurrency(286 + yearOffset * 14 + (monthIndex % 2) * 18);
  return roundCurrency(244 + yearOffset * 12 + (monthIndex % 2) * 16);
}

function schoolExpenseDescription(monthNumber) {
  if (monthNumber >= 5 && monthNumber <= 6) return 'LITTLE OAKS LEARNING CENTER';
  if (monthNumber === 4 || monthNumber === 9) return 'COMMUNITY SOCCER CLUB';
  return 'RIVER COUNTY SCHOOL DISTRICT';
}

function schoolExpenseComment(monthNumber, monthIndex) {
  if (monthNumber >= 5 && monthNumber <= 6) return monthIndex % 2 === 0 ? 'Summer camp tuition and activity fees' : 'Day camp and swim lessons';
  if (monthNumber === 7) return 'Back-to-school supplies and registration fees';
  if (monthNumber === 9) return 'Fall sports dues';
  if (monthNumber === 4) return 'Spring field trips and soccer registration';
  if (monthNumber >= 8 && monthNumber <= 10) return 'After-school care and activity fees';
  return 'After-school care and classroom extras';
}

function schoolExpenseCompanyId(monthNumber) {
  if (monthNumber >= 5 && monthNumber <= 6) return COMPANY_IDS.LITTLE_OAKS_LEARNING;
  if (monthNumber === 4 || monthNumber === 9) return COMPANY_IDS.COMMUNITY_SOCCER_CLUB;
  return COMPANY_IDS.RIVER_COUNTY_SCHOOLS;
}

function healthcareAmount(yearOffset, monthNumber) {
  if (monthNumber === 0) return roundCurrency(126 + yearOffset * 7);
  if (monthNumber === 3) return roundCurrency(214 + yearOffset * 11);
  return roundCurrency(94 + yearOffset * 6);
}

function healthcareComment(monthNumber) {
  if (monthNumber === 0) return 'Winter pediatric visit and prescriptions';
  if (monthNumber === 3) return 'Spring dental visits and pharmacy refill';
  return 'Back-to-school physical and prescriptions';
}

function homeImprovementAmount(yearOffset, monthNumber) {
  if (monthNumber === 3) return roundCurrency(212 + yearOffset * 12 + (yearOffset % 2 === 0 ? 160 : 0));
  if (monthNumber === 5) return roundCurrency(338 + yearOffset * 15);
  return roundCurrency(286 + yearOffset * 14);
}

function homeImprovementComment(yearOffset, monthNumber) {
  if (monthNumber === 3) return ['Spring fence repair and garden supplies', 'Patio repair materials and mulch', 'Driveway patch and garden supplies', 'Garage shelving and tool refresh', 'Spring landscaping materials'][yearOffset % 5];
  if (monthNumber === 5) return ['Deck stain and yard cleanup', 'Backyard playset maintenance', 'Bathroom fixture refresh', 'Outdoor seating and garden updates', 'Summer landscaping and irrigation parts'][yearOffset % 5];
  return ['Fall gutter cleaning and weatherproofing', 'Furnace filter replacement', 'Window weatherproofing materials', 'Roof leak repair materials', 'Water heater flush'][yearOffset % 5];
}

// ---------------------------------------------------------------------------
// Deterministic randomness and date helpers
// ---------------------------------------------------------------------------

function hashSeed(seed, label) {
  const digest = createHash('sha256').update(`${seed}:${label}`).digest();
  return digest.readUInt32LE(0);
}

/** mulberry32: small, fast, deterministic. */
function createRandom(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    between: (min, max) => min + (max - min) * next(),
    /** A dollar amount with cents, never a round number (keeps transfer pairing unambiguous). */
    money: (min, max) => {
      const cents = Math.round((min + (max - min) * next()) * 100);
      return fromCents(cents % 100 === 0 ? cents + 37 : cents);
    },
    chance: (probability) => next() < probability,
  };
}

/** Every `intervalDays`-th `weekday` (0 = Sunday) from the first one on/after `start` through `end`. */
function biweeklyDates(start, end, weekday, offsetDays = 0) {
  const first = new Date(start.getTime());
  while (first.getUTCDay() !== weekday) first.setUTCDate(first.getUTCDate() + 1);
  first.setUTCDate(first.getUTCDate() + offsetDays);
  const dates = [];
  for (let cursor = first; cursor <= end; cursor = new Date(cursor.getTime() + 14 * 86400000)) {
    if (cursor >= start) dates.push(formatDate(cursor));
  }
  return dates;
}

function saturdaysOf(month) {
  const days = [];
  for (let day = 1; day <= month.daysInMonth; day += 1) {
    if (new Date(Date.UTC(month.monthDate.getUTCFullYear(), month.monthDate.getUTCMonth(), day)).getUTCDay() === 6) days.push(day);
  }
  return days;
}

/** Standard amortizing payment for `principal` at `aprPercent` over `termMonths`, in dollars. */
export function amortizingPayment(principal, aprPercent, termMonths) {
  const monthlyRate = aprPercent / 100 / 12;
  if (monthlyRate === 0) return roundCurrency(principal / termMonths);
  const factor = (1 + monthlyRate) ** termMonths;
  return roundCurrency((principal * monthlyRate * factor) / (factor - 1));
}

export function buildMonthDateString(monthDate, day) {
  const year = monthDate.getUTCFullYear();
  const month = monthDate.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, daysInMonth))).toISOString().slice(0, 10);
}

export function firstDayOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function addUtcMonths(monthDate, months) {
  return new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + months, 1));
}

export function diffCalendarMonths(startDate, endDate) {
  return (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + (endDate.getUTCMonth() - startDate.getUTCMonth());
}

export function getDaysInMonth(monthDate) {
  return new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0)).getUTCDate();
}

export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function formatMonthKey(date) {
  return date.toISOString().slice(0, 7);
}

export function roundCurrency(value) {
  return Number(value.toFixed(2));
}

export function toCents(value) {
  return Math.round(roundCurrency(value) * 100);
}

export function fromCents(value) {
  return roundCurrency(value / 100);
}
