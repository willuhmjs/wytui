import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory store backing the downloadProfile prisma mock.
const profileDb: any[] = [];

vi.mock('child_process', () => {
	const execFileSync = vi.fn(() => '2026.01.01');
	return { default: { execFileSync }, execFileSync };
});

vi.mock('fs/promises', () => {
	const statfs = vi.fn(async () => ({ bsize: 4096, blocks: 1000 }));
	return { default: { statfs }, statfs };
});

vi.mock('./db', () => ({
	prisma: {
		settings: { upsert: vi.fn(async () => ({})) },
		// Count > 0 so a leaked ADMIN_USERNAME/ADMIN_PASSWORD in the test
		// environment can't take the first-user creation branch.
		user: { count: vi.fn(async () => 1) },
		download: {
			updateMany: vi.fn(async () => ({ count: 0 })),
			findMany: vi.fn(async () => []),
		},
		downloadProfile: {
			findFirst: vi.fn(
				async ({ where }: any) =>
					profileDb.find((p) => p.name === where.name && p.userId === null) ?? null,
			),
			create: vi.fn(async ({ data }: any) => {
				const row = { id: `profile-${profileDb.length}`, ...data };
				profileDb.push(row);
				return row;
			}),
			findMany: vi.fn(async () => profileDb.filter((p) => p.userId == null).map((p) => ({ ...p }))),
			update: vi.fn(async ({ where, data }: any) => {
				const i = profileDb.findIndex((p) => p.id === where.id);
				profileDb[i] = { ...profileDb[i], ...data };
				return profileDb[i];
			}),
		},
	},
}));

vi.mock('./auth', () => ({
	hashPassword: vi.fn(async () => 'hash'),
	invalidateUsersCache: vi.fn(),
}));

vi.mock('./services/download.service', () => ({
	downloadService: { resumeDownload: vi.fn() },
}));

vi.mock('./services/library.service', () => ({
	libraryService: {
		resumeInterruptedPromotions: vi.fn(async () => {}),
		sweepOrphanedDownloads: vi.fn(async () => {}),
	},
}));

vi.mock('$lib/server/services/ytdlp.service', () => ({
	ytdlpService: { getPath: vi.fn(() => '/usr/local/bin/yt-dlp') },
}));

import { ensureDefaults, DEFAULT_PROFILES } from './init';

describe('ensureDefaults system profiles', () => {
	beforeEach(() => {
		profileDb.length = 0;
	});

	it('seeds all default profiles with denylist-clean flags', async () => {
		await ensureDefaults();

		expect(profileDb).toHaveLength(DEFAULT_PROFILES.length);
		for (const profile of profileDb) {
			expect(profile.customFlags).not.toContain('--postprocessor-args');
		}
	});

	it('repairs pre-denylist system profiles that still carry --postprocessor-args', async () => {
		// The exact flags a pre-denylist seed created for the default profile.
		profileDb.push({
			id: 'legacy-1080p',
			name: '1080p',
			userId: null,
			customFlags: [
				'-f',
				'bestvideo[vcodec^=avc]+bestaudio/best',
				'--merge-output-format',
				'mp4',
				'--postprocessor-args',
				'ffmpeg:-c:a aac -b:a 192k',
			],
		});

		await ensureDefaults();

		const repaired = profileDb.find((p) => p.id === 'legacy-1080p');
		expect(repaired.customFlags).not.toContain('--postprocessor-args');
		expect(repaired.customFlags).toEqual(
			DEFAULT_PROFILES.find((p) => p.name === '1080p')!.customFlags,
		);
	});

	it('leaves clean system profiles and user-owned profiles untouched', async () => {
		profileDb.push(
			{ id: 'clean', name: '720p', userId: null, customFlags: ['-f', 'bv+ba'] },
			{
				id: 'user-owned',
				name: 'My Profile',
				userId: 'user-1',
				customFlags: ['-f', 'bv+ba'],
			},
		);

		await ensureDefaults();

		expect(profileDb.find((p) => p.id === 'clean').customFlags).toEqual(['-f', 'bv+ba']);
		// Customized system profiles without the forbidden flag keep their edits
		// (only the flags array of flagged rows is rewritten).
		expect(profileDb.find((p) => p.id === 'user-owned').customFlags).toEqual(['-f', 'bv+ba']);
	});
});
