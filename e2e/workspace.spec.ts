import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'

async function navigate(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Open navigation' })
  if (await menu.isVisible()) await menu.click()
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name, exact: false })
    .click()
  const headings: Record<string, string> = {
    Overview: 'A little clarity for your data.',
    'Data explorer': 'A closer look, row by row.',
    'Model lab': 'Find the signal. Test the idea.',
    Reports: 'From findings to next steps.',
  }
  await expect(page.getByRole('heading', { name: headings[name], exact: true })).toBeVisible()
}

async function ready(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'A little clarity for your data.' })).toBeVisible()
  await expect(page.locator('.recharts-area-curve')).toBeVisible()
}

test('demo loads without browser errors or external runtime requests', async ({ page }) => {
  const errors: string[] = []
  const external: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) external.push(request.url())
  })
  await ready(page)
  await expect(page.locator('.stat-card .stat-value').first()).toContainText('2,412')
  const first = await page.locator('.chart-summary strong').innerText()
  await page.getByLabel('Chart aggregation').selectOption('mean')
  await expect(page.locator('.chart-summary strong')).not.toHaveText(first)
  await page.getByLabel('Chart metric').selectOption('units')
  await expect(page.locator('.chart-summary .eyebrow')).toContainText('UNITS')
  expect(errors).toEqual([])
  expect(external).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('explorer searches, sorts, paginates, profiles and measures relationships', async ({ page }) => {
  await ready(page)
  await page.clock.install()
  await navigate(page, 'Data explorer')
  await expect(page.getByRole('heading', { name: 'A closer look, row by row.' })).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(25)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  // Regression: an unnecessary initial debounce used to reset this first page change.
  await page.clock.fastForward(350)
  await expect(page.locator('.table-pagination')).toContainText('26–50')
  await page.getByRole('textbox', { name: 'Search dataset' }).fill('FN-10001')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.locator('tbody')).toContainText('FN-10001')
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(25)
  await page.getByRole('button', { name: 'revenue', exact: true }).click()
  await expect(page.getByRole('columnheader', { name: 'revenue', exact: true })).toHaveAttribute(
    'aria-sort',
    'ascending'
  )
  await page.getByRole('tab', { name: 'Column profile' }).click()
  await page.locator('.schema-row').filter({ hasText: 'revenue' }).click()
  await expect(page.locator('.column-detail')).toContainText('Median')
  await page.getByRole('tab', { name: 'Relationships' }).click()
  await expect(page.getByRole('heading', { name: 'What moves together?' })).toBeVisible()
  await expect(page.locator('.correlation-row').first()).toContainText('complete pairs')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('uploads, analyzes, exports and removes a real CSV', async ({ page }) => {
  await ready(page)
  await page.getByRole('button', { name: 'New analysis' }).click()
  await page.getByLabel('Choose CSV file').setInputFiles({
    name: 'browser-fixture.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'order_id,date,region,revenue\n001,2026-01-01,North,10\n002,2026-02-01,South,20\n003,2026-03-01,North,30\n004,2026-04-01,South,40\n'
    ),
  })
  await page.getByRole('button', { name: 'Let’s find the story' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.locator('.dataset-strip-name')).toContainText('browser-fixture.csv')
  await expect(page.locator('.stat-card').first()).toContainText('4')
  await navigate(page, 'Data explorer')
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await expect(page.locator('tbody tr').first()).toContainText('001')
  await navigate(page, 'Reports')
  await expect(page.locator('.report-title h2')).toHaveText('browser-fixture')
  const event = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download report', exact: true }).click()
  const download = await event
  expect(download.suggestedFilename()).toBe('browser-fixture-report.md')
  const path = await download.path()
  expect(path).toBeTruthy()
  expect(await readFile(path!, 'utf8')).toContain('Rows: 4')
  const jsonEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: /Structured findings/ }).click()
  const json = await jsonEvent
  const report = JSON.parse(await readFile((await json.path())!, 'utf8'))
  expect(report.analysis.row_count).toBe(4)
  if (await page.getByRole('button', { name: 'Open navigation' }).isVisible())
    await page.getByRole('button', { name: 'Open navigation' }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete browser-fixture.csv', exact: true }).click()
  await expect(page.locator('.dataset-strip-name')).toContainText('Commerce performance.csv')
})

test('malformed uploads are actionable and the modal restores keyboard focus', async ({ page }) => {
  await ready(page)
  const trigger = page.getByRole('button', { name: 'New analysis' })
  await trigger.click()
  await page
    .getByLabel('Choose CSV file')
    .setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('x,x\n1,2') })
  await page.getByRole('button', { name: 'Let’s find the story' }).click()
  await expect(page.getByRole('alert')).toContainText('unique')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(trigger).toBeFocused()
})

test('trains a baseline with real metrics and adds it to the report', async ({ page }) => {
  await ready(page)
  await navigate(page, 'Model lab')
  await expect(page.getByRole('heading', { name: 'Find the signal. Test the idea.' })).toBeVisible()
  await page.getByLabel('What would you like to predict?', { exact: false }).selectOption('revenue')
  await page.getByLabel('What kind of question is it?', { exact: false }).selectOption('regression')
  await page.getByLabel('How should we test it?', { exact: false }).selectOption('time')
  await page.getByRole('button', { name: 'Train baseline' }).click()
  await expect(page.getByText('EXPERIMENT COMPLETE', { exact: true })).toBeVisible()
  await expect(page.locator('.model-metric')).toHaveCount(3)
  await expect(page.locator('.importance-row').first()).toContainText('Units')
  await expect(page.getByRole('heading', { name: 'Predictions meet reality' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await navigate(page, 'Reports')
  await expect(page.getByText('EXPERIMENT INCLUDED', { exact: true })).toBeVisible()
})

test('classification and feature selection produce a real confusion matrix', async ({ page }) => {
  await ready(page)
  await navigate(page, 'Model lab')
  await page.getByLabel('What would you like to predict?', { exact: false }).selectOption('customer_type')
  await page.getByLabel('What kind of question is it?', { exact: false }).selectOption('classification')
  await page.getByRole('button', { name: /selected features/ }).click()
  await page
    .locator('.feature-list label')
    .filter({ hasText: 'discount_pct' })
    .getByRole('checkbox')
    .uncheck()
  await page.getByRole('button', { name: 'Train baseline' }).click()
  await expect(page.getByRole('heading', { name: 'Where the classes get confused' })).toBeVisible()
  await expect(page.locator('.confusion-panel tbody tr')).toHaveCount(2)
  await expect(page.locator('.importance-list')).not.toContainText('Discount pct')
  await navigate(page, 'Reports')
  await navigate(page, 'Model lab')
  await expect(page.getByLabel('What would you like to predict?', { exact: false })).toHaveValue(
    'customer_type'
  )
  await page.getByRole('button', { name: /selected features/ }).click()
  await expect(
    page.locator('.feature-list label').filter({ hasText: 'discount_pct' }).getByRole('checkbox')
  ).not.toBeChecked()
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(results.violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('service errors offer retry rather than a blank screen', async ({ page }) => {
  await page.route('**/api/demo', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Temporary test outage' }),
    })
  )
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Temporary test outage')
  await page.unroute('**/api/demo')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: 'A little clarity for your data.' })).toBeVisible()
})

for (const name of ['Overview', 'Data explorer', 'Model lab', 'Reports']) {
  test(`${name} passes automated WCAG AA checks`, async ({ page }) => {
    await ready(page)
    if (name !== 'Overview') await navigate(page, name)
    if (name === 'Data explorer') await expect(page.locator('tbody tr')).toHaveCount(25)
    if (name === 'Model lab')
      await expect(page.getByRole('heading', { name: 'Design your experiment' })).toBeVisible()
    if (name === 'Reports') await expect(page.locator('.report-title')).toBeVisible()
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(results.violations).toEqual([])
  })
}

test('upload dialog passes automated WCAG AA checks', async ({ page }) => {
  await ready(page)
  await page.getByRole('button', { name: 'New analysis' }).click()
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(results.violations).toEqual([])
})
