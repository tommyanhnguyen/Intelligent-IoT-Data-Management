import { expect, test } from "@playwright/test";

const loginRoute = "**/api/auth/login";
const refreshRoute = "**/api/auth/refresh";
const verifyRoute = "**/api/auth/mfa/verify";
const resendRoute = "**/api/auth/mfa/resend";
const datasetsRoute = "**/api/datasets";
const initialChallengeId = "mfa-challenge-initial";
const replacementChallengeId = "mfa-challenge-replacement";

async function routeMfaLogin(page, mfaChallengeId = initialChallengeId) {
  await page.route(refreshRoute, (route) => route.fulfill({
    status: 401,
    json: { error: { message: "Sign-in required." } },
  }));
  await page.route(loginRoute, (route) => route.fulfill({
    status: 202,
    json: { data: { mfaChallengeId } },
  }));
}

async function openMfa(page, mfaChallengeId = initialChallengeId) {
  await routeMfaLogin(page, mfaChallengeId);
  await page.goto("/");
  await page.getByLabel("Email Address").fill("mfa@example.com");
  await page.getByLabel("Password").fill("valid-password");
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Two-Factor Authentication" }),
  ).toBeVisible();

  return page.getByLabel("6-digit verification code");
}

test("renders one six-digit OTP input with the expected input attributes", async ({ page }) => {
  const otpInput = await openMfa(page);

  await expect(otpInput).toHaveCount(1);
  await expect(otpInput).toHaveAttribute("type", "text");
  await expect(otpInput).toHaveAttribute("inputmode", "numeric");
  await expect(otpInput).toHaveAttribute("maxlength", "6");
  await expect(otpInput).toHaveAttribute("autocomplete", "one-time-code");
});

test("accepts six typed numeric digits and preserves a leading zero", async ({ page }) => {
  const otpInput = await openMfa(page);

  await otpInput.pressSequentially("012345");

  await expect(otpInput).toHaveValue("012345");
});

test("pastes a complete six-digit OTP", async ({ page }) => {
  await page.context().grantPermissions(
    ["clipboard-read", "clipboard-write"],
    { origin: "http://127.0.0.1:5173" },
  );
  const otpInput = await openMfa(page);

  await page.evaluate(() => navigator.clipboard.writeText("012345"));
  await otpInput.focus();
  await page.keyboard.press("ControlOrMeta+V");

  await expect(otpInput).toHaveValue("012345");
});

test("removes non-numeric characters and truncates OTP values after six digits", async ({ page }) => {
  const otpInput = await openMfa(page);

  await otpInput.pressSequentially("a1b2c3d4e5f6");
  await expect(otpInput).toHaveValue("123456");

  await otpInput.fill("987654321");
  await expect(otpInput).toHaveValue("987654");
});

test("rejects an incomplete OTP without calling verification", async ({ page }) => {
  let verificationRequests = 0;
  await page.route(verifyRoute, (route) => {
    verificationRequests += 1;
    return route.fulfill({ json: { data: { accessToken: "unused" } } });
  });
  const otpInput = await openMfa(page);

  await otpInput.fill("12345");
  await page.getByRole("button", { name: "Verify Code", exact: true }).click();

  await expect(
    page.getByText("Please enter the 6-digit verification code."),
  ).toBeVisible();
  expect(verificationRequests).toBe(0);
});

test("verifies a complete OTP with the existing payload and navigates home", async ({ page }) => {
  let verificationPayload;
  await page.route(verifyRoute, (route) => {
    verificationPayload = route.request().postDataJSON();
    return route.fulfill({ json: { data: { accessToken: "verified-token" } } });
  });
  await page.route(datasetsRoute, (route) => route.fulfill({ json: [] }));
  const otpInput = await openMfa(page);

  await otpInput.fill("012345");
  await page.getByRole("button", { name: "Verify Code", exact: true }).click();

  await expect(page).toHaveURL(/\/home$/);
  expect(verificationPayload).toEqual({
    mfaChallengeId: initialChallengeId,
    otp: "012345",
  });
});

test("shows the backend verification error without leaving the MFA screen", async ({ page }) => {
  await page.route(verifyRoute, (route) => route.fulfill({
    status: 401,
    json: { error: { message: "The verification code is invalid." } },
  }));
  const otpInput = await openMfa(page);

  await otpInput.fill("123456");
  await page.getByRole("button", { name: "Verify Code", exact: true }).click();

  await expect(page.getByText("The verification code is invalid.")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("enforces resend cooldown and verifies with the replacement challenge", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-28T00:00:00.000Z") });

  let resendPayload;
  let verificationPayload;
  await page.route(resendRoute, (route) => {
    resendPayload = route.request().postDataJSON();
    return route.fulfill({
      status: 202,
      json: { data: { mfaChallengeId: replacementChallengeId } },
    });
  });
  await page.route(verifyRoute, (route) => {
    verificationPayload = route.request().postDataJSON();
    return route.fulfill({ json: { data: { accessToken: "verified-token" } } });
  });
  await page.route(datasetsRoute, (route) => route.fulfill({ json: [] }));
  const otpInput = await openMfa(page);
  const resendButton = page.getByRole("button", {
    name: "Resend Code",
    exact: true,
  });

  await otpInput.fill("123456");
  await expect(resendButton).toBeDisabled();
  await expect(page.getByText("Resend code available in 1:00")).toBeVisible();

  await page.clock.runFor(60_000);
  await expect(resendButton).toBeEnabled();
  await resendButton.click();

  expect(resendPayload).toEqual({ mfaChallengeId: initialChallengeId });
  await expect(otpInput).toHaveValue("");
  await expect(
    page.getByText("A new verification code has been sent."),
  ).toBeVisible();
  await expect(resendButton).toBeDisabled();
  await expect(page.getByText("Resend code available in 1:00")).toBeVisible();

  await otpInput.fill("654321");
  await page.getByRole("button", { name: "Verify Code", exact: true }).click();

  await expect(page).toHaveURL(/\/home$/);
  expect(verificationPayload).toEqual({
    mfaChallengeId: replacementChallengeId,
    otp: "654321",
  });
});
