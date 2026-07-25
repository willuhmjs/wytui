<script lang="ts">
	import CheckIcon from '$lib/components/icons/CheckIcon.svelte';

	let {
		src,
		poster,
		videoId,
		downloadId,
		startTime = 0,
		subtitles = [],
		onEnded,
		onDownload,
	}: {
		src: string;
		poster?: string;
		videoId?: string;
		downloadId?: string;
		startTime?: number;
		subtitles?: { label: string; lang: string; src: string }[];
		onEnded?: () => void;
		onDownload?: () => void;
	} = $props();

	// -- Element refs --
	let wrapperEl: HTMLDivElement | undefined = $state();
	let videoEl: HTMLVideoElement | undefined = $state();

	// -- Playback state --
	let paused = $state(true);
	let currentTime = $state(0);
	let duration = $state(0);
	let buffered = $state(0);
	let volume = $state(1);
	let muted = $state(false);
	let playbackRate = $state(1);
	let isFullscreen = $state(false);

	// -- UI state --
	let controlsVisible = $state(true);
	let hideControlsTimer: ReturnType<typeof setTimeout> | undefined;
	let speedMenuOpen = $state(false);
	let skipNotification = $state('');
	let skipNotificationTimer: ReturnType<typeof setTimeout> | undefined;
	let theaterMode = $state(false);
	let pipActive = $state(false);
	let showHelp = $state(false);
	let helpTimer: ReturnType<typeof setTimeout> | undefined;
	let activeSubtitleIndex = $state(-1); // -1 = off

	// -- Loop --
	let loopEnabled = $state(false);
	$effect(() => {
		if (videoEl) videoEl.loop = loopEnabled;
	});

	// -- Context menu --
	let contextMenu = $state<{ x: number; y: number } | null>(null);

	function openContextMenu(e: MouseEvent) {
		e.preventDefault();
		// Clamp so menu doesn't overflow viewport
		const menuW = 240,
			menuH = 280;
		const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
		const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
		contextMenu = { x, y };
	}

	function closeContextMenu() {
		contextMenu = null;
	}

	// -- SponsorBlock --
	type SBSegment = {
		segment: [number, number];
		category: string;
		UUID: string;
	};
	let segments = $state<SBSegment[]>([]);
	let skippedUUIDs = $state<Set<string>>(new Set());
	let autoSkipEnabled = $state(true);

	const SEGMENT_COLORS: Record<string, string> = {
		sponsor: '#00d400',
		selfpromo: '#ffff00',
		interaction: '#cc00ff',
		intro: '#00ffff',
		outro: '#0202ed',
		preview: '#008fd6',
		music_offtopic: '#ff9900',
	};

	const CATEGORY_LABELS: Record<string, string> = {
		sponsor: 'Sponsor',
		selfpromo: 'Self-Promotion',
		interaction: 'Interaction Reminder',
		intro: 'Intro',
		outro: 'Outro',
		preview: 'Preview',
		music_offtopic: 'Non-Music',
	};

	const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

	// -- Fetch SponsorBlock segments --
	$effect(() => {
		if (!videoId) return;
		const categories = JSON.stringify([
			'sponsor',
			'selfpromo',
			'interaction',
			'intro',
			'outro',
			'preview',
			'music_offtopic',
		]);
		fetch(
			`https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=${encodeURIComponent(categories)}`,
		)
			.then((res) => {
				if (!res.ok) return [];
				return res.json();
			})
			.then((data: SBSegment[]) => {
				if (Array.isArray(data)) {
					segments = data;
				}
			})
			.catch(() => {
				// Fail silently
			});
	});

	// -- Auto-skip sponsor segments --
	$effect(() => {
		if (!autoSkipEnabled || segments.length === 0 || !videoEl) return;
		const time = currentTime;
		for (const seg of segments) {
			if (skippedUUIDs.has(seg.UUID)) continue;
			const [start, end] = seg.segment;
			if (time >= start && time < end - 0.5) {
				videoEl.currentTime = end;
				skippedUUIDs = new Set([...skippedUUIDs, seg.UUID]);
				showSkipNotification(CATEGORY_LABELS[seg.category] || seg.category);
				break;
			}
		}
	});

	function showSkipNotification(label: string) {
		skipNotification = `Skipped: ${label}`;
		if (skipNotificationTimer) clearTimeout(skipNotificationTimer);
		skipNotificationTimer = setTimeout(() => {
			skipNotification = '';
		}, 2500);
	}

	// -- Controls visibility --
	function resetHideTimer() {
		controlsVisible = true;
		if (hideControlsTimer) clearTimeout(hideControlsTimer);
		if (!paused) {
			hideControlsTimer = setTimeout(() => {
				controlsVisible = false;
				speedMenuOpen = false;
			}, 3000);
		}
	}

	$effect(() => {
		if (paused) {
			controlsVisible = true;
			if (hideControlsTimer) clearTimeout(hideControlsTimer);
		}
	});

	// -- Video event handlers --
	let lastTime = 0;

	function handleTimeUpdate() {
		if (!videoEl) return;
		currentTime = videoEl.currentTime;
		// Detect a loop restart (native loop seeks to ~0 without firing `ended`)
		// and reset skipped segments so SponsorBlock re-skips on the next pass.
		if (lastTime > duration - 1 && currentTime < 1 && skippedUUIDs.size > 0) {
			skippedUUIDs = new Set();
		}
		lastTime = currentTime;
		// Update buffered
		if (videoEl.buffered.length > 0) {
			buffered = videoEl.buffered.end(videoEl.buffered.length - 1);
		}
	}

	function handleMetadata() {
		if (!videoEl) return;
		duration = videoEl.duration;
		if (startTime > 0 && startTime < videoEl.duration - 0.5) {
			videoEl.currentTime = startTime;
		}
	}

	function handleEnded() {
		onEnded?.();
	}

	function handlePlay() {
		paused = false;
		resetHideTimer();
	}

	function handlePause() {
		paused = true;
	}

	function handleVolumeChange() {
		if (!videoEl) return;
		volume = videoEl.volume;
		muted = videoEl.muted;
	}

	function handleRateChange() {
		if (!videoEl) return;
		playbackRate = videoEl.playbackRate;
	}

	// -- Control actions --
	function togglePlay() {
		if (!videoEl) return;
		if (videoEl.paused) {
			videoEl.play();
		} else {
			videoEl.pause();
		}
	}

	function seek(time: number) {
		if (!videoEl) return;
		videoEl.currentTime = Math.max(0, Math.min(time, duration));
	}

	function changeVolume(delta: number) {
		if (!videoEl) return;
		videoEl.volume = Math.max(0, Math.min(1, videoEl.volume + delta));
	}

	function setVolume(newVolume: number) {
		if (!videoEl) return;
		videoEl.volume = Math.max(0, Math.min(1, newVolume));
		if (newVolume > 0 && videoEl.muted) videoEl.muted = false;
	}

	function toggleMute() {
		if (!videoEl) return;
		videoEl.muted = !videoEl.muted;
	}

	function setSpeed(speed: number) {
		if (!videoEl) return;
		videoEl.playbackRate = speed;
		speedMenuOpen = false;
	}

	function changeSpeed(delta: number) {
		const idx = SPEED_OPTIONS.indexOf(playbackRate);
		let newIdx: number;
		if (idx === -1) {
			// Find closest
			newIdx = SPEED_OPTIONS.findIndex((s) => s >= playbackRate);
			if (newIdx === -1) newIdx = SPEED_OPTIONS.length - 1;
			if (delta < 0 && newIdx > 0) newIdx--;
		} else {
			newIdx = Math.max(0, Math.min(SPEED_OPTIONS.length - 1, idx + delta));
		}
		setSpeed(SPEED_OPTIONS[newIdx]);
	}

	function toggleFullscreen() {
		if (!wrapperEl) return;
		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else {
			wrapperEl.requestFullscreen();
		}
	}

	function toggleTheaterMode() {
		theaterMode = !theaterMode;
		if (theaterMode && document.fullscreenElement) {
			document.exitFullscreen();
		}
	}

	async function togglePip() {
		if (!videoEl) return;
		if (document.pictureInPictureElement) {
			await document.exitPictureInPicture();
			pipActive = false;
		} else {
			await videoEl.requestPictureInPicture();
			pipActive = true;
		}
	}

	$effect(() => {
		function onPipLeave() {
			pipActive = false;
		}
		videoEl?.addEventListener('leavepictureinpicture', onPipLeave);
		return () => videoEl?.removeEventListener('leavepictureinpicture', onPipLeave);
	});

	function cycleSubtitle() {
		if (!videoEl || subtitles.length === 0) return;
		const tracks = videoEl.textTracks;
		const nextIndex = activeSubtitleIndex >= subtitles.length - 1 ? -1 : activeSubtitleIndex + 1;
		for (let i = 0; i < tracks.length; i++) {
			tracks[i].mode = i === nextIndex ? 'showing' : 'disabled';
		}
		activeSubtitleIndex = nextIndex;
	}

	function showHelpOverlay() {
		showHelp = true;
		if (helpTimer) clearTimeout(helpTimer);
		helpTimer = setTimeout(() => {
			showHelp = false;
		}, 4000);
	}

	let linkCopiedNotification = $state('');
	let linkCopiedTimer: ReturnType<typeof setTimeout> | undefined;

	async function copyLinkAtCurrentTime() {
		if (!downloadId) return;
		const t = Math.floor(currentTime);
		const url = `${window.location.origin}/downloads/${downloadId}?t=${t}`;
		try {
			await navigator.clipboard.writeText(url);
			linkCopiedNotification = 'Link copied to clipboard';
		} catch {
			linkCopiedNotification = 'Failed to copy link';
		}
		if (linkCopiedTimer) clearTimeout(linkCopiedTimer);
		linkCopiedTimer = setTimeout(() => {
			linkCopiedNotification = '';
		}, 2500);
	}

	$effect(() => {
		function handleFsChange() {
			isFullscreen = !!document.fullscreenElement;
		}
		document.addEventListener('fullscreenchange', handleFsChange);
		return () => document.removeEventListener('fullscreenchange', handleFsChange);
	});

	// -- Chromecast --
	let castAvailable = $state(false);
	let castConnected = $state(false);
	let castSession: any = $state(null);

	$effect(() => {
		if (typeof window === 'undefined') return;
		const win = window as any;
		if (win.chrome?.cast) {
			initCast();
			return;
		}
		win['__onGCastApiAvailable'] = (isAvailable: boolean) => {
			if (isAvailable) initCast();
		};
		if (!document.querySelector('script[src*="cast_sender"]')) {
			const script = document.createElement('script');
			script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
			script.async = true;
			document.head.appendChild(script);
		}
		return () => {
			// Avoid leaking the global callback across remounts.
			if (win['__onGCastApiAvailable']) delete win['__onGCastApiAvailable'];
		};
	});

	function initCast() {
		const win = window as any;
		const cast = win.cast;
		const chrome = win.chrome;
		if (!cast?.framework || !chrome?.cast) return;

		cast.framework.CastContext.getInstance().setOptions({
			receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
			autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
		});

		cast.framework.CastContext.getInstance().addEventListener(
			cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
			(event: any) => {
				castConnected =
					event.sessionState === cast.framework.SessionState.SESSION_STARTED ||
					event.sessionState === cast.framework.SessionState.SESSION_RESUMED;
				castSession = castConnected
					? cast.framework.CastContext.getInstance().getCurrentSession()
					: null;
			},
		);
		castAvailable = true;
	}

	function toggleCast() {
		const win = window as any;
		const cast = win.cast;
		if (!cast?.framework) return;
		if (castConnected) {
			cast.framework.CastContext.getInstance().endCurrentSession(true);
		} else {
			cast.framework.CastContext.getInstance().requestSession();
		}
	}

	$effect(() => {
		if (!castSession || !castConnected || !src) return;
		const win = window as any;
		const chrome = win.chrome;
		if (!chrome?.cast) return;

		const mediaUrl = new URL(src, window.location.origin).href;
		const mediaInfo = new chrome.cast.media.MediaInfo(mediaUrl, 'video/mp4');
		if (poster) {
			mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
			mediaInfo.metadata.images = [{ url: new URL(poster, window.location.origin).href }];
		}
		const request = new chrome.cast.media.LoadRequest(mediaInfo);
		request.currentTime = currentTime;
		castSession.loadMedia(request).catch((e: any) => console.error('[Cast] Load failed:', e));
	});

	// -- Progress bar interaction --
	let progressDragging = $state(false);
	let volumeDragging = $state(false);

	function handleProgressMouseDown(e: MouseEvent) {
		progressDragging = true;
		seekToMousePosition(e);
		window.addEventListener('mousemove', handleProgressMouseMove);
		window.addEventListener('mouseup', handleProgressMouseUp);
	}

	function handleProgressMouseMove(e: MouseEvent) {
		if (progressDragging) {
			seekToMousePosition(e);
		}
	}

	function handleProgressMouseUp() {
		progressDragging = false;
		window.removeEventListener('mousemove', handleProgressMouseMove);
		window.removeEventListener('mouseup', handleProgressMouseUp);
	}

	function seekToMousePosition(e: MouseEvent) {
		const bar = wrapperEl?.querySelector('.progress-bar-hitarea') as HTMLElement;
		if (!bar || !duration) return;
		const rect = bar.getBoundingClientRect();
		const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		seek(pct * duration);
	}

	// Track hover state on the larger interaction zone so the visible bar can expand
	let progressHovered = $state(false);

	// Touch support for progress bar
	function handleProgressTouchStart(e: TouchEvent) {
		progressDragging = true;
		seekToTouchPosition(e);
	}

	function handleProgressTouchMove(e: TouchEvent) {
		if (progressDragging) {
			e.preventDefault();
			seekToTouchPosition(e);
		}
	}

	function handleProgressTouchEnd() {
		progressDragging = false;
	}

	function seekToTouchPosition(e: TouchEvent) {
		const bar = wrapperEl?.querySelector('.progress-bar-hitarea') as HTMLElement;
		if (!bar || !duration || !e.touches[0]) return;
		const rect = bar.getBoundingClientRect();
		const pct = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
		seek(pct * duration);
	}

	// -- SponsorBlock segment click (unskip) --
	let rewatchCleanup: (() => void) | null = null;
	let rewatchPrevAutoSkip = false;

	function handleSegmentClick(seg: SBSegment) {
		if (!videoEl) return;
		// Seek to start of the segment to re-watch it
		videoEl.currentTime = seg.segment[0];
		// Mark as skipped so auto-skip doesn't re-trigger immediately
		skippedUUIDs = new Set([...skippedUUIDs, seg.UUID]);
		// Capture the user's real auto-skip preference only on the first
		// re-watch; clear any in-flight listener so they don't stack.
		if (rewatchCleanup) {
			rewatchCleanup();
		} else {
			rewatchPrevAutoSkip = autoSkipEnabled;
		}
		autoSkipEnabled = false;
		const end = seg.segment[1];
		const el = videoEl;
		function checkEnd() {
			if (el.currentTime >= end) {
				autoSkipEnabled = rewatchPrevAutoSkip;
				cleanup();
			}
		}
		function cleanup() {
			el.removeEventListener('timeupdate', checkEnd);
			rewatchCleanup = null;
		}
		rewatchCleanup = cleanup;
		el.addEventListener('timeupdate', checkEnd);
	}

	// -- Keyboard shortcuts --
	function handleKeydown(e: KeyboardEvent) {
		// Ignore if an input/textarea is focused
		const tag = (e.target as HTMLElement)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

		let handled = true;

		switch (e.key) {
			case ' ':
				togglePlay();
				break;
			case 'ArrowLeft':
				seek(currentTime - 5);
				break;
			case 'ArrowRight':
				seek(currentTime + 5);
				break;
			case 'ArrowUp':
				changeVolume(0.1);
				break;
			case 'ArrowDown':
				changeVolume(-0.1);
				break;
			case 'f':
			case 'F':
				toggleFullscreen();
				break;
			case 't':
			case 'T':
				toggleTheaterMode();
				break;
			case 'p':
			case 'P':
				if (document.pictureInPictureEnabled) togglePip();
				break;
			case 'c':
			case 'C':
				cycleSubtitle();
				break;
			case 'm':
			case 'M':
				toggleMute();
				break;
			case '<':
				changeSpeed(-1);
				break;
			case '>':
				changeSpeed(1);
				break;
			case 'l':
			case 'L':
				copyLinkAtCurrentTime();
				break;
			case '?':
				showHelpOverlay();
				break;
			case 'Escape':
				if (theaterMode) toggleTheaterMode();
				else if (showHelp) showHelp = false;
				else handled = false;
				break;
			default:
				if (e.key >= '0' && e.key <= '9' && !e.ctrlKey && !e.altKey && !e.metaKey) {
					const pct = parseInt(e.key) / 10;
					seek(duration * pct);
				} else {
					handled = false;
				}
		}

		if (handled) {
			e.preventDefault();
			e.stopPropagation();
			resetHideTimer();
		}
	}

	// -- Time formatting --
	function formatTime(seconds: number): string {
		if (!isFinite(seconds) || seconds < 0) return '0:00';
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		const s = Math.floor(seconds % 60);
		if (h > 0) {
			return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
		}
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	// -- Derived values --
	let playedPct = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);
	let bufferedPct = $derived(duration > 0 ? (buffered / duration) * 100 : 0);

	let volumeIcon = $derived.by(() => {
		if (muted || volume === 0) return 'muted';
		if (volume < 0.5) return 'low';
		return 'high';
	});

	// -- Close speed menu on outside click --
	function handleWrapperClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (speedMenuOpen && !target.closest('.speed-control')) {
			speedMenuOpen = false;
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="video-player-wrapper"
	class:controls-hidden={!controlsVisible && !paused}
	class:theater-mode={theaterMode}
	bind:this={wrapperEl}
	tabindex="0"
	onkeydown={handleKeydown}
	onmousemove={resetHideTimer}
	onclick={handleWrapperClick}
	oncontextmenu={openContextMenu}
	role="application"
	aria-label="Video player"
>
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		bind:this={videoEl}
		{src}
		{poster}
		preload="metadata"
		onclick={togglePlay}
		ondblclick={toggleFullscreen}
		ontimeupdate={handleTimeUpdate}
		onloadedmetadata={handleMetadata}
		onplay={handlePlay}
		onpause={handlePause}
		onvolumechange={handleVolumeChange}
		onratechange={handleRateChange}
		onended={handleEnded}
		class="video-element"
	>
		{#each subtitles as sub}
			<track kind="subtitles" label={sub.label} srclang={sub.lang} src={sub.src} />
		{/each}
	</video>

	<!-- Big play button overlay when paused -->
	{#if paused && currentTime === 0}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="big-play-overlay" onclick={togglePlay}>
			<div class="big-play-btn">
				<svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
					<path d="M8 5v14l11-7z" />
				</svg>
			</div>
		</div>
	{/if}

	<!-- Custom controls overlay -->
	<div class="player-controls" class:visible={controlsVisible || paused}>
		<!-- Progress bar (large hit area wraps a thin visible bar) -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="progress-bar-hitarea"
			class:hovered={progressHovered || progressDragging}
			onmousedown={handleProgressMouseDown}
			ontouchstart={handleProgressTouchStart}
			ontouchmove={handleProgressTouchMove}
			ontouchend={handleProgressTouchEnd}
			onmouseenter={() => (progressHovered = true)}
			onmouseleave={() => (progressHovered = false)}
			role="slider"
			tabindex="0"
			aria-label="Seek"
			aria-valuenow={Math.floor(currentTime)}
			aria-valuemin={0}
			aria-valuemax={Math.floor(duration)}
			aria-valuetext="{formatTime(currentTime)} of {formatTime(duration)}"
		>
			<div class="progress-bar-track">
				<div class="progress-bar-buffered" style="width: {bufferedPct}%"></div>
				<div class="progress-bar-played" style="width: {playedPct}%">
					<div class="progress-bar-thumb"></div>
				</div>
				<!-- SponsorBlock segments -->
				{#each segments as seg}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="sb-segment"
						style="left: {(seg.segment[0] / duration) * 100}%; width: {((seg.segment[1] -
							seg.segment[0]) /
							duration) *
							100}%;"
						style:background-color={SEGMENT_COLORS[seg.category] || '#888'}
						title="{CATEGORY_LABELS[seg.category] || seg.category} ({formatTime(
							seg.segment[0],
						)} - {formatTime(seg.segment[1])})"
						onmousedown={(e: MouseEvent) => e.stopPropagation()}
						onclick={(e: MouseEvent) => {
							e.stopPropagation();
							handleSegmentClick(seg);
						}}
					></div>
				{/each}
			</div>
		</div>

		<div class="controls-row">
			<!-- Play/Pause -->
			<button class="ctrl-btn" onclick={togglePlay} aria-label={paused ? 'Play' : 'Pause'}>
				{#if paused}
					<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
						<path d="M8 5v14l11-7z" />
					</svg>
				{:else}
					<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
						<rect x="6" y="4" width="4" height="16" />
						<rect x="14" y="4" width="4" height="16" />
					</svg>
				{/if}
			</button>

			<!-- Time -->
			<div class="time-display">
				{formatTime(currentTime)} / {formatTime(duration)}
			</div>

			<div class="controls-spacer"></div>

			<!-- Speed selector -->
			<div class="speed-control">
				<button
					class="ctrl-btn speed-btn"
					onclick={() => (speedMenuOpen = !speedMenuOpen)}
					aria-label="Playback speed"
				>
					{playbackRate === 1 ? '1x' : playbackRate + 'x'}
				</button>
				{#if speedMenuOpen}
					<div class="speed-menu">
						{#each SPEED_OPTIONS as speed}
							<button
								class="speed-option"
								class:active={playbackRate === speed}
								onclick={() => setSpeed(speed)}
							>
								{speed}x
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Volume -->
			<div class="volume-control" class:dragging={volumeDragging}>
				<button class="ctrl-btn" onclick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
					{#if volumeIcon === 'muted'}
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none" />
							<line x1="23" y1="9" x2="17" y2="15" />
							<line x1="17" y1="9" x2="23" y2="15" />
						</svg>
					{:else if volumeIcon === 'low'}
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none" />
							<path d="M15.54 8.46a5 5 0 010 7.07" />
						</svg>
					{:else}
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none" />
							<path d="M15.54 8.46a5 5 0 010 7.07" />
							<path d="M19.07 4.93a10 10 0 010 14.14" />
						</svg>
					{/if}
				</button>
				<div
					class="volume-slider-wrapper"
					role="slider"
					tabindex="0"
					aria-label="Volume"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round((muted ? 0 : volume) * 100)}
					aria-valuetext="{Math.round((muted ? 0 : volume) * 100)}%"
					onkeydown={(e) => {
						if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
							e.preventDefault();
							changeVolume(0.05);
						} else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
							e.preventDefault();
							changeVolume(-0.05);
						} else if (e.key === 'Home') {
							e.preventDefault();
							setVolume(0);
						} else if (e.key === 'End') {
							e.preventDefault();
							setVolume(1);
						}
					}}
					onmousedown={(e) => {
						const track = e.currentTarget;
						const rect = track.getBoundingClientRect();
						const update = (clientX: number) =>
							setVolume(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)));
						volumeDragging = true;
						update(e.clientX);
						const onMove = (ev: MouseEvent) => update(ev.clientX);
						const onUp = () => {
							volumeDragging = false;
							window.removeEventListener('mousemove', onMove);
							window.removeEventListener('mouseup', onUp);
						};
						window.addEventListener('mousemove', onMove);
						window.addEventListener('mouseup', onUp);
					}}
				>
					<div class="volume-slider-fill" style="width: {(muted ? 0 : volume) * 100}%">
						<div class="volume-slider-thumb"></div>
					</div>
				</div>
			</div>

			<!-- Subtitles -->
			{#if subtitles.length > 0}
				<button
					class="ctrl-btn"
					class:subtitle-active={activeSubtitleIndex >= 0}
					onclick={cycleSubtitle}
					title={activeSubtitleIndex >= 0
						? `Subtitles: ${subtitles[activeSubtitleIndex]?.label}`
						: 'Subtitles off'}
					aria-label="Toggle subtitles"
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<rect x="2" y="4" width="20" height="16" rx="2" />
						<path d="M7 15h4M15 15h2M7 11h2M13 11h4" stroke-linecap="round" />
					</svg>
				</button>
			{/if}

			<!-- Chromecast -->
			{#if castAvailable}
				<button
					class="ctrl-btn"
					class:cast-active={castConnected}
					onclick={toggleCast}
					aria-label={castConnected ? 'Stop casting' : 'Cast'}
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							d="M2 16.1A5 5 0 015.9 20M2 12.05A9 9 0 019.95 20M2 8V6a2 2 0 012-2h16a2 2 0 012 2v12a2 2 0 01-2 2h-6"
						/>
						<line x1="2" y1="20" x2="2.01" y2="20" />
					</svg>
				</button>
			{/if}

			<!-- Picture-in-Picture -->
			{#if typeof document !== 'undefined' && document.pictureInPictureEnabled}
				<button
					class="ctrl-btn"
					class:pip-active={pipActive}
					onclick={togglePip}
					aria-label={pipActive ? 'Exit picture-in-picture' : 'Picture-in-picture'}
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<rect x="2" y="4" width="20" height="16" rx="2" />
						<rect x="12" y="11" width="8" height="6" rx="1" fill="currentColor" stroke="none" />
					</svg>
				</button>
			{/if}

			<!-- Theater mode -->
			<button
				class="ctrl-btn"
				class:theater-active={theaterMode}
				onclick={toggleTheaterMode}
				aria-label={theaterMode ? 'Exit theater mode' : 'Theater mode'}
			>
				{#if theaterMode}
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<rect x="2" y="6" width="20" height="12" rx="2" />
					</svg>
				{:else}
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<rect x="2" y="4" width="20" height="16" rx="2" />
						<line x1="2" y1="8" x2="22" y2="8" />
						<line x1="2" y1="16" x2="22" y2="16" />
					</svg>
				{/if}
			</button>

			<!-- Fullscreen -->
			<button
				class="ctrl-btn"
				onclick={toggleFullscreen}
				aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
			>
				{#if isFullscreen}
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"
						/>
					</svg>
				{:else}
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"
						/>
					</svg>
				{/if}
			</button>
		</div>
	</div>

	<!-- Skip notification toast -->
	{#if skipNotification}
		<div class="skip-toast">{skipNotification}</div>
	{/if}

	<!-- Link copied toast -->
	{#if linkCopiedNotification}
		<div class="skip-toast link-toast">{linkCopiedNotification}</div>
	{/if}

	<!-- Right-click context menu -->
	{#if contextMenu}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="ctx-backdrop" onclick={closeContextMenu}></div>
		<div
			class="ctx-menu"
			style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
			oncontextmenu={(e) => e.preventDefault()}
			role="menu"
			tabindex="-1"
			aria-label="Player options"
		>
			<button
				class="ctx-item ctx-item-toggle"
				class:active={loopEnabled}
				role="menuitemcheckbox"
				aria-checked={loopEnabled}
				onclick={() => {
					loopEnabled = !loopEnabled;
					closeContextMenu();
				}}
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<polyline points="17 1 21 5 17 9" />
					<path d="M3 11V9a4 4 0 014-4h14" />
					<polyline points="7 23 3 19 7 15" />
					<path d="M21 13v2a4 4 0 01-4 4H3" />
				</svg>
				Loop
				{#if loopEnabled}<span class="ctx-check"><CheckIcon width={14} height={14} /></span>{/if}
			</button>
			<button
				class="ctx-item ctx-item-toggle"
				class:active={autoSkipEnabled}
				role="menuitemcheckbox"
				aria-checked={autoSkipEnabled}
				onclick={() => {
					autoSkipEnabled = !autoSkipEnabled;
					closeContextMenu();
				}}
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="12" cy="12" r="10" />
					<path d="M10 15l5-3-5-3v6z" fill="currentColor" stroke="none" />
				</svg>
				Skip Sponsors
				{#if autoSkipEnabled}<span class="ctx-check"><CheckIcon width={14} height={14} /></span
					>{/if}
			</button>
			{#if downloadId}
				<button
					class="ctx-item"
					role="menuitem"
					onclick={() => {
						copyLinkAtCurrentTime();
						closeContextMenu();
					}}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
						<path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
					</svg>
					Copy link at current time
				</button>
			{/if}
			{#if onDownload}
				<button
					class="ctx-item"
					role="menuitem"
					onclick={() => {
						onDownload?.();
						closeContextMenu();
					}}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
						<polyline points="7 10 12 15 17 10" />
						<line x1="12" y1="15" x2="12" y2="3" />
					</svg>
					Download
				</button>
			{/if}
			<div class="ctx-divider"></div>
			<div class="ctx-label">Speed</div>
			<div class="ctx-speeds">
				{#each SPEED_OPTIONS as speed}
					<button
						class="ctx-speed"
						class:active={playbackRate === speed}
						role="menuitemradio"
						aria-checked={playbackRate === speed}
						onclick={() => {
							setSpeed(speed);
							closeContextMenu();
						}}
					>
						{speed}x
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Help overlay -->
	{#if showHelp}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="help-overlay"
			role="dialog"
			tabindex="-1"
			aria-label="Keyboard shortcuts"
			onmousedown={(e) => e.stopPropagation()}
			onclick={(e) => e.stopPropagation()}
		>
			<h4>Keyboard Shortcuts</h4>
			<div class="help-grid">
				<span>Space</span><span>Play / Pause</span>
				<span>← / →</span><span>Seek ±5s</span>
				<span>↑ / ↓</span><span>Volume ±10%</span>
				<span>0–9</span><span>Jump to %</span>
				<span>F</span><span>Fullscreen</span>
				<span>T</span><span>Theater mode</span>
				<span>P</span><span>Picture-in-picture</span>
				<span>M</span><span>Mute</span>
				<span>C</span><span>Cycle subtitles</span>
				<span>&lt; / &gt;</span><span>Speed down / up</span>
				<span>L</span><span>Copy link at time</span>
				<span>?</span><span>Show this help</span>
				<span>Esc</span><span>Exit theater / help</span>
			</div>
		</div>
	{/if}
</div>

<style>
	.video-player-wrapper {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		max-height: 80vh;
		background: #000;
		border-radius: var(--radius-lg);
		overflow: hidden;
		outline: none;
		user-select: none;
		-webkit-user-select: none;
	}

	.video-player-wrapper:focus-visible {
		box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3);
	}

	.video-element {
		width: 100%;
		height: 100%;
		display: block;
		cursor: pointer;
	}

	/* Big play overlay */
	.big-play-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		background: rgba(0, 0, 0, 0.3);
	}

	.big-play-btn {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		transition:
			transform var(--transition-fast),
			background var(--transition-fast);
	}

	.big-play-overlay:hover .big-play-btn {
		transform: scale(1.1);
		background: rgba(59, 130, 246, 0.8);
	}

	/* Controls */
	.player-controls {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		background: linear-gradient(transparent, rgba(0, 0, 0, 0.85));
		padding: 0 var(--spacing-md) var(--spacing-sm);
		opacity: 0;
		transition: opacity var(--transition-normal);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.player-controls.visible {
		opacity: 1;
	}

	.controls-hidden {
		cursor: none;
	}

	/* Progress bar — large invisible hit area wraps a thin visible track */
	.progress-bar-hitarea {
		position: relative;
		width: 100%;
		/* 4px visual bar + 16px padding top/bottom = 36px interaction zone */
		padding: 16px 0;
		cursor: pointer;
		touch-action: none;
	}

	.progress-bar-track {
		position: relative;
		width: 100%;
		height: 4px;
		background: var(--color-overlay-white-20);
		border-radius: 2px;
		pointer-events: none;
		transition: height var(--transition-fast);
	}

	.progress-bar-hitarea.hovered .progress-bar-track {
		height: 8px;
	}

	.progress-bar-buffered {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		background: var(--color-overlay-white-30);
		border-radius: 2px;
		pointer-events: none;
	}

	.progress-bar-played {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		background: var(--color-player-progress);
		border-radius: 2px;
		pointer-events: none;
		z-index: 1;
	}

	.progress-bar-thumb {
		position: absolute;
		right: -8px;
		top: 50%;
		transform: translateY(-50%);
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--color-player-progress);
		opacity: 0;
		transition: opacity var(--transition-fast);
	}

	.progress-bar-hitarea.hovered .progress-bar-thumb {
		opacity: 1;
	}

	/* SponsorBlock segments */
	.sb-segment {
		position: absolute;
		top: 0;
		height: 100%;
		border-radius: 2px;
		opacity: 0.7;
		z-index: 2;
		cursor: pointer;
		pointer-events: auto;
		transition: opacity var(--transition-fast);
		min-width: 2px;
	}

	.sb-segment:hover {
		opacity: 1;
	}

	/* Controls row */
	.controls-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.controls-spacer {
		flex: 1;
	}

	.ctrl-btn {
		background: none;
		border: none;
		color: white;
		width: 36px;
		height: 36px;
		min-height: unset;
		min-width: unset;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		border-radius: var(--radius-sm);
		transition: background var(--transition-fast);
		flex-shrink: 0;
	}

	.cast-active,
	.pip-active,
	.theater-active,
	.subtitle-active {
		color: var(--color-accent-primary);
	}

	.ctrl-btn:hover {
		background: var(--color-overlay-white-15);
	}

	.ctrl-btn:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--color-accent-primary);
	}

	/* Time display */
	.time-display {
		color: white;
		font-size: var(--font-size-control);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		padding: 0 var(--spacing-xs);
	}

	/* Speed control */
	.speed-control {
		position: relative;
	}

	.speed-btn {
		font-size: var(--font-size-control);
		font-weight: var(--font-weight-semibold);
		width: auto;
		padding: 0 var(--spacing-xs);
		min-width: 36px;
	}

	.speed-menu {
		position: absolute;
		bottom: 100%;
		right: 0;
		margin-bottom: var(--spacing-xs);
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		padding: var(--spacing-xs);
		display: flex;
		flex-direction: column;
		min-width: 80px;
		z-index: 10;
		box-shadow: var(--shadow-dropdown);
	}

	.speed-option {
		background: none;
		border: none;
		color: var(--color-text-secondary);
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--font-size-control);
		text-align: left;
		cursor: pointer;
		border-radius: var(--radius-sm);
		min-height: unset;
		min-width: unset;
		transition:
			background var(--transition-fast),
			color var(--transition-fast);
	}

	.speed-option:hover {
		background: var(--color-overlay-white-10);
		color: var(--color-text-primary);
	}

	.speed-option.active {
		color: var(--color-accent-primary);
		font-weight: var(--font-weight-semibold);
	}

	/* Theater mode */
	.theater-mode {
		position: fixed;
		inset: 0;
		z-index: var(--z-modal);
		border-radius: 0;
		background: #000;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.theater-mode .video-element {
		max-height: 95vh;
		max-width: 95vw;
		width: auto;
	}

	/* Volume control */
	.volume-control {
		display: flex;
		align-items: center;
	}

	.volume-slider-wrapper {
		position: relative;
		width: 0;
		height: 4px;
		background: var(--color-overlay-white-20);
		border-radius: 2px;
		cursor: pointer;
		overflow: visible;
		transition:
			width var(--transition-snappy),
			margin var(--transition-snappy);
		margin: 0;
	}

	.volume-slider-wrapper::before {
		content: '';
		position: absolute;
		top: -8px;
		bottom: -8px;
		left: 0;
		right: 0;
	}

	.volume-control:hover .volume-slider-wrapper,
	.volume-control.dragging .volume-slider-wrapper {
		width: 70px;
		margin-right: var(--spacing-sm);
		margin-left: 2px;
	}

	.volume-slider-fill {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		background: white;
		border-radius: 2px;
		display: flex;
		align-items: center;
		justify-content: flex-end;
	}

	.volume-slider-thumb {
		position: absolute;
		right: -5px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: white;
		opacity: 0;
		transition: opacity var(--transition-fast);
	}

	.volume-control:hover .volume-slider-thumb,
	.volume-control.dragging .volume-slider-thumb {
		opacity: 1;
	}

	/* Help overlay */
	.help-overlay {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background: var(--color-overlay-heavy);
		border: 1px solid var(--color-overlay-white-12);
		border-radius: var(--radius-lg);
		padding: var(--spacing-lg);
		color: white;
		z-index: 30;
		min-width: 280px;
		backdrop-filter: blur(8px);
	}

	.help-overlay h4 {
		margin: 0 0 var(--spacing-md);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-semibold);
		text-align: center;
		color: rgba(255, 255, 255, 0.7);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.help-grid {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 6px 16px;
		font-size: var(--font-size-control);
	}

	.help-grid span:nth-child(odd) {
		font-family: var(--font-family-mono);
		color: var(--color-accent-primary);
		white-space: nowrap;
	}

	.help-grid span:nth-child(even) {
		color: rgba(255, 255, 255, 0.8);
	}

	/* Context menu — matches the app's elevated dropdown/menu styling */
	.ctx-backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-overlay);
	}

	.ctx-menu {
		position: fixed;
		z-index: calc(var(--z-overlay) + 1);
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		padding: var(--spacing-xs);
		width: 232px;
		max-width: calc(100vw - 16px);
		box-shadow: var(--shadow-dropdown);
		animation: fadeIn var(--transition-fast) ease-out both;
	}

	.ctx-item {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: var(--spacing-sm);
		width: 100%;
		padding: var(--spacing-sm);
		background: none;
		border: none;
		color: var(--color-text-primary);
		font: inherit;
		font-size: var(--font-size-sm);
		cursor: pointer;
		border-radius: var(--radius-sm);
		text-align: left;
		transition: background var(--transition-fast);
		min-height: unset;
		min-width: unset;
	}

	.ctx-item:hover {
		background: var(--color-overlay-hover);
	}

	.ctx-item:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--color-accent-primary);
	}

	.ctx-check {
		display: inline-flex;
		margin-left: auto;
		color: var(--color-accent-primary);
	}

	.ctx-divider {
		height: 1px;
		background: var(--color-border-default);
		margin: var(--spacing-xs) 0;
	}

	.ctx-label {
		font-size: var(--font-size-2xs);
		color: var(--color-text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: var(--spacing-xs) var(--spacing-sm) 2px;
	}

	.ctx-speeds {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: var(--spacing-xs);
		padding: var(--spacing-xs);
	}

	.ctx-speed {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-bg-tertiary);
		border: none;
		color: var(--color-text-secondary);
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs) 0;
		text-align: center;
		font: inherit;
		font-size: var(--font-size-xs);
		cursor: pointer;
		transition:
			background var(--transition-fast),
			color var(--transition-fast);
		min-height: unset;
		min-width: unset;
	}

	.ctx-speed:hover {
		background: var(--color-bg-hover);
		color: var(--color-text-primary);
	}

	.ctx-speed:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--color-accent-primary);
	}

	.ctx-speed.active {
		background: var(--color-accent-primary);
		color: var(--color-text-on-accent);
	}

	/* Skip notification toast */
	.skip-toast {
		position: absolute;
		top: var(--spacing-lg);
		right: var(--spacing-lg);
		background: rgba(0, 0, 0, 0.8);
		color: white;
		padding: var(--spacing-sm) var(--spacing-md);
		border-radius: var(--radius-md);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		z-index: 20;
		pointer-events: none;
		animation: toast-in 0.3s ease;
		border-left: 3px solid #00d400;
	}

	.link-toast {
		border-left-color: var(--color-accent-primary);
	}

	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Mobile */
	@media (max-width: 768px) {
		.ctrl-btn {
			width: 44px;
			height: 44px;
		}

		/* Expand the progress bar hit area to 44px tall for comfortable thumb dragging */
		.progress-bar-hitarea {
			padding: 20px 0;
		}

		/* Always show a slightly thicker bar on touch devices since there's no hover */
		.progress-bar-track {
			height: 5px;
		}

		.progress-bar-thumb {
			opacity: 1;
			width: 14px;
			height: 14px;
			right: -7px;
		}

		.time-display {
			font-size: 0.75rem;
		}

		.speed-btn {
			font-size: 0.75rem;
		}

		.player-controls {
			padding: var(--spacing-sm);
		}

		.skip-toast {
			top: var(--spacing-md);
			right: var(--spacing-md);
			font-size: 0.75rem;
		}
	}

	/* Fullscreen adjustments */
	:global(:fullscreen) .video-element {
		max-height: 100vh;
	}
</style>
