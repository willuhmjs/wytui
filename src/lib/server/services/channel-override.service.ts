import { prisma } from '../db';

class ChannelOverrideService {
	/**
	 * List all channel overrides with profile data
	 */
	async list() {
		return prisma.channelOverride.findMany({
			include: { profile: true },
			orderBy: { createdAt: 'desc' },
		});
	}

	/**
	 * Create a new channel override
	 */
	async create(data: {
		channelUrl: string;
		channelName?: string;
		profileId?: string;
		autoDeleteDays?: number;
		sponsorblock?: boolean;
		customFlags?: string[];
	}) {
		return prisma.channelOverride.create({
			data: {
				channelUrl: data.channelUrl,
				channelName: data.channelName,
				profileId: data.profileId,
				autoDeleteDays: data.autoDeleteDays,
				sponsorblock: data.sponsorblock,
				customFlags: data.customFlags ?? [],
			},
			include: { profile: true },
		});
	}

	/**
	 * Update an existing channel override
	 */
	async update(
		id: string,
		data: {
			channelUrl?: string;
			channelName?: string;
			profileId?: string | null;
			autoDeleteDays?: number | null;
			sponsorblock?: boolean;
			customFlags?: string[];
		},
	) {
		return prisma.channelOverride.update({
			where: { id },
			data,
			include: { profile: true },
		});
	}

	/**
	 * Delete a channel override
	 */
	async delete(id: string) {
		return prisma.channelOverride.delete({
			where: { id },
		});
	}

	/**
	 * Find override for a specific channel URL
	 */
	async getByChannelUrl(channelUrl: string) {
		return prisma.channelOverride.findUnique({
			where: { channelUrl },
			include: { profile: true },
		});
	}

	/**
	 * Get effective flags by merging base flags with channel override flags.
	 * Override flags come after base flags. If the override has a profile,
	 * the profile's custom flags are also included.
	 * Returns the merged flags array plus the sponsorblock setting.
	 */
	async getEffectiveFlags(
		channelUrl: string,
		baseFlags: string[],
	): Promise<{ flags: string[]; sponsorblock: boolean }> {
		const override = await this.getByChannelUrl(channelUrl);

		if (!override) {
			return { flags: baseFlags, sponsorblock: true };
		}

		const flags = [...baseFlags];

		// Include profile custom flags if override has a profile
		if (override.profile) {
			flags.push(...override.profile.customFlags);
		}

		// Override custom flags come last
		flags.push(...override.customFlags);

		return { flags, sponsorblock: override.sponsorblock };
	}
}

// Singleton instance
export const channelOverrideService = new ChannelOverrideService();
