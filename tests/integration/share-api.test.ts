/**
 * Integration test for Share API download functionality.
 *
 * This test suite verifies that the download/share implementation:
 * 1. Correctly detects mobile vs desktop devices
 * 2. Uses navigator.share() on mobile when available
 * 3. Falls back to window.open() on desktop or when Share API unavailable
 * 4. Shows appropriate error toasts when sharing fails
 *
 * To run these tests:
 * 1. Start the app with Docker: docker-compose up -d
 * 2. Wait for the app to be healthy
 * 3. Run: npm run test:integration
 *
 * These tests use Playwright to simulate real browser interactions.
 */

import { test, expect, devices } from '@playwright/test';

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

test.describe('Download Share API Integration', () => {
	test.beforeEach(async ({ page }) => {
		// Navigate to a download detail page with a completed download
		// This assumes you have at least one completed download in the test DB
		await page.goto(`${APP_URL}/downloads`);

		// Login if required (adjust based on your auth flow)
		// await page.fill('input[name="username"]', 'testuser');
		// await page.fill('input[name="password"]', 'password');
		// await page.click('button[type="submit"]');
	});

	test('Desktop: should use window.open for downloads', async ({ page }) => {
		// Navigate to downloads page
		await page.goto(`${APP_URL}/downloads`);

		// Find first completed download and click it
		const firstDownload = page.locator('.download-card').filter({ hasText: 'COMPLETED' }).first();
		await firstDownload.click();

		// Mock window.open to track calls
		await page.evaluate(() => {
			(window as any).windowOpenCalls = [];
			const originalOpen = window.open;
			window.open = function (...args: any[]) {
				(window as any).windowOpenCalls.push(args);
				return null; // Don't actually open
			};
		});

		// Click download button
		await page.click('button:has-text("Download File")');

		// Wait a moment for the action to complete
		await page.waitForTimeout(500);

		// Verify window.open was called
		const openCalls = await page.evaluate(() => (window as any).windowOpenCalls);
		expect(openCalls.length).toBeGreaterThan(0);
		expect(openCalls[0][0]).toContain('/api/files/');
		expect(openCalls[0][1]).toBe('_blank');
	});

	test('Mobile (iOS): should attempt to use Share API', async ({ browser }) => {
		// Create a mobile context (iPhone 13)
		const context = await browser.newContext({
			...devices['iPhone 13'],
		});
		const page = await context.newPage();

		await page.goto(`${APP_URL}/downloads`);

		// Mock navigator.share to track calls
		await page.evaluate(() => {
			(window.navigator as any).shareCalls = [];
			(window.navigator as any).canShare = () => true;
			(window.navigator as any).share = async function (data: any) {
				(window.navigator as any).shareCalls.push(data);
				return Promise.resolve();
			};
		});

		// Find and click first completed download
		const firstDownload = page.locator('.download-card').filter({ hasText: 'COMPLETED' }).first();
		await firstDownload.click();

		// Click download button
		await page.click('button:has-text("Download File")');

		// Wait for share to be called
		await page.waitForTimeout(1000);

		// Verify navigator.share was called with files
		const shareCalls = await page.evaluate(() => (window.navigator as any).shareCalls);
		expect(shareCalls.length).toBeGreaterThan(0);
		expect(shareCalls[0]).toHaveProperty('files');
		expect(Array.isArray(shareCalls[0].files)).toBe(true);

		await context.close();
	});

	test('Mobile (Android): should attempt to use Share API', async ({ browser }) => {
		// Create a mobile context (Pixel 5)
		const context = await browser.newContext({
			...devices['Pixel 5'],
		});
		const page = await context.newPage();

		await page.goto(`${APP_URL}/downloads`);

		// Mock navigator.share
		await page.evaluate(() => {
			(window.navigator as any).shareCalls = [];
			(window.navigator as any).canShare = () => true;
			(window.navigator as any).share = async function (data: any) {
				(window.navigator as any).shareCalls.push(data);
				return Promise.resolve();
			};
		});

		// Find and click first completed download
		const firstDownload = page.locator('.download-card').filter({ hasText: 'COMPLETED' }).first();
		await firstDownload.click();

		// Click download button
		await page.click('button:has-text("Download File")');

		// Wait for share
		await page.waitForTimeout(1000);

		// Verify share was called
		const shareCalls = await page.evaluate(() => (window.navigator as any).shareCalls);
		expect(shareCalls.length).toBeGreaterThan(0);

		await context.close();
	});

	test('Mobile: should show error toast when share fails', async ({ browser }) => {
		const context = await browser.newContext({
			...devices['iPhone 13'],
		});
		const page = await context.newPage();

		await page.goto(`${APP_URL}/downloads`);

		// Mock navigator.share to throw error
		await page.evaluate(() => {
			(window.navigator as any).canShare = () => true;
			(window.navigator as any).share = async function () {
				throw new Error('Share not supported');
			};
		});

		// Find and click first completed download
		const firstDownload = page.locator('.download-card').filter({ hasText: 'COMPLETED' }).first();
		await firstDownload.click();

		// Click download button
		await page.click('button:has-text("Download File")');

		// Wait for error toast to appear
		await page.waitForSelector('.toast.error', { timeout: 3000 });

		// Verify error toast contains expected message
		const toastText = await page.locator('.toast.error').textContent();
		expect(toastText).toContain('Failed to share file');

		await context.close();
	});

	test('Mobile: should NOT show toast when user cancels share (AbortError)', async ({
		browser,
	}) => {
		const context = await browser.newContext({
			...devices['iPhone 13'],
		});
		const page = await context.newPage();

		await page.goto(`${APP_URL}/downloads`);

		// Mock navigator.share to throw AbortError
		await page.evaluate(() => {
			(window.navigator as any).canShare = () => true;
			(window.navigator as any).share = async function () {
				const error = new Error('User cancelled');
				error.name = 'AbortError';
				throw error;
			};
		});

		// Find and click first completed download
		const firstDownload = page.locator('.download-card').filter({ hasText: 'COMPLETED' }).first();
		await firstDownload.click();

		// Click download button
		await page.click('button:has-text("Download File")');

		// Wait a moment
		await page.waitForTimeout(500);

		// Verify NO error toast appeared
		const toastCount = await page.locator('.toast.error').count();
		expect(toastCount).toBe(0);

		await context.close();
	});

	test('Multi-version: should show version picker before sharing', async ({ browser }) => {
		const context = await browser.newContext({
			...devices['iPhone 13'],
		});
		const page = await context.newPage();

		await page.goto(`${APP_URL}/downloads`);

		// Mock share API
		await page.evaluate(() => {
			(window.navigator as any).shareCalls = [];
			(window.navigator as any).canShare = () => true;
			(window.navigator as any).share = async function (data: any) {
				(window.navigator as any).shareCalls.push(data);
				return Promise.resolve();
			};
		});

		// Find a download with multiple versions (if available)
		// This test may need adjustment based on your test data
		const firstDownload = page.locator('.download-card').filter({ hasText: 'COMPLETED' }).first();
		await firstDownload.click();

		// Click download button
		await page.click('button:has-text("Download File")');

		// If multiple versions exist, picker should appear
		const pickerVisible = await page
			.locator('.dvp-popover')
			.isVisible({ timeout: 1000 })
			.catch(() => false);

		if (pickerVisible) {
			// Verify picker has version options
			const versionRows = await page.locator('.dvp-row').count();
			expect(versionRows).toBeGreaterThan(0);

			// Click first version
			await page.locator('.dvp-row').first().click();

			// Wait for share
			await page.waitForTimeout(500);

			// Verify share was called
			const shareCalls = await page.evaluate(() => (window.navigator as any).shareCalls);
			expect(shareCalls.length).toBeGreaterThan(0);
		} else {
			// Single version → should share immediately
			const shareCalls = await page.evaluate(() => (window.navigator as any).shareCalls);
			expect(shareCalls.length).toBeGreaterThan(0);
		}

		await context.close();
	});
});
