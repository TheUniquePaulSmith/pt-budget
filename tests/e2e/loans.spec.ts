import { expect, test, type Page } from '@playwright/test';

import { bootstrapDatabase, navigateToPage, runQueryAndReadFirstCell } from './helpers/bootstrap';

// The sample data seeds three loans. The mortgage and the furnace financing
// come with payment rules (their payments link as soon as the Loans page
// opens); the auto loan is deliberately left without one, which gives this
// spec a ready-made payment stream ("LAKESIDE AUTO FINANCE PMT" from
// Household Joint every month) to link through the rule editor.
const AUTO_LOAN_NAME = 'Auto loan';
const AUTO_LOAN_DESCRIPTION_FRAGMENT = 'lakeside auto';
const AUTO_LOAN_DESCRIPTION = 'LAKESIDE AUTO FINANCE PMT';

async function addLoan(
  page: Page,
  options: { name: string; type?: 'Installment loan' | 'Deferred-interest financing'; principal: string; payment: string; promoEnd?: string }
) {
  await page.getByTestId('loans-add').click();
  const dialog = page.getByRole('dialog', { name: 'Add Loan' });
  await dialog.getByTestId('loan-name').fill(options.name);
  if (options.type) {
    await dialog.getByRole('combobox', { name: 'Type' }).click();
    await page.getByRole('option', { name: options.type }).click();
  }
  await dialog.getByTestId('loan-original-principal').fill(options.principal);
  await dialog.getByTestId('loan-expected-payment').fill(options.payment);
  if (options.promoEnd) {
    await dialog.getByTestId('loan-promo-end').fill(options.promoEnd);
  }
  await dialog.getByTestId('loan-form-save').click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId('loans-grid').getByText(options.name)).toBeVisible();
}

test.describe('Loans', () => {
  test('tracks a loan from creation through rule-linked payments and the subscriptions page @smoke', async ({ page }) => {
    await bootstrapDatabase(page);

    await navigateToPage(page, 'loans');
    await expect(page.getByRole('heading', { name: 'Loans', exact: true })).toBeVisible();
    const grid = page.getByTestId('loans-grid');
    await expect(grid.getByText('Home mortgage')).toBeVisible();
    await expect(grid.getByText(AUTO_LOAN_NAME)).toBeVisible();

    // Opening the page applied the seeded rules: the mortgage already has linked payments.
    await expect
      .poll(
        async () =>
          Number(
            await runQueryAndReadFirstCell(
              page,
              "SELECT COUNT(*) FROM loan_payments lp JOIN loans l ON l.id = lp.loan_id WHERE l.name = 'Home mortgage' AND lp.match_source = 'rule'"
            )
          )
      )
      .toBeGreaterThan(0);
    await navigateToPage(page, 'loans');

    // 1. A deferred-interest loan with a pay-by date shows its balance and deadline.
    await addLoan(page, {
      name: 'Kitchen remodel financing',
      type: 'Deferred-interest financing',
      principal: '3000',
      payment: '250',
      promoEnd: '2030-12-31',
    });
    const kitchenLoanId = Number(
      await runQueryAndReadFirstCell(page, "SELECT id FROM loans WHERE name = 'Kitchen remodel financing'")
    );
    await navigateToPage(page, 'loans');
    await expect(page.getByTestId(`loan-balance-${kitchenLoanId}`)).toHaveText('$3,000.00');
    await expect(page.getByTestId('loans-grid').getByText('2030-12-31', { exact: false })).toBeVisible();

    // 2. Detail view: record a manual payment and watch the balance fall.
    await page.getByRole('button', { name: 'View Kitchen remodel financing' }).click();
    const detail = page.getByTestId('loan-detail-dialog');
    await expect(detail.getByTestId('loan-detail-title')).toHaveText('Kitchen remodel financing');
    await expect(detail.getByTestId('loan-deferred-panel')).toContainText('Pay off by 2030-12-31');

    await detail.getByTestId('loan-record-payment').click();
    const paymentDialog = page.getByRole('dialog', { name: 'Record Payment' });
    await paymentDialog.getByTestId('loan-payment-date').fill('2026-02-15');
    await paymentDialog.getByTestId('loan-payment-amount').fill('500');
    await paymentDialog.getByTestId('loan-payment-save').click();
    await expect(paymentDialog).not.toBeVisible();
    await expect(detail.getByTestId('loan-detail-balance')).toHaveText('$2,500.00');
    await expect(detail.getByTestId('loan-principal-interest-chart')).toBeVisible();
    await detail.getByTestId('loan-detail-close').click();

    // 3. A payment rule on the seeded auto loan links its sample-data payments.
    await page.getByRole('button', { name: `View ${AUTO_LOAN_NAME}` }).click();
    await expect(detail.getByTestId('loan-detail-title')).toHaveText(AUTO_LOAN_NAME);
    await expect(detail.getByText('Payments (0)')).toBeVisible();
    await detail.getByTestId('loan-add-rule').click();
    const ruleDialog = page.getByRole('dialog', { name: `Track payments for ${AUTO_LOAN_NAME}` });
    await ruleDialog.getByTestId('loan-rule-pattern').fill(AUTO_LOAN_DESCRIPTION_FRAGMENT);
    await expect(ruleDialog.getByTestId('loan-rule-preview')).toBeVisible();
    await ruleDialog.getByTestId('loan-rule-save').click();
    await expect(ruleDialog).not.toBeVisible();
    await expect(detail.getByTestId('loan-rules-list')).toContainText('LAKESIDE AUTO');
    await expect(detail.getByText(/Payments \((\d+)\)/)).not.toHaveText('Payments (0)');
    await detail.getByTestId('loan-detail-close').click();

    const linkedPayments = Number(
      await runQueryAndReadFirstCell(
        page,
        `SELECT COUNT(*) FROM loan_payments lp JOIN loans l ON l.id = lp.loan_id WHERE l.name = '${AUTO_LOAN_NAME}' AND lp.match_source = 'rule'`
      )
    );
    const paymentRows = Number(
      await runQueryAndReadFirstCell(
        page,
        `SELECT COUNT(*) FROM transactions WHERE description = '${AUTO_LOAN_DESCRIPTION}' AND amount < 0`
      )
    );
    expect(linkedPayments).toBeGreaterThan(0);
    expect(linkedPayments).toBe(paymentRows);

    // 4. The Subscriptions page lists the loans with their rules, and the
    //    auto payments are no longer offered as a recurring charge.
    await navigateToPage(page, 'subscriptions');
    const loansSection = page.getByTestId('subscriptions-loans-section');
    await expect(loansSection).toBeVisible();
    await expect(loansSection).toContainText(AUTO_LOAN_NAME);
    await expect(loansSection).toContainText('LAKESIDE AUTO');
    await expect(page.getByText(AUTO_LOAN_DESCRIPTION, { exact: true })).toHaveCount(0);
  });
});
