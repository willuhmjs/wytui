<script lang="ts">
	import type { DownloadProfile } from '$lib/types';

	let {
		profiles = [],
		selectedProfileId = '',
		saveToLibrary = false,
		excludeShorts = false,
		options = { sponsorblock: false, subtitles: false, metadata: false },
		libraryConfigured = false,
		onChange,
	}: {
		profiles?: DownloadProfile[];
		selectedProfileId?: string;
		saveToLibrary?: boolean;
		excludeShorts?: boolean;
		options?: {
			sponsorblock: boolean;
			subtitles: boolean;
			metadata: boolean;
		};
		libraryConfigured?: boolean;
		onChange?: (updates: {
			profileId?: string;
			saveToLibrary?: boolean;
			excludeShorts?: boolean;
			options?: {
				sponsorblock: boolean;
				subtitles: boolean;
				metadata: boolean;
			};
		}) => void;
	} = $props();

	function toggleOption(key: keyof typeof options) {
		const newOptions = { ...options, [key]: !options[key] };
		onChange?.({ options: newOptions });
	}

	function updateSaveToLibrary(value: boolean) {
		onChange?.({ saveToLibrary: value });
		if (value && libraryConfigured) {
			onChange?.({
				options: {
					sponsorblock: true,
					subtitles: true,
					metadata: true,
				},
			});
		}
	}

	function updateExcludeShorts(value: boolean) {
		onChange?.({ excludeShorts: value });
	}

	function updateProfileId(value: string) {
		onChange?.({ profileId: value });
	}
</script>

<div class="subscription-config">
	<div class="form-group">
		<label for="sub-profile"
			>Download Profile <span class="required-asterisk" aria-label="required">*</span></label
		>
		<select
			id="sub-profile"
			value={selectedProfileId}
			onchange={(e) => updateProfileId((e.target as HTMLSelectElement).value)}
			required
		>
			{#each profiles as profile}
				<option value={profile.id}>{profile.name}</option>
			{/each}
		</select>
	</div>

	{#if libraryConfigured}
		<div class="form-group">
			<label class="toggle-label">
				<input
					type="checkbox"
					checked={saveToLibrary}
					onchange={(e) => updateSaveToLibrary((e.target as HTMLInputElement).checked)}
				/>
				Save to Library
			</label>
			<p class="help-text">
				Automatically save downloads to your library (requires library path configured)
			</p>
		</div>
	{/if}

	<div class="form-group">
		<label class="toggle-label">
			<input
				type="checkbox"
				checked={excludeShorts}
				onchange={(e) => updateExcludeShorts((e.target as HTMLInputElement).checked)}
			/>
			Exclude Shorts
		</label>
		<p class="help-text">
			Skip shorts and other vertical videos from this subscription (up to 3 min, portrait format)
		</p>
	</div>

	<div class="form-group">
		<span class="options-label">Options</span>
		<div class="options-chips">
			<button
				type="button"
				class="option-chip"
				class:active={options.sponsorblock}
				onclick={() => toggleOption('sponsorblock')}
			>
				SponsorBlock
			</button>
			<button
				type="button"
				class="option-chip"
				class:active={options.subtitles}
				onclick={() => toggleOption('subtitles')}
			>
				Subtitles
			</button>
			<button
				type="button"
				class="option-chip"
				class:active={options.metadata}
				onclick={() => toggleOption('metadata')}
			>
				Metadata
			</button>
		</div>
		<p class="help-text">
			Additional download options to apply to all videos from this subscription
		</p>
	</div>
</div>

<style>
	.subscription-config {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.subscription-config .form-group {
		margin-bottom: 0;
	}

	.required-asterisk {
		color: var(--color-status-error);
		font-weight: var(--font-weight-bold);
		margin-left: var(--spacing-xs);
	}

	.options-label {
		display: block;
		font-weight: var(--font-weight-semibold);
		margin-bottom: var(--spacing-xs);
	}

	.options-chips {
		display: flex;
		gap: var(--spacing-sm);
		flex-wrap: wrap;
	}

	.option-chip {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.option-chip:hover {
		border-color: var(--color-border-translucent-hover);
	}

	.option-chip.active {
		background: var(--color-accent-primary);
		border-color: var(--color-accent-primary);
		color: var(--color-text-on-accent);
	}
</style>
