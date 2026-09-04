<script lang="ts">
	/**
	 * Draggable duration field (like a time scrubber).
	 *
	 * The value is in whole minutes; 0 means "no limit". Dragging horizontally
	 * scrubs the value — it displays as minutes and rolls over into hours once
	 * past 60. Drag distance accelerates so the full range (default 0–24h) is
	 * reachable in one gesture. Clicking (or pressing Enter) swaps in a text
	 * input accepting forms like "45", "45m", "1h", "1h30m", "1.5h", "none".
	 */
	let {
		minutes = 0,
		maxMinutes = 1440,
		label = 'Duration',
		onChange,
	}: {
		minutes?: number;
		maxMinutes?: number;
		label?: string;
		onChange?: (minutes: number) => void;
	} = $props();

	const PX_PER_MINUTE = 4;

	let dragging = $state(false);
	let editing = $state(false);
	let editText = $state('');
	let dragStartX = 0;
	let dragStartMinutes = 0;
	let dragMoved = false;

	function clamp(value: number): number {
		return Math.min(maxMinutes, Math.max(0, value));
	}

	function commit(value: number): void {
		const next = clamp(Math.round(value));
		if (next !== minutes) onChange?.(next);
	}

	function formatValue(): string {
		if (minutes <= 0) return 'No limit';
		if (minutes < 60) return `${minutes} min`;
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return m === 0 ? `${h} h` : `${h} h ${m} min`;
	}

	function startEditing(): void {
		if (minutes > 0) {
			const h = Math.floor(minutes / 60);
			const m = minutes % 60;
			editText = h > 0 ? `${h}h${m ? ` ${m}m` : ''}` : `${minutes}m`;
		} else {
			editText = '';
		}
		editing = true;
	}

	function commitEdit(): void {
		if (!editing) return;
		editing = false;
		const parsed = parseDuration(editText);
		if (parsed !== null) commit(parsed);
	}

	function parseDuration(input: string): number | null {
		const t = input.trim().toLowerCase();
		if (!t || t === 'none' || t === 'no limit' || t === 'off') return 0;
		const hm = t.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in)?)?$/);
		if (hm && (hm[1] !== undefined || hm[2] !== undefined)) {
			return Math.round((hm[1] ? parseFloat(hm[1]) : 0) * 60 + (hm[2] ? parseFloat(hm[2]) : 0));
		}
		if (/^\d+(?:\.\d+)?$/.test(t)) return Math.round(parseFloat(t));
		return null;
	}

	function onpointerdown(e: PointerEvent) {
		if (e.button !== 0 || editing) return;
		dragging = true;
		dragMoved = false;
		dragStartX = e.clientX;
		dragStartMinutes = minutes;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onpointermove(e: PointerEvent) {
		if (!dragging) return;
		const dx = e.clientX - dragStartX;
		if (!dragMoved && Math.abs(dx) < 3) return;
		dragMoved = true;
		// 1 min per 4px to start; every 30px of travel bumps the step so long
		// drags accelerate and the top of the range stays reachable.
		const accel = Math.max(1, Math.floor(Math.abs(dx) / 30));
		commit(dragStartMinutes + (dx * accel) / PX_PER_MINUTE);
	}

	function endDrag() {
		if (!dragging) return;
		dragging = false;
		// A click without movement opens the type-in editor.
		if (!dragMoved) startEditing();
	}

	function onkeydown(e: KeyboardEvent) {
		switch (e.key) {
			case 'ArrowUp':
			case 'ArrowRight':
				e.preventDefault();
				commit(minutes + 1);
				break;
			case 'ArrowDown':
			case 'ArrowLeft':
				e.preventDefault();
				commit(minutes - 1);
				break;
			case 'PageUp':
				e.preventDefault();
				commit(minutes + 60);
				break;
			case 'PageDown':
				e.preventDefault();
				commit(minutes - 60);
				break;
			case 'Home':
				e.preventDefault();
				commit(0);
				break;
			case 'End':
				e.preventDefault();
				commit(maxMinutes);
				break;
			case 'Enter':
				e.preventDefault();
				startEditing();
				break;
		}
	}

	function autofocus(el: HTMLInputElement) {
		el.focus();
		el.select();
	}
</script>

<div class="duration-field">
	{#if editing}
		<input
			class="duration-input"
			type="text"
			placeholder="e.g. 45m, 1h 30m"
			bind:value={editText}
			use:autofocus
			aria-label={label}
			onkeydown={(e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					commitEdit();
				} else if (e.key === 'Escape') {
					e.preventDefault();
					editing = false;
				}
				e.stopPropagation();
			}}
			onblur={commitEdit}
		/>
	{:else}
		<div
			class="duration-scrub"
			class:dragging
			role="slider"
			tabindex="0"
			aria-label={label}
			aria-valuemin="0"
			aria-valuemax={maxMinutes}
			aria-valuenow={minutes}
			aria-valuetext={formatValue()}
			title="Drag to adjust — click to type"
			{onpointerdown}
			{onpointermove}
			onpointerup={endDrag}
			onpointercancel={() => (dragging = false)}
			{onkeydown}
		>
			{#if minutes <= 0}
				<span class="duration-value no-limit">No limit</span>
			{:else}
				{#if minutes >= 60}
					<span class="duration-value">{Math.floor(minutes / 60)}</span>
					<span class="duration-unit">h</span>
				{/if}
				{#if minutes < 60 || minutes % 60 !== 0}
					<span class="duration-value">{minutes % 60}</span>
					<span class="duration-unit">min</span>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.duration-field {
		display: inline-flex;
		width: 100%;
	}

	.duration-scrub {
		display: inline-flex;
		align-items: baseline;
		gap: var(--spacing-xs);
		width: 100%;
		box-sizing: border-box;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-translucent);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm) var(--spacing-md);
		color: var(--color-text-primary);
		font-size: var(--font-size-sm);
		cursor: ew-resize;
		user-select: none;
		-webkit-user-select: none;
		touch-action: none;
		transition:
			border-color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.duration-scrub:hover {
		border-color: var(--color-accent-primary);
	}

	.duration-scrub:focus-visible {
		outline: none;
		border-color: var(--color-accent-primary);
		box-shadow: 0 0 0 3px var(--color-focus-ring);
	}

	.duration-scrub.dragging {
		border-color: var(--color-accent-primary);
		box-shadow: 0 0 0 3px var(--color-focus-ring);
	}

	.duration-value {
		font-variant-numeric: tabular-nums;
		font-weight: var(--font-weight-semibold);
	}

	.duration-value.no-limit {
		color: var(--color-text-tertiary);
		font-weight: var(--font-weight-regular, 400);
	}

	.duration-unit {
		color: var(--color-text-secondary);
		font-size: var(--font-size-xs);
		margin-right: var(--spacing-xs);
	}

	.duration-unit:last-child {
		margin-right: 0;
	}

	.duration-input {
		width: 100%;
		box-sizing: border-box;
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-accent-primary);
		border-radius: var(--radius-md);
		box-shadow: 0 0 0 3px var(--color-focus-ring);
		color: var(--color-text-primary);
		font-size: var(--font-size-sm);
		font-family: inherit;
	}

	.duration-input:focus {
		outline: none;
	}

	.duration-input::placeholder {
		color: var(--color-text-tertiary);
	}
</style>
