import { expect, test, type Page } from '@playwright/test';

import { bootstrapDatabase, navigateToPage, runQueryAndReadFirstCell } from './helpers/bootstrap';

// The sample data pays "Monthly mortgage payment" from Household Checking
// every month, which makes it a ready-made loan payment stream for rules.
const MORTGAGE_DESCRIPTION_FRAGMENT = 'mortgage';

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
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('loans-grid').getByText(options.name)).toBeVisible({ timeout: 30_000 });
}

test.describe('Loans', () => {
  test('tracks a loan from creation through rule-linked payments and the subscriptions page @smoke', async ({ page }) => {
    await bootstrapDatabase(page);

    await navigateToPage(page, 'loans');
    await expect(page.getByRole('heading', { name: 'Loans', exact: true })).toBeVisible();
    await expect(page.getByText('No loans yet')).toBeVisible();

    // 1. A deferred-interest loan with a pay-by date shows its balance and deadline.
    await addLoan(page, {
      name: 'Furnace financing',
      type: 'Deferred-interest financing',
      principal: '3000',
      payment: '250',
      promoEnd: '2030-12-31',
    });
    await expect(page.getByTestId('loan-balance-1')).toHaveText('$3,000.00', { timeout: 30_000 });
    await expect(page.getByTestId('loans-grid').getByText('2030-12-31', { exact: false })).toBeVisible();

    // 2. Detail view: record a manual payment and watch the balance fall.
    await page.getByRole('button', { name: 'View Furnace financing' }).click();
    const detail = page.getByTestId('loan-detail-dialog');
    await expect(detail.getByTestId('loan-detail-title')).toHaveText('Furnace financing');
    await expect(detail.getByTestId('loan-deferred-panel')).toContainText('Pay off by 2030-12-31');

    await detail.getByTestId('loan-record-payment').click();
    const paymentDialog = page.getByRole('dialog', { name: 'Record Payment' });
    await paymentDialog.getByTestId('loan-payment-date').fill('2026-02-15');
    await paymentDialog.getByTestId('loan-payment-amount').fill('500');
    await paymentDialog.getByTestId('loan-payment-save').click();
    await expect(paymentDialog).not.toBeVisible();
    await expect(detail.getByTestId('loan-detail-balance')).toHaveText('$2,500.00', { timeout: 30_000 });
    await expect(detail.getByTestId('loan-principal-interest-chart')).toBeVisible();
    await detail.getByTestId('loan-detail-close').click();

    // 3. An installment loan with a payment rule links the sample-data mortgage payments.
    await addLoan(page, { name: 'House mortgage', principal: '250000', payment: '1500' });
    await page.getByRole('button', { name: 'View House mortgage' }).click();
    await detail.getByTestId('loan-add-rule').click();
    const ruleDialog = page.getByRole('dialog', { name: 'Track payments for House mortgage' });
    await ruleDialog.getByTestId('loan-rule-pattern').fill(MORTGAGE_DESCRIPTION_FRAGMENT);
    await expect(ruleDialog.getByTestId('loan-rule-preview')).toBeVisible({ timeout: 30_000 });
    await ruleDialog.getByTestId('loan-rule-save').click();
    await expect(ruleDialog).not.toBeVisible({ timeout: 30_000 });
    await expect(detail.getByTestId('loan-rules-list')).toContainText('MORTGAGE');
    await expect(detail.getByText(/Payments \((\d+)\)/)).not.toHaveText('Payments (0)', { timeout: 30_000 });
    await detail.getByTestId('loan-detail-close').click();

    const linkedPayments = Number(
      await runQueryAndReadFirstCell(
        page,
        "SELECT COUNT(*) FROM loan_payments lp JOIN loans l ON l.id = lp.loan_id WHERE l.name = 'House mortgage' AND lp.match_source = 'rule'"
      )
    );
    expect(linkedPayments).toBeGreaterThan(0);

    // 4. The Subscriptions page lists the loans with their rules, and the
    //    mortgage payments are no longer offered as a recurring charge.
    await navigateToPage(page, 'subscriptions');
    const loansSection = page.getByTestId('subscriptions-loans-section');
    await expect(loansSection).toBeVisible({ timeout: 30_000 });
    await expect(loansSection).toContainText('House mortgage');
    await expect(loansSection).toContainText('MORTGAGE');
    await expect(page.getByText('Monthly mortgage payment', { exact: true })).toHaveCount(0);
  });
});
