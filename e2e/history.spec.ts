import { expect, test, type Page } from "@playwright/test";

/**
 * Critical browser flows (brief 13.5), run against the real imported history.
 *
 * These assert on specific real records — the Full Murph's 58:52 total and the
 * two sessions on 2026-04-14 — because those are the exact cases the import was
 * designed around. A regression in the data model or the UI then fails with a
 * recognisable symptom instead of a blank page.
 */

const EMAIL = "roman@local.test";
const PASSWORD = "localdev";

/** `exact` matters: "Today" also matches the "Today's sessions" subheading. */
const todayHeading = (page: Page) => page.getByRole("heading", { name: "Today", exact: true });

async function signIn(page: Page) {
  await page.goto("/");
  if (
    await todayHeading(page)
      .isVisible()
      .catch(() => false)
  )
    return;
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(todayHeading(page)).toBeVisible({ timeout: 20_000 });
}

/** The filter panel is a collapsed <details>; its inputs need it opened. */
async function openFilters(page: Page) {
  const summary = page.getByText("Filters", { exact: true });
  await expect(summary).toBeVisible({ timeout: 20_000 });
  if (
    !(await page
      .getByLabel("From", { exact: true })
      .isVisible()
      .catch(() => false))
  ) {
    await summary.click();
  }
  await expect(page.getByLabel("From", { exact: true })).toBeVisible();
}

async function filterToDate(page: Page, date: string) {
  await page.goto("/history");
  await openFilters(page);
  await page.getByLabel("From", { exact: true }).fill(date);
  await page.getByLabel("To", { exact: true }).fill(date);
}

const sessionLinks = (page: Page) => page.locator("a[href^='/sessions/']");

test.describe("signed-in shell", () => {
  test("signs in and lands on Today", async ({ page }) => {
    await signIn(page);
    await expect(todayHeading(page)).toBeVisible();
    // The summary tiles are counted from the imported history, not hardcoded.
    await expect(page.getByText("Sessions logged")).toBeVisible();
  });

  test("navigates to History and lists imported sessions", async ({ page }) => {
    await signIn(page);
    await page.goto("/history");
    await expect(page.getByRole("heading", { name: "History", exact: true })).toBeVisible();
    // 244 sessions were imported, so the first page cannot be empty.
    await expect(sessionLinks(page).first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("imported data reaches the screen", () => {
  /**
   * Acceptance criterion 11 end to end: the workbook cell R17C3 held a gym
   * workout and a bike commute, and the importer had to split them.
   */
  test("one date holds two independent sessions", async ({ page }) => {
    await signIn(page);
    await filterToDate(page, "2026-04-14");
    await expect(sessionLinks(page)).toHaveCount(2, { timeout: 20_000 });
  });

  /**
   * Acceptance criterion 10 end to end. The 58:52 total must survive, and the
   * cumulative splits must be labelled as such — `split_seconds` is null by
   * design and the UI must not invent a per-movement duration.
   */
  test("the Full Murph shows 58:52 and labels its cumulative splits", async ({ page }) => {
    await signIn(page);
    await filterToDate(page, "2026-06-07");
    await expect(sessionLinks(page).first()).toBeVisible({ timeout: 20_000 });
    await sessionLinks(page).first().click();

    await expect(page.getByText("58:52").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/cumulative/i).first()).toBeVisible();
  });

  /**
   * Acceptance criterion 12 end to end. R15C6 recorded
   * `4x10 lat pulldown (value = 6)`; 6 is a pin position, not six kilograms.
   * The screen must say "setting 6" and must not show a kg figure for it.
   */
  test("a machine setting is shown as a setting, not as kilograms", async ({ page }) => {
    await signIn(page);
    await filterToDate(page, "2026-04-03");
    await expect(sessionLinks(page).first()).toBeVisible({ timeout: 20_000 });
    await sessionLinks(page).first().click();

    await expect(page.getByText("setting 6").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("6 kg")).toHaveCount(0);
  });
});

test.describe("the app works without AI", () => {
  test("Record offers manual entry and does not fake voice", async ({ page }) => {
    await signIn(page);
    await page.goto("/record");
    await expect(page.getByRole("heading", { name: "Record", exact: true })).toBeVisible();
    // VITE_AI_WORKER_URL is unset locally, so the mic must be disabled and say so.
    await expect(page.getByText(/VITE_AI_WORKER_URL|switched off/i).first()).toBeVisible();
    await page
      .getByRole("button", { name: /enter manually/i })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: /log a session/i })).toBeVisible();
  });

  test("import review surfaces the entries needing review", async ({ page }) => {
    await signIn(page);
    await page.goto("/import-review");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
    // 13 of the 170 imported cells were flagged review_required.
    await expect(page.getByText(/review/i).first()).toBeVisible();
  });
});
