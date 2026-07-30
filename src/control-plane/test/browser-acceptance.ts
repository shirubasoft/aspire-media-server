import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import {
  chromium,
  type BrowserContext,
  type Page,
  type Response,
} from "playwright";

export interface BrowserAcceptanceOptions {
  readonly ingressUrl: string;
  readonly dashboardUrl: string;
  readonly domain: string;
  readonly ingressUsername: string;
  readonly ingressPassword: string;
  readonly jellyfinUsername: string;
  readonly jellyfinPassword: string;
  readonly qbittorrentPassword: string;
  readonly duplicatiPassword: string;
  readonly grafanaPassword: string;
}

interface BrowserSurface {
  readonly service: string;
  readonly title: string;
  readonly marker: string;
  readonly path?: string;
}

const administrativeSurfaces: readonly BrowserSurface[] = [
  {
    service: "home",
    title: "Homepage",
    marker: 'a[href*="jellyfin."]',
  },
  {
    service: "sonarr",
    title: "Sonarr",
    marker: 'input[name="seriesSearch"]',
  },
  {
    service: "radarr",
    title: "Radarr",
    marker: 'input[name="movieSearch"]',
  },
  {
    service: "lidarr",
    title: "Lidarr",
    marker: 'input[name="artistSearch"]',
  },
  {
    service: "prowlarr",
    title: "Prowlarr",
    marker: 'input[name="movieSearch"]',
  },
  {
    service: "bazarr",
    title: "Bazarr",
    marker: 'input[placeholder="Search"]',
  },
  {
    service: "tdarr",
    title: "Tdarr",
    marker: 'input[name="pauseAllNodes"]',
  },
  {
    service: "prometheus",
    title: "Prometheus",
    marker: "button",
    path: "/query",
  },
  {
    service: "traefik",
    title: "Traefik",
    marker: '[data-testid="theme-switcher"]',
    path: "/dashboard/",
  },
] as const;

function serviceUrl(
  ingressUrl: string,
  domain: string,
  service: string,
  path = "/",
): string {
  const url = new URL(ingressUrl);
  url.hostname = `${service}.${domain}`;
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function gotoAvailable(page: Page, url: string): Promise<Response> {
  const deadline = Date.now() + 60_000;
  let lastFailure = "no response";
  do {
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      if (response && response.status() < 400) {
        return response;
      }
      lastFailure = response
        ? `HTTP ${String(response.status())}`
        : "no response";
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await delay(1_000);
  } while (Date.now() < deadline);

  throw new Error(`${url} did not become available: ${lastFailure}`);
}

async function verifySurface(
  page: Page,
  options: BrowserAcceptanceOptions,
  surface: BrowserSurface,
): Promise<void> {
  const url = serviceUrl(
    options.ingressUrl,
    options.domain,
    surface.service,
    surface.path,
  );
  await gotoAvailable(page, url);
  await page.locator(surface.marker).first().waitFor({
    state: "visible",
    timeout: 60_000,
  });
  assert.ok(
    (await page.title()).includes(surface.title),
    `${surface.service} rendered an unexpected title: ${await page.title()}`,
  );
}

async function signIntoArrspire(
  page: Page,
  options: BrowserAcceptanceOptions,
): Promise<void> {
  const homepage = serviceUrl(
    options.ingressUrl,
    options.domain,
    "home",
  );
  await gotoAvailable(page, homepage);
  assert.equal(
    new URL(page.url()).hostname,
    `auth.${options.domain}`,
    "Administrative ingress did not redirect to the Arrspire sign-in portal",
  );
  await page.locator("#username-textfield").fill(options.ingressUsername);
  await page.locator("#password-textfield").fill(options.ingressPassword);
  await page.locator("#sign-in-button").click();
  await page.waitForURL(
    (url) => url.hostname !== `auth.${options.domain}`,
    { timeout: 30_000 },
  );
  await page.locator('a[href*="jellyfin."]').first().waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

async function verifyAspireDashboard(
  page: Page,
  options: BrowserAcceptanceOptions,
): Promise<void> {
  await gotoAvailable(page, options.dashboardUrl);
  await Promise.all(
    ["Resources", "Console", "Traces", "Metrics"].map((name) =>
      page.getByText(name, { exact: true }).first().waitFor({
        state: "visible",
        timeout: 30_000,
      }),
    ),
  );
  await page.waitForFunction(
    () => document.title.toLowerCase().includes("resources"),
    undefined,
    { timeout: 30_000 },
  );
}

async function verifyQBittorrent(
  context: BrowserContext,
  options: BrowserAcceptanceOptions,
): Promise<void> {
  const page = await context.newPage();
  await gotoAvailable(
    page,
    serviceUrl(options.ingressUrl, options.domain, "qbittorrent"),
  );
  await page.locator("#username").fill("admin");
  await page.locator("#password").fill(options.qbittorrentPassword);
  await page.locator("#loginButton").click();
  await page.locator("#logoutLink").waitFor({
    state: "visible",
    timeout: 30_000,
  });
  assert.ok(
    (await page.title()).includes("qBittorrent"),
    "qBittorrent did not render its authenticated WebUI",
  );
  await page.close();
}

async function verifyGrafana(
  context: BrowserContext,
  options: BrowserAcceptanceOptions,
): Promise<void> {
  const page = await context.newPage();
  const baseUrl = serviceUrl(options.ingressUrl, options.domain, "grafana");
  await gotoAvailable(page, baseUrl);
  await page.locator('input[name="user"]').fill("admin");
  await page.locator('input[name="password"]').fill(options.grafanaPassword);
  const [loginResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/login" &&
        response.request().method() === "POST",
      { timeout: 30_000 },
    ),
    page.locator('button[type="submit"]').click(),
  ]);
  assert.ok(
    loginResponse.status() < 400,
    `Grafana login returned HTTP ${String(loginResponse.status())}`,
  );
  await page.waitForURL(
    (url) => !url.pathname.startsWith("/login"),
    { timeout: 30_000 },
  );
  assert.ok(
    (await page.title()).includes("Grafana"),
    "Grafana did not render its authenticated home page",
  );
  await page.goto(new URL("/connections/datasources/edit/prometheus", baseUrl).toString(), {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.getByText("Prometheus", { exact: true }).first().waitFor({
    state: "visible",
    timeout: 30_000,
  });
  assert.ok(
    page.url().includes("/connections/datasources/edit/prometheus"),
    "Grafana does not expose the provisioned Prometheus data source",
  );
  await page.close();
}

async function verifyDuplicati(
  context: BrowserContext,
  options: BrowserAcceptanceOptions,
): Promise<void> {
  const page = await context.newPage();
  await gotoAvailable(
    page,
    serviceUrl(options.ingressUrl, options.domain, "duplicati"),
  );
  await page
    .getByPlaceholder("Enter your password")
    .fill(options.duplicatiPassword);
  await page.getByRole("button", { name: "Login" }).click();
  await page.getByRole("button", { name: /Add backup/u }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
  assert.ok(
    (await page.title()).includes("Duplicati"),
    "Duplicati did not render its authenticated backup UI",
  );
  await page.close();
}

async function verifySeerr(
  context: BrowserContext,
  options: BrowserAcceptanceOptions,
): Promise<void> {
  const page = await context.newPage();
  const baseUrl = serviceUrl(
    options.ingressUrl,
    options.domain,
    "seerr",
  );
  await gotoAvailable(page, baseUrl);
  await page.locator("#username").fill(options.jellyfinUsername);
  await page.locator("#password").fill(options.jellyfinPassword);
  await page.locator('button[type="submit"]').click();
  await page.locator("#username").waitFor({
    state: "hidden",
    timeout: 30_000,
  });
  await page.getByText("Discover", { exact: true }).first().waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await page.goto(new URL("/settings/services", baseUrl).toString(), {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await Promise.all(
    ["Sonarr Settings", "Radarr Settings"].map((name) =>
      page.getByText(name, { exact: true }).waitFor({
        state: "visible",
        timeout: 30_000,
      }),
    ),
  );
  for (const service of ["sonarr", "radarr"] as const) {
    const name = service === "sonarr" ? "Sonarr" : "Radarr";
    const publicLink = page.getByRole("link", { name, exact: true });
    await publicLink.waitFor({ state: "visible", timeout: 30_000 });
    assert.equal(
      await publicLink.getAttribute("href"),
      new URL(
        serviceUrl(options.ingressUrl, options.domain, service),
      ).origin,
      `${name} does not link to its public ingress URL`,
    );
  }
  await page.close();
}

async function verifyJellyfin(
  context: BrowserContext,
  options: BrowserAcceptanceOptions,
): Promise<void> {
  const page = await context.newPage();
  await gotoAvailable(
    page,
    serviceUrl(options.ingressUrl, options.domain, "jellyfin"),
  );
  await page.locator("#txtManualName").fill(options.jellyfinUsername);
  await page.locator("#txtManualPassword").fill(options.jellyfinPassword);
  await page.locator('button[type="submit"]').click();
  await page.locator('a[href="#/home"]').waitFor({
    state: "visible",
    timeout: 30_000,
  });
  for (const collectionType of ["movies", "tvshows", "music"]) {
    await page
      .locator(`a[href*="collectionType=${collectionType}"]`)
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  }
  const moviesHref = await page
    .locator('a[href*="collectionType=movies"]')
    .first()
    .getAttribute("href");
  assert.ok(moviesHref, "Jellyfin did not expose its Movies library");
  await page.goto(new URL(`/web/${moviesHref}`, page.url()).toString(), {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  assert.ok(
    page.url().includes("collectionType=movies"),
    "Jellyfin could not navigate into its Movies library",
  );
  await page.close();
}

export async function verifyBrowserAcceptance(
  options: BrowserAcceptanceOptions,
): Promise<void> {
  const browser = await chromium.launch({
    headless: true,
    args: [
      `--host-resolver-rules=MAP *.${options.domain} 127.0.0.1,EXCLUDE localhost`,
    ],
  });
  try {
    const administrativeContext = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    const administrativePage = await administrativeContext.newPage();
    await signIntoArrspire(administrativePage, options);
    for (const surface of administrativeSurfaces) {
      await verifySurface(administrativePage, options, surface);
    }
    await verifyAspireDashboard(administrativePage, options);
    await administrativePage.close();
    await verifyQBittorrent(administrativeContext, options);
    await verifyGrafana(administrativeContext, options);
    await administrativeContext.close();

    const serviceContext = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    await verifyJellyfin(serviceContext, options);
    await verifySeerr(serviceContext, options);
    await verifyDuplicati(serviceContext, options);
    await serviceContext.close();
  } finally {
    await browser.close();
  }
}
